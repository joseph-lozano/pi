import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import shakeExtension, { rewriteShakenToolResults, selectToolResults } from "../extensions/shake";

function user(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 1 };
}

function assistantWithCall(id: string, path = "file.ts"): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name: "read", arguments: { path } }],
		api: "test",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 2,
	};
}

function toolResult(id: string, text: string, toolName = "read"): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: 3,
	};
}

describe("selectToolResults", () => {
	test("keeps tool results inside the recent 4,000-token tail", () => {
		const messages = [assistantWithCall("recent"), toolResult("recent", "recent output")];
		expect(selectToolResults(messages).toolCallIds).toEqual([]);
	});

	test("selects older results once newer context exceeds the protected tail", () => {
		const messages = [
			assistantWithCall("old"),
			toolResult("old", "old output".repeat(100)),
			user("new context ".repeat(2_000)),
		];
		const selection = selectToolResults(messages);
		expect(selection.toolCallIds).toEqual(["old"]);
		expect(selection.approxTokensRemoved).toBeGreaterThan(0);
	});

	test("protects read results for Pi's loaded skill files", () => {
		const skillPath = "/skills/research/SKILL.md";
		const messages = [
			assistantWithCall("skill-call", skillPath),
			toolResult("skill-call", "skill data".repeat(100)),
			user("tail ".repeat(4_000)),
		];
		expect(
			selectToolResults(messages, { protectedReadPaths: new Set([skillPath]), cwd: "/repo" }).toolCallIds,
		).toEqual([]);
	});

	test("protects skill reads through equivalent symlink paths", () => {
		const directory = mkdtempSync(join(tmpdir(), "shake-skill-"));
		try {
			const skillPath = join(directory, "SKILL.md");
			const aliasPath = join(directory, "skill-alias.md");
			writeFileSync(skillPath, "skill instructions");
			symlinkSync(skillPath, aliasPath);
			const messages = [
				assistantWithCall("skill-call", aliasPath),
				toolResult("skill-call", "skill data".repeat(100)),
				user("tail ".repeat(4_000)),
			];
			expect(
				selectToolResults(messages, { protectedReadPaths: new Set([skillPath]), cwd: directory }).toolCallIds,
			).toEqual([]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("allows ordinary read results outside the recent tail", () => {
		const messages = [
			assistantWithCall("read-call", "/repo/file.ts"),
			toolResult("read-call", "source".repeat(100)),
			user("tail ".repeat(4_000)),
		];
		expect(
			selectToolResults(messages, { protectedReadPaths: new Set(["/skills/research/SKILL.md"]), cwd: "/repo" })
				.toolCallIds,
		).toEqual(["read-call"]);
	});
});

describe("rewriteShakenToolResults", () => {
	test("replaces result payload while preserving its assistant tool call", () => {
		const call = assistantWithCall("call-1");
		const result = toolResult("call-1", "secret output");
		const rewritten = rewriteShakenToolResults([call, result], new Set(["call-1"]));

		expect(rewritten[0]).toBe(call);
		expect(rewritten[1]).toMatchObject({
			role: "toolResult",
			toolCallId: "call-1",
			content: [{ type: "text", text: "[shaken read result]" }],
		});
		expect(JSON.stringify(rewritten)).not.toContain("secret output");
	});

	test("does not mutate the stored message objects", () => {
		const result = toolResult("call-1", "original");
		rewriteShakenToolResults([result], new Set(["call-1"]));
		expect(result).toMatchObject({ content: [{ text: "original" }] });
	});

	test("returns the original array when no result is selected", () => {
		const messages = [user("hello")];
		expect(rewriteShakenToolResults(messages, new Set())).toBe(messages);
	});
});

describe("extension state", () => {
	test("restores the active branch after session-tree navigation", async () => {
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const pi = {
			on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(name, handler);
			},
			registerCommand() {},
			appendEntry() {},
		};
		shakeExtension(pi as never);

		const legacyEntry = {
			type: "custom",
			customType: "shake-state",
			data: { version: 1, toolCallIds: ["legacy"] },
		};
		const deltaEntry = {
			type: "custom",
			customType: "shake-state",
			data: { version: 2, toolCallIds: ["branch-a"] },
		};
		await handlers.get("session_start")?.({}, { sessionManager: { getBranch: () => [legacyEntry, deltaEntry] } });

		const results = [toolResult("legacy", "old original"), toolResult("branch-a", "new original")];
		const onBranchA = (await handlers.get("context")?.({ messages: results }, {})) as { messages: AgentMessage[] };
		expect(JSON.stringify(onBranchA.messages)).not.toContain("original");

		const result = toolResult("branch-a", "original");

		await handlers.get("session_tree")?.({}, { sessionManager: { getBranch: () => [] } });
		const onBranchB = handlers.get("context")?.({ messages: [result] }, {});
		expect(onBranchB).toBeUndefined();
	});

	test("persists deltas and leaves later results visible until the next shake", async () => {
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		let command: ((args: string, ctx: unknown) => Promise<void>) | undefined;
		const appended: unknown[] = [];
		const notifications: string[] = [];
		const pi = {
			on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(name, handler);
			},
			registerCommand(_name: string, options: { handler: typeof command }) {
				command = options.handler;
			},
			appendEntry(_type: string, data: unknown) {
				appended.push(data);
			},
		};
		shakeExtension(pi as never);
		await handlers.get("session_start")?.({}, { sessionManager: { getBranch: () => [] } });

		const messages = [toolResult("old", "old".repeat(1_000)), user("tail ".repeat(4_000))];
		const ctx = {
			cwd: "/repo",
			waitForIdle: async () => {},
			sessionManager: { buildSessionContext: () => ({ messages }) },
			getSystemPromptOptions: () => ({ skills: [] }),
			ui: { notify: (message: string) => notifications.push(message) },
		};

		await command?.("ELIDE", ctx);
		messages.push(toolResult("later", "later".repeat(1_000)), user("new tail ".repeat(4_000)));

		const beforeSecondShake = handlers.get("context")?.({ messages }, {}) as { messages: AgentMessage[] };
		const laterBeforeSecondShake = beforeSecondShake.messages.find(
			(message) => message.role === "toolResult" && message.toolCallId === "later",
		);
		const laterText = laterBeforeSecondShake?.role === "toolResult"
			? laterBeforeSecondShake.content.find((part) => part.type === "text")?.text
			: undefined;
		expect(laterText).toContain("laterlater");

		await command?.("", ctx);
		await command?.("images", ctx);

		expect(appended).toEqual([
			{ version: 2, toolCallIds: ["old"] },
			{ version: 2, toolCallIds: ["later"] },
		]);
		expect(notifications[0]).toContain("Shook 1 tool result");
		expect(notifications[1]).toContain("Shook 1 tool result");
		expect(notifications[2]).toBe("Usage: /shake [elide]");
	});
});

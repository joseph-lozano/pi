import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
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

		const shakenEntry = {
			type: "custom",
			customType: "shake-state",
			data: { version: 1, toolCallIds: ["branch-a"] },
		};
		await handlers.get("session_start")?.({}, { sessionManager: { getBranch: () => [shakenEntry] } });

		const result = toolResult("branch-a", "original");
		const onBranchA = (await handlers.get("context")?.({ messages: [result] }, {})) as { messages: AgentMessage[] };
		expect(JSON.stringify(onBranchA.messages)).not.toContain("original");

		await handlers.get("session_tree")?.({}, { sessionManager: { getBranch: () => [] } });
		const onBranchB = handlers.get("context")?.({ messages: [result] }, {});
		expect(onBranchB).toBeUndefined();
	});

	test("persists one snapshot and makes repeated shakes a no-op", async () => {
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
		await command?.("", ctx);
		await command?.("images", ctx);

		expect(appended).toEqual([{ version: 1, toolCallIds: ["old"] }]);
		expect(notifications[0]).toContain("Shook 1 tool result");
		expect(notifications[1]).toContain("Nothing to shake");
		expect(notifications[2]).toBe("Usage: /shake [elide]");
	});
});

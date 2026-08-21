import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POTETO_MODE_ENTRY, potetoSystemPrompt, restorePotetoMode } from "../extensions/pstack/mode";
import { choiceForRole, choicesForRole, configuredModelIds, missingConfiguredModels } from "../extensions/pstack/models";
import { jobLogTail, listJobLogs, listWorkspaceSessions, resolveSessionFile, sessionTail } from "../extensions/pstack/sessions";
import { isPstackModelAvailable, setPstackAvailableModels } from "../extensions/pstack/shared";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Poteto Mode state", () => {
	test("restores the latest valid state on the active branch", () => {
		const entries = [
			{ type: "custom", customType: POTETO_MODE_ENTRY, data: { enabled: true } },
			{ type: "custom", customType: "other", data: { enabled: false } },
			{ type: "custom", customType: POTETO_MODE_ENTRY, data: { enabled: "invalid" } },
			{ type: "custom", customType: POTETO_MODE_ENTRY, data: { enabled: false } },
		];
		expect(restorePotetoMode(entries)).toBe(false);
		expect(restorePotetoMode(entries.slice(0, 1))).toBe(true);
	});

	test("injects the Pi workflow and local safety policy", () => {
		const prompt = potetoSystemPrompt("/agent/skills/poteto-mode/SKILL.md");
		expect(prompt).toContain("/agent/skills/poteto-mode/SKILL.md");
		expect(prompt).toContain("todo tool");
		expect(prompt).toContain("local job workers");
		expect(prompt).toContain("cloud agents are out of scope");
		expect(prompt).toContain("explicit user approval");
	});
});

describe("workspace session discovery", () => {
	test("lists only sibling sessions and returns bounded untrusted tails", () => {
		const root = mkdtempSync(join(tmpdir(), "pstack-sessions-"));
		roots.push(root);
		const current = join(root, "current.jsonl");
		const prior = join(root, "prior.jsonl");
		const unrelated = join(root, "unrelated.jsonl");
		writeFileSync(current, `${JSON.stringify({ type: "session", cwd: root })}\n`);
		writeFileSync(prior, [
			JSON.stringify({ type: "session", cwd: root }),
			JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "previous request" }] } }),
			JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "previous answer" }] } }),
		].join("\n"));
		writeFileSync(unrelated, `${JSON.stringify({ type: "session", cwd: "/unrelated/workspace" })}\n`);
		const listed = listWorkspaceSessions(current, root);
		expect(listed.map((entry) => entry.id)).toEqual(["prior"]);
		expect(resolveSessionFile(current, root, "prior")).toBe(prior);
		expect(() => resolveSessionFile(current, root, "unrelated")).toThrow("unknown workspace session");
		expect(() => resolveSessionFile(current, root, "../other")).toThrow("invalid session id");
		expect(sessionTail(prior, 1)).toBe("assistant: previous answer");
	});

	test("lists and tails only validated worker log IDs", () => {
		const root = mkdtempSync(join(tmpdir(), "pstack-jobs-"));
		roots.push(root);
		const current = join(root, "current.jsonl");
		writeFileSync(current, `${JSON.stringify({ type: "session", cwd: root })}\n`);
		mkdirSync(join(root, "background-jobs"));
		writeFileSync(join(root, "background-jobs", "job_abc_1.log"), "worker evidence");
		writeFileSync(join(root, "secret.log"), "secret");
		symlinkSync(join(root, "secret.log"), join(root, "background-jobs", "job_escape_1.log"));
		expect(listJobLogs(current, ["job_abc_1", "job_escape_1"]).map((entry) => entry.id)).toEqual(["job_abc_1"]);
		expect(jobLogTail(current, ["job_abc_1"], "job_abc_1")).toBe("worker evidence");
		expect(() => jobLogTail(current, ["job_escape_1"], "job_escape_1")).toThrow("unknown current-session job log");
		expect(() => jobLogTail(current, [], "../secret")).toThrow("invalid job id");
	});
});

describe("pstack model roles", () => {
	test("uses the configured Sol and Grok scoped models", () => {
		expect(configuredModelIds()).toEqual([
			"openai-codex/gpt-5.6-sol",
			"xai/grok-4.6",
		]);
		expect(choicesForRole("arena")).toHaveLength(2);
		expect(choicesForRole("code")).toEqual([
			{ model: "openai-codex/gpt-5.6-sol", thinking: "high" },
		]);
		expect(choiceForRole("arena", 1)).toEqual({ model: "xai/grok-4.6", thinking: "high" });
	});

	test("reports and enforces unavailable configured models", () => {
		expect(missingConfiguredModels(["openai-codex/gpt-5.6-sol"])).toEqual(["xai/grok-4.6"]);
		expect(missingConfiguredModels(configuredModelIds())).toEqual([]);
		setPstackAvailableModels(["openai-codex/gpt-5.6-sol"]);
		expect(isPstackModelAvailable("openai-codex/gpt-5.6-sol")).toBe(true);
		expect(isPstackModelAvailable("xai/grok-4.6")).toBe(false);
	});
});

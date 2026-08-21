import { describe, expect, test } from "bun:test";
import { POTETO_MODE_ENTRY, potetoSystemPrompt, restorePotetoMode } from "../extensions/pstack/mode";
import { choiceForRole, choicesForRole, configuredModelIds, missingConfiguredModels } from "../extensions/pstack/models";

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

	test("reports unavailable configured models", () => {
		expect(missingConfiguredModels(["openai-codex/gpt-5.6-sol"])).toEqual(["xai/grok-4.6"]);
		expect(missingConfiguredModels(configuredModelIds())).toEqual([]);
	});
});

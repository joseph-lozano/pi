import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PiProfileName, ThinkingLevel } from "./types";

export interface PiProfile {
	name: PiProfileName;
	label: string;
	icon: string;
	model?: string;
	thinking?: ThinkingLevel;
	tools: string[];
	extensions: string[];
	systemPrompt: string;
}

interface PiProfileDefinition extends Omit<PiProfile, "systemPrompt"> {
	promptFile: string;
}

const extensionPath = (name: string) => fileURLToPath(new URL(`../${name}`, import.meta.url));
const promptPath = (name: PiProfileName) => fileURLToPath(new URL(`./profiles/${name}.md`, import.meta.url));

const definitions: Record<PiProfileName, PiProfileDefinition> = {
	scout: {
		name: "scout",
		label: "Scout",
		icon: "🔭",
		model: "openai-codex/gpt-5.6-luna",
		thinking: "high",
		tools: ["read", "grep", "find", "ls"],
		extensions: [],
		promptFile: promptPath("scout"),
	},
	researcher: {
		name: "researcher",
		label: "Researcher",
		icon: "🔬",
		model: "openai-codex/gpt-5.6-luna",
		thinking: "high",
		tools: ["read", "write", "exa_search", "exa_fetch", "firecrawl_search", "firecrawl_fetch"],
		extensions: [extensionPath("exa.ts"), extensionPath("firecrawl.ts")],
		promptFile: promptPath("researcher"),
	},
	oracle: {
		name: "oracle",
		label: "Oracle",
		icon: "🔮",
		model: "openai-codex/gpt-5.6-sol",
		thinking: "xhigh",
		tools: ["read", "grep", "find", "ls"],
		extensions: [],
		promptFile: promptPath("oracle"),
	},
	worker: {
		name: "worker",
		label: "Worker",
		icon: "🛠️",
		model: "xai/grok-4.6",
		tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
		extensions: [],
		promptFile: promptPath("worker"),
	},
};

const cache = new Map<PiProfileName, PiProfile>();

export function getPiProfile(name: PiProfileName): PiProfile {
	const cached = cache.get(name);
	if (cached) return cached;
	const definition = definitions[name];
	const { promptFile, ...profile } = definition;
	const loaded = { ...profile, tools: [...profile.tools], extensions: [...profile.extensions], systemPrompt: readFileSync(promptFile, "utf8").trim() };
	cache.set(name, loaded);
	return loaded;
}

export function resolveProfileRuntime(
	profileName: PiProfileName | undefined,
	overrides: { model?: string; thinking?: ThinkingLevel },
	parent: { model?: string; thinking?: ThinkingLevel },
): { model?: string; thinking?: ThinkingLevel } {
	if (profileName !== "worker") return overrides;
	return {
		model: overrides.model ?? getPiProfile("worker").model,
		thinking: overrides.thinking ?? parent.thinking,
	};
}

export function jobIdentity(profileName: PiProfileName | undefined, kind: "shell" | "pi"): { icon: string; label: string } {
	if (profileName) {
		const profile = getPiProfile(profileName);
		return { icon: profile.icon, label: profile.name };
	}
	return kind === "shell" ? { icon: "🖥️", label: "shell" } : { icon: "🤖", label: "pi" };
}

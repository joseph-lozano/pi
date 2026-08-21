import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { JobKind, ThinkingLevel, WorkerProfileName } from "./types";

export interface WorkerConfig {
	tools: string[];
	extensions: string[];
	skills: string[];
	systemPrompt: string;
}

const pathFromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const WEB_EXTENSIONS = [pathFromHere("../exa.ts"), pathFromHere("../firecrawl.ts")];
const WRITE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "exa_search", "exa_fetch", "firecrawl_search", "firecrawl_fetch"];
const READ_TOOLS = ["read", "grep", "find", "ls", "exa_search", "exa_fetch", "firecrawl_search", "firecrawl_fetch"];

export const WORKER_PROFILE_NAMES = ["general", "writer", "poteto", "reviewer", "comment-sicko", "investigator"] as const satisfies readonly WorkerProfileName[];

const cached = new Map<WorkerProfileName, WorkerConfig>();

function profileText(name: string): string {
	return readFileSync(pathFromHere(`./profiles/${name}.md`), "utf8").trim();
}

export function getWorkerConfig(profile: WorkerProfileName = "general"): WorkerConfig {
	const existing = cached.get(profile);
	if (existing) return existing;

	let config: WorkerConfig;
	switch (profile) {
		case "general":
			config = { tools: WRITE_TOOLS, extensions: WEB_EXTENSIONS, skills: [], systemPrompt: profileText("worker") };
			break;
		case "writer":
			config = { tools: WRITE_TOOLS, extensions: WEB_EXTENSIONS, skills: [], systemPrompt: profileText("writer") };
			break;
		case "poteto":
			config = {
				tools: WRITE_TOOLS,
				extensions: WEB_EXTENSIONS,
				skills: [pathFromHere("../../skills/poteto-worker")],
				systemPrompt: `${profileText("poteto")}\n\n${readFileSync(pathFromHere("../../vendor/pstack/agents/poteto-agent.md"), "utf8").trim()}`,
			};
			break;
		case "reviewer":
			config = { tools: READ_TOOLS, extensions: WEB_EXTENSIONS, skills: [], systemPrompt: profileText("reviewer") };
			break;
		case "comment-sicko":
			config = {
				tools: READ_TOOLS,
				extensions: WEB_EXTENSIONS,
				skills: [],
				systemPrompt: `${profileText("reviewer")}\n\n${readFileSync(pathFromHere("../../vendor/pstack/agents/comment-sicko.md"), "utf8").trim()}`,
			};
			break;
		case "investigator":
			config = {
				tools: READ_TOOLS,
				extensions: WEB_EXTENSIONS,
				skills: [pathFromHere("../../skills/why")],
				systemPrompt: profileText("investigator"),
			};
			break;
	}
	cached.set(profile, config);
	return config;
}

export function resolveWorkerRuntime(
	overrides: { model?: string; thinking?: ThinkingLevel },
	parent: { model?: string; thinking?: ThinkingLevel },
): { model?: string; thinking?: ThinkingLevel } {
	return {
		model: overrides.model ?? parent.model,
		thinking: overrides.thinking ?? parent.thinking,
	};
}

export function jobIdentity(emoji: string | undefined, kind: JobKind): { icon: string; label: string } {
	return {
		icon: emoji?.trim() || (kind === "shell" ? "🖥️" : "🛠️"),
		label: kind === "shell" ? "shell" : "worker",
	};
}

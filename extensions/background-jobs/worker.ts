import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { JobKind, ThinkingLevel } from "./types";

export interface WorkerConfig {
	tools: string[];
	extensions: string[];
	systemPrompt: string;
}

const pathFromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));
let cached: WorkerConfig | undefined;

export function getWorkerConfig(): WorkerConfig {
	if (cached) return cached;
	cached = {
		tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "exa_search", "exa_fetch", "firecrawl_search", "firecrawl_fetch"],
		extensions: [pathFromHere("../exa.ts"), pathFromHere("../firecrawl.ts")],
		systemPrompt: readFileSync(pathFromHere("./profiles/worker.md"), "utf8").trim(),
	};
	return cached;
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

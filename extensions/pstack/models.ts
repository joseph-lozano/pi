import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export interface PstackModelChoice {
	model: string;
	thinking: ThinkingLevel;
}

export type PstackConfiguredChoice = PstackModelChoice | "inherit-parent";

export type PstackModelRole =
	| "feature"
	| "refactoring"
	| "bug-fix"
	| "perf-issue"
	| "hillclimb"
	| "judgment-prose"
	| "hardest"
	| "how-explorer"
	| "how-explainer"
	| "how-critics"
	| "why-investigator"
	| "why-synthesizer"
	| "reflect-tooling"
	| "reflect-judgment"
	| "arena-runners"
	| "arena-cross-judge"
	| "architect-runners"
	| "interrogate-reviewers"
	| "swarm";

const GROK_46: PstackModelChoice = {
	model: "xai/grok-4.6",
	thinking: "high",
};

const GROK_45: PstackModelChoice = {
	model: "xai/grok-4.5",
	thinking: "high",
};

const SOL: PstackModelChoice = {
	model: "openai-codex/gpt-5.6-sol",
	thinking: "max",
};

const LUNA: PstackModelChoice = {
	model: "openai-codex/gpt-5.6-luna",
	thinking: "high",
};

const TERRA: PstackModelChoice = {
	model: "openai-codex/gpt-5.6-terra",
	thinking: "high",
};

const OX_ALPHA_FREE: PstackModelChoice = {
	model: "opencode/x-preview-f-free",
	thinking: "max",
};

const PANEL = [GROK_46, GROK_45, SOL, LUNA, TERRA, OX_ALPHA_FREE] as const;

/** Static pstack model policy, adapted from Jesse Hanley's published role split. */
export const PSTACK_MODELS: Record<PstackModelRole, PstackConfiguredChoice | readonly PstackConfiguredChoice[]> = {
	feature: GROK_46,
	refactoring: GROK_46,
	"bug-fix": GROK_46,
	"perf-issue": SOL,
	hillclimb: SOL,
	"judgment-prose": GROK_46,
	hardest: GROK_46,
	"how-explorer": LUNA,
	"how-explainer": GROK_46,
	"how-critics": PANEL,
	"why-investigator": GROK_46,
	"why-synthesizer": GROK_46,
	"reflect-tooling": LUNA,
	"reflect-judgment": GROK_46,
	"arena-runners": PANEL,
	"arena-cross-judge": PANEL,
	"architect-runners": PANEL,
	"interrogate-reviewers": PANEL,
	swarm: GROK_46,
};

export function configuredChoicesForRole(role: PstackModelRole): readonly PstackConfiguredChoice[] {
	const configured = PSTACK_MODELS[role];
	return Array.isArray(configured) ? configured : [configured as PstackConfiguredChoice];
}

export function choicesForRole(role: PstackModelRole, parent?: PstackModelChoice): readonly PstackModelChoice[] {
	return configuredChoicesForRole(role).flatMap((choice) => choice === "inherit-parent"
		? parent ? [parent] : []
		: [choice]);
}

export function configuredModelIds(): string[] {
	return [...new Set(Object.values(PSTACK_MODELS).flatMap((choice) =>
		(Array.isArray(choice) ? choice : [choice]).flatMap((entry) => entry === "inherit-parent" ? [] : [entry.model]),
	))];
}

export function choiceForRole(role: PstackModelRole, panelIndex = 0, parent?: PstackModelChoice): PstackModelChoice | undefined {
	const choices = choicesForRole(role, parent);
	return choices.length > 0 ? choices[Math.abs(panelIndex) % choices.length] : parent;
}

export function missingConfiguredModels(availableCanonicalIds: readonly string[]): string[] {
	const available = new Set(availableCanonicalIds);
	return configuredModelIds().filter((id) => !available.has(id));
}

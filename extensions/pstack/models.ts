import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export interface PstackModelChoice {
	model: string;
	thinking: ThinkingLevel;
}

export type PstackConfiguredChoice = PstackModelChoice | "inherit-parent";

export type PstackModelRole =
	| "code"
	| "judgment"
	| "exploration"
	| "synthesis"
	| "review"
	| "arena"
	| "architect"
	| "swarm";

const SOL: PstackModelChoice = {
	model: "openai-codex/gpt-5.6-sol",
	thinking: "high",
};

const GROK: PstackModelChoice = {
	model: "xai/grok-4.6",
	thinking: "high",
};

/** Static pstack model policy. Change this source to change role routing. */
export const PSTACK_MODELS: Record<PstackModelRole, PstackConfiguredChoice | readonly PstackConfiguredChoice[]> = {
	code: SOL,
	judgment: SOL,
	exploration: GROK,
	synthesis: SOL,
	review: [SOL, GROK],
	arena: [SOL, GROK],
	architect: SOL,
	swarm: GROK,
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

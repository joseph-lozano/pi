export const POTETO_MODE_ENTRY = "poteto-mode-state";

interface PotetoModeState {
	enabled: boolean;
}

function parseState(data: unknown): PotetoModeState | undefined {
	if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
	const enabled = (data as { enabled?: unknown }).enabled;
	return typeof enabled === "boolean" ? { enabled } : undefined;
}

export function restorePotetoMode(entries: Array<{ type: string; customType?: string; data?: unknown }>): boolean {
	let enabled = false;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== POTETO_MODE_ENTRY) continue;
		const state = parseState(entry.data);
		if (state) enabled = state.enabled;
	}
	return enabled;
}

export function potetoSystemPrompt(skillPath: string): string {
	return `Poteto Mode is active.

Before substantive work:
1. Read the complete Poteto Mode skill at ${skillPath} and the linked Principles section.
2. Classify the request and read the matching playbook completely.
3. Use the todo tool to create the Principles item followed by the playbook steps verbatim; keep skipped steps with a concrete reason.
4. Replace Cursor Task/subagent instructions with local job workers. Use local worktrees only; cloud agents are out of scope.
5. Resolve pstack model roles through the extension's static model policy.
6. Never post, send, push, merge, deploy, or otherwise mutate an external system without presenting the exact content or action and receiving explicit user approval.

Continue from the persisted todo's active or first pending item.`;
}

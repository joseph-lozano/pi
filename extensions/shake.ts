import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";

const STATE_TYPE = "shake-state";
const STATE_VERSION = 1;
const PROTECTED_TAIL_TOKENS = 4_000;
const CHARS_PER_TOKEN = 4;

interface PersistedShakeState {
	version: number;
	toolCallIds: string[];
}

interface ToolResultLike {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: Array<{ type: string; text?: string }>;
}

interface ShakeSelectionOptions {
	alreadyShaken?: ReadonlySet<string>;
	cwd?: string;
	protectedReadPaths?: ReadonlySet<string>;
}

function isToolResult(message: AgentMessage): message is AgentMessage & ToolResultLike {
	return message.role === "toolResult";
}

function estimateTokens(message: AgentMessage): number {
	try {
		return Math.ceil(JSON.stringify(message).length / CHARS_PER_TOKEN);
	} catch {
		return 0;
	}
}

function hasPayload(message: ToolResultLike): boolean {
	return message.content.some(
		(part) => part.type === "image" || (part.type === "text" && typeof part.text === "string" && part.text.length > 0),
	);
}

function placeholder(message: ToolResultLike): string {
	return `[shaken ${message.toolName} result]`;
}

export interface ShakeSelection {
	toolCallIds: string[];
	approxTokensRemoved: number;
}

/** Select old tool results while preserving an approximate 4,000-token recent tail. */
export function selectToolResults(
	messages: AgentMessage[],
	options: ShakeSelectionOptions = {},
): ShakeSelection {
	const alreadyShaken = options.alreadyShaken ?? new Set<string>();
	const visibleMessages = rewriteShakenToolResults(messages, alreadyShaken);
	const protectedToolCallIds = collectProtectedReadIds(visibleMessages, options);
	const selected: string[] = [];
	let approxTokensRemoved = 0;
	let newerTokens = 0;

	for (let index = visibleMessages.length - 1; index >= 0; index--) {
		const message = visibleMessages[index];
		const protectedByTail = newerTokens < PROTECTED_TAIL_TOKENS;

		if (
			!protectedByTail &&
			isToolResult(message) &&
			message.toolName !== "skill" &&
			!protectedToolCallIds.has(message.toolCallId) &&
			!alreadyShaken.has(message.toolCallId) &&
			hasPayload(message)
		) {
			selected.push(message.toolCallId);
			approxTokensRemoved += Math.max(0, estimateTokens(message) - estimateTokens({
				...message,
				content: [{ type: "text", text: placeholder(message) }],
			}));
		}

		newerTokens += estimateTokens(message);
	}

	selected.reverse();
	return { toolCallIds: selected, approxTokensRemoved };
}

function collectProtectedReadIds(messages: AgentMessage[], options: ShakeSelectionOptions): Set<string> {
	const skillPaths = new Set(
		[...(options.protectedReadPaths ?? [])].map((path) => resolve(options.cwd ?? process.cwd(), path.replace(/^@/, ""))),
	);
	const protectedIds = new Set<string>();
	if (skillPaths.size === 0) return protectedIds;

	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part.type !== "toolCall" || part.name !== "read") continue;
			const path = part.arguments?.path;
			if (typeof path !== "string") continue;
			const absolutePath = resolve(options.cwd ?? process.cwd(), path.replace(/^@/, ""));
			if (skillPaths.has(absolutePath)) protectedIds.add(part.id);
		}
	}
	return protectedIds;
}

/** Replace selected tool-result payloads without removing their assistant tool calls. */
export function rewriteShakenToolResults(
	messages: AgentMessage[],
	shakenToolCallIds: ReadonlySet<string>,
): AgentMessage[] {
	let changed = false;
	const rewritten = messages.map((message) => {
		if (!isToolResult(message) || !shakenToolCallIds.has(message.toolCallId)) return message;
		changed = true;
		return {
			...message,
			content: [{ type: "text" as const, text: placeholder(message) }],
		};
	});
	return changed ? rewritten : messages;
}

function restoreState(entries: ReadonlyArray<unknown>): Set<string> {
	let restored = new Set<string>();
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as { type?: string; customType?: string; data?: unknown };
		if (candidate.type !== "custom" || candidate.customType !== STATE_TYPE) continue;
		if (!candidate.data || typeof candidate.data !== "object") continue;
		const data = candidate.data as Partial<PersistedShakeState>;
		if (data.version !== STATE_VERSION || !Array.isArray(data.toolCallIds)) continue;
		restored = new Set(data.toolCallIds.filter((id): id is string => typeof id === "string"));
	}
	return restored;
}

export default function shakeExtension(pi: ExtensionAPI) {
	let shakenToolCallIds = new Set<string>();

	const restoreFromBranch = (ctx: { sessionManager: { getBranch(): ReadonlyArray<unknown> } }) => {
		shakenToolCallIds = restoreState(ctx.sessionManager.getBranch());
	};

	pi.on("session_start", (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	pi.registerCommand("shake", {
		description: "Strip older tool-result payloads from future model context",
		handler: async (args, ctx) => {
			const mode = (args ?? "").trim().toLowerCase();
			if (mode !== "" && mode !== "elide") {
				ctx.ui.notify('Usage: /shake [elide]', "warning");
				return;
			}

			await ctx.waitForIdle();
			const messages = ctx.sessionManager.buildSessionContext().messages;
			const skillPaths = new Set(
				(ctx.getSystemPromptOptions().skills ?? []).map((skill) => skill.filePath),
			);
			const selection = selectToolResults(messages, {
				alreadyShaken: shakenToolCallIds,
				cwd: ctx.cwd,
				protectedReadPaths: skillPaths,
			});
			if (selection.toolCallIds.length === 0) {
				ctx.ui.notify("Nothing to shake. The recent context tail is protected.", "info");
				return;
			}

			for (const id of selection.toolCallIds) shakenToolCallIds.add(id);
			pi.appendEntry(STATE_TYPE, {
				version: STATE_VERSION,
				toolCallIds: [...shakenToolCallIds],
			} satisfies PersistedShakeState);

			ctx.ui.notify(
				`Shook ${selection.toolCallIds.length} tool result${selection.toolCallIds.length === 1 ? "" : "s"} (~${selection.approxTokensRemoved} tokens removed from future model context).`,
				"info",
			);
		},
	});

	pi.on("context", (event) => {
		if (shakenToolCallIds.size === 0) return;
		return { messages: rewriteShakenToolResults(event.messages, shakenToolCallIds) };
	});
}

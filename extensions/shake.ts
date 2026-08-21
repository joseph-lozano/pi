import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const STATE_TYPE = "shake-state";
const STATE_VERSION = 2;
const PROTECTED_TAIL_TOKENS = 4_000;
const CHARS_PER_TOKEN = 4;
const COMPACT_AFTER_SHAKE_PERCENT = 50;

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

type BranchEntry = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>[number];
type MessageEntry = Extract<BranchEntry, { type: "message" }>;
type UserEntry = MessageEntry & { message: UserMessage };

interface PendingOverflowRetry {
	userEntryId: string;
	content: UserMessage["content"];
	toolCallIds: string[];
}

function isToolResult(message: AgentMessage): message is AgentMessage & ToolResultLike {
	return message.role === "toolResult";
}

function findLastUserEntry(branch: ReadonlyArray<BranchEntry>): UserEntry | undefined {
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type === "message" && entry.message.role === "user") return entry as UserEntry;
	}
	return undefined;
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

function canonicalPath(path: string, cwd: string): string {
	const stripped = path.replace(/^@/, "");
	const expanded = stripped === "~" || stripped.startsWith("~/")
		? resolve(homedir(), stripped.slice(2))
		: resolve(cwd, stripped);
	try {
		return realpathSync.native(expanded);
	} catch {
		return expanded;
	}
}

function collectProtectedReadIds(messages: AgentMessage[], options: ShakeSelectionOptions): Set<string> {
	const cwd = options.cwd ?? process.cwd();
	const skillPaths = new Set(
		[...(options.protectedReadPaths ?? [])].map((path) => canonicalPath(path, cwd)),
	);
	const protectedIds = new Set<string>();
	if (skillPaths.size === 0) return protectedIds;

	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part.type !== "toolCall" || part.name !== "read") continue;
			const path = part.arguments?.path;
			if (typeof path !== "string") continue;
			if (skillPaths.has(canonicalPath(path, cwd))) protectedIds.add(part.id);
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
	const restored = new Set<string>();
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as { type?: string; customType?: string; data?: unknown };
		if (candidate.type !== "custom" || candidate.customType !== STATE_TYPE) continue;
		if (!candidate.data || typeof candidate.data !== "object") continue;
		const data = candidate.data as Partial<PersistedShakeState>;
		if (data.version !== 1 && data.version !== STATE_VERSION) continue;
		if (!Array.isArray(data.toolCallIds)) continue;
		for (const id of data.toolCallIds) {
			if (typeof id === "string") restored.add(id);
		}
	}
	return restored;
}

export default function shakeExtension(pi: ExtensionAPI) {
	let shakenToolCallIds = new Set<string>();
	let protectedReadPaths = new Set<string>();
	let pendingOverflowRetry: PendingOverflowRetry | undefined;

	const restoreFromBranch = (ctx: { sessionManager: { getBranch(): ReadonlyArray<unknown> } }) => {
		shakenToolCallIds = restoreState(ctx.sessionManager.getBranch());
	};

	const applyShake = (
		messages: AgentMessage[],
		ctx: { cwd: string; ui: { notify(message: string, level: "info" | "warning"): void } },
		automatic: boolean,
	) => {
		const selection = selectToolResults(messages, {
			alreadyShaken: shakenToolCallIds,
			cwd: ctx.cwd,
			protectedReadPaths,
		});
		if (selection.toolCallIds.length === 0) {
			ctx.ui.notify(
				automatic
					? "There was nothing eligible to shake."
					: "Nothing to shake. The recent context tail is protected.",
				automatic ? "warning" : "info",
			);
			return selection;
		}

		for (const id of selection.toolCallIds) shakenToolCallIds.add(id);
		pi.appendEntry(STATE_TYPE, {
			version: STATE_VERSION,
			toolCallIds: selection.toolCallIds,
		} satisfies PersistedShakeState);

		ctx.ui.notify(
			`${automatic ? "Auto-shook" : "Shook"} ${selection.toolCallIds.length} tool result${selection.toolCallIds.length === 1 ? "" : "s"} (~${selection.approxTokensRemoved} tokens removed from future agent-turn context).`,
			"info",
		);
		return selection;
	};

	pi.on("session_start", (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	pi.on("before_agent_start", (event) => {
		protectedReadPaths = new Set((event.systemPromptOptions.skills ?? []).map((skill) => skill.filePath));
	});

	pi.on("session_before_compact", (event, ctx) => {
		if (event.reason === "manual") return;
		const messages = ctx.sessionManager.buildSessionContext().messages;
		const selection = applyShake(messages, ctx, true);
		const usage = ctx.getContextUsage?.();
		const resultingTokens = usage?.tokens === null || usage?.tokens === undefined
			? undefined
			: Math.max(0, usage.tokens - selection.approxTokensRemoved);
		const shouldCompact = resultingTokens !== undefined &&
			resultingTokens / usage!.contextWindow * 100 > COMPACT_AFTER_SHAKE_PERCENT;

		if (shouldCompact) {
			ctx.ui.notify("Context is still over 50% after automatic shake; continuing with compaction.", "info");
			return;
		}

		if (event.reason === "overflow" && event.willRetry && selection.toolCallIds.length > 0) {
			const userEntry = findLastUserEntry(ctx.sessionManager.getBranch());
			if (userEntry) {
				pendingOverflowRetry = {
					userEntryId: userEntry.id,
					content: userEntry.message.content,
					toolCallIds: selection.toolCallIds,
				};
			}
		}
		return { cancel: true };
	});

	pi.on("agent_settled", () => {
		if (!pendingOverflowRetry) return;
		pi.sendUserMessage("/shake-overflow-retry", { expandPromptTemplates: true });
	});

	pi.registerCommand("shake-overflow-retry", {
		description: "Retry an overflowed turn after automatic shake",
		handler: async (_args, ctx) => {
			const retry = pendingOverflowRetry;
			pendingOverflowRetry = undefined;
			if (!retry) return;

			const navigation = await ctx.navigateTree(retry.userEntryId, { summarize: false });
			if (navigation.cancelled) {
				ctx.ui.notify("Overflow retry canceled by session navigation", "warning");
				return;
			}

			for (const id of retry.toolCallIds) shakenToolCallIds.add(id);
			pi.appendEntry(STATE_TYPE, {
				version: STATE_VERSION,
				toolCallIds: retry.toolCallIds,
			} satisfies PersistedShakeState);
			ctx.ui.setEditorText("");
			ctx.ui.notify("Retrying overflowed turn after shake", "info");
			pi.sendUserMessage(retry.content);
		},
	});

	pi.registerCommand("shake", {
		description: "Strip older tool-result payloads from future agent-turn context",
		handler: async (args, ctx) => {
			const mode = (args ?? "").trim().toLowerCase();
			if (mode !== "" && mode !== "elide") {
				ctx.ui.notify('Usage: /shake [elide]', "warning");
				return;
			}

			await ctx.waitForIdle();
			const messages = ctx.sessionManager.buildSessionContext().messages;
			protectedReadPaths = new Set(
				(ctx.getSystemPromptOptions().skills ?? []).map((skill) => skill.filePath),
			);
			applyShake(messages, ctx, false);
		},
	});

	pi.on("context", (event) => {
		if (shakenToolCallIds.size === 0) return;
		return { messages: rewriteShakenToolResults(event.messages, shakenToolCallIds) };
	});
}

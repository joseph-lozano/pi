import type { UserMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type FailedTurn = {
	userEntryId: string;
	stopReason: "error" | "aborted";
	errorSnippet?: string;
};

type BranchEntry = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>[number];
type MessageEntry = Extract<BranchEntry, { type: "message" }>;
type UserEntry = MessageEntry & { message: UserMessage };

function findLastUserEntry(branch: BranchEntry[]): UserEntry | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "message" && entry.message.role === "user") {
			return entry as UserEntry;
		}
	}
	return undefined;
}

function errorSnippet(message: {
	errorMessage?: string;
	content: Array<{ type: string; text?: string }>;
}): string | undefined {
	const error = message.errorMessage?.trim();
	const text = message.content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join(" ")
		.trim();
	const snippet = (error || text).replace(/\s+/g, " ");
	if (!snippet) return undefined;
	return snippet.length > 100 ? `${snippet.slice(0, 99)}…` : snippet;
}

function retryNotice(snippet?: string): string {
	return snippet ? `Retrying: ${snippet}` : "Retrying last user message";
}

export default function retryExtension(pi: ExtensionAPI) {
	let failedTurn: FailedTurn | undefined;

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;

		if (
			event.message.stopReason !== "error" &&
			event.message.stopReason !== "aborted"
		) {
			failedTurn = undefined;
			return;
		}

		const userEntry = findLastUserEntry(ctx.sessionManager.getBranch());
		if (!userEntry) return;
		failedTurn = {
			userEntryId: userEntry.id,
			stopReason: event.message.stopReason,
			errorSnippet: errorSnippet(event.message),
		};
	});

	pi.registerCommand("retry", {
		description: "Retry the last user message after a failed turn",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy; retry skipped", "warning");
				return;
			}

			const branch = ctx.sessionManager.getBranch();
			const userEntry = findLastUserEntry(branch);
			if (!userEntry) {
				ctx.ui.notify("No user message to retry", "warning");
				return;
			}

			const leaf = branch[branch.length - 1];
			if (leaf?.type === "message" && leaf.message.role === "user") {
				if (
					failedTurn?.userEntryId !== leaf.id ||
					failedTurn.stopReason !== "error"
				) {
					ctx.ui.notify("Last turn did not fail", "warning");
					return;
				}

				await ctx.navigateTree(userEntry.id, { summarize: false });
				ctx.ui.setEditorText("");
				ctx.ui.notify(retryNotice(failedTurn.errorSnippet), "info");
				pi.sendUserMessage(userEntry.message.content);
				return;
			}

			if (
				leaf?.type !== "message" ||
				leaf.message.role !== "assistant" ||
				(leaf.message.stopReason !== "error" &&
					leaf.message.stopReason !== "aborted")
			) {
				ctx.ui.notify("Last turn did not fail", "warning");
				return;
			}

			const snippet = errorSnippet(leaf.message);
			await ctx.navigateTree(userEntry.id, { summarize: false });
			ctx.ui.setEditorText("");
			ctx.ui.notify(retryNotice(snippet), "info");
			pi.sendUserMessage(userEntry.message.content);
		},
	});
}

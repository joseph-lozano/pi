import { uuidv7 } from "@earendil-works/pi-ai";
import { convertToLlm, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildBtwMessages, BTW_SYSTEM_INSTRUCTION, extractBtwAnswer } from "./model";
import { BtwOverlay } from "./overlay";
import { buildBtwAgentContext } from "./session-context";

export default function btwExtension(pi: ExtensionAPI) {
	pi.registerCommand("btw", {
		description: "Ask a one-off question using the current context",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/btw requires interactive mode", "error");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn before using /btw", "warning");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}
			if (!ctx.modelRegistry.hasConfiguredAuth(ctx.model)) {
				ctx.ui.notify(`No authentication configured for ${ctx.model.provider}/${ctx.model.id}`, "error");
				return;
			}

			const question = args.trim();
			if (!question) {
				ctx.ui.notify("Usage: /btw <question>", "warning");
				return;
			}

			const model = ctx.model;
			const context = convertToLlm(buildBtwAgentContext(ctx.sessionManager.buildContextEntries()));
			const messages = buildBtwMessages(context, question);
			const systemPrompt = `${ctx.getSystemPrompt()}\n\n${BTW_SYSTEM_INSTRUCTION}`;
			const reasoningEffort = ctx.thinkingLevel;

			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => new BtwOverlay(
					question,
					theme,
					() => tui.requestRender(),
					done,
					async (signal) => {
						const response = await ctx.modelRegistry.complete(
							model,
							{ systemPrompt, messages },
							{ signal, reasoningEffort, cacheRetention: "none", sessionId: uuidv7() },
						);
						if (response.stopReason === "error") {
							throw new Error(response.errorMessage || "The model request failed");
						}
						return extractBtwAnswer(response);
					},
				),
				{
					overlay: true,
					overlayOptions: { width: "100%", maxHeight: 22, anchor: "bottom-center", margin: 0 },
				},
			);
		},
	});
}

import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { POTETO_MODE_ENTRY, potetoSystemPrompt, restorePotetoMode } from "./mode";
import { missingConfiguredModels } from "./models";
import { setPotetoModeEnabled } from "./shared";

export default function pstackExtension(pi: ExtensionAPI) {
	let enabled = false;

	const applyState = (next: boolean, ctx: ExtensionContext, persist: boolean) => {
		enabled = next;
		setPotetoModeEnabled(next);
		if (persist) pi.appendEntry(POTETO_MODE_ENTRY, { enabled: next });
		if (ctx.hasUI) ctx.ui.notify(`Poteto Mode ${next ? "enabled" : "disabled"}`, "info");
	};

	const restore = (ctx: ExtensionContext) => {
		enabled = restorePotetoMode(ctx.sessionManager.getBranch());
		setPotetoModeEnabled(enabled);
	};

	pi.on("session_start", (_event, ctx) => {
		restore(ctx);
		const scoped = ctx.scopedModels.length > 0
			? ctx.scopedModels.map(({ model }) => `${model.provider}/${model.id}`)
			: ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`);
		const missing = missingConfiguredModels(scoped);
		if (missing.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`Pstack model configuration unavailable: ${missing.join(", ")}`, "warning");
		}
	});

	pi.on("session_tree", (_event, ctx) => restore(ctx));

	pi.on("before_agent_start", (event) => {
		if (!enabled) return;
		const skillPath = join(getAgentDir(), "skills", "poteto-mode", "SKILL.md");
		return { systemPrompt: `${event.systemPrompt}\n\n${potetoSystemPrompt(skillPath)}` };
	});

	pi.registerCommand("poteto-mode", {
		description: "Enable persistent Poteto Mode, run an optional task, or disable with 'off'",
		handler: async (args, ctx) => {
			const task = args.trim();
			if (task.toLowerCase() === "off") {
				applyState(false, ctx, true);
				return;
			}
			applyState(true, ctx, true);
			if (task) pi.sendUserMessage(task);
		},
	});

}

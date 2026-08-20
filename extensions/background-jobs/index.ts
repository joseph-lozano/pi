import { resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { formatCompletionBatch, formatJob } from "./format";
import { JobManager, shouldPreserveJobsOnShutdown } from "./manager";
import { BackgroundJobsOverlay } from "./overlay";
import type { JobRecord, JobSpec, PersistedJobRecord } from "./types";

const ENTRY_TYPE = "background-job-record";
const MESSAGE_TYPE = "background-job-completion";
const BATCH_MS = 3_000;
const REGISTRY_KEY = Symbol.for("pi.background-jobs.registry.v1");

interface RegistryGlobal { [REGISTRY_KEY]?: JobManager }

export function getBackgroundJobManager(): JobManager {
	const global = globalThis as typeof globalThis & RegistryGlobal;
	return global[REGISTRY_KEY] ??= new JobManager();
}

function summary(job: JobRecord): string {
	return `${job.id}  ${job.status}  ${job.spec.kind}  ${job.logPath}`;
}

function restoreRecords(ctx: ExtensionContext): PersistedJobRecord[] {
	const latest = new Map<string, PersistedJobRecord>();
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
		const record = (entry.data as { record?: PersistedJobRecord } | undefined)?.record;
		if (record?.version === 1 && record.owner?.sessionId === ctx.sessionManager.getSessionId()) latest.set(record.id, record);
	}
	return [...latest.values()];
}

export default function backgroundJobsExtension(pi: ExtensionAPI) {
	const manager = getBackgroundJobManager();
	let sessionId: string | undefined;
	let currentContext: ExtensionContext | undefined;
	let unsubscribe: (() => void) | undefined;
	let batchTimer: NodeJS.Timeout | undefined;
	const batchIds = new Set<string>();

	const persist = (job: JobRecord) => {
		if (!sessionId || job.owner.sessionId !== sessionId) return;
		const record = manager.toPersisted(job);
		if (record) pi.appendEntry(ENTRY_TYPE, { record });
	};

	const flushBatch = () => {
		batchTimer = undefined;
		if (!sessionId || !currentContext) return;
		const ids = [...batchIds];
		batchIds.clear();
		const pending = ids.map((id) => manager.get(id, sessionId!)).filter((job): job is JobRecord => job?.delivery === "pending");
		if (pending.length === 0) return;
		for (let offset = 0; offset < pending.length; offset += 20) {
			const group = pending.slice(offset, offset + 20);
			const content = formatCompletionBatch(group);
			const injected = manager.markInjected(group.map((job) => job.id), sessionId);
			try {
				pi.sendMessage(
					{ customType: MESSAGE_TYPE, content, display: true, details: { jobIds: injected.map((job) => job.id) } },
					{ triggerTurn: true, deliverAs: currentContext.isIdle() ? "steer" : "followUp" },
				);
			} catch (error) {
				manager.resetInjected(injected.map((job) => job.id), sessionId);
				for (const job of pending.slice(offset)) schedule(job);
				currentContext.ui.notify(`Could not deliver background completion: ${error instanceof Error ? error.message : String(error)}`, "error");
				break;
			}
		}
	};

	const schedule = (job: JobRecord) => {
		if (!sessionId || job.owner.sessionId !== sessionId || job.delivery !== "pending") return;
		batchIds.add(job.id);
		if (!batchTimer) {
			batchTimer = setTimeout(flushBatch, BATCH_MS);
			batchTimer.unref?.();
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId();
		currentContext = ctx;
		const restored = restoreRecords(ctx);
		const restoredIds = new Set(restored.map((record) => record.id));
		manager.restore(restored);
		unsubscribe?.();
		unsubscribe = manager.subscribe((event) => {
			if (!sessionId || event.job.owner.sessionId !== sessionId) return;
			if (event.type === "completed" || event.type === "dismissed" || (event.type === "changed" && event.job.delivery === "injected")) persist(event.job);
			if (event.type === "completed" || (event.type === "changed" && event.job.finishedAt && event.job.delivery === "pending")) schedule(event.job);
		});
		for (const job of manager.list(sessionId, true)) {
			if (job.finishedAt && !restoredIds.has(job.id)) persist(job);
			if (job.finishedAt && job.delivery === "pending") schedule(job);
		}
	});

	pi.on("session_shutdown", async (event) => {
		if (batchTimer) clearTimeout(batchTimer);
		batchTimer = undefined;
		batchIds.clear();
		if (!shouldPreserveJobsOnShutdown(event.reason) && sessionId) await manager.stopAll(sessionId);
		unsubscribe?.();
		unsubscribe = undefined;
		currentContext = undefined;
	});

	pi.registerMessageRenderer(MESSAGE_TYPE, (message, options, theme) => {
		const content = typeof message.content === "string" ? message.content : "Background jobs completed";
		return new Text(theme.fg("accent", content), options.outputPad, 0);
	});

	pi.registerTool({
		name: "job",
		label: "Job",
		description: "Supervise session-owned shell or one-shot Pi subprocess jobs. Actions: start, wait, status, stop. Background starts return a stable job ID; wait claims completion so it is delivered exactly once. Output is bounded and complete output is written to the returned log path.",
		promptSnippet: "Start, wait for, inspect, or stop managed background jobs",
		promptGuidelines: ["Use job for managed long-running shell work or an isolated one-shot Pi task when the parent should remain responsive."],
		parameters: Type.Object({
			action: StringEnum(["start", "wait", "status", "stop"] as const),
			id: Type.Optional(Type.String({ description: "Stable job ID for wait, status, or stop" })),
			kind: Type.Optional(StringEnum(["shell", "pi"] as const, { description: "Job kind for start" })),
			mode: Type.Optional(StringEnum(["blocking", "background"] as const, { description: "Launch mode; default background" })),
			wake: Type.Optional(StringEnum(["always", "never", "on-failure"] as const, { description: "Background completion wake policy; default always" })),
			command: Type.Optional(Type.String({ description: "Shell command for a shell job" })),
			prompt: Type.Optional(Type.String({ description: "Prompt for a one-shot Pi job" })),
			cwd: Type.Optional(Type.String({ description: "Working directory; default is the parent cwd" })),
			model: Type.Optional(Type.String({ description: "Optional provider/model for a Pi job" })),
			thinking: Type.Optional(StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const owner = { sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile() };
			if (params.action === "status") {
				if (params.id) {
					const job = manager.get(params.id, owner.sessionId);
					if (!job) return { content: [{ type: "text" as const, text: `Unknown job: ${params.id}` }], details: {} };
					return { content: [{ type: "text" as const, text: formatJob(job) }], details: { job } };
				}
				const jobs = manager.list(owner.sessionId);
				return { content: [{ type: "text" as const, text: jobs.length ? jobs.map(summary).join("\n") : "No jobs in this session." }], details: { jobs } };
			}

			if (!params.id && params.action !== "start") return { content: [{ type: "text" as const, text: `job ${params.action} requires id` }], details: {} };
			if (params.action === "wait") {
				try {
					const job = await manager.wait(params.id!, owner.sessionId, signal, true);
					return { content: [{ type: "text" as const, text: formatJob(job) }], details: { job } };
				} catch (error) {
					if ((error as Error).name === "AbortError") {
						manager.releaseClaim(params.id!, owner.sessionId);
						return { content: [{ type: "text" as const, text: `Wait aborted; ${params.id} is still managed in the background.` }], details: {} };
					}
					throw error;
				}
			}
			if (params.action === "stop") {
				const job = await manager.stop(params.id!, owner.sessionId);
				return { content: [{ type: "text" as const, text: formatJob(job) }], details: { job } };
			}

			const kind = params.kind ?? "shell";
			if (kind === "shell" && !params.command?.trim()) return { content: [{ type: "text" as const, text: "A shell start requires command." }], details: {} };
			if (kind === "pi" && !params.prompt?.trim()) return { content: [{ type: "text" as const, text: "A Pi start requires prompt." }], details: {} };
			const spec: JobSpec = {
				kind,
				mode: params.mode ?? "background",
				wake: params.wake ?? "always",
				cwd: resolve(ctx.cwd, params.cwd ?? ctx.cwd),
				command: params.command,
				prompt: params.prompt,
				model: params.model,
				thinking: params.thinking,
			};
			const blocking = spec.mode === "blocking";
			const job = manager.start(owner, spec, blocking);
			if (!blocking) return { content: [{ type: "text" as const, text: `Started ${job.id} in background.\nLog: ${job.logPath}` }], details: { job } };
			try {
				const completed = await manager.wait(job.id, owner.sessionId, signal, false);
				return { content: [{ type: "text" as const, text: formatJob(completed) }], details: { job: completed } };
			} catch (error) {
				if ((error as Error).name === "AbortError") {
					manager.releaseClaim(job.id, owner.sessionId);
					return { content: [{ type: "text" as const, text: `Blocking wait aborted; ${job.id} continues in background.\nLog: ${job.logPath}` }], details: { job } };
				}
				throw error;
			}
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold(`job ${args.action}`)) + (args.id ? ` ${theme.fg("accent", args.id)}` : ""), 0, 0);
		},
	});

	pi.registerCommand("bg", {
		description: "Open the background jobs supervisor",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/bg requires interactive mode", "error");
				return;
			}
			const id = ctx.sessionManager.getSessionId();
			const result = await ctx.ui.custom(
				(tui, theme, _keybindings, done) => new BackgroundJobsOverlay(manager, id, theme, () => tui.requestRender(), done),
				{ overlay: true, overlayOptions: { width: "85%", maxHeight: "80%", minWidth: 60, anchor: "center", margin: 1 } },
			);
			if (result?.action === "log") {
				ctx.ui.setEditorText(result.path);
				ctx.ui.notify(`Log path copied to editor: ${result.path}`, "info");
			}
		},
	});
}

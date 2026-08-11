/**
 * xAI Priority Processing ("fast mode") for Grok models.
 *
 * xAI exposes higher-priority scheduling via:
 *   service_tier: "priority"
 * on Chat Completions and Responses
 * (https://docs.x.ai/developers/advanced-api-usage/priority-processing).
 *
 * grok-4.5 uses api=openai-responses, so this extension injects that field
 * when fast mode is enabled.
 *
 * Commands:
 *   /fast          toggle on ↔ off for the current xAI session model
 *   /fast on       enable
 *   /fast off      disable
 *   /fast status   show state
 *
 * State is persisted in ~/.pi/agent/xai-fast.json (or $PI_CODING_AGENT_DIR).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const CONFIG_FILE = "xai-fast.json";
const FAST_TIER = "priority";
const SUPPORTED_APIS = new Set(["openai-responses", "openai-completions"]);

type FastConfig = {
	enabled: boolean;
};

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function configPath(): string {
	return join(agentDir(), CONFIG_FILE);
}

function defaultConfig(): FastConfig {
	return { enabled: false };
}

function loadConfig(): FastConfig {
	const path = configPath();
	if (!existsSync(path)) return defaultConfig();
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (
			parsed &&
			typeof parsed === "object" &&
			!Array.isArray(parsed) &&
			typeof (parsed as FastConfig).enabled === "boolean"
		) {
			return { enabled: (parsed as FastConfig).enabled };
		}
	} catch {
		// fall through to default
	}
	return defaultConfig();
}

function saveConfig(config: FastConfig): void {
	const path = configPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function modelLabel(model: ExtensionContext["model"]): string {
	if (!model) return "no model";
	return `${model.provider}/${model.id}`;
}

function supportsXaiFast(model: ExtensionContext["model"]): boolean {
	return (
		Boolean(model) &&
		model?.provider === "xai" &&
		typeof model?.api === "string" &&
		SUPPORTED_APIS.has(model.api)
	);
}

function parseArgs(args: string): "toggle" | "on" | "off" | "status" | "help" {
	const token = args.trim().toLowerCase().split(/\s+/)[0] ?? "";
	if (!token) return "toggle";
	if (token === "on" || token === "enable" || token === "true" || token === "1") {
		return "on";
	}
	if (token === "off" || token === "disable" || token === "false" || token === "0") {
		return "off";
	}
	if (token === "status" || token === "state") return "status";
	if (token === "help" || token === "?" || token === "-h" || token === "--help") {
		return "help";
	}
	return "help";
}

function statusMessage(enabled: boolean, model: ExtensionContext["model"]): string {
	const support = supportsXaiFast(model)
		? "supported"
		: model?.provider === "xai"
			? `unsupported api (${model.api ?? "unknown"})`
			: "n/a (not xAI)";
	const active = enabled && supportsXaiFast(model);
	return [
		`xAI fast mode: ${enabled ? "on" : "off"}`,
		`model: ${modelLabel(model)} (${support})`,
		active
			? `requests will send service_tier="${FAST_TIER}" (2x priority pricing when granted)`
			: enabled
				? "enabled, but current model will not receive the tier"
				: "standard scheduling",
	].join(" · ");
}

export default function xaiFastExtension(pi: ExtensionAPI) {
	let enabled = loadConfig().enabled;

	const setEnabled = (next: boolean, ctx: ExtensionCommandContext): void => {
		enabled = next;
		try {
			saveConfig({ enabled });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Failed to save xAI fast mode: ${message}`, "error");
			return;
		}
		ctx.ui.notify(statusMessage(enabled, ctx.model), "info");
	};

	pi.registerCommand("fast", {
		description:
			"Toggle xAI Priority Processing (service_tier=priority) for Grok models like grok-4.5",
		handler: async (args, ctx) => {
			const action = parseArgs(args ?? "");
			switch (action) {
				case "on":
					setEnabled(true, ctx);
					return;
				case "off":
					setEnabled(false, ctx);
					return;
				case "status":
					ctx.ui.notify(statusMessage(enabled, ctx.model), "info");
					return;
				case "help":
					ctx.ui.notify(
						"Usage: /fast [on|off|status] — xAI Priority Processing for Grok (service_tier=priority)",
						"info",
					);
					return;
				case "toggle":
				default:
					if (!supportsXaiFast(ctx.model) && !enabled) {
						// Turning on while on a non-xAI model is allowed (persists), but warn.
						ctx.ui.notify(
							`Current model ${modelLabel(ctx.model)} is not an xAI Responses/Completions model; enabling anyway for when you switch to grok-4.5.`,
							"warning",
						);
					}
					setEnabled(!enabled, ctx);
			}
		},
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!enabled) return;
		if (!supportsXaiFast(ctx.model)) return;
		if (!isRecord(event.payload)) return;

		// Only set when absent so an explicit upstream value wins.
		if (event.payload.service_tier !== undefined) return;

		return {
			...event.payload,
			service_tier: FAST_TIER,
		};
	});
}

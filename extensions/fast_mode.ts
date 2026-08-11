/**
 * Fast mode (priority service tier) for OpenAI and xAI.
 *
 * When enabled, injects `service_tier: "priority"` into supported request
 * payloads so providers schedule with lower latency (at premium rates).
 *
 * Supported:
 *   - openai        / openai-responses, openai-completions
 *   - openai-codex  / openai-codex-responses
 *   - xai           / openai-responses, openai-completions  (e.g. grok-4.5)
 *
 * Docs:
 *   - OpenAI service tiers: https://platform.openai.com/docs/guides/priority-processing
 *   - xAI priority processing: https://docs.x.ai/developers/advanced-api-usage/priority-processing
 *
 * Commands:
 *   /fast          toggle on ↔ off
 *   /fast on       enable
 *   /fast off      disable
 *   /fast status   show state for the current model
 *
 * State: ~/.pi/agent/fast-mode.json (gitignored runtime file).
 * Footer bolt is owned by extensions/footer.ts (no setStatus chip here).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const CONFIG_FILE = "fast-mode.json";
const FAST_TIER = "priority";

type FastConfig = {
	enabled: boolean;
};

type ModelRef = {
	provider?: unknown;
	api?: unknown;
	id?: unknown;
};

type ProviderSupport = {
	label: string;
	apis: ReadonlySet<string>;
};

const PROVIDER_SUPPORT: Record<string, ProviderSupport> = {
	openai: {
		label: "OpenAI",
		apis: new Set(["openai-responses", "openai-completions"]),
	},
	"openai-codex": {
		label: "OpenAI Codex",
		apis: new Set(["openai-codex-responses"]),
	},
	xai: {
		label: "xAI",
		apis: new Set(["openai-responses", "openai-completions"]),
	},
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
		// fall through
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

function modelLabel(model: ModelRef | undefined): string {
	if (!model?.provider || !model?.id) return "no model";
	return `${String(model.provider)}/${String(model.id)}`;
}

function supportFor(model: ModelRef | undefined): ProviderSupport | undefined {
	if (!model || typeof model.provider !== "string") return undefined;
	return PROVIDER_SUPPORT[model.provider];
}

function supportsFast(model: ModelRef | undefined): boolean {
	const support = supportFor(model);
	if (!support || typeof model?.api !== "string") return false;
	return support.apis.has(model.api);
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
	const support = supportFor(model);
	const ok = supportsFast(model);
	const supportLabel = ok
		? `supported (${support?.label ?? "unknown"})`
		: support
			? `unsupported api (${String(model?.api ?? "unknown")}) for ${support.label}`
			: "n/a (provider not openai/xai)";
	const active = enabled && ok;
	return [
		`fast mode: ${enabled ? "on" : "off"}`,
		`model: ${modelLabel(model)} (${supportLabel})`,
		active
			? `requests will send service_tier="${FAST_TIER}"`
			: enabled
				? "enabled, but current model will not receive the tier"
				: "standard scheduling",
	].join(" · ");
}

export default function fastModeExtension(pi: ExtensionAPI) {
	let enabled = loadConfig().enabled;

	const setEnabled = (next: boolean, ctx: ExtensionCommandContext): void => {
		enabled = next;
		try {
			saveConfig({ enabled });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Failed to save fast mode: ${message}`, "error");
			return;
		}
		ctx.ui.notify(statusMessage(enabled, ctx.model), "info");
	};

	pi.registerCommand("fast", {
		description:
			"Toggle priority service tier (fast mode) for OpenAI and xAI models",
		handler: async (args, ctx) => {
			const action = parseArgs(args ?? "");
			switch (action) {
				case "on":
					if (!supportsFast(ctx.model)) {
						ctx.ui.notify(
							`Enabling fast mode, but ${modelLabel(ctx.model)} is not a supported OpenAI/xAI model/API.`,
							"warning",
						);
					}
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
						"Usage: /fast [on|off|status] — priority service_tier for OpenAI + xAI (grok-4.5, GPT, Codex)",
						"info",
					);
					return;
				case "toggle":
				default:
					if (!supportsFast(ctx.model) && !enabled) {
						ctx.ui.notify(
							`Current model ${modelLabel(ctx.model)} is not a supported OpenAI/xAI model/API; enabling anyway for when you switch.`,
							"warning",
						);
					}
					setEnabled(!enabled, ctx);
			}
		},
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!enabled) return;
		if (!supportsFast(ctx.model)) return;
		if (!isRecord(event.payload)) return;
		// Keep an explicit upstream value if something else already set it.
		if (event.payload.service_tier !== undefined) return;

		return {
			...event.payload,
			service_tier: FAST_TIER,
		};
	});
}

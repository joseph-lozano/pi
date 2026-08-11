/**
 * Custom B1 footer — always-on replacement for pi's default footer.
 *
 * Spec (from prototypes/footer.html):
 *   Row 1: 📁 cwd · nerd-branch · git numstat … phase anim (right)
 *   Row 2: ctx ring · cache (last-turn db + session %) … provider · model · 🧠 · bolt
 *   Phases: idle ● · think sand · tool line (edits=tools) · stream pulse ●
 *   Whimsy on working line only (indicator upright, message italic)
 *   Drop r1: cwd → branch · Drop r2: provider → cache → fast → thinking → model
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, AssistantMessageEvent, Usage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// —— icons (nerd / emoji mix) ————————————————————————————————

const NF = {
	branch: "\ue725", // nf-dev-git_branch
	provider: "\uf0c2", // nf-fa-cloud
	fast: "\uf0e7", // nf-fa-bolt
	cache: "\uf1c0", // nf-fa-database
} as const;

// —— cli-spinners (sindresorhus/cli-spinners) ————————————————

const SAND_FRAMES = [
	"⠁",
	"⠂",
	"⠄",
	"⡀",
	"⡈",
	"⡐",
	"⡠",
	"⣀",
	"⣁",
	"⣂",
	"⣄",
	"⣌",
	"⣔",
	"⣤",
	"⣥",
	"⣦",
	"⣮",
	"⣶",
	"⣷",
	"⣿",
	"⡿",
	"⠿",
	"⢟",
	"⠟",
	"⡛",
	"⠛",
	"⠫",
	"⢋",
	"⠋",
	"⠍",
	"⡉",
	"⠉",
	"⠑",
	"⠡",
	"⢁",
] as const;

const LINE_FRAMES = ["-", "\\", "|", "/"] as const;

const SAND_INTERVAL_MS = 80;
const LINE_INTERVAL_MS = 130;
const PULSE_INTERVAL_MS = 80;

// —— thresholds ——————————————————————————————————————————————

const CTX_WARN = 50;
const CTX_HOT = 85;
const CACHE_SESSION_GOOD = 70;
const CACHE_SESSION_OK = 30;

// —— whimsy (dmmulroy-style; working line only) ———————————————

const WHIMSY = [
	"Noodling...",
	"Combobulating...",
	"Schlepping...",
	"Pontificating...",
	"Spelunking...",
	"Ruminating...",
	"Percolating...",
	"Marinating...",
	"Fermenting...",
	"Tinkering...",
	"Wrangling...",
	"Finagling...",
	"Discombobulating...",
	"Recombobulating...",
	"Petting the wild goroutines...",
	"Memoizing the vibes for later...",
	"Folding the list into a single beautiful thought...",
	"Asking the monad what it wants to be when it grows up...",
	"Gently unwrapping the Maybe...",
	"Politely declining the null...",
	"Teaching the cache to fetch...",
	"Knitting a cozy for the cold start...",
	"Origami-folding the configuration...",
	"Hosting a mixer for microservices...",
	"Burning sage in the staging environment...",
	"Counting the sheep in the thread pool...",
	"Making illegal states unrepresentable...",
	"Letting the compiler do the thinking...",
	"Trusting the tail call to do the right thing...",
	"Lazily evaluating whether to care...",
] as const;

// —— phase model ——————————————————————————————————————————————

type Phase =
	| { kind: "idle" }
	| { kind: "think" }
	| { kind: "stream" }
	| { kind: "tool"; toolName: string };

type GitDelta = { plus: number; minus: number };

type CacheView =
	| { kind: "none" }
	| {
			kind: "ready";
			turn: "hit" | "bust";
			sessionPct: number;
			sessionLevel: "good" | "ok" | "bad";
	  };

type CtxLevel = "ok" | "warn" | "hot";

// —— helpers ————————————————————————————————————————————————

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function isFastEnabled(): boolean {
	const path = join(agentDir(), "fast-mode.json");
	if (!existsSync(path)) return false;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return (
			Boolean(parsed) &&
			typeof parsed === "object" &&
			!Array.isArray(parsed) &&
			(parsed as { enabled?: unknown }).enabled === true
		);
	} catch {
		return false;
	}
}

function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

function formatWindow(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
	return String(tokens);
}

function hitPct(read: number, write: number, input: number): number | null {
	const denom = input + read + write;
	if (denom <= 0) return null;
	return Math.round((read / denom) * 100);
}

function parseNumstat(stdout: string): GitDelta {
	let plus = 0;
	let minus = 0;
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const [a, b] = trimmed.split("\t");
		const add = a === "-" ? 0 : Number(a);
		const del = b === "-" ? 0 : Number(b);
		if (Number.isFinite(add)) plus += add;
		if (Number.isFinite(del)) minus += del;
	}
	return { plus, minus };
}

function sumUsage(entries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>): {
	session: Usage;
	last: Usage | null;
} {
	const session: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	let last: Usage | null = null;

	const add = (u: Usage): void => {
		session.input += u.input;
		session.output += u.output;
		session.cacheRead += u.cacheRead;
		session.cacheWrite += u.cacheWrite;
		session.totalTokens += u.totalTokens;
		session.cost.input += u.cost.input;
		session.cost.output += u.cost.output;
		session.cost.cacheRead += u.cost.cacheRead;
		session.cost.cacheWrite += u.cost.cacheWrite;
		session.cost.total += u.cost.total;
		last = u;
	};

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role === "assistant") {
			add((msg as AssistantMessage).usage);
		} else if (msg.role === "toolResult" && msg.usage) {
			add(msg.usage);
		}
	}

	return { session, last };
}

function cacheView(entries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>): CacheView {
	const { session, last } = sumUsage(entries);
	const hasActivity = session.cacheRead > 0 || session.cacheWrite > 0;
	if (!hasActivity && !last) return { kind: "none" };

	const sessionPct = hitPct(session.cacheRead, session.cacheWrite, session.input);
	if (sessionPct === null && !last) return { kind: "none" };

	let sessionLevel: "good" | "ok" | "bad" = "bad";
	const pct = sessionPct ?? 0;
	if (pct >= CACHE_SESSION_GOOD) sessionLevel = "good";
	else if (pct >= CACHE_SESSION_OK) sessionLevel = "ok";

	let turn: "hit" | "bust" = "bust";
	if (last) {
		const turnTokens = last.cacheRead + last.cacheWrite + last.input;
		if (turnTokens <= 0) return hasActivity
			? { kind: "ready", turn: "bust", sessionPct: pct, sessionLevel }
			: { kind: "none" };
		turn = last.cacheRead > 0 ? "hit" : "bust";
	} else if (!hasActivity) {
		return { kind: "none" };
	}

	return {
		kind: "ready",
		turn,
		sessionPct: pct,
		sessionLevel,
	};
}

function ctxLevel(percent: number): CtxLevel {
	if (percent >= CTX_HOT) return "hot";
	if (percent >= CTX_WARN) return "warn";
	return "ok";
}

function ctxColor(theme: Theme, level: CtxLevel): (s: string) => string {
	switch (level) {
		case "ok":
			return (s) => theme.fg("accent", s);
		case "warn":
			return (s) => theme.fg("warning", s);
		case "hot":
			return (s) => theme.fg("error", s);
		default: {
			const _exhaustive: never = level;
			return _exhaustive;
		}
	}
}

function sessionCacheColor(theme: Theme, level: "good" | "ok" | "bad"): (s: string) => string {
	switch (level) {
		case "good":
			return (s) => theme.fg("success", s);
		case "ok":
			return (s) => theme.fg("warning", s);
		case "bad":
			return (s) => theme.fg("error", s);
		default: {
			const _exhaustive: never = level;
			return _exhaustive;
		}
	}
}

function phaseFromAssistantEvent(event: AssistantMessageEvent): "think" | "stream" | null {
	switch (event.type) {
		case "thinking_start":
		case "thinking_delta":
		case "thinking_end":
			return "think";
		case "text_start":
		case "text_delta":
		case "text_end":
			return "stream";
		default:
			return null;
	}
}

function pickWhimsy(): string {
	return WHIMSY[Math.floor(Math.random() * WHIMSY.length)]!;
}

function sep(theme: Theme): string {
	return theme.fg("dim", " · ");
}

function joinParts(parts: string[], theme: Theme): string {
	return parts.filter(Boolean).join(sep(theme));
}

// —— extension ————————————————————————————————————————————————

export default function footerExtension(pi: ExtensionAPI) {
	let phase: Phase = { kind: "idle" };
	let frameIdx = 0;
	let whimsy = pickWhimsy();
	let git: GitDelta = { plus: 0, minus: 0 };
	let gitRefreshing = false;
	const activeTools = new Map<string, string>();
	let timer: ReturnType<typeof setInterval> | undefined;
	let activeTui: TUI | undefined;
	let liveCtx: ExtensionContext | undefined;

	const requestRender = (): void => {
		activeTui?.requestRender();
	};

	const stopTimer = (): void => {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
	};

	const intervalForPhase = (): number => {
		switch (phase.kind) {
			case "idle":
				return 1000;
			case "think":
				return SAND_INTERVAL_MS;
			case "tool":
				return LINE_INTERVAL_MS;
			case "stream":
				return PULSE_INTERVAL_MS;
			default: {
				const _exhaustive: never = phase;
				return _exhaustive;
			}
		}
	};

	const ensureTimer = (): void => {
		stopTimer();
		if (phase.kind === "idle") {
			// Slow poll so /fast toggles and git refreshes still paint while idle.
			timer = setInterval(() => requestRender(), 500);
			requestRender();
			return;
		}
		timer = setInterval(() => {
			frameIdx++;
			requestRender();
		}, intervalForPhase());
		requestRender();
	};

	const setPhase = (next: Phase): void => {
		const changed = phase.kind !== next.kind ||
			(phase.kind === "tool" && next.kind === "tool" && phase.toolName !== next.toolName);
		phase = next;
		if (changed) {
			frameIdx = 0;
			ensureTimer();
			syncWorkingLine();
		} else {
			requestRender();
		}
	};

	/**
	 * WorkingStatusIndicator always wraps the message with theme.fg("muted", …).
	 * Nest our color inside so it overrides muted (same pattern as working-message-test).
	 */
	const coloredWhimsy = (theme: Theme, color: ThemeColor, text: string): string =>
		theme.fg(color, theme.italic(text));

	const syncWorkingLine = (): void => {
		const ctx = liveCtx;
		if (!ctx?.hasUI) return;
		const theme = ctx.ui.theme;

		switch (phase.kind) {
			case "idle":
				ctx.ui.setWorkingMessage();
				ctx.ui.setWorkingIndicator();
				return;
			case "think":
				// thinkingHigh is purple in dark theme; thinkingText is gray.
				ctx.ui.setWorkingMessage(coloredWhimsy(theme, "thinkingHigh", whimsy));
				ctx.ui.setWorkingIndicator({
					frames: SAND_FRAMES.map((f) => theme.fg("thinkingHigh", f)),
					intervalMs: SAND_INTERVAL_MS,
				});
				return;
			case "tool":
				ctx.ui.setWorkingMessage(
					coloredWhimsy(theme, "accent", `⚙ ${phase.toolName}`),
				);
				ctx.ui.setWorkingIndicator({
					frames: LINE_FRAMES.map((f) => theme.fg("accent", f)),
					intervalMs: LINE_INTERVAL_MS,
				});
				return;
			case "stream":
				ctx.ui.setWorkingMessage(coloredWhimsy(theme, "text", "streaming"));
				ctx.ui.setWorkingIndicator({
					frames: [
						theme.fg("dim", "●"),
						theme.fg("muted", "●"),
						theme.fg("text", "●"),
						theme.fg("muted", "●"),
					],
					intervalMs: PULSE_INTERVAL_MS,
				});
				return;
			default: {
				const _exhaustive: never = phase;
				return _exhaustive;
			}
		}
	};

	const refreshGit = async (cwd: string): Promise<void> => {
		if (gitRefreshing) return;
		gitRefreshing = true;
		try {
			const [unstaged, staged] = await Promise.all([
				pi.exec("git", ["diff", "--numstat"], { cwd }).catch(() => undefined),
				pi.exec("git", ["diff", "--cached", "--numstat"], { cwd }).catch(() => undefined),
			]);
			const a = parseNumstat(unstaged?.stdout ?? "");
			const b = parseNumstat(staged?.stdout ?? "");
			git = { plus: a.plus + b.plus, minus: a.minus + b.minus };
			requestRender();
		} finally {
			gitRefreshing = false;
		}
	};

	const animGlyph = (theme: Theme): string => {
		switch (phase.kind) {
			case "idle":
				return theme.fg("text", "●");
			case "think":
				return theme.fg("thinkingHigh", SAND_FRAMES[frameIdx % SAND_FRAMES.length]!);
			case "tool":
				return theme.fg("accent", LINE_FRAMES[frameIdx % LINE_FRAMES.length]!);
			case "stream": {
				const pulse = [
					theme.fg("dim", "●"),
					theme.fg("muted", "●"),
					theme.fg("text", "●"),
					theme.fg("muted", "●"),
				];
				return pulse[frameIdx % pulse.length]!;
			}
			default: {
				const _exhaustive: never = phase;
				return _exhaustive;
			}
		}
	};

	const installFooter = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;
		liveCtx = ctx;
		// Footer owns the bolt; clear any legacy fast-mode status chip.
		ctx.ui.setStatus("fast-mode", undefined);

		ctx.ui.setFooter((tui, theme, footerData) => {
			activeTui = tui;
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: () => {
					unsubBranch();
					if (activeTui === tui) activeTui = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					liveCtx = ctx;
					const branch = footerData.getGitBranch();
					const usage = ctx.getContextUsage();
					const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const pct = usage?.percent;
					const level: CtxLevel =
						pct === null || pct === undefined ? "ok" : ctxLevel(pct);
					const colorizeCtx = ctxColor(theme, level);

					const cwdText = formatCwd(ctx.cwd);
					const thinking = ctx.thinkingLevel ?? pi.getThinkingLevel();
					const provider = ctx.model?.provider ?? "?";
					const model = ctx.model?.id ?? "no-model";
					const fastOn = isFastEnabled();
					const cache = cacheView(ctx.sessionManager.getBranch());

					// —— segment builders ——————————————————————————

					const segments: Record<string, string> = {
						cwd: `📁 ${theme.fg("muted", cwdText)}`,
						branch: branch
							? theme.fg("success", `${NF.branch} ${branch}`)
							: "",
						git:
							git.plus || git.minus
								? `${theme.fg("success", `+${git.plus}`)} ${theme.fg("error", `−${git.minus}`)}`
								: theme.fg("dim", "clean"),
						anim: animGlyph(theme),
						ctx:
							pct === null || pct === undefined || !window
								? colorizeCtx("◔ ?")
								: `${colorizeCtx(`◔ ${pct.toFixed(1)}%`)}${theme.fg("dim", `/${formatWindow(window)}`)}`,
						cache: (() => {
							if (cache.kind === "none") return "";
							const db =
								cache.turn === "bust"
									? theme.fg("error", NF.cache)
									: theme.fg("text", NF.cache);
							const sess = sessionCacheColor(theme, cache.sessionLevel)(
								`${cache.sessionPct}%`,
							);
							return `${db}\u00a0${sess}`;
						})(),
						provider: theme.fg("accent", `${NF.provider} ${provider}`),
						model: theme.fg("text", model),
						thinking: theme.fg("thinkingText", `🧠 ${thinking}`),
						fast: fastOn ? theme.fg("warning", NF.fast) : "",
					};

					const row1Order = ["cwd", "branch", "git", "anim"] as const;
					const row1Drop = ["cwd", "branch"] as const;
					const row2Order = ["ctx", "cache", "provider", "model", "thinking", "fast"] as const;
					const row2Drop = ["provider", "cache", "fast", "thinking", "model"] as const;

					const fitRow = (
						order: readonly string[],
						drop: readonly string[],
						opts: { animRight?: boolean },
					): string => {
						const visible = new Set(
							order.filter((id) => {
								const v = segments[id];
								return typeof v === "string" && v.length > 0;
							}),
						);
						const dropQ = drop.filter((id) => visible.has(id));

						const render = (): string => {
							if (opts.animRight && visible.has("anim")) {
								const left = row1Order
									.filter((id) => id !== "anim" && visible.has(id))
									.map((id) => segments[id]!);
								const leftHtml = joinParts(left, theme);
								const right = segments.anim!;
								const gap = Math.max(
									1,
									width - visibleWidth(leftHtml) - visibleWidth(right),
								);
								return truncateToWidth(leftHtml + " ".repeat(gap) + right, width);
							}

							const leftIds = ["ctx", "cache"].filter((id) => visible.has(id));
							const rightIds = ["provider", "model", "thinking", "fast"].filter((id) =>
								visible.has(id),
							);
							const leftHtml = joinParts(
								leftIds.map((id) => segments[id]!),
								theme,
							);
							const rightHtml = rightIds.map((id) => segments[id]!).join(" ");
							if (!leftHtml) return truncateToWidth(rightHtml, width);
							if (!rightHtml) return truncateToWidth(leftHtml, width);
							const gap = Math.max(
								1,
								width - visibleWidth(leftHtml) - visibleWidth(rightHtml),
							);
							return truncateToWidth(leftHtml + " ".repeat(gap) + rightHtml, width);
						};

						let line = render();
						let guard = 12;
						while (visibleWidth(line) > width && dropQ.length > 0 && guard-- > 0) {
							visible.delete(dropQ.shift()!);
							line = render();
						}
						return truncateToWidth(line, width);
					};

					return [
						fitRow(row1Order, row1Drop, { animRight: true }),
						fitRow(row2Order, row2Drop, {}),
					];
				},
			};
		});

		void refreshGit(ctx.cwd);
		ensureTimer();
		syncWorkingLine();
	};

	pi.on("session_start", async (_event, ctx) => {
		installFooter(ctx);
	});

	pi.on("session_shutdown", async () => {
		stopTimer();
		activeTui = undefined;
		liveCtx = undefined;
		activeTools.clear();
		phase = { kind: "idle" };
	});

	pi.on("agent_start", async (_event, ctx) => {
		liveCtx = ctx;
		whimsy = pickWhimsy();
		if (phase.kind === "idle") setPhase({ kind: "think" });
	});

	pi.on("turn_start", async (_event, ctx) => {
		liveCtx = ctx;
		whimsy = pickWhimsy();
		if (activeTools.size === 0) setPhase({ kind: "think" });
	});

	pi.on("message_update", async (event, ctx) => {
		liveCtx = ctx;
		if (activeTools.size > 0) return;
		const next = phaseFromAssistantEvent(event.assistantMessageEvent);
		if (next === "think") setPhase({ kind: "think" });
		else if (next === "stream") setPhase({ kind: "stream" });
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		liveCtx = ctx;
		activeTools.set(event.toolCallId, event.toolName);
		setPhase({ kind: "tool", toolName: event.toolName });
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		liveCtx = ctx;
		activeTools.delete(event.toolCallId);

		if (event.toolName === "edit" || event.toolName === "write") {
			void refreshGit(ctx.cwd);
		}

		if (activeTools.size > 0) {
			const [, name] = [...activeTools].at(-1)!;
			setPhase({ kind: "tool", toolName: name });
			return;
		}
		// Between tools / before next stream — sand while the turn continues.
		if (!ctx.isIdle()) setPhase({ kind: "think" });
	});

	pi.on("turn_end", async (_event, ctx) => {
		liveCtx = ctx;
		if (activeTools.size === 0 && ctx.isIdle()) setPhase({ kind: "idle" });
	});

	pi.on("agent_settled", async (_event, ctx) => {
		liveCtx = ctx;
		activeTools.clear();
		setPhase({ kind: "idle" });
		void refreshGit(ctx.cwd);
	});

	pi.on("model_select", async (_event, ctx) => {
		liveCtx = ctx;
		requestRender();
	});

	pi.on("thinking_level_select", async (_event, ctx) => {
		liveCtx = ctx;
		requestRender();
	});
}

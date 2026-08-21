import { execFile, spawn, type ChildProcess } from "node:child_process";
import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { addedRenderedRows } from "./log-lines";
import { wheelDirection } from "./mouse";

const MAX_BUFFERED_LINES = 5_000;
const MAX_PENDING_CHARS = 64 * 1024;
const WHEEL_LINES = 3;

export class JobLogOverlay {
	private readonly process: ChildProcess;
	private readonly stdoutDecoder = new StringDecoder("utf8");
	private readonly stderrDecoder = new StringDecoder("utf8");
	private lines: string[] = [];
	private pending = "";
	private scrollOffset = 0;
	private totalLines?: number;
	private countTimer?: NodeJS.Timeout;
	private disposed = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly jobId: string,
		private readonly logPath: string,
		private readonly done: () => void,
	) {
		this.process = spawn("tail", ["-n", String(MAX_BUFFERED_LINES), "-f", logPath], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.process.stdout?.on("data", (chunk: Buffer) => this.append(this.stdoutDecoder.write(chunk)));
		this.process.stderr?.on("data", (chunk: Buffer) => this.append(this.stderrDecoder.write(chunk), true));
		this.process.on("error", (error) => this.append(`tail: ${error.message}\n`, true));
		this.process.on("close", (code) => {
			const stdoutRemainder = this.stdoutDecoder.end();
			const stderrRemainder = this.stderrDecoder.end();
			if (stdoutRemainder) this.append(stdoutRemainder);
			if (stderrRemainder) this.append(stderrRemainder, true);
			if (!this.disposed && code !== null && code !== 0) this.append(`tail exited with status ${code}\n`, true);
		});
		this.refreshLineCount();
	}

	private refreshLineCount(): void {
		if (this.disposed) return;
		if (this.countTimer) clearTimeout(this.countTimer);
		this.countTimer = setTimeout(() => {
			execFile("wc", ["-l", this.logPath], (error, stdout) => {
				if (this.disposed || error) return;
				const newlineCount = Number.parseInt(stdout.trim().split(/\s+/, 1)[0] ?? "", 10);
				if (Number.isFinite(newlineCount)) void this.setAccurateLineCount(newlineCount);
			});
		}, 100);
		this.countTimer.unref?.();
	}

	private async setAccurateLineCount(newlineCount: number): Promise<void> {
		let hasUnterminatedFinalLine = false;
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		try {
			handle = await open(this.logPath, "r");
			const { size } = await handle.stat();
			if (size > 0) {
				const lastByte = Buffer.allocUnsafe(1);
				await handle.read(lastByte, 0, 1, size - 1);
				hasUnterminatedFinalLine = lastByte[0] !== 0x0a;
			}
		} catch {
			return;
		} finally {
			await handle?.close().catch(() => {});
		}
		if (this.disposed) return;
		this.totalLines = newlineCount + (hasUnterminatedFinalLine ? 1 : 0);
		this.tui.requestRender();
	}

	private append(text: string, error = false): void {
		if (this.disposed) return;
		const hadPending = this.pending.length > 0;
		const parts = (this.pending + text).split("\n");
		this.pending = parts.pop() ?? "";
		if (this.pending.length > MAX_PENDING_CHARS) {
			this.pending = `… [unterminated line truncated] ${this.pending.slice(-MAX_PENDING_CHARS)}`;
		}
		const complete = error ? parts.map((line) => this.theme.fg("error", line)) : parts;
		if (this.scrollOffset > 0) this.scrollOffset += addedRenderedRows(hadPending, complete.length, this.pending.length > 0);
		this.lines.push(...complete);
		if (this.lines.length > MAX_BUFFERED_LINES) {
			const removed = this.lines.length - MAX_BUFFERED_LINES;
			this.lines.splice(0, removed);
		}
		this.refreshLineCount();
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") return this.done();
		const wheel = wheelDirection(data);
		if (wheel === -1) this.scrollOffset += WHEEL_LINES;
		else if (wheel === 1) this.scrollOffset = Math.max(0, this.scrollOffset - WHEEL_LINES);
		else if (matchesKey(data, "up") || data === "k") this.scrollOffset += 1;
		else if (matchesKey(data, "down") || data === "j") this.scrollOffset = Math.max(0, this.scrollOffset - 1);
		else if (matchesKey(data, "pageup")) this.scrollOffset += Math.max(1, this.tui.terminal.rows - 5);
		else if (matchesKey(data, "pagedown")) this.scrollOffset = Math.max(0, this.scrollOffset - Math.max(1, this.tui.terminal.rows - 5));
		else if (data === "G" || matchesKey(data, "end")) this.scrollOffset = 0;
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerWidth = Math.max(1, width - 2);
		const height = Math.max(1, this.tui.terminal.rows);
		const outputHeight = Math.max(0, height - 5);
		const border = (text: string) => th.fg("borderMuted", text);
		const fit = (text: string) => {
			const truncated = truncateToWidth(text, innerWidth, "", true);
			return truncated + " ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)));
		};
		const title = truncateToWidth(` ${this.jobId} log — following ${this.logPath} `, innerWidth, "…", true);
		const countMessage = this.totalLines === undefined
			? " Counting log lines…"
			: ` Showing last ${Math.min(MAX_BUFFERED_LINES, this.totalLines).toLocaleString()} lines of ${this.totalLines.toLocaleString()} total`;
		const rows = this.pending ? [...this.lines, this.pending] : this.lines;
		const maxOffset = Math.max(0, rows.length - outputHeight);
		this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
		const end = rows.length - this.scrollOffset;
		const visible = rows.slice(Math.max(0, end - outputHeight), end);
		while (visible.length < outputHeight) visible.unshift("");

		return [
			border("╭") + th.fg("accent", title) + border(`${"─".repeat(Math.max(0, innerWidth - visibleWidth(title)))}╮`),
			border("│") + fit(th.fg("dim", countMessage)) + border("│"),
			...visible.map((line) => border("│") + fit(line) + border("│")),
			border("├") + border("─".repeat(innerWidth)) + border("┤"),
			border("│") + fit(th.fg("dim", this.scrollOffset === 0
				? " Following log • wheel/↑↓ scroll • q/esc close"
				: ` Paused • ${this.scrollOffset} line(s) above bottom • G/end resume • q/esc close`)) + border("│"),
			border(`╰${"─".repeat(innerWidth)}╯`),
		].slice(0, height);
	}

	invalidate(): void {}

	dispose(): void {
		this.disposed = true;
		if (this.countTimer) clearTimeout(this.countTimer);
		this.process.kill();
	}
}

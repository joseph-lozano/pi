import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { displayOutput, elapsed } from "./format";
import type { JobManager } from "./manager";
import type { JobRecord } from "./types";

export type OverlayResult = { action: "log"; path: string } | undefined;

export class BackgroundJobsOverlay {
	private selected = 0;
	private showAll = false;
	private unsubscribe?: () => void;
	private timer?: NodeJS.Timeout;

	constructor(
		private readonly manager: JobManager,
		private readonly sessionId: string,
		private readonly theme: Theme,
		private readonly requestRender: () => void,
		private readonly done: (result: OverlayResult) => void,
	) {
		this.unsubscribe = manager.subscribe(() => requestRender());
		this.timer = setInterval(requestRender, 1_000);
		this.timer.unref?.();
	}

	private visibleJobs(): JobRecord[] {
		const jobs = this.manager.list(this.sessionId);
		const active = jobs.filter((job) => job.status === "queued" || job.status === "running");
		const history = jobs.filter((job) => job.status !== "queued" && job.status !== "running");
		return [...active, ...(this.showAll ? history : history.slice(0, 20))];
	}

	handleInput(data: string): void {
		const jobs = this.visibleJobs();
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return this.done(undefined);
		if (matchesKey(data, "up")) this.selected = Math.max(0, this.selected - 1);
		else if (matchesKey(data, "down")) this.selected = Math.min(Math.max(0, jobs.length - 1), this.selected + 1);
		else if (data === "a") {
			this.showAll = !this.showAll;
			this.selected = 0;
		} else {
			const job = jobs[this.selected];
			if (!job) return;
			if (data === "s" && (job.status === "running" || job.status === "queued")) {
				void this.manager.stop(job.id, this.sessionId).catch(() => {});
			}
			if (data === "d" && job.status !== "running" && job.status !== "queued") {
				this.manager.dismiss(job.id, this.sessionId);
				this.selected = Math.min(this.selected, Math.max(0, this.visibleJobs().length - 1));
			}
			if (data === "l") return this.done({ action: "log", path: job.logPath });
		}
		this.requestRender();
	}

	render(width: number): string[] {
		const th = this.theme;
		const jobs = this.visibleJobs();
		this.selected = Math.min(this.selected, Math.max(0, jobs.length - 1));
		const line = (text = "") => truncateToWidth(text, Math.max(1, width));
		const lines = [line(th.fg("accent", th.bold("Background jobs")))];
		if (jobs.length === 0) lines.push(line(th.fg("dim", "No jobs in this session.")));
		const rowLimit = 12;
		const start = Math.max(0, Math.min(this.selected - Math.floor(rowLimit / 2), Math.max(0, jobs.length - rowLimit)));
		const end = Math.min(jobs.length, start + rowLimit);
		if (start > 0) lines.push(line(th.fg("dim", `  ↑ ${start} earlier job(s)`)));
		for (let index = start; index < end; index++) {
			const job = jobs[index]!;
			const selected = index === this.selected;
			const icon = job.status === "running" ? "●" : job.status === "completed" ? "✓" : job.status === "failed" ? "✗" : job.status === "stopped" ? "■" : "○";
			const color = job.status === "failed" ? "error" : job.status === "completed" ? "success" : job.status === "running" ? "warning" : "muted";
			const description = job.spec.kind === "shell" ? job.spec.command : job.spec.prompt;
			const row = `${selected ? "›" : " "} ${icon} ${job.id} ${job.spec.kind} ${elapsed(job)}  ${(description ?? "").replace(/\s+/g, " ")}`;
			lines.push(line(selected ? th.bg("selectedBg", th.fg(color, row)) : th.fg(color, row)));
		}
		if (end < jobs.length) lines.push(line(th.fg("dim", `  ↓ ${jobs.length - end} later job(s)`)));

		const selectedJob = jobs[this.selected];
		if (selectedJob) {
			lines.push(line(th.fg("borderMuted", "─".repeat(Math.max(1, width)))));
			lines.push(line(`${th.fg("accent", selectedJob.id)}  ${th.fg("muted", selectedJob.logPath)}`));
			const outputLines = displayOutput(selectedJob).split("\n").slice(-12);
			for (const outputLine of outputLines) lines.push(line(th.fg("toolOutput", outputLine)));
		}
		lines.push(line(th.fg("dim", "↑↓ select • s stop • d dismiss • l log • a all history • esc close")));
		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		this.unsubscribe?.();
		if (this.timer) clearInterval(this.timer);
	}
}

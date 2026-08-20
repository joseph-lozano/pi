import type { JobRecord } from "./types";

export const MODEL_TAIL_LIMIT = 12_000;

export function elapsed(job: JobRecord, now = Date.now()): string {
	const milliseconds = (job.finishedAt ?? now) - job.startedAt;
	if (milliseconds < 1_000) return `${milliseconds}ms`;
	if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
	return `${Math.floor(milliseconds / 60_000)}m ${Math.floor((milliseconds % 60_000) / 1_000)}s`;
}

export function displayOutput(job: JobRecord): string {
	if (job.spec.kind !== "pi" || !job.progress) return job.outputTail || job.stderrTail || "(no output)";
	const pieces: string[] = [];
	if (job.progress.currentTool) pieces.push(`Current tool: ${job.progress.currentTool}`);
	if (job.progress.recentToolOutput) pieces.push(`Recent tool output:\n${job.progress.recentToolOutput}`);
	if (job.progress.recentAssistantText) pieces.push(`Recent assistant text:\n${job.progress.recentAssistantText}`);
	if (job.progress.recentThinking) pieces.push(`Recent thinking:\n${job.progress.recentThinking}`);
	return pieces.join("\n\n") || job.stderrTail || "(waiting for Pi output)";
}

export function formatJob(job: JobRecord): string {
	const lines = [
		`Job ${job.id}: ${job.status}`,
		`Kind: ${job.spec.kind}`,
		`Elapsed: ${elapsed(job)}`,
		`CWD: ${job.spec.cwd}`,
	];
	if (job.exitCode !== undefined) lines.push(`Exit code: ${job.exitCode}`);
	if (job.signal) lines.push(`Signal: ${job.signal}`);
	if (job.error) lines.push(`Error: ${job.error}`);
	if (job.progress) {
		const usage = job.progress.usage;
		lines.push(`Pi progress: ${job.progress.turns} turn(s), ${usage.totalTokens} tokens, $${usage.cost.toFixed(4)}`);
		if (job.progress.currentTool) lines.push(`Current tool: ${job.progress.currentTool}`);
	}
	lines.push(`Log: ${job.logPath}`);
	let output = displayOutput(job);
	if (Buffer.byteLength(output, "utf8") > MODEL_TAIL_LIMIT) {
		let buffer = Buffer.from(output);
		buffer = buffer.subarray(buffer.length - MODEL_TAIL_LIMIT);
		output = buffer.toString("utf8").replace(/^\uFFFD/, "");
		lines.push(`Output tail (last ${MODEL_TAIL_LIMIT} bytes; complete output in log):`);
	} else {
		lines.push("Output tail:");
	}
	lines.push(output);
	return lines.join("\n");
}

const BATCH_LIMIT = 48_000;

function boundedTail(text: string, bytes: number): string {
	const value = Buffer.from(text);
	if (value.length <= bytes) return text;
	return value.subarray(value.length - bytes).toString("utf8").replace(/^\uFFFD/, "");
}

export function formatCompletionBatch(jobs: JobRecord[]): string {
	const title = `Background job completion${jobs.length === 1 ? "" : "s"}:`;
	const headers = jobs.map((job) => [
		`Job ${job.id}: ${job.status}`,
		`Kind: ${job.spec.kind}`,
		`Elapsed: ${elapsed(job)}`,
		job.exitCode === undefined ? undefined : `Exit code: ${job.exitCode}`,
		job.error ? `Error: ${boundedTail(job.error, 500)}` : undefined,
		`Log: ${boundedTail(job.logPath, 1_000)}`,
	].filter(Boolean).join("\n"));
	const fixedBytes = Buffer.byteLength(title) + 2 + headers.reduce((sum, header) => sum + Buffer.byteLength(header) + 24, 0);
	const outputBudget = Math.max(256, Math.floor((BATCH_LIMIT - fixedBytes) / Math.max(1, jobs.length)));
	const segments = jobs.map((job, index) => `${headers[index]}\nOutput tail:\n${boundedTail(displayOutput(job), outputBudget)}`);
	return `${title}\n\n${segments.join("\n\n")}`;
}

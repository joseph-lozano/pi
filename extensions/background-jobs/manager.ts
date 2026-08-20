import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PiJsonProjector } from "./pi-json";
import { getPiProfile } from "./profiles";
import type { JobEvent, JobOwner, JobRecord, JobSpec, PersistedJobRecord } from "./types";

const DEFAULT_TAIL_BYTES = 24 * 1024;
const DEFAULT_GRACE_MS = 2_000;

export function shouldPreserveJobsOnShutdown(reason: string): boolean {
	return reason === "reload";
}

class ByteTail {
	private value = Buffer.alloc(0);
	constructor(private readonly maxBytes: number) {}
	append(chunk: Buffer | string): void {
		const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		this.value = Buffer.concat([this.value, next]);
		if (this.value.length > this.maxBytes) this.value = this.value.subarray(this.value.length - this.maxBytes);
	}
	text(): string {
		return this.value.toString("utf8").replace(/^\uFFFD/, "");
	}
}

interface RuntimeJob {
	child: ChildProcess;
	completion: Promise<JobRecord>;
	resolve: (job: JobRecord) => void;
	output: ByteTail;
	stderr: ByteTail;
	projector?: PiJsonProjector;
	killTimer?: NodeJS.Timeout;
}

export interface JobManagerOptions {
	logRoot?: string;
	outputTailBytes?: number;
	stopGraceMs?: number;
	piInvocation?: (args: string[]) => { command: string; args: string[] };
}

export function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	const virtual = script?.startsWith("/$bunfs/root/");
	if (script && !virtual && basename(script) !== "bun" && basename(script) !== "node") {
		return { command: process.execPath, args: [script, ...args] };
	}
	const executable = basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(executable)) return { command: process.execPath, args };
	return { command: "pi", args };
}

export function buildPiArgs(spec: JobSpec): string[] {
	const args = ["--mode", "json", "-p", "--no-session", "--no-extensions"];
	const profile = spec.profile ? getPiProfile(spec.profile) : undefined;
	if (profile) {
		args.push("--no-skills");
		for (const extension of profile.extensions) args.push("--extension", extension);
		args.push("--tools", profile.tools.join(","));
		args.push("--append-system-prompt", profile.systemPrompt);
	}
	const model = spec.model ?? profile?.model;
	const thinking = spec.thinking ?? profile?.thinking;
	if (model) args.push("--model", model);
	if (thinking) args.push("--thinking", thinking);
	args.push(spec.prompt ?? "");
	return args;
}

export class JobManager {
	private readonly jobs = new Map<string, JobRecord>();
	private readonly runtime = new Map<string, RuntimeJob>();
	private readonly listeners = new Set<(event: JobEvent) => void>();
	private sequence = 0;
	private readonly logRoot: string;
	private readonly outputTailBytes: number;
	private readonly stopGraceMs: number;
	private readonly piInvocation: (args: string[]) => { command: string; args: string[] };

	constructor(options: JobManagerOptions = {}) {
		this.logRoot = options.logRoot ?? join(tmpdir(), "pi-background-jobs");
		this.outputTailBytes = options.outputTailBytes ?? DEFAULT_TAIL_BYTES;
		this.stopGraceMs = options.stopGraceMs ?? DEFAULT_GRACE_MS;
		this.piInvocation = options.piInvocation ?? getPiInvocation;
	}

	subscribe(listener: (event: JobEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(type: JobEvent["type"], job: JobRecord): void {
		for (const listener of this.listeners) listener({ type, job });
	}

	list(sessionId?: string, includeDismissed = false): JobRecord[] {
		return [...this.jobs.values()]
			.filter((job) => (!sessionId || job.owner.sessionId === sessionId) && (includeDismissed || !job.dismissed))
			.sort((a, b) => b.startedAt - a.startedAt);
	}

	get(id: string, sessionId?: string): JobRecord | undefined {
		const job = this.jobs.get(id);
		return job && (!sessionId || job.owner.sessionId === sessionId) ? job : undefined;
	}

	restore(records: PersistedJobRecord[]): void {
		for (const record of records) {
			if (this.jobs.has(record.id)) continue;
			const { version: _version, ...job } = record;
			this.jobs.set(record.id, job);
		}
	}

	start(owner: JobOwner, spec: JobSpec, claimed = false): JobRecord {
		const id = `job_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
		const ownerLogRoot = owner.sessionFile
			? join(dirname(owner.sessionFile), "background-jobs")
			: join(this.logRoot, owner.sessionId);
		mkdirSync(ownerLogRoot, { recursive: true });
		const logPath = join(ownerLogRoot, `${id}.log`);
		const job: JobRecord = {
			id,
			owner: { ...owner },
			spec: { ...spec },
			status: "queued",
			startedAt: Date.now(),
			stopRequested: false,
			dismissed: false,
			delivery: claimed ? "claimed" : "pending",
			logPath,
			outputTail: "",
			stderrTail: "",
		};
		this.jobs.set(id, job);

		const args = spec.kind === "pi" ? buildPiArgs(spec) : ["-lc", spec.command ?? ""];
		const invocation = spec.kind === "pi" ? this.piInvocation(args) : { command: "/bin/sh", args };
		const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
		const output = new ByteTail(this.outputTailBytes);
		const stderr = new ByteTail(this.outputTailBytes);
		const projector = spec.kind === "pi" ? new PiJsonProjector() : undefined;
		let resolve!: (value: JobRecord) => void;
		const completion = new Promise<JobRecord>((done) => { resolve = done; });

		try {
			const child = spawn(invocation.command, invocation.args, {
				cwd: spec.cwd,
				detached: process.platform !== "win32",
				env: process.env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			const state: RuntimeJob = { child, completion, resolve, output, stderr, projector };
			this.runtime.set(id, state);
			job.pid = child.pid;
			job.status = "running";
			this.emit("changed", job);
			let logFailed = false;
			log.on("error", (error) => {
				logFailed = true;
				job.error ??= `Log write failed: ${error.message}`;
			});
			const writeLog = (chunk: Buffer, source: { pause(): void; resume(): void }) => {
				if (logFailed) return;
				if (!log.write(chunk)) {
					source.pause();
					log.once("drain", () => source.resume());
				}
			};

			child.stdout?.on("data", (chunk: Buffer) => {
				writeLog(chunk, child.stdout!);
				output.append(chunk);
				projector?.push(chunk);
				this.refresh(job, state);
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				writeLog(chunk, child.stderr!);
				output.append(chunk);
				stderr.append(chunk);
				this.refresh(job, state);
			});
			child.on("error", (error) => {
				job.error = error.message;
				stderr.append(error.message);
				this.refresh(job, state);
			});
			child.on("close", (code, signal) => {
				projector?.finish();
				job.finishedAt = Date.now();
				job.exitCode = code ?? undefined;
				job.signal = signal ?? undefined;
				if (job.stopRequested) {
					job.status = "stopped";
					job.delivery = "none";
				} else if (code === 0 && !job.error && !projector?.progress.failure) {
					job.status = "completed";
				} else {
					job.status = "failed";
					job.error ??= projector?.progress.failure ?? (signal ? `Terminated by ${signal}` : `Exited with code ${code}`);
				}
				if (!this.shouldWake(job) && job.delivery === "pending") job.delivery = "none";
				this.refresh(job, state);
				if (state.killTimer && !job.stopRequested) clearTimeout(state.killTimer);
				this.runtime.delete(id);
				log.end(() => {
					this.emit("completed", job);
					resolve(job);
				});
			});
		} catch (error) {
			job.status = "failed";
			job.finishedAt = Date.now();
			job.error = error instanceof Error ? error.message : String(error);
			if (!this.shouldWake(job) && job.delivery === "pending") job.delivery = "none";
			log.end(job.error);
			this.emit("completed", job);
			resolve(job);
		}
		return job;
	}

	private refresh(job: JobRecord, state: RuntimeJob): void {
		job.outputTail = state.output.text();
		job.stderrTail = state.stderr.text();
		if (state.projector) job.progress = { ...state.projector.progress, usage: { ...state.projector.progress.usage } };
		this.emit("changed", job);
	}

	private shouldWake(job: JobRecord): boolean {
		return job.status !== "stopped" && (job.spec.wake === "always" || (job.spec.wake === "on-failure" && job.status === "failed"));
	}

	claim(id: string, sessionId: string): boolean {
		const job = this.get(id, sessionId);
		if (!job || (job.delivery !== "pending" && job.delivery !== "none")) return false;
		job.delivery = "claimed";
		this.emit("changed", job);
		return true;
	}

	releaseClaim(id: string, sessionId: string): void {
		const job = this.get(id, sessionId);
		if (!job || job.delivery !== "claimed") return;
		job.delivery = this.shouldWake(job) || job.status === "running" || job.status === "queued" ? "pending" : "none";
		this.emit("changed", job);
	}

	resetInjected(ids: string[], sessionId: string): void {
		for (const id of ids) {
			const job = this.get(id, sessionId);
			if (!job || job.delivery !== "injected") continue;
			job.delivery = "pending";
			this.emit("changed", job);
		}
	}

	markInjected(ids: string[], sessionId: string): JobRecord[] {
		const jobs: JobRecord[] = [];
		for (const id of ids) {
			const job = this.get(id, sessionId);
			if (!job || job.delivery !== "pending") continue;
			job.delivery = "injected";
			jobs.push(job);
			this.emit("changed", job);
		}
		return jobs;
	}

	async wait(id: string, sessionId: string, signal?: AbortSignal, claim = true): Promise<JobRecord> {
		const job = this.get(id, sessionId);
		if (!job) throw new Error(`Unknown job: ${id}`);
		if (claim && !this.claim(id, sessionId)) {
			throw new Error(job.delivery === "injected" ? `Completion for ${id} was already injected.` : `Completion for ${id} is already claimed.`);
		}
		const runtime = this.runtime.get(id);
		if (!runtime) return job;
		if (!signal) return runtime.completion;
		if (signal.aborted) throw new DOMException("Wait aborted", "AbortError");
		return Promise.race([
			runtime.completion,
			new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Wait aborted", "AbortError")), { once: true })),
		]);
	}

	async stop(id: string, sessionId: string): Promise<JobRecord> {
		const job = this.get(id, sessionId);
		if (!job) throw new Error(`Unknown job: ${id}`);
		const state = this.runtime.get(id);
		if (!state) return job;
		job.stopRequested = true;
		job.delivery = "none";
		this.signal(state.child, "SIGTERM");
		state.killTimer = setTimeout(() => this.signal(state.child, "SIGKILL"), this.stopGraceMs);
		state.killTimer.unref?.();
		this.emit("changed", job);
		return state.completion;
	}

	async stopAll(sessionId: string): Promise<void> {
		await Promise.all(this.list(sessionId, true).filter((job) => job.status === "running" || job.status === "queued").map((job) => this.stop(job.id, sessionId)));
	}

	dismiss(id: string, sessionId: string): JobRecord {
		const job = this.get(id, sessionId);
		if (!job) throw new Error(`Unknown job: ${id}`);
		if (job.status === "running" || job.status === "queued") throw new Error("Running jobs cannot be dismissed");
		job.dismissed = true;
		this.emit("dismissed", job);
		return job;
	}

	toPersisted(job: JobRecord): PersistedJobRecord | undefined {
		if (job.status === "running" || job.status === "queued") return undefined;
		const { pid: _pid, ...record } = job;
		return { ...record, status: job.status, version: 1 };
	}

	private signal(child: ChildProcess, signal: NodeJS.Signals): void {
		if (!child.pid) return;
		try {
			if (process.platform === "win32") child.kill(signal);
			else process.kill(-child.pid, signal);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ESRCH" && code !== "EPERM") throw error;
		}
	}
}

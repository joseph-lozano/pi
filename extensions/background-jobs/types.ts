export type JobKind = "shell" | "pi";
export type LaunchMode = "blocking" | "background";
export type WakePolicy = "always" | "never" | "on-failure";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type WorkerProfileName = "general" | "writer" | "poteto" | "reviewer" | "comment-sicko" | "investigator";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "stopped";
export type DeliveryState = "pending" | "claimed" | "injected" | "none";

export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
}

export interface PiProgress {
	currentTool?: string;
	recentToolOutput?: string;
	recentAssistantText?: string;
	recentThinking?: string;
	usage: TokenUsage;
	turns: number;
	failure?: string;
}

export interface JobSpec {
	kind: JobKind;
	mode: LaunchMode;
	wake: WakePolicy;
	cwd: string;
	command?: string;
	prompt?: string;
	emoji?: string;
	profile?: WorkerProfileName;
	role?: "code" | "judgment" | "exploration" | "synthesis" | "review" | "arena" | "architect" | "swarm";
	panelIndex?: number;
	model?: string;
	thinking?: ThinkingLevel;
}

export interface JobOwner {
	sessionId: string;
	sessionFile?: string;
}

export interface JobRecord {
	id: string;
	owner: JobOwner;
	spec: JobSpec;
	status: JobStatus;
	pid?: number;
	startedAt: number;
	finishedAt?: number;
	exitCode?: number;
	signal?: NodeJS.Signals;
	stopRequested: boolean;
	dismissed: boolean;
	delivery: DeliveryState;
	logPath: string;
	outputTail: string;
	stderrTail: string;
	progress?: PiProgress;
	error?: string;
}

export interface PersistedJobRecord extends Omit<JobRecord, "pid" | "status"> {
	status: "completed" | "failed" | "stopped";
	version: 1;
}

export interface JobEvent {
	type: "changed" | "completed" | "dismissed";
	job: JobRecord;
}

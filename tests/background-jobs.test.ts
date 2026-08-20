import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPiArgs, JobManager, shouldPreserveJobsOnShutdown } from "../extensions/background-jobs/manager";
import { elapsed, formatCompletionBatch } from "../extensions/background-jobs/format";
import { PiJsonProjector } from "../extensions/background-jobs/pi-json";
import { jobIdentity, resolveProfileRuntime } from "../extensions/background-jobs/profiles";
import type { JobRecord, JobSpec } from "../extensions/background-jobs/types";

const roots: string[] = [];
const owner = { sessionId: "session-test" };

function root(): string {
	const path = mkdtempSync(join(tmpdir(), "background-jobs-test-"));
	roots.push(path);
	return path;
}

function shellSpec(command: string, overrides: Partial<JobSpec> = {}): JobSpec {
	return { kind: "shell", mode: "background", wake: "always", cwd: process.cwd(), command, ...overrides };
}

afterEach(() => {
	for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("JobManager lifecycle and delivery", () => {
	test("captures complete logs while bounding model-visible output", async () => {
		const manager = new JobManager({ logRoot: root(), outputTailBytes: 64 });
		const job = manager.start(owner, shellSpec("printf 'head-'; printf '%0100d' 0; printf '%s' '-tail' >&2"));
		const completed = await manager.wait(job.id, owner.sessionId, undefined, false);

		expect(completed.status).toBe("completed");
		expect(Buffer.byteLength(completed.outputTail)).toBeLessThanOrEqual(64);
		expect(completed.outputTail).toContain("-tail");
		const log = readFileSync(completed.logPath, "utf8");
		expect(log).toContain("head-");
		expect(log).toContain("-tail");
		expect(log.length).toBeGreaterThan(completed.outputTail.length);
	});

	test("blocking launches and explicit waits claim completion exactly once", async () => {
		const manager = new JobManager({ logRoot: root() });
		const blocking = manager.start(owner, shellSpec("printf done", { mode: "blocking" }), true);
		const blockingDone = await manager.wait(blocking.id, owner.sessionId, undefined, false);
		expect(blockingDone.delivery).toBe("claimed");
		expect(manager.markInjected([blocking.id], owner.sessionId)).toEqual([]);

		const background = manager.start(owner, shellSpec("sleep 0.05; printf waited"));
		const waited = await manager.wait(background.id, owner.sessionId);
		expect(waited.delivery).toBe("claimed");
		expect(manager.markInjected([background.id], owner.sessionId)).toEqual([]);
	});

	test("releases a claim even when abort races with terminal completion", async () => {
		const manager = new JobManager({ logRoot: root() });
		const job = manager.start(owner, shellSpec("printf raced"), true);
		await manager.wait(job.id, owner.sessionId, undefined, false);
		manager.releaseClaim(job.id, owner.sessionId);
		expect(manager.get(job.id)?.delivery).toBe("pending");
		expect(manager.markInjected([job.id], owner.sessionId)).toHaveLength(1);
		await expect(manager.wait(job.id, owner.sessionId)).rejects.toThrow("already injected");
	});

	test("applies wake policies and never wakes explicit stops", async () => {
		const manager = new JobManager({ logRoot: root(), stopGraceMs: 50 });
		const never = await manager.wait(manager.start(owner, shellSpec("exit 0", { wake: "never" })).id, owner.sessionId, undefined, false);
		const failure = await manager.wait(manager.start(owner, shellSpec("exit 7", { wake: "on-failure" })).id, owner.sessionId, undefined, false);
		const success = await manager.wait(manager.start(owner, shellSpec("exit 0", { wake: "on-failure" })).id, owner.sessionId, undefined, false);
		const running = manager.start(owner, shellSpec("sleep 30"));
		const stopped = await manager.stop(running.id, owner.sessionId);

		expect(never.delivery).toBe("none");
		expect(failure.status).toBe("failed");
		expect(failure.delivery).toBe("pending");
		expect(success.delivery).toBe("none");
		expect(stopped.status).toBe("stopped");
		expect(stopped.delivery).toBe("none");
	});

	test("stops the detached process group", async () => {
		if (process.platform === "win32") return;
		const directory = root();
		const childPidFile = join(directory, "child.pid");
		const manager = new JobManager({ logRoot: directory, stopGraceMs: 100 });
		const job = manager.start(owner, shellSpec(`sh -c 'trap "" TERM; sleep 30' & echo $! > '${childPidFile}'; wait`));
		for (let i = 0; i < 50 && !existsSync(childPidFile); i++) await Bun.sleep(10);
		const childPid = Number(readFileSync(childPidFile, "utf8").trim());
		await manager.stop(job.id, owner.sessionId);
		await Bun.sleep(200);
		let alive = true;
		try {
			process.kill(childPid, 0);
			const state = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(childPid)]).stdout.toString().trim();
			alive = Boolean(state) && !state.startsWith("Z");
		} catch { alive = false; }
		expect(alive).toBe(false);
	});
});

describe("named Pi profiles", () => {
	test("builds constrained scout and oracle invocations", () => {
		for (const [profile, model, thinking] of [
			["scout", "openai-codex/gpt-5.6-luna", "high"],
			["oracle", "openai-codex/gpt-5.6-sol", "xhigh"],
		] as const) {
			const args = buildPiArgs({ kind: "pi", profile, mode: "background", wake: "always", cwd: process.cwd(), prompt: "inspect" });
			expect(args).toContain("--no-extensions");
			expect(args).toContain("--no-skills");
			expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", "read,grep,find,ls"]);
			expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", model]);
			expect(args.slice(args.indexOf("--thinking"), args.indexOf("--thinking") + 2)).toEqual(["--thinking", thinking]);
			expect(args.join(" ")).not.toContain("background-jobs/index.ts");
		}
	});

	test("worker defaults to Grok 4.6, inherits thinking, and allows overrides", () => {
		expect(resolveProfileRuntime("worker", {}, { model: "parent/model", thinking: "high" })).toEqual({
			model: "xai/grok-4.6",
			thinking: "high",
		});
		expect(resolveProfileRuntime("worker", { model: "override/model", thinking: "low" }, { model: "parent/model", thinking: "high" })).toEqual({
			model: "override/model",
			thinking: "low",
		});
		const runtime = resolveProfileRuntime("worker", {}, { model: "parent/model", thinking: "high" });
		const args = buildPiArgs({
			kind: "pi",
			profile: "worker",
			mode: "blocking",
			wake: "never",
			cwd: process.cwd(),
			prompt: "implement",
			...runtime,
		});
		expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual([
			"--tools",
			"read,bash,edit,write,grep,find,ls",
		]);
		expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "xai/grok-4.6"]);
		expect(jobIdentity("worker", "pi")).toEqual({ icon: "🛠️", label: "worker" });
	});

	test("loads only researcher web extensions and allows explicit model overrides", () => {
		const args = buildPiArgs({
			kind: "pi",
			profile: "researcher",
			mode: "blocking",
			wake: "never",
			cwd: process.cwd(),
			prompt: "research",
			model: "provider/custom",
			thinking: "low",
		});
		const extensions = args.flatMap((arg, index) => args[index - 1] === "--extension" ? [arg] : []);
		expect(extensions.map((path) => path.split("/").pop())).toEqual(["exa.ts", "firecrawl.ts"]);
		expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual([
			"--tools",
			"read,write,exa_search,exa_fetch,firecrawl_search,firecrawl_fetch",
		]);
		expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "provider/custom"]);
		expect(args.slice(args.indexOf("--thinking"), args.indexOf("--thinking") + 2)).toEqual(["--thinking", "low"]);
		expect(args.at(-1)).toBe("research");
	});
});

describe("Pi JSON projection", () => {
	test("projects tools, output, assistant text, thinking, usage, and failure", () => {
		const projector = new PiJsonProjector();
		const events = [
			{ type: "tool_execution_start", toolName: "read" },
			{ type: "tool_execution_update", partialResult: { content: [{ type: "text", text: "partial file" }] } },
			{ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "considering" } },
			{ type: "tool_execution_end", result: { content: [{ type: "text", text: "final file" }] } },
			{ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "thought" }, { type: "text", text: "answer" }], usage: { input: 10, output: 4, cacheRead: 2, cacheWrite: 1, totalTokens: 17, cost: { total: 0.25 } }, stopReason: "error", errorMessage: "provider failed" } },
		];
		projector.push(events.map(JSON.stringify).join("\n") + "\n");
		expect(projector.progress).toMatchObject({
			currentTool: undefined,
			recentToolOutput: "final file",
			recentAssistantText: "answer",
			recentThinking: "thought",
			turns: 1,
			failure: "provider failed",
			usage: { input: 10, output: 4, totalTokens: 17, cost: 0.25 },
		});
	});

	test("decodes UTF-8 characters split across chunks", () => {
		const projector = new PiJsonProjector();
		const line = Buffer.from(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "child-🙂" } }) + "\n");
		const split = line.indexOf(Buffer.from("🙂")) + 2;
		projector.push(line.subarray(0, split));
		projector.push(line.subarray(split));
		expect(projector.progress.recentAssistantText).toBe("child-🙂");
	});

	test("projects a real managed Pi JSON stream", async () => {
		const script = [
			`console.log(JSON.stringify({type:'tool_execution_start',toolName:'bash'}))`,
			`console.log(JSON.stringify({type:'tool_execution_end',result:{content:[{type:'text',text:'tool result'}]},isError:false}))`,
			`console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'finished'}],usage:{input:3,output:2,cacheRead:0,cacheWrite:0,totalTokens:5,cost:{total:0.01}},stopReason:'stop'}}))`,
		].join(";");
		const manager = new JobManager({ logRoot: root(), piInvocation: () => ({ command: process.execPath, args: ["-e", script] }) });
		const job = manager.start(owner, { kind: "pi", mode: "background", wake: "always", cwd: process.cwd(), prompt: "test" });
		const completed = await manager.wait(job.id, owner.sessionId, undefined, false);
		expect(completed.status).toBe("completed");
		expect(completed.progress).toMatchObject({ recentToolOutput: "tool result", recentAssistantText: "finished", turns: 1, usage: { totalTokens: 5 } });
		expect(readFileSync(completed.logPath, "utf8")).toContain("tool_execution_start");
	});
});

describe("job display formatting", () => {
	test("floors elapsed time to whole seconds", () => {
		expect(elapsed({ startedAt: 0, finishedAt: 999 } as JobRecord)).toBe("0s");
		expect(elapsed({ startedAt: 0, finishedAt: 1_999 } as JobRecord)).toBe("1s");
		expect(elapsed({ startedAt: 0, finishedAt: 59_999 } as JobRecord)).toBe("59s");
		expect(elapsed({ startedAt: 0, finishedAt: 60_999 } as JobRecord)).toBe("1m 0s");
	});

	test("bounds twenty simultaneous completion tails", () => {
		const records: JobRecord[] = Array.from({ length: 20 }, (_, index) => ({
			id: `job_batch_${index}`,
			owner,
			spec: shellSpec(`printf ${index}`),
			status: "completed",
			startedAt: 1,
			finishedAt: 2,
			exitCode: 0,
			stopRequested: false,
			dismissed: false,
			delivery: "pending",
			logPath: `/tmp/job_batch_${index}.log`,
			outputTail: "x".repeat(20_000),
			stderrTail: "",
		}));
		const message = formatCompletionBatch(records);
		expect(Buffer.byteLength(message)).toBeLessThanOrEqual(48_000);
		for (const record of records) expect(message).toContain(record.id);
	});
});

describe("extension session lifecycle policy", () => {
	test("preserves only reload and stops for replacement or quit", () => {
		expect(shouldPreserveJobsOnShutdown("reload")).toBe(true);
		for (const reason of ["new", "resume", "fork", "quit"]) expect(shouldPreserveJobsOnShutdown(reason)).toBe(false);
	});
});

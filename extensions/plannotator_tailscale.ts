import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, unwatchFile, watchFile } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getBackgroundJobManager } from "./background-jobs/manager";

const requestFile = join(tmpdir(), `pi-plannotator-tailscale-${process.pid}`, "port");

/** Route remote Plannotator sessions through a managed Tailscale Serve job. */
export default function (pi: ExtensionAPI) {
	if (!process.env.SSH_TTY && !process.env.SSH_CONNECTION && !process.env.PLANNOTATOR_REMOTE) {
		return;
	}

	process.env.PLANNOTATOR_REMOTE ??= "1";
	process.env.PLANNOTATOR_PORT ??= "19432-19463";
	process.env.PLANNOTATOR_URL_HOST ??= "auto";
	process.env.PLANNOTATOR_TAILSCALE_REQUEST_FILE = requestFile;
	process.env.PLANNOTATOR_BROWSER ??= join(
		homedir(),
		".pi",
		"agent",
		"scripts",
		"plannotator-tailscale-browser",
	);

	const manager = getBackgroundJobManager();
	let context: ExtensionContext | undefined;
	let activeJobId: string | undefined;
	let lastRequest = "";
	let queue = Promise.resolve();

	const startServe = async (port: number, ctx: ExtensionContext) => {
		const owner = {
			sessionId: ctx.sessionManager.getSessionId(),
			sessionFile: ctx.sessionManager.getSessionFile(),
		};
		if (activeJobId) {
			await manager.stop(activeJobId, owner.sessionId).catch(() => undefined);
		}

		const command = [
			"set -eu",
			"serve_pid=",
			'cleanup() { if [ -n "$serve_pid" ]; then kill "$serve_pid" >/dev/null 2>&1 || true; wait "$serve_pid" 2>/dev/null || true; fi; tailscale serve reset >/dev/null 2>&1 || true; }',
			"trap cleanup EXIT INT TERM",
			'status="$(tailscale serve status 2>&1 || true)"',
			'if [ "$status" != "No serve config" ]; then tailscale serve reset; fi',
			`tailscale serve --yes http://127.0.0.1:${port} & serve_pid=$!`,
			`while kill -0 "$serve_pid" 2>/dev/null && curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:${port}/; do sleep 1; done`,
		].join("; ");

		const job = manager.start(owner, {
			kind: "shell",
			mode: "background",
			wake: "never",
			emoji: "🛜",
			cwd: ctx.cwd,
			command,
		});
		activeJobId = job.id;

		execFile("tailscale", ["status", "--json"], (error, stdout) => {
			if (error) return;
			try {
				const dnsName = (JSON.parse(stdout).Self?.DNSName as string | undefined)?.replace(/\.$/, "");
				if (dnsName) ctx.ui.notify(`Plannotator: https://${dnsName}/ (${job.id}; stop in /bg)`, "info");
			} catch {
				// The managed job still reports Tailscale's URL in its /bg output.
			}
		});
	};

	const consumeRequest = () => {
		let value: string;
		try {
			value = readFileSync(requestFile, "utf8").trim();
		} catch {
			return;
		}
		if (!value || value === lastRequest) return;
		lastRequest = value;
		const [nonce, rawPort] = value.split(":");
		const port = Number(rawPort);
		const ctx = context;
		if (!nonce || !ctx || !Number.isInteger(port) || port < 1 || port > 65535) return;
		queue = queue.then(() => startServe(port, ctx)).catch((error) => {
			ctx.ui.notify(`Could not start Tailscale Serve: ${error instanceof Error ? error.message : String(error)}`, "error");
		});
	};

	pi.on("session_start", (_event, ctx) => {
		context = ctx;
		mkdirSync(dirname(requestFile), { recursive: true });
		watchFile(requestFile, { interval: 100 }, consumeRequest);
		consumeRequest();
	});

	pi.on("session_shutdown", (event) => {
		unwatchFile(requestFile, consumeRequest);
		context = undefined;
		if (event.reason !== "reload") rmSync(dirname(requestFile), { recursive: true, force: true });
	});
}

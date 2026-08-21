import { closeSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const MAX_TAIL_BYTES = 2 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_TEXT = 1_000;

export interface SessionFileInfo {
	id: string;
	path: string;
	modifiedAt: number;
	size: number;
	current: boolean;
}

function boundedText(path: string, maxBytes: number): string {
	const size = statSync(path).size;
	const length = Math.min(size, maxBytes);
	const offset = size - length;
	const buffer = Buffer.alloc(length);
	const fd = openSync(path, "r");
	try {
		readSync(fd, buffer, 0, length, offset);
	} finally {
		closeSync(fd);
	}
	const text = buffer.toString("utf8");
	return offset > 0 ? text.slice(text.indexOf("\n") + 1) : text;
}

function canonicalCwd(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function sessionCwd(path: string): string | undefined {
	const fd = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(Math.min(statSync(path).size, MAX_HEADER_BYTES));
		readSync(fd, buffer, 0, buffer.length, 0);
		const first = buffer.toString("utf8").split("\n", 1)[0];
		if (!first) return undefined;
		const header = JSON.parse(first) as { type?: unknown; cwd?: unknown };
		return header.type === "session" && typeof header.cwd === "string" ? canonicalCwd(header.cwd) : undefined;
	} catch {
		return undefined;
	} finally {
		closeSync(fd);
	}
}

function regularFile(path: string): boolean {
	try {
		return lstatSync(path).isFile();
	} catch {
		return false;
	}
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.flatMap((part) => {
		if (!part || typeof part !== "object") return [];
		const value = part as { type?: unknown; text?: unknown };
		return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
	}).join("\n");
}

function oneLine(value: string): string {
	const compact = value.replace(/\s+/g, " ").trim();
	return compact.length > MAX_TEXT ? `${compact.slice(0, MAX_TEXT)}…` : compact;
}

export function listWorkspaceSessions(currentFile: string, workspaceCwd: string, includeCurrent = false): SessionFileInfo[] {
	const directory = realpathSync(dirname(currentFile));
	const current = basename(currentFile);
	const expectedCwd = canonicalCwd(workspaceCwd);
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl") && (includeCurrent || entry.name !== current))
		.flatMap((entry) => {
			const path = join(directory, entry.name);
			if (sessionCwd(path) !== expectedCwd) return [];
			const stat = statSync(path);
			return [{ id: entry.name.slice(0, -6), path, modifiedAt: stat.mtimeMs, size: stat.size, current: entry.name === current }];
		})
		.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function resolveSessionFile(currentFile: string, workspaceCwd: string, id: string): string {
	if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("invalid session id");
	const directory = realpathSync(dirname(currentFile));
	const path = join(directory, id.endsWith(".jsonl") ? id : `${id}.jsonl`);
	if (!regularFile(path) || dirname(realpathSync(path)) !== directory || sessionCwd(path) !== canonicalCwd(workspaceCwd)) {
		throw new Error(`unknown workspace session: ${id}`);
	}
	return path;
}

export function sessionTail(path: string, limit = 20): string {
	const rows: string[] = [];
	for (const line of boundedText(path, MAX_TAIL_BYTES).split("\n")) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as {
				type?: string;
				message?: { role?: string; content?: unknown };
				summary?: string;
				customType?: string;
				data?: { record?: { id?: string; status?: string; logPath?: string } };
			};
			if (entry.type === "message" && entry.message?.role) {
				const text = oneLine(contentText(entry.message.content));
				if (text) rows.push(`${entry.message.role}: ${text}`);
			} else if (entry.type === "compaction" && entry.summary) {
				rows.push(`compaction: ${oneLine(entry.summary)}`);
			} else if (entry.type === "custom" && entry.customType === "background-job-record" && entry.data?.record?.id) {
				rows.push(`job: ${entry.data.record.id} ${entry.data.record.status ?? "unknown"} ${entry.data.record.logPath ?? ""}`.trim());
			}
		} catch {
			// Ignore an incomplete first line or malformed historical entry.
		}
	}
	return rows.slice(-Math.max(1, Math.min(limit, 50))).join("\n") || "No readable conversation entries in the selected tail.";
}

export function listJobLogs(currentFile: string, allowedIds: readonly string[]): SessionFileInfo[] {
	const directory = join(realpathSync(dirname(currentFile)), "background-jobs");
	try {
		if (!lstatSync(directory).isDirectory()) return [];
	} catch {
		return [];
	}
	const allowed = new Set(allowedIds);
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".log") && allowed.has(entry.name.slice(0, -4)))
		.map((entry) => {
			const path = join(directory, entry.name);
			const stat = statSync(path);
			return { id: entry.name.slice(0, -4), path, modifiedAt: stat.mtimeMs, size: stat.size, current: false };
		})
		.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function jobLogTail(currentFile: string, allowedIds: readonly string[], id: string, maxChars = 12_000): string {
	if (!/^job_[A-Za-z0-9_]+$/.test(id)) throw new Error("invalid job id");
	if (!allowedIds.includes(id)) throw new Error(`unknown current-session job log: ${id}`);
	const directory = join(realpathSync(dirname(currentFile)), "background-jobs");
	const path = join(directory, `${id}.log`);
	if (!regularFile(path) || dirname(realpathSync(path)) !== realpathSync(directory)) throw new Error(`unknown current-session job log: ${id}`);
	const text = boundedText(path, Math.max(MAX_TAIL_BYTES, maxChars * 4));
	return text.length > maxChars ? `[earlier log omitted]\n${text.slice(-maxChars)}` : text;
}

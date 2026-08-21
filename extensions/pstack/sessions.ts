import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const MAX_TAIL_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 1_000;

export interface SessionFileInfo {
	id: string;
	path: string;
	modifiedAt: number;
	size: number;
	current: boolean;
}

function tailText(path: string): string {
	const size = statSync(path).size;
	const length = Math.min(size, MAX_TAIL_BYTES);
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

export function listWorkspaceSessions(currentFile: string, includeCurrent = false): SessionFileInfo[] {
	const directory = dirname(currentFile);
	const current = basename(currentFile);
	return readdirSync(directory)
		.filter((name) => name.endsWith(".jsonl") && (includeCurrent || name !== current))
		.map((name) => {
			const path = join(directory, name);
			const stat = statSync(path);
			return { id: name.slice(0, -6), path, modifiedAt: stat.mtimeMs, size: stat.size, current: name === current };
		})
		.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function resolveSessionFile(currentFile: string, id: string): string {
	if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("invalid session id");
	const path = join(dirname(currentFile), id.endsWith(".jsonl") ? id : `${id}.jsonl`);
	if (!existsSync(path)) throw new Error(`unknown workspace session: ${id}`);
	return path;
}

export function sessionTail(path: string, limit = 20): string {
	const rows: string[] = [];
	for (const line of tailText(path).split("\n")) {
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

export function listJobLogs(currentFile: string): SessionFileInfo[] {
	const directory = join(dirname(currentFile), "background-jobs");
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name.endsWith(".log"))
		.map((name) => {
			const path = join(directory, name);
			const stat = statSync(path);
			return { id: name.slice(0, -4), path, modifiedAt: stat.mtimeMs, size: stat.size, current: false };
		})
		.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function jobLogTail(currentFile: string, id: string, maxChars = 12_000): string {
	if (!/^job_[A-Za-z0-9_]+$/.test(id)) throw new Error("invalid job id");
	const path = join(dirname(currentFile), "background-jobs", `${id}.log`);
	if (!existsSync(path)) throw new Error(`unknown workspace job log: ${id}`);
	const text = readFileSync(path, "utf8");
	return text.length > maxChars ? `[earlier log omitted]\n${text.slice(-maxChars)}` : text;
}

import { StringDecoder } from "node:string_decoder";
import type { PiProgress, TokenUsage } from "./types";

const TEXT_LIMIT = 8_000;

function tail(text: string, limit = TEXT_LIMIT): string {
	return text.length <= limit ? text : text.slice(-limit);
}

function emptyUsage(): TokenUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
}

function textContent(content: unknown, type: "text" | "thinking"): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part && typeof part === "object" && (part as { type?: string }).type === type)
		.map((part) => type === "text" ? (part as { text?: string }).text ?? "" : (part as { thinking?: string }).thinking ?? "")
		.join("\n");
}

function resultText(value: unknown): string {
	if (!value || typeof value !== "object") return "";
	const content = (value as { content?: unknown }).content;
	return textContent(content, "text");
}

export class PiJsonProjector {
	readonly progress: PiProgress = { usage: emptyUsage(), turns: 0 };
	private buffer = "";
	private readonly decoder = new StringDecoder("utf8");

	push(chunk: string | Buffer): void {
		this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
		while (true) {
			const newline = this.buffer.indexOf("\n");
			if (newline < 0) return;
			const line = this.buffer.slice(0, newline).replace(/\r$/, "");
			this.buffer = this.buffer.slice(newline + 1);
			this.processLine(line);
		}
	}

	finish(): void {
		this.buffer += this.decoder.end();
		if (this.buffer.trim()) this.processLine(this.buffer.replace(/\r$/, ""));
		this.buffer = "";
	}

	private processLine(line: string): void {
		if (!line.trim()) return;
		let event: any;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}

		switch (event.type) {
			case "tool_execution_start":
				this.progress.currentTool = typeof event.toolName === "string" ? event.toolName : undefined;
				break;
			case "tool_execution_update": {
				const output = resultText(event.partialResult);
				if (output) this.progress.recentToolOutput = tail(output);
				break;
			}
			case "tool_execution_end": {
				const output = resultText(event.result);
				if (output) this.progress.recentToolOutput = tail(output);
				this.progress.currentTool = undefined;
				break;
			}
			case "message_update": {
				const update = event.assistantMessageEvent;
				if (update?.type === "text_delta" && typeof update.delta === "string") {
					this.progress.recentAssistantText = tail((this.progress.recentAssistantText ?? "") + update.delta);
				}
				if (update?.type === "thinking_delta" && typeof update.delta === "string") {
					this.progress.recentThinking = tail((this.progress.recentThinking ?? "") + update.delta);
				}
				break;
			}
			case "message_end": {
				const message = event.message;
				if (message?.role !== "assistant") break;
				this.progress.turns++;
				const text = textContent(message.content, "text");
				const thinking = textContent(message.content, "thinking");
				if (text) this.progress.recentAssistantText = tail(text);
				if (thinking) this.progress.recentThinking = tail(thinking);
				const usage = message.usage;
				if (usage) {
					this.progress.usage.input += usage.input ?? 0;
					this.progress.usage.output += usage.output ?? 0;
					this.progress.usage.cacheRead += usage.cacheRead ?? 0;
					this.progress.usage.cacheWrite += usage.cacheWrite ?? 0;
					this.progress.usage.totalTokens += usage.totalTokens ?? 0;
					this.progress.usage.cost += usage.cost?.total ?? 0;
				}
				if (message.stopReason === "error" || message.stopReason === "aborted") {
					this.progress.failure = message.errorMessage ?? `Pi stopped: ${message.stopReason}`;
				}
				break;
			}
			case "auto_retry_end":
				if (event.success === false) this.progress.failure = event.finalError ?? "Pi retry failed";
				break;
			case "extension_error":
				this.progress.failure = event.error ?? "Pi extension error";
				break;
		}
	}
}

import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { buildBtwMessages, BTW_SYSTEM_INSTRUCTION, extractBtwAnswer } from "../extensions/btw/model";
import { buildBtwAgentContext } from "../extensions/btw/session-context";

function assistant(content: AssistantMessage["content"]): AssistantMessage {
	return { content } as AssistantMessage;
}

describe("btw model request", () => {
	test("adds the aside without mutating the context snapshot", () => {
		const context = [{ role: "user", content: [{ type: "text", text: "main task" }], timestamp: 1 }] as Message[];
		const messages = buildBtwMessages(context, "why this approach?");

		expect(context).toHaveLength(1);
		expect(messages).toHaveLength(2);
		expect(messages[0]).toBe(context[0]);
		expect(messages[1]).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "why this approach?" }],
		});
	});

	test("converts compacted session entries into provider messages", () => {
		const entries = [
			{
				type: "compaction",
				id: "compact1",
				parentId: null,
				timestamp: new Date(1).toISOString(),
				summary: "Earlier work",
				tokensBefore: 100,
				retainedTail: [{ role: "user", content: [{ type: "text", text: "kept" }], timestamp: 2 }],
			},
			{
				type: "message",
				id: "message1",
				parentId: "compact1",
				timestamp: new Date(3).toISOString(),
				message: { role: "user", content: [{ type: "text", text: "latest" }], timestamp: 3 },
			},
		] as SessionEntry[];

		const context = buildBtwAgentContext(entries);
		expect(context.map((message) => message.role)).toEqual(["compactionSummary", "user", "user"]);
		expect(context[0]).toMatchObject({ summary: "Earlier work", tokensBefore: 100 });
		expect(context[1]).toMatchObject({ content: [{ type: "text", text: "kept" }] });
		expect(context[2]).toMatchObject({ content: [{ type: "text", text: "latest" }] });
	});

	test("extracts only visible answer text", () => {
		const response = assistant([
			{ type: "thinking", thinking: "private" },
			{ type: "text", text: "First" },
			{ type: "text", text: "Second" },
		]);
		expect(extractBtwAnswer(response)).toBe("First\nSecond");
	});

	test("instructs the model not to continue the main task", () => {
		expect(BTW_SYSTEM_INSTRUCTION).toContain("one-off response");
		expect(BTW_SYSTEM_INSTRUCTION).toContain("Do not continue the main task");
		expect(BTW_SYSTEM_INSTRUCTION).toContain("will remain in context");
	});
});

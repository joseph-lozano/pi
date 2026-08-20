import type { AssistantMessage, Message, UserMessage } from "@earendil-works/pi-ai";

export const BTW_SYSTEM_INSTRUCTION = [
	"Answer the user's aside using the conversation context above.",
	"This is a one-off response shown outside the main conversation.",
	"Do not continue the main task, claim to have changed files, or assume this response will remain in context.",
	"Answer the aside directly and concisely.",
].join(" ");

export function buildBtwMessages(messages: Message[], question: string): Message[] {
	const userMessage: UserMessage = {
		role: "user",
		content: [{ type: "text", text: question }],
		timestamp: Date.now(),
	};
	return [...messages, userMessage];
}

export function extractBtwAnswer(response: AssistantMessage): string {
	return response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

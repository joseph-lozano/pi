import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

function entryMessages(entry: SessionEntry): AgentMessage[] {
	const timestamp = new Date(entry.timestamp).getTime();
	if (entry.type === "message") return [entry.message];
	if (entry.type === "compaction") {
		// retainedTail is part of the v3 session format, but Pi 0.84.2's public
		// CompactionEntry declaration predates the field.
		const retainedTail = (entry as typeof entry & { retainedTail?: AgentMessage[] }).retainedTail ?? [];
		return [
			{
				role: "compactionSummary",
				summary: entry.summary,
				tokensBefore: entry.tokensBefore,
				timestamp,
			},
			...retainedTail,
		];
	}
	if (entry.type === "branch_summary") {
		return [{ role: "branchSummary", summary: entry.summary, fromId: entry.fromId, timestamp }];
	}
	if (entry.type === "custom_message") {
		return [{
			role: "custom",
			customType: entry.customType,
			content: entry.content,
			display: entry.display,
			details: entry.details,
			timestamp,
		}];
	}
	return [];
}

export function buildBtwAgentContext(entries: SessionEntry[]): AgentMessage[] {
	return entries.flatMap(entryMessages);
}

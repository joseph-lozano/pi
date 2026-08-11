/**
 * Enable pi's built-in find / grep / ls tools for every session.
 *
 * Pi ships these tools but only activates read/bash/edit/write by default.
 * settings.json has no tools key; activation is CLI (--tools) or setActiveTools.
 * This extension turns them on at session_start without replacing other tools.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SEARCH_TOOLS = ["find", "grep", "ls"] as const;

export default function (pi: ExtensionAPI) {
	const enable = () => {
		const available = new Set(pi.getAllTools().map((tool) => tool.name));
		const extra = SEARCH_TOOLS.filter((name) => available.has(name));
		if (extra.length === 0) return;

		const active = pi.getActiveTools();
		const next = [...new Set([...active, ...extra])];
		if (next.length === active.length) return;
		pi.setActiveTools(next);
	};

	// session_start covers startup, /new, resume, fork, reload.
	pi.on("session_start", enable);
}

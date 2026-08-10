/**
 * Exa search + fetch tools via the official JavaScript SDK.
 *
 * Happy path (exa.ai/docs/sdks/javascript-sdk):
 *   import Exa from "exa-js";
 *   const exa = new Exa(); // EXA_API_KEY
 *   await exa.search(query, { type: "auto", contents: { highlights: true } })
 *   await exa.getContents(urls, { text: true })
 *
 * Auth: EXA_API_KEY
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import Exa from "exa-js";
import { Type } from "typebox";

function textResult(text: string, details: Record<string, unknown> = {}) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

function errorResult(err: unknown, details: Record<string, unknown> = {}) {
	const message = err instanceof Error ? err.message : String(err);
	return textResult(`Exa error: ${message}`, { ...details, error: message });
}

function requireClient(): Exa {
	if (!process.env.EXA_API_KEY) {
		throw new Error("EXA_API_KEY is not set. Get a key at https://dashboard.exa.ai/api-keys");
	}
	// Official default: reads EXA_API_KEY from the environment.
	return new Exa();
}

function assertNotAborted(signal?: AbortSignal) {
	if (signal?.aborted) {
		const err = new Error("Aborted");
		err.name = "AbortError";
		throw err;
	}
}

function clip(s: string, max = 280): string {
	return s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s;
}

export default function exaExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "exa_search",
		label: "Exa Search",
		description:
			"Search the web with Exa. Returns ranked results (title, url, snippet/highlights). Use exa_fetch to load full page text.",
		promptSnippet: "Search the web via Exa",
		promptGuidelines: [
			"Use exa_search for discovery; use exa_fetch when you already have a URL.",
			"Exa prefers natural-language queries. Default search type is auto with highlights.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query (natural language OK)" }),
			numResults: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 100,
					description: "Max results (default 5)",
					default: 5,
				}),
			),
		}),
		async execute(_toolCallId, params, signal) {
			try {
				assertNotAborted(signal);
				const client = requireClient();
				const numResults = params.numResults ?? 5;
				// Official recommended default: type auto + highlights (lean for agents).
				const response = await client.search(params.query, {
					type: "auto",
					numResults,
					contents: { highlights: true },
				});
				assertNotAborted(signal);

				const results = response.results ?? [];
				if (results.length === 0) {
					return textResult(`No Exa results for: ${params.query}`, {
						query: params.query,
						count: 0,
					});
				}

				const body = results
					.map((r, i) => {
						const highlights = Array.isArray(r.highlights)
							? r.highlights.filter((h): h is string => typeof h === "string")
							: [];
						const snippet =
							highlights.length > 0
								? clip(highlights.join(" … "))
								: typeof r.text === "string"
									? clip(r.text)
									: "";
						const lines = [
							`${i + 1}. ${r.title || "(no title)"}`,
							r.url ? `   ${r.url}` : "",
							snippet ? `   ${snippet}` : "",
							r.publishedDate ? `   date: ${r.publishedDate}` : "",
							r.author ? `   author: ${r.author}` : "",
						].filter(Boolean);
						return lines.join("\n");
					})
					.join("\n\n");

				return textResult(`Exa search: ${params.query}\n\n${body}`, {
					query: params.query,
					count: results.length,
					urls: results.map((r) => r.url).filter((u): u is string => typeof u === "string"),
					requestId: response.requestId,
				});
			} catch (err) {
				return errorResult(err, { query: params.query });
			}
		},
	});

	pi.registerTool({
		name: "exa_fetch",
		label: "Exa Fetch",
		description:
			"Fetch URL(s) with Exa Contents API and return clean text/markdown. Supports multiple URLs per call.",
		promptSnippet: "Fetch URL content via Exa",
		promptGuidelines: [
			"Use exa_fetch when you know the URL(s) and need full page text.",
		],
		parameters: Type.Object({
			urls: Type.Array(Type.String({ description: "URL" }), {
				description: "URLs to fetch (1-10)",
				minItems: 1,
				maxItems: 10,
			}),
		}),
		async execute(_toolCallId, params, signal) {
			const unique = [...new Set(params.urls.map((u) => u.trim()).filter(Boolean))];
			if (unique.length === 0) {
				return textResult("Exa fetch requires at least one URL.", { count: 0 });
			}
			if (unique.length > 10) {
				return textResult("Exa fetch accepts at most 10 URLs.", { count: unique.length });
			}

			try {
				assertNotAborted(signal);
				const client = requireClient();
				// Official happy path: getContents(urls, { text: true })
				const response = await client.getContents(unique, { text: true });
				assertNotAborted(signal);

				const results = response.results ?? [];
				if (results.length === 0) {
					return textResult("Exa fetch returned no results.", {
						urls: unique,
						requestId: response.requestId,
					});
				}

				const parts = results.map((page) => {
					const meta = [
						`Source: ${page.url}`,
						page.title ? `Title: ${page.title}` : "",
						page.publishedDate ? `Date: ${page.publishedDate}` : "",
						page.author ? `Author: ${page.author}` : "",
					]
						.filter(Boolean)
						.join("\n");
					const body = (page.text ?? "").trim() || "(empty content)";
					return `${meta}\n\n${body}`;
				});

				return textResult(parts.join("\n\n---\n\n"), {
					urls: unique,
					ok: results.length,
					requestId: response.requestId,
				});
			} catch (err) {
				return errorResult(err, { urls: unique });
			}
		},
	});
}

/**
 * Firecrawl search + fetch tools via the official Node SDK.
 *
 * Happy path (docs.firecrawl.dev/quickstarts/nodejs):
 *   import { Firecrawl } from "firecrawl";
 *   const app = new Firecrawl(); // FIRECRAWL_API_KEY
 *   await app.search(query, { limit })
 *   await app.scrape(url)        // markdown by default
 *
 * Auth: FIRECRAWL_API_KEY
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Firecrawl } from "firecrawl";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

function textResult(text: string, details: Record<string, unknown> = {}) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

function errorResult(err: unknown, details: Record<string, unknown> = {}) {
	const message = err instanceof Error ? err.message : String(err);
	return textResult(`Firecrawl error: ${message}`, { ...details, error: message });
}

function requireClient(): Firecrawl {
	if (!process.env.FIRECRAWL_API_KEY) {
		throw new Error(
			"FIRECRAWL_API_KEY is not set. Get a key at https://www.firecrawl.dev/app/api-keys",
		);
	}
	// Official default: reads FIRECRAWL_API_KEY from the environment.
	return new Firecrawl();
}

function assertNotAborted(signal?: AbortSignal) {
	if (signal?.aborted) {
		const err = new Error("Aborted");
		err.name = "AbortError";
		throw err;
	}
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Lean SERP line — never dump full page markdown into search results. */
function formatSearchResult(item: Record<string, unknown>, index: number): string {
	const title = typeof item.title === "string" ? item.title : "(no title)";
	const url = typeof item.url === "string" ? item.url : "";
	const description =
		typeof item.description === "string"
			? item.description
			: typeof item.snippet === "string"
				? item.snippet
				: "";
	// Keep snippets short so search stays scannable.
	const snippet =
		description.length > 280 ? `${description.slice(0, 277).trimEnd()}...` : description;
	const category = typeof item.category === "string" ? ` [${item.category}]` : "";

	return [`${index}. ${title}${category}`, url ? `   ${url}` : "", snippet ? `   ${snippet}` : ""]
		.filter(Boolean)
		.join("\n");
}

function formatFetchedMarkdown(title: string | undefined, source: string, markdown: string): string {
	// Metadata lines only — do not synthesize a second H1 on top of page markdown.
	const meta = [`Source: ${source}`, title ? `Title: ${title}` : ""].filter(Boolean).join("\n");
	return `${meta}\n\n${markdown.trim()}`;
}

export default function firecrawlExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "firecrawl_search",
		label: "Firecrawl Search",
		description:
			"Search the web with Firecrawl. Returns ranked results (title, url, description). Use firecrawl_fetch to load a full page.",
		promptSnippet: "Search the web via Firecrawl",
		promptGuidelines: [
			"Use firecrawl_search for discovery; use firecrawl_fetch when you already have a URL.",
			"Prefer a focused query; set limit only when you need more/fewer than the default.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			limit: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 100,
					description: "Max results (default 5)",
					default: 5,
				}),
			),
		}),
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const summary = (context.state as { summary?: string }).summary;
			text.setText(
				theme.fg("toolTitle", theme.bold("firecrawl_search ")) +
					theme.fg("accent", args.query) +
					(summary ? theme.fg("dim", ` (${summary})`) : ""),
			);
			return text;
		},
		renderResult(result, { expanded }, theme, context) {
			const content = result.content.find((item) => item.type === "text");
			const value = content?.type === "text" ? content.text : "";
			const count = result.details?.count;
			if (!context.isError && !result.details?.error && typeof count === "number") {
				const state = context.state as { summary?: string };
				const summary = `${count} ${count === 1 ? "result" : "results"}`;
				if (state.summary !== summary) {
					state.summary = summary;
					context.invalidate();
				}
			}
			if (!expanded && !context.isError && !result.details?.error) return new Container();
			return new Text(
				context.isError || result.details?.error ? theme.fg("error", value) : value,
				0,
				0,
			);
		},
		async execute(_toolCallId, params, signal) {
			try {
				assertNotAborted(signal);
				const client = requireClient();
				const limit = params.limit ?? 5;
				const data = await client.search(params.query, { limit });
				assertNotAborted(signal);
				const web = data.web ?? [];

				if (web.length === 0) {
					return textResult(`No Firecrawl results for: ${params.query}`, {
						query: params.query,
						count: 0,
					});
				}

				const body = web
					.map((item, i) => formatSearchResult(item as Record<string, unknown>, i + 1))
					.join("\n\n");

				return textResult(`Firecrawl search: ${params.query}\n\n${body}`, {
					query: params.query,
					count: web.length,
					urls: web
						.map((item) => ("url" in item ? item.url : undefined))
						.filter((u): u is string => typeof u === "string"),
				});
			} catch (err) {
				return errorResult(err, { query: params.query });
			}
		},
	});

	pi.registerTool({
		name: "firecrawl_fetch",
		label: "Firecrawl Fetch",
		description:
			"Fetch a URL with Firecrawl scrape and return clean markdown (main content). Official scrape happy path.",
		promptSnippet: "Fetch URL content via Firecrawl scrape",
		promptGuidelines: [
			"Use firecrawl_fetch when you know the URL and need page content as markdown.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch" }),
		}),
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const summary = (context.state as { summary?: string }).summary;
			text.setText(
				theme.fg("toolTitle", theme.bold("firecrawl_fetch ")) +
					theme.fg("accent", args.url) +
					(summary ? theme.fg("dim", ` (${summary})`) : ""),
			);
			return text;
		},
		renderResult(result, { expanded }, theme, context) {
			const content = result.content.find((item) => item.type === "text");
			const value = content?.type === "text" ? content.text : "";
			if (!context.isError && !result.details?.error) {
				const state = context.state as { summary?: string };
				const summary = formatBytes(Buffer.byteLength(value, "utf8"));
				if (state.summary !== summary) {
					state.summary = summary;
					context.invalidate();
				}
			}
			if (!expanded && !context.isError && !result.details?.error) return new Container();
			return new Text(
				context.isError || result.details?.error ? theme.fg("error", value) : value,
				0,
				0,
			);
		},
		async execute(_toolCallId, params, signal) {
			try {
				assertNotAborted(signal);
				const client = requireClient();
				// Official happy path: scrape(url) → markdown + metadata
				const doc = await client.scrape(params.url);
				assertNotAborted(signal);
				const title = doc.metadata?.title ?? doc.metadata?.ogTitle;
				const source = doc.metadata?.sourceURL ?? params.url;
				const markdown = doc.markdown?.trim() ?? "";

				if (!markdown) {
					return textResult(`Firecrawl fetch returned no markdown for ${source}`, {
						url: params.url,
						sourceURL: source,
						metadata: doc.metadata ?? {},
					});
				}

				return textResult(formatFetchedMarkdown(title, source, markdown), {
					url: params.url,
					sourceURL: source,
					title: title ?? null,
					scrapeId: doc.metadata?.scrapeId,
				});
			} catch (err) {
				return errorResult(err, { url: params.url });
			}
		},
	});
}

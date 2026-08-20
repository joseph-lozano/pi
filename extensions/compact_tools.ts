/**
 * Header-only tool rows.
 *
 * Collapsed: the call line only (same as `read`).
 *   write → `write path +N`
 *   edit  → `edit path +N -M`
 * Expanded (`ctrl+o`): the tool's stock renderer (content / diff / listing).
 *
 * Write and edit put the preview in `renderCall`, so both slots are gated.
 * Built-ins are re-registered so their 5–20 line previews disappear.
 * `pi.registerTool` is wrapped so later extension tools (exa, firecrawl, …)
 * get the same gate without each one opting in.
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const INNER_CALL = "__compactInnerCall";
const INNER_RESULT = "__compactInnerResult";
const COMPACTED = Symbol("compactTools");

type AnyTool = ToolDefinition<any, any, any>;
type ResultContent = { type: string; text?: string };
type ThemeFg = { fg: (color: string, text: string) => string };

function emptyResult(context: { lastComponent?: unknown }): Text {
	const last = context.lastComponent;
	if (last instanceof Text) {
		last.setText("");
		return last;
	}
	return new Text("", 0, 0);
}

function fallbackResult(
	result: { content?: ResultContent[] },
	theme: ThemeFg,
): Text {
	const text = (result.content ?? [])
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
		.join("\n")
		.trim();
	if (!text) return new Text("", 0, 0);
	const styled = text
		.split("\n")
		.map((line) => theme.fg("toolOutput", line))
		.join("\n");
	return new Text(`\n${styled}`, 0, 0);
}

function countLines(content: string): number {
	if (!content) return 0;
	const lines = content.split("\n");
	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines.length;
}

function diffCounts(diff: string | undefined): { plus: number; minus: number } | undefined {
	if (!diff) return undefined;
	let plus = 0;
	let minus = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) plus++;
		else if (line.startsWith("-") && !line.startsWith("---")) minus++;
	}
	return { plus, minus };
}

function editCountsFromArgs(args: {
	edits?: Array<{ oldText?: string; newText?: string }>;
	oldText?: string;
	newText?: string;
}): { plus: number; minus: number } | undefined {
	const edits =
		Array.isArray(args.edits) && args.edits.length > 0
			? args.edits
			: typeof args.oldText === "string" && typeof args.newText === "string"
				? [{ oldText: args.oldText, newText: args.newText }]
				: [];
	if (edits.length === 0) return undefined;
	let plus = 0;
	let minus = 0;
	for (const edit of edits) {
		minus += countLines(edit.oldText ?? "");
		plus += countLines(edit.newText ?? "");
	}
	return { plus, minus };
}

function pathArg(args: { path?: string; file_path?: string } | undefined): string {
	return args?.path || args?.file_path || "";
}

function collapsedWriteCall(
	args: { path?: string; file_path?: string; content?: string } | undefined,
	theme: ThemeFg,
	lastComponent: unknown,
): Text {
	const lines = countLines(typeof args?.content === "string" ? args.content : "");
	const count = lines > 0 ? ` ${theme.fg("success", `+${lines}`)}` : "";
	const text = `${theme.fg("toolTitle", theme.bold("write"))} ${theme.fg("accent", pathArg(args))}${count}`;
	if (lastComponent instanceof Text) {
		lastComponent.setText(text);
		return lastComponent;
	}
	return new Text(text, 0, 0);
}

function collapsedEditCall(
	args: {
		path?: string;
		file_path?: string;
		edits?: Array<{ oldText?: string; newText?: string }>;
		oldText?: string;
		newText?: string;
	},
	theme: ThemeFg,
	inner: { preview?: { diff?: string; error?: string } } | undefined,
): string {
	const counts = diffCounts(inner?.preview?.diff) ?? editCountsFromArgs(args);
	let text = `${theme.fg("toolTitle", theme.bold("edit"))} ${theme.fg("accent", pathArg(args))}`;
	if (counts) {
		text += ` ${theme.fg("success", `+${counts.plus}`)} ${theme.fg("error", `-${counts.minus}`)}`;
	}
	return text;
}

function compactTool<T extends AnyTool>(tool: T): T {
	if ((tool as object as Record<symbol, boolean>)[COMPACTED]) return tool;

	const originalCall = tool.renderCall;
	const originalResult = tool.renderResult;
	const wrapped = {
		...tool,
		renderCall(args, theme, context) {
			const innerContext = {
				...context,
				lastComponent: context.state?.[INNER_CALL] ?? context.lastComponent,
			};
			const inner = originalCall?.(args, theme, innerContext);
			if (context.state) context.state[INNER_CALL] = inner;

			if (context.expanded || context.isError) {
				return inner ?? new Text(theme.fg("toolTitle", theme.bold(tool.name)), 0, 0);
			}

			if (tool.name === "write") {
				return collapsedWriteCall(args, theme, inner);
			}

			if (tool.name === "edit") {
				const text = collapsedEditCall(args, theme, inner as { preview?: { diff?: string } } | undefined);
				if (inner && typeof (inner as { clear?: unknown }).clear === "function") {
					const box = inner as { clear: () => void; addChild: (child: Text) => void };
					box.clear();
					box.addChild(new Text(text, 0, 0));
					return inner;
				}
				return new Text(text, 0, 0);
			}

			return inner ?? new Text(theme.fg("toolTitle", theme.bold(tool.name)), 0, 0);
		},
		renderResult(result, options, theme, context) {
			const innerContext = {
				...context,
				lastComponent: context.state?.[INNER_RESULT] ?? context.lastComponent,
			};
			const inner = originalResult
				? originalResult(result, options, theme, innerContext)
				: options.expanded || context.isError
					? fallbackResult(result, theme)
					: emptyResult(context);

			if (context.state) context.state[INNER_RESULT] = inner;
			if (!options.expanded && !context.isError) return emptyResult(context);
			return inner;
		},
	} as T;

	Object.defineProperty(wrapped, COMPACTED, { value: true });
	return wrapped;
}

type DefFactory = (cwd: string) => AnyTool;

const BUILTIN_FACTORIES: DefFactory[] = [
	createReadToolDefinition,
	createBashToolDefinition,
	createEditToolDefinition,
	createWriteToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
];

function withSessionCwd(create: DefFactory): AnyTool {
	const cache = new Map<string, AnyTool>();
	const get = (cwd: string) => {
		let def = cache.get(cwd);
		if (!def) {
			def = create(cwd);
			cache.set(cwd, def);
		}
		return def;
	};

	const base = get(process.cwd());
	return {
		...base,
		execute(id, params, signal, onUpdate, ctx) {
			return get(ctx.cwd).execute(id, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme, context) {
			const renderCall = get(context.cwd).renderCall;
			if (renderCall) return renderCall(args, theme, context);
			return new Text(theme.fg("toolTitle", theme.bold(base.name)), 0, 0);
		},
		renderResult(result, options, theme, context) {
			const renderResult = get(context.cwd).renderResult;
			if (renderResult) return renderResult(result, options, theme, context);
			return fallbackResult(result, theme);
		},
	};
}

export default function (pi: ExtensionAPI) {
	const registerTool = pi.registerTool.bind(pi);
	pi.registerTool = ((tool) => {
		registerTool(compactTool(tool as AnyTool) as typeof tool);
	}) as ExtensionAPI["registerTool"];

	for (const create of BUILTIN_FACTORIES) {
		registerTool(compactTool(withSessionCwd(create)));
	}
}

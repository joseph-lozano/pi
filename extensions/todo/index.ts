import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	applyTodoAction,
	createTodoIdFactory,
	MAX_TODO_DISPLAY_NAME,
	MAX_TODO_ITEMS,
	MAX_TODO_NOTE,
	MAX_TODO_TEXT,
	renderTodos,
	restoreTodos,
	selectTodoWindow,
	TODO_ENTRY_TYPE,
	todoContext,
	todoDisplayText,
	type TodoAction,
	type TodoItem,
} from "./state";

export default function todoExtension(pi: ExtensionAPI) {
	let items: TodoItem[] = [];
	const nextId = createTodoIdFactory();

	const persist = () => pi.appendEntry(TODO_ENTRY_TYPE, { items });

	const updateWidget = (ctx: ExtensionContext) => {
		if (items.length === 0) {
			ctx.ui.setWidget("todos", undefined);
			return;
		}
		const snapshot = items.map((item) => ({ ...item }));
		ctx.ui.setWidget("todos", (_tui, theme) => ({
			render(width: number) {
				const finished = snapshot.filter((item) => item.status === "done" || item.status === "skipped").length;
				const { start, visible, below } = selectTodoWindow(snapshot);
				const lines = [theme.fg("accent", theme.bold(`Todos ${finished}/${snapshot.length}`))];
				if (start > 0) lines.push(theme.fg("dim", `… ${start} above`));
				for (const item of visible) {
					const indent = item.parentId ? "  " : "";
					const display = todoDisplayText(item);
					const note = item.note ? theme.fg("dim", ` (${item.note})`) : "";
					switch (item.status) {
						case "active":
							lines.push(`${indent}${theme.fg("accent", "> ")}${theme.fg("text", display)}${note}`);
							break;
						case "done":
							lines.push(`${indent}${theme.fg("success", "✓ ")}${theme.fg("muted", theme.strikethrough(display))}${note}`);
							break;
						case "skipped":
							lines.push(`${indent}${theme.fg("warning", "- ")}${theme.fg("muted", display)}${note}`);
							break;
						case "pending":
							lines.push(`${indent}${theme.fg("dim", "○ ")}${theme.fg("muted", display)}${note}`);
							break;
					}
				}
				if (below > 0) lines.push(theme.fg("dim", `… ${below} below`));
				return lines.map((line) => truncateToWidth(line, Math.max(1, width)));
			},
			invalidate() {},
		}));
	};

	const restore = (ctx: ExtensionContext) => {
		items = restoreTodos(ctx.sessionManager.getBranch());
		updateWidget(ctx);
	};

	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));

	pi.on("before_agent_start", (event) => {
		const context = todoContext(items);
		if (!context) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${context}` };
	});

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description: "Maintain the current session's persisted checklist. Full item text is agent-visible and may be up to 2,000 characters. Human-facing displayName is limited to 80 characters and is required when text exceeds 80. Items receive generated IDs for updates but IDs are hidden from the human widget. Add one-level subtasks with parentId; rename, move, or remove items by ID. Removing a parent also removes its subtasks. Parents cannot be closed until all subtasks are done or skipped.",
		promptSnippet: "Get or update the session's persisted multi-step checklist",
		parameters: Type.Object({
			action: StringEnum(["get", "set", "add", "update", "move", "rename", "remove", "clear"] as const),
			items: Type.Optional(Type.Array(Type.Object({
				text: Type.String({ maxLength: MAX_TODO_TEXT }),
				displayName: Type.Optional(Type.String({ maxLength: MAX_TODO_DISPLAY_NAME })),
				children: Type.Optional(Type.Array(Type.Union([
					Type.String({ maxLength: MAX_TODO_TEXT }),
					Type.Object({
						text: Type.String({ maxLength: MAX_TODO_TEXT }),
						displayName: Type.Optional(Type.String({ maxLength: MAX_TODO_DISPLAY_NAME })),
					}),
				]), { maxItems: MAX_TODO_ITEMS })),
			}), { maxItems: MAX_TODO_ITEMS, description: "Top-level seeds for set; text over 80 characters requires displayName; children create subtasks atomically" })),
			id: Type.Optional(Type.String({ maxLength: 64, description: "Generated todo ID for update, rename, move, or remove" })),
			text: Type.Optional(Type.String({ maxLength: MAX_TODO_TEXT, description: "Full agent-visible item text for add or rename; text over 80 characters requires displayName" })),
			displayName: Type.Optional(Type.String({ maxLength: MAX_TODO_DISPLAY_NAME, description: "Human-facing widget label, required when text exceeds 80 characters" })),
			parentId: Type.Optional(Type.String({ maxLength: 64, description: "Existing top-level todo ID when adding a subtask" })),
			children: Type.Optional(Type.Array(Type.Union([
				Type.String({ maxLength: MAX_TODO_TEXT }),
				Type.Object({
					text: Type.String({ maxLength: MAX_TODO_TEXT }),
					displayName: Type.Optional(Type.String({ maxLength: MAX_TODO_DISPLAY_NAME })),
				}),
			]), { maxItems: MAX_TODO_ITEMS, description: "Subtasks; use an object with displayName when text exceeds 80 characters" })),
			beforeId: Type.Optional(Type.String({ maxLength: 64, description: "Move before this ID; its parent determines the moved item's level" })),
			afterId: Type.Optional(Type.String({ maxLength: 64, description: "Move after this ID; its parent determines the moved item's level" })),
			status: Type.Optional(StringEnum(["pending", "active", "done", "skipped"] as const)),
			note: Type.Optional(Type.String({ maxLength: MAX_TODO_NOTE, description: "Short outcome or skip reason for update" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const next = applyTodoAction(items, params as TodoAction, nextId);
			if (next !== items) {
				items = next;
				persist();
				updateWidget(ctx);
			}
			return {
				content: [{ type: "text", text: renderTodos(items) }],
				details: { items },
			};
		},
		renderCall(args, theme) {
			let detail = "";
			if (args.action === "set") detail = ` ${args.items?.length ?? 0} items`;
			if (args.action === "add") detail = args.parentId
				? ` under ${args.parentId}`
				: args.children?.length ? ` +${args.children.length} subtasks` : "";
			if (args.action === "update") detail = ` ${args.id ?? "?"} ${args.status ?? "?"}`;
			if (args.action === "move") detail = ` ${args.id ?? "?"} ${args.beforeId ? `before ${args.beforeId}` : `after ${args.afterId ?? "?"}`}`;
			if (args.action === "rename") detail = ` ${args.id ?? "?"}`;
			if (args.action === "remove") detail = ` ${args.id ?? "?"}`;
			return new Text(theme.fg("toolTitle", theme.bold("todo")) + theme.fg("muted", ` ${args.action}${detail}`), 0, 0);
		},
		renderResult(result, { expanded }, theme, context) {
			if (!expanded && !context.isError) return new Container();
			const value = result.content
				.filter((item): item is { type: "text"; text: string } => item.type === "text")
				.map((item) => item.text)
				.join("\n");
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText(context.isError ? theme.fg("error", value) : value);
			return text;
		},
	});
}

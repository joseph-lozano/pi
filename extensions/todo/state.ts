export const TODO_ENTRY_TYPE = "todo-state";
export const MAX_TODO_ITEMS = 50;
export const MAX_TODO_TEXT = 2000;
export const MAX_TODO_DISPLAY_NAME = 80;
export const MAX_TODO_NOTE = 160;

export type TodoStatus = "pending" | "active" | "done" | "skipped";

export interface TodoItem {
	id: string;
	text: string;
	displayName?: string;
	status: TodoStatus;
	parentId?: string;
	note?: string;
}

export interface TodoChildSeed {
	text: string;
	displayName?: string;
}

export interface TodoSeed extends TodoChildSeed {
	children?: Array<string | TodoChildSeed>;
}

export type TodoAction =
	| { action: "get" }
	| { action: "set"; items?: TodoSeed[] }
	| { action: "add"; text?: string; displayName?: string; parentId?: string; children?: Array<string | TodoChildSeed> }
	| { action: "update"; id?: string; status?: TodoStatus; note?: string }
	| { action: "move"; id?: string; beforeId?: string; afterId?: string }
	| { action: "rename"; id?: string; text?: string; displayName?: string }
	| { action: "remove"; id?: string }
	| { action: "clear" };

const ID_PATTERN = /^todo_[a-z0-9]+_[a-z0-9]+$|^step-[0-9]+$/;

const STATUS_MARK: Record<TodoStatus, string> = {
	pending: " ",
	active: ">",
	done: "x",
	skipped: "-",
};

function isTodoStatus(value: unknown): value is TodoStatus {
	return value === "pending" || value === "active" || value === "done" || value === "skipped";
}

function cleanText(value: string, label: "text" | "note"): string {
	const cleaned = value.trim();
	const limit = label === "text" ? MAX_TODO_TEXT : MAX_TODO_NOTE;
	if (!cleaned) throw new Error(`todo ${label} cannot be empty`);
	if (cleaned.length > limit) throw new Error(`todo ${label} cannot exceed ${limit} characters`);
	return cleaned;
}

function cleanDisplayName(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const cleaned = value.trim();
	if (!cleaned) return undefined;
	if (cleaned.length > MAX_TODO_DISPLAY_NAME) {
		throw new Error(`todo displayName cannot exceed ${MAX_TODO_DISPLAY_NAME} characters`);
	}
	return cleaned;
}

function presentation(textValue: string, displayValue?: string): { text: string; displayName?: string } {
	const text = cleanText(textValue, "text");
	const displayName = cleanDisplayName(displayValue);
	if (text.length > MAX_TODO_DISPLAY_NAME && !displayName) {
		throw new Error(`todo text over ${MAX_TODO_DISPLAY_NAME} characters requires displayName`);
	}
	return { text, ...(displayName ? { displayName } : {}) };
}

function childSeed(seed: string | TodoChildSeed): TodoChildSeed {
	return typeof seed === "string" ? { text: seed } : seed;
}

export function todoDisplayText(item: TodoItem): string {
	return item.displayName ?? item.text;
}

function validateStructure(items: TodoItem[]): void {
	if (items.length > MAX_TODO_ITEMS) throw new Error(`todo cannot exceed ${MAX_TODO_ITEMS} items`);
	const seen = new Map<string, TodoItem>();
	let currentParentId: string | undefined;
	for (const item of items) {
		if (!ID_PATTERN.test(item.id)) throw new Error(`invalid todo id: ${item.id}`);
		if (seen.has(item.id)) throw new Error(`duplicate todo id: ${item.id}`);
		presentation(item.text, item.displayName);
		if (item.note !== undefined) cleanText(item.note, "note");
		if (item.parentId) {
			const parent = seen.get(item.parentId);
			if (!parent) throw new Error(`todo parent must precede child: ${item.parentId}`);
			if (parent.parentId) throw new Error("todo supports only one subtask level");
			if (item.parentId !== currentParentId) throw new Error(`todo children must immediately follow parent: ${item.parentId}`);
		} else {
			currentParentId = item.id;
		}
		seen.set(item.id, item);
	}
}

function parseItems(value: unknown): TodoItem[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items: TodoItem[] = [];
	for (const [index, item] of value.entries()) {
		if (!item || typeof item !== "object") return undefined;
		const candidate = item as { id?: unknown; text?: unknown; displayName?: unknown; status?: unknown; parentId?: unknown; note?: unknown };
		if (typeof candidate.text !== "string" || !isTodoStatus(candidate.status)) return undefined;
		if (candidate.id !== undefined && typeof candidate.id !== "string") return undefined;
		if (candidate.displayName !== undefined && typeof candidate.displayName !== "string") return undefined;
		if (candidate.parentId !== undefined && typeof candidate.parentId !== "string") return undefined;
		if (candidate.note !== undefined && typeof candidate.note !== "string") return undefined;
		items.push({
			id: candidate.id ?? `step-${index + 1}`,
			text: candidate.text,
			...(candidate.displayName ? { displayName: candidate.displayName } : {}),
			status: candidate.status,
			...(candidate.parentId ? { parentId: candidate.parentId } : {}),
			...(candidate.note ? { note: candidate.note } : {}),
		});
	}
	try {
		validateStructure(items);
		return items;
	} catch {
		return undefined;
	}
}

export function restoreTodos(entries: Array<{ type: string; customType?: string; data?: unknown }>): TodoItem[] {
	let restored: TodoItem[] = [];
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== TODO_ENTRY_TYPE) continue;
		const items = parseItems((entry.data as { items?: unknown } | undefined)?.items);
		if (items) restored = items;
	}
	return restored;
}

export function renderTodos(items: TodoItem[]): string {
	if (items.length === 0) return "No todos.";
	return items.map((item) => {
		const indent = item.parentId ? "   " : "";
		const note = item.note ? ` (${item.note})` : "";
		return `${indent}[${STATUS_MARK[item.status]}] ${item.id}: ${item.text}${note}`;
	}).join("\n");
}

export function createTodoIdFactory(now: () => number = Date.now): () => string {
	let sequence = 0;
	return () => `todo_${now().toString(36)}_${(++sequence).toString(36)}`;
}

function allocateId(items: TodoItem[], nextId: () => string): string {
	const existing = new Set(items.map((item) => item.id));
	for (let attempt = 0; attempt < MAX_TODO_ITEMS * 2; attempt++) {
		const id = nextId();
		if (!existing.has(id)) return id;
	}
	throw new Error("unable to allocate a unique todo id");
}

export function applyTodoAction(items: TodoItem[], action: TodoAction, nextId: () => string): TodoItem[] {
	if (action.action === "get") return items;
	if (action.action === "clear") return [];
	if (action.action === "remove") {
		if (!action.id?.trim()) throw new Error("todo remove requires id");
		if (!items.some((item) => item.id === action.id)) throw new Error(`unknown todo id: ${action.id}`);
		return items.filter((item) => item.id !== action.id && item.parentId !== action.id);
	}
	if (action.action === "rename") {
		if (!action.id?.trim()) throw new Error("todo rename requires id");
		if (action.text === undefined) throw new Error("todo rename requires text");
		const existing = items.find((item) => item.id === action.id);
		if (!existing) throw new Error(`unknown todo id: ${action.id}`);
		const renamed = presentation(action.text, action.displayName === undefined ? existing.displayName : action.displayName);
		return items.map((item) => item.id === action.id ? { ...item, ...renamed } : item);
	}
	if (action.action === "set") {
		if (!action.items?.length) throw new Error("todo set requires at least one item");
		const next: TodoItem[] = [];
		for (const seed of action.items) {
			const parent: TodoItem = { id: allocateId(next, nextId), ...presentation(seed.text, seed.displayName), status: "pending" };
			next.push(parent);
			for (const rawChild of seed.children ?? []) {
				const child = childSeed(rawChild);
				next.push({
					id: allocateId(next, nextId),
					...presentation(child.text, child.displayName),
					status: "pending",
					parentId: parent.id,
				});
			}
		}
		validateStructure(next);
		return next;
	}
	if (action.action === "add") {
		if (!action.text) throw new Error("todo add requires text");
		if (action.parentId && action.children?.length) throw new Error("a subtask cannot have children");
		const added: TodoItem = {
			id: allocateId(items, nextId),
			...presentation(action.text, action.displayName),
			status: "pending",
			...(action.parentId?.trim() ? { parentId: action.parentId.trim() } : {}),
		};
		if (!added.parentId) {
			const next = [...items, added];
			for (const rawChild of action.children ?? []) {
				const child = childSeed(rawChild);
				next.push({
					id: allocateId(next, nextId),
					...presentation(child.text, child.displayName),
					status: "pending",
					parentId: added.id,
				});
			}
			validateStructure(next);
			return next;
		}
		const parentIndex = items.findIndex((item) => item.id === added.parentId);
		if (parentIndex < 0) throw new Error(`unknown todo parent: ${added.parentId}`);
		if (items[parentIndex].parentId) throw new Error("todo supports only one subtask level");
		let insertAt = parentIndex + 1;
		while (insertAt < items.length && items[insertAt].parentId === added.parentId) insertAt++;
		const next = [...items.slice(0, insertAt), added, ...items.slice(insertAt)];
		validateStructure(next);
		return next;
	}
	if (action.action === "move") {
		if (!action.id?.trim()) throw new Error("todo move requires id");
		if (Boolean(action.beforeId) === Boolean(action.afterId)) throw new Error("todo move requires exactly one of beforeId or afterId");
		const source = items.find((item) => item.id === action.id);
		const anchorId = action.beforeId ?? action.afterId!;
		const anchor = items.find((item) => item.id === anchorId);
		if (!source) throw new Error(`unknown todo id: ${action.id}`);
		if (!anchor) throw new Error(`unknown todo anchor: ${anchorId}`);
		const moving = source.parentId ? [source] : [source, ...items.filter((item) => item.parentId === source.id)];
		if (moving.some((item) => item.id === anchor.id)) throw new Error("todo cannot move relative to itself or its subtask");
		if (anchor.parentId && moving.length > 1) throw new Error("a todo with subtasks cannot become a subtask");
		const movingIds = new Set(moving.map((item) => item.id));
		const remaining = items.filter((item) => !movingIds.has(item.id));
		const anchorIndex = remaining.findIndex((item) => item.id === anchor.id);
		let insertAt = anchorIndex;
		if (action.afterId) {
			insertAt++;
			if (!anchor.parentId) {
				while (insertAt < remaining.length && remaining[insertAt].parentId === anchor.id) insertAt++;
			}
		}
		const parentId = anchor.parentId;
		const moved = moving.map((item, index) => {
			if (index > 0) return item;
			const { parentId: _oldParentId, ...base } = item;
			return parentId ? { ...base, parentId } : base;
		});
		const next = [...remaining.slice(0, insertAt), ...moved, ...remaining.slice(insertAt)];
		validateStructure(next);
		return next;
	}
	if (!action.id?.trim()) throw new Error("todo update requires id");
	if (!action.status) throw new Error("todo update requires status");
	if (!items.some((item) => item.id === action.id)) throw new Error(`unknown todo id: ${action.id}`);
	if (action.status === "done" || action.status === "skipped") {
		const unfinishedChild = items.find((item) => item.parentId === action.id && item.status !== "done" && item.status !== "skipped");
		if (unfinishedChild) throw new Error(`todo parent has unfinished subtask: ${unfinishedChild.id}`);
	}
	const note = action.note === undefined || !action.note.trim() ? undefined : cleanText(action.note, "note");
	const next = items.map((item) => {
		const status = action.status === "active" && item.status === "active" ? "pending" : item.status;
		if (item.id !== action.id) return status === item.status ? item : { ...item, status };
		return { ...item, status: action.status!, note };
	});
	validateStructure(next);
	return next;
}

export interface TodoWindow {
	start: number;
	visible: TodoItem[];
	below: number;
}

export function selectTodoWindow(items: TodoItem[]): TodoWindow {
	if (items.length <= 9) return { start: 0, visible: items, below: 0 };
	const active = items.findIndex((item) => item.status === "active");
	const pending = items.findIndex((item) => item.status === "pending");
	const focus = active >= 0 ? active : pending >= 0 ? pending : items.length - 1;
	const visibleLimit = 7;
	const start = Math.max(0, Math.min(focus - 3, items.length - visibleLimit));
	const visible = items.slice(start, start + visibleLimit);
	return { start, visible, below: items.length - start - visible.length };
}

export function todoContext(items: TodoItem[]): string | undefined {
	if (items.length === 0) return undefined;
	return `Current persisted checklist:\n\n${renderTodos(items)}\n\nContinue from the active or first pending item. Address items by ID. Do not silently omit pending items; mark an inapplicable item skipped with a short reason. Complete or skip subtasks individually before closing their parent.`;
}

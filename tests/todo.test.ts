import { describe, expect, test } from "bun:test";
import {
	applyTodoAction,
	createTodoIdFactory,
	MAX_TODO_ITEMS,
	renderTodos,
	restoreTodos,
	selectTodoWindow,
	TODO_ENTRY_TYPE,
	todoContext,
	type TodoItem,
} from "../extensions/todo/state";

const initial: TodoItem[] = [
	{ id: "todo_a_1", text: "Reproduce the bug", status: "done" },
	{ id: "todo_a_2", text: "Fix the root cause", status: "active" },
	{ id: "todo_a_3", text: "Verify the real surface", status: "pending", parentId: "todo_a_2" },
];

describe("todo state", () => {
	test("generates stable IDs and addresses updates by ID", () => {
		const nextId = createTodoIdFactory(() => 123);
		let items = applyTodoAction([], { action: "set", items: [{ text: " First " }, { text: "Second" }] }, nextId);
		expect(items).toEqual([
			{ id: "todo_3f_1", text: "First", status: "pending" },
			{ id: "todo_3f_2", text: "Second", status: "pending" },
		]);
		items = applyTodoAction(items, { action: "update", id: "todo_3f_1", status: "active" }, nextId);
		items = applyTodoAction(items, { action: "update", id: "todo_3f_2", status: "active" }, nextId);
		expect(items.map((item) => item.status)).toEqual(["pending", "active"]);
		items = applyTodoAction(items, { action: "update", id: "todo_3f_2", status: "skipped", note: "not applicable" }, nextId);
		expect(renderTodos(items)).toContain("[-] todo_3f_2: Second (not applicable)");
		expect(applyTodoAction(items, { action: "clear" }, nextId)).toEqual([]);
	});

	test("renames items by ID", () => {
		const nextId = createTodoIdFactory(() => 300);
		const items = applyTodoAction(initial, { action: "rename", id: "todo_a_2", text: " Fix the parser " }, nextId);
		expect(items.find((item) => item.id === "todo_a_2")?.text).toBe("Fix the parser");
		expect(initial[1].text).toBe("Fix the root cause");
		expect(() => applyTodoAction(initial, { action: "rename", id: "todo_a_2" }, nextId)).toThrow("requires text");
		expect(() => applyTodoAction(initial, { action: "rename", id: "todo_missing_1", text: "Missing" }, nextId)).toThrow("unknown todo id");
	});

	test("guards parent completion until all subtasks are closed", () => {
		const nextId = createTodoIdFactory(() => 310);
		expect(() => applyTodoAction(initial, { action: "update", id: "todo_a_2", status: "done" }, nextId)).toThrow("unfinished subtask: todo_a_3");
		expect(() => applyTodoAction(initial, { action: "update", id: "todo_a_2", status: "skipped" }, nextId)).toThrow("unfinished subtask: todo_a_3");
		let items = applyTodoAction(initial, { action: "update", id: "todo_a_3", status: "skipped", note: "not needed" }, nextId);
		items = applyTodoAction(items, { action: "update", id: "todo_a_2", status: "done" }, nextId);
		expect(items.find((item) => item.id === "todo_a_2")?.status).toBe("done");
	});

	test("removes individual items and parent subtrees by ID", () => {
		const nextId = createTodoIdFactory(() => 321);
		let items = applyTodoAction(initial, { action: "remove", id: "todo_a_3" }, nextId);
		expect(items.map((item) => item.id)).toEqual(["todo_a_1", "todo_a_2"]);
		items = applyTodoAction(initial, { action: "remove", id: "todo_a_2" }, nextId);
		expect(items).toEqual([{ id: "todo_a_1", text: "Reproduce the bug", status: "done" }]);
		expect(() => applyTodoAction(initial, { action: "remove" }, nextId)).toThrow("requires id");
		expect(() => applyTodoAction(initial, { action: "remove", id: "todo_missing_1" }, nextId)).toThrow("unknown todo id");
	});

	test("creates one-level subtasks atomically or under an existing parent", () => {
		const nextId = createTodoIdFactory(() => 456);
		let items = applyTodoAction([], {
			action: "set",
			items: [{ text: "Implement", children: ["Write regression test"] }],
		}, nextId);
		expect(items).toEqual([
			{ id: "todo_co_1", text: "Implement", status: "pending" },
			{ id: "todo_co_2", text: "Write regression test", status: "pending", parentId: "todo_co_1" },
		]);
		items = applyTodoAction(items, { action: "add", text: "Run test", parentId: "todo_co_1" }, nextId);
		expect(items.map((item) => item.id)).toEqual(["todo_co_1", "todo_co_2", "todo_co_3"]);
		expect(renderTodos(items)).toContain("   [ ] todo_co_2: Write regression test");
		expect(() => applyTodoAction(items, { action: "add", text: "Too deep", parentId: "todo_co_2" }, nextId)).toThrow("one subtask level");
	});

	test("moves relative to stable IDs and adopts the anchor's level", () => {
		const nextId = createTodoIdFactory(() => 500);
		let items = applyTodoAction([], {
			action: "set",
			items: [{ text: "A", children: ["A1", "A2"] }, { text: "B" }, { text: "C" }],
		}, nextId);
		const [a, a1, a2, b, c] = items.map((item) => item.id);
		items = applyTodoAction(items, { action: "move", id: c, beforeId: a1 }, nextId);
		expect(items.map((item) => [item.text, item.parentId])).toEqual([
			["A", undefined], ["C", a], ["A1", a], ["A2", a], ["B", undefined],
		]);
		items = applyTodoAction(items, { action: "move", id: a2, afterId: b }, nextId);
		expect(items.map((item) => [item.text, item.parentId])).toEqual([
			["A", undefined], ["C", a], ["A1", a], ["B", undefined], ["A2", undefined],
		]);
		items = applyTodoAction(items, { action: "move", id: a, afterId: b }, nextId);
		expect(items.map((item) => item.text)).toEqual(["B", "A", "C", "A1", "A2"]);
		expect(() => applyTodoAction(items, { action: "move", id: a, beforeId: a1 }, nextId)).toThrow("relative to itself");
	});

	test("avoids restored ID collisions and validates every add path", () => {
		const nextId = createTodoIdFactory(() => 123);
		const existing: TodoItem[] = [{ id: "todo_3f_1", text: "Existing", status: "pending" }];
		const added = applyTodoAction(existing, { action: "add", text: "New" }, nextId);
		expect(added.map((item) => item.id)).toEqual(["todo_3f_1", "todo_3f_2"]);
		expect(() => applyTodoAction(existing, { action: "add", text: "Duplicate" }, () => "todo_3f_1")).toThrow("unique todo id");
	});

	test("rejects incomplete, oversized, and structurally invalid mutations", () => {
		const nextId = createTodoIdFactory(() => 789);
		expect(() => applyTodoAction([], { action: "set", items: [] }, nextId)).toThrow("at least one");
		expect(() => applyTodoAction([], { action: "set", items: Array.from({ length: MAX_TODO_ITEMS + 1 }, (_, i) => ({ text: `Step ${i}` })) }, nextId)).toThrow("cannot exceed");
		expect(() => applyTodoAction([], { action: "set", items: [{ text: "x".repeat(161) }] }, nextId)).toThrow("cannot exceed");
		expect(() => applyTodoAction(initial, { action: "add", text: "Child", parentId: "todo_missing_1" }, nextId)).toThrow("unknown todo parent");
		expect(() => applyTodoAction(initial, { action: "update", id: "todo_missing_1", status: "done" }, nextId)).toThrow("unknown todo id");
		expect(() => applyTodoAction(initial, { action: "update", id: "todo_a_1" }, nextId)).toThrow("requires status");
	});

	test("restores only contiguous hierarchies and migrates index-era items", () => {
		const legacy = initial.map(({ id: _id, parentId: _parentId, ...item }) => item);
		const entries = [
			{ type: "custom", customType: TODO_ENTRY_TYPE, data: { items: legacy } },
			{ type: "custom", customType: "other", data: { items: [] } },
			{ type: "custom", customType: TODO_ENTRY_TYPE, data: { items: "invalid" } },
			{ type: "custom", customType: TODO_ENTRY_TYPE, data: { items: initial } },
		];
		expect(restoreTodos(entries)).toEqual(initial);
		expect(restoreTodos(entries.slice(0, 1)).map((item) => item.id)).toEqual(["step-1", "step-2", "step-3"]);
		const split = [initial[0], { id: "todo_b_1", text: "Other", status: "pending" as const }, initial[2]];
		expect(restoreTodos([{ type: "custom", customType: TODO_ENTRY_TYPE, data: { items: split } }])).toEqual([]);
	});

	test("widget window falls back to the first pending item", () => {
		const items: TodoItem[] = Array.from({ length: 20 }, (_, index) => ({
			id: `todo_z_${(index + 1).toString(36)}`,
			text: `Step ${index + 1}`,
			status: index < 10 ? "done" : "pending",
		}));
		const window = selectTodoWindow(items);
		expect(window.visible.some((item) => item.text === "Step 11")).toBe(true);
		expect(window.start).toBe(7);
		expect(window.below).toBe(6);
	});

	test("formats hierarchy for per-turn context injection", () => {
		expect(todoContext([])).toBeUndefined();
		expect(todoContext(initial)).toContain("[>] todo_a_2: Fix the root cause");
		expect(todoContext(initial)).toContain("   [ ] todo_a_3: Verify the real surface");
		expect(todoContext(initial)).toContain("Address items by ID");
	});
});

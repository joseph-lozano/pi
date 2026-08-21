import { todoDisplayText, type TodoItem, type TodoStatus } from "./state";

const STATUS_MARK: Record<TodoStatus, string> = {
	pending: "○",
	active: ">",
	done: "✓",
	skipped: "-",
};

export interface TodoCatalogBlock {
	id: string;
	status: TodoStatus;
	child: boolean;
	rows: string[];
}

function wrapPlain(text: string, width: number): string[] {
	if (text.length <= width) return [text];
	const rows: string[] = [];
	let rest = text;
	while (rest.length > width) {
		const cut = rest.lastIndexOf(" ", width - 1);
		const breakAt = cut > 0 ? cut + 1 : width;
		rows.push(rest.slice(0, breakAt));
		rest = rest.slice(breakAt);
	}
	if (rest) rows.push(rest);
	return rows;
}

export function layoutTodoCatalog(items: readonly TodoItem[], innerWidth: number): TodoCatalogBlock[] {
	const width = Math.max(1, innerWidth);
	const blocks: TodoCatalogBlock[] = [];
	for (const item of items) {
		const child = Boolean(item.parentId);
		const indent = child ? "  " : "";
		const fieldIndent = `${indent}  `;
		const headerRows = wrapPlain(`${indent}${STATUS_MARK[item.status]} ${item.id}  ${todoDisplayText(item)}`, width);
		const rows = [...headerRows];
		if (item.parentId) rows.push(...wrapPlain(`${fieldIndent}parent: ${item.parentId}`, width));
		if (item.displayName) rows.push(...wrapPlain(`${fieldIndent}displayName: ${item.displayName}`, width));
		if (item.displayName || headerRows.length > 1) rows.push(...wrapPlain(`${fieldIndent}text: ${item.text}`, width));
		if (item.note) rows.push(...wrapPlain(`${fieldIndent}note: ${item.note}`, width));
		blocks.push({ id: item.id, status: item.status, child, rows });
	}
	return blocks;
}

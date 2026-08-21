import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { layoutTodoCatalog } from "./catalog";
import { type TodoItem, type TodoStatus } from "./state";

export interface TodoOverlayDeps {
	getItems: () => readonly TodoItem[];
	theme: Theme;
	requestRender: () => void;
	done: () => void;
}

export class TodoOverlay {
	private scroll = 0;
	private timer?: ReturnType<typeof setInterval>;

	constructor(private readonly deps: TodoOverlayDeps) {
		this.timer = setInterval(deps.requestRender, 250);
		this.timer.unref?.();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.deps.done();
			return;
		}
		if (matchesKey(data, "up") || data === "k") this.scroll = Math.max(0, this.scroll - 1);
		else if (matchesKey(data, "down") || data === "j") this.scroll += 1;
		else if (data === "g") this.scroll = 0;
		else if (data === "G") this.scroll = Number.MAX_SAFE_INTEGER;
		this.deps.requestRender();
	}

	render(width: number): string[] {
		if (width < 8) return [truncateToWidth("Todos", Math.max(0, width), "")];
		const th = this.deps.theme;
		const innerWidth = Math.max(1, width - 2);
		const line = (text = "") => truncateToWidth(text, innerWidth);
		const items = this.deps.getItems();
		const blocks = layoutTodoCatalog(items, innerWidth);
		const catalog: { text: string; header: boolean; status?: TodoStatus }[] = [];
		if (blocks.length === 0) {
			catalog.push({ text: "No todos.", header: false });
		} else {
			for (const block of blocks) {
				for (const [index, row] of block.rows.entries()) {
					catalog.push({ text: row, header: index === 0, status: block.status });
				}
			}
		}

		const bodyHeight = 18;
		const maxScroll = Math.max(0, catalog.length - bodyHeight);
		this.scroll = Math.min(this.scroll, maxScroll);
		const bodyRows = catalog.slice(this.scroll, this.scroll + bodyHeight).map((entry) => {
			let painted: string;
			if (!entry.header || !entry.status) painted = th.fg("dim", entry.text);
			else {
				switch (entry.status) {
					case "active":
						painted = th.fg("accent", entry.text);
						break;
					case "done":
						painted = th.fg("muted", th.strikethrough(entry.text));
						break;
					case "skipped":
						painted = th.fg("warning", entry.text);
						break;
					case "pending":
						painted = th.fg("dim", entry.text);
						break;
					default: {
						const _exhaustive: never = entry.status;
						painted = _exhaustive;
					}
				}
			}
			return line(painted);
		});
		while (bodyRows.length < bodyHeight) bodyRows.push("");

		const position = catalog.length > bodyHeight
			? ` • ${this.scroll + 1}-${Math.min(catalog.length, this.scroll + bodyHeight)}/${catalog.length}`
			: "";
		const help = line(th.fg("dim", `j/k or ↑/↓ scroll${position} • g/G • esc close`));
		const content = [...bodyRows, help];

		const finished = items.filter((item) => item.status === "done" || item.status === "skipped").length;
		const title = ` Todos ${finished}/${items.length} `;
		const top = th.fg("borderMuted", `╭─${title}${"─".repeat(Math.max(0, width - visibleWidth(title) - 3))}╮`);
		const framed = content.map((row) => {
			const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(row)));
			return `${th.fg("borderMuted", "│")}${row}${padding}${th.fg("borderMuted", "│")}`;
		});
		return [top, ...framed, th.fg("borderMuted", `╰${"─".repeat(innerWidth)}╯`)];
	}

	invalidate(): void {}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
	}
}

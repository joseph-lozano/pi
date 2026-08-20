import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type BtwRun = (signal: AbortSignal) => Promise<string>;

type State =
	| { kind: "loading" }
	| { kind: "answer"; text: string }
	| { kind: "error"; message: string };

export class BtwOverlay {
	private state: State = { kind: "loading" };
	private scroll = 0;
	private closed = false;
	private readonly controller = new AbortController();

	constructor(
		private readonly question: string,
		private readonly theme: Theme,
		private readonly requestRender: () => void,
		private readonly done: () => void,
		run: BtwRun,
	) {
		void run(this.controller.signal)
			.then((text) => {
				if (this.closed) return;
				this.state = { kind: "answer", text: text || "(No text response.)" };
				this.requestRender();
			})
			.catch((error: unknown) => {
				if (this.closed) return;
				if (this.controller.signal.aborted) return this.close();
				this.state = { kind: "error", message: error instanceof Error ? error.message : String(error) };
				this.requestRender();
			});
	}

	private close(): void {
		if (this.closed) return;
		this.closed = true;
		this.controller.abort();
		this.done();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return this.close();
		if (this.state.kind !== "loading" && matchesKey(data, "enter")) return this.close();
		if (matchesKey(data, "up") || data === "k") this.scroll = Math.max(0, this.scroll - 1);
		else if (matchesKey(data, "down") || data === "j") this.scroll += 1;
		else if (data === "g") this.scroll = 0;
		else if (data === "G") this.scroll = Number.MAX_SAFE_INTEGER;
		this.requestRender();
	}

	render(width: number): string[] {
		if (width < 8) return [truncateToWidth("BTW", Math.max(0, width), "")];
		const th = this.theme;
		const innerWidth = Math.max(1, width - 2);
		const line = (text = "") => truncateToWidth(text, innerWidth);
		const bodyHeight = 15;
		const question = this.question.replace(/\s+/g, " ");
		const heading = line(`${th.fg("accent", "Q")} ${th.fg("muted", question)}`);

		let body: string[];
		if (this.state.kind === "loading") {
			body = [th.fg("warning", "Thinking…")];
		} else {
			const text = this.state.kind === "answer"
				? th.fg("text", this.state.text)
				: th.fg("error", `Error: ${this.state.message}`);
			body = wrapTextWithAnsi(text, innerWidth);
		}

		const maxScroll = Math.max(0, body.length - bodyHeight);
		this.scroll = Math.min(this.scroll, maxScroll);
		const bodyRows = body.slice(this.scroll, this.scroll + bodyHeight).map(line);
		while (bodyRows.length < bodyHeight) bodyRows.push("");

		const position = body.length > bodyHeight
			? ` • ${this.scroll + 1}-${Math.min(body.length, this.scroll + bodyHeight)}/${body.length}`
			: "";
		const help = this.state.kind === "loading"
			? "esc cancel"
			: `j/k or ↑/↓ scroll${position} • enter/esc close`;
		const content = [heading, th.fg("borderMuted", "─".repeat(innerWidth)), ...bodyRows, th.fg("dim", help)].map(line);

		const title = " BTW ";
		const top = th.fg("borderMuted", `╭─${title}${"─".repeat(Math.max(0, width - visibleWidth(title) - 3))}╮`);
		const framed = content.map((row) => {
			const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(row)));
			return `${th.fg("borderMuted", "│")}${row}${padding}${th.fg("borderMuted", "│")}`;
		});
		return [top, ...framed, th.fg("borderMuted", `╰${"─".repeat(innerWidth)}╯`)];
	}

	invalidate(): void {}

	dispose(): void {
		this.closed = true;
		this.controller.abort();
	}
}

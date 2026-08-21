export function wheelDirection(data: string): -1 | 1 | undefined {
	const match = /^\x1b\[<(\d+);\d+;\d+[Mm]$/.exec(data);
	if (!match) return undefined;
	const button = Number.parseInt(match[1]!, 10);
	if ((button & 64) === 0) return undefined;
	return (button & 1) === 0 ? -1 : 1;
}

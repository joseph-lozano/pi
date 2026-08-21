export function addedRenderedRows(hadPending: boolean, completedLines: number, hasPending: boolean): number {
	return Math.max(0, completedLines + (hasPending ? 1 : 0) - (hadPending ? 1 : 0));
}

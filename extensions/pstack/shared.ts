const REGISTRY_KEY = Symbol.for("pi.pstack.runtime-state.v1");

interface PstackRuntimeRegistry {
	enabled: boolean;
	availableModels?: Set<string>;
}

type RegistryGlobal = typeof globalThis & { [REGISTRY_KEY]?: PstackRuntimeRegistry };

function registry(): PstackRuntimeRegistry {
	const global = globalThis as RegistryGlobal;
	return global[REGISTRY_KEY] ??= { enabled: false };
}

export function isPotetoModeEnabled(): boolean {
	return registry().enabled;
}

export function setPotetoModeEnabled(enabled: boolean): void {
	registry().enabled = enabled;
}

export function setPstackAvailableModels(ids: readonly string[]): void {
	registry().availableModels = new Set(ids);
}

export function isPstackModelAvailable(id: string): boolean {
	const available = registry().availableModels;
	return available ? available.has(id) : true;
}

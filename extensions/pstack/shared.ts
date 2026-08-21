const REGISTRY_KEY = Symbol.for("pi.pstack.mode-state.v1");

interface PstackModeRegistry {
	enabled: boolean;
}

type RegistryGlobal = typeof globalThis & { [REGISTRY_KEY]?: PstackModeRegistry };

function registry(): PstackModeRegistry {
	const global = globalThis as RegistryGlobal;
	return global[REGISTRY_KEY] ??= { enabled: false };
}

export function isPotetoModeEnabled(): boolean {
	return registry().enabled;
}

export function setPotetoModeEnabled(enabled: boolean): void {
	registry().enabled = enabled;
}

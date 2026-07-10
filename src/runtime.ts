/** Pure runtime guards shared by the plugin and its Node test suite. */

export function isSuccessfulExit(code: number | null): boolean {
	return code === 0;
}

export function isValidPort(value: number): boolean {
	return Number.isInteger(value) && value >= 1 && value <= 65_535;
}


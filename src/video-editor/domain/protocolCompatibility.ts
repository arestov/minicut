export interface ProtocolVersion {
	major: number
	minor: number
}

const toInteger = (value: unknown): number | null => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return null
	}
	const normalized = Math.trunc(value)
	return normalized >= 0 ? normalized : null
}

export const parseProtocolVersion = (
	value: number | string,
): ProtocolVersion | null => {
	if (typeof value === 'number') {
		const major = toInteger(value)
		if (major === null) {
			return null
		}

		return { major, minor: 0 }
	}

	const [majorRaw, minorRaw = '0'] = value.trim().split('.', 2)
	const major = toInteger(Number(majorRaw))
	const minor = toInteger(Number(minorRaw))
	if (major === null || minor === null) {
		return null
	}

	return { major, minor }
}

export const isProtocolCompatible = (
	local: ProtocolVersion,
	remote: ProtocolVersion,
): boolean => {
	// Compatibility policy: strict major, tolerant minor.
	return local.major === remote.major
}

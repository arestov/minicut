export const reduceTrackAppendStart = (starts: unknown, durations: unknown): number => {
	const s = Array.isArray(starts) ? starts : []
	const d = Array.isArray(durations) ? durations : []
	let maxEnd = 0
	const len = Math.max(s.length, d.length)
	for (let i = 0; i < len; i += 1) {
		const sv = typeof s[i] === 'number' && Number.isFinite(s[i]) ? s[i] : 0
		const dv = typeof d[i] === 'number' && Number.isFinite(d[i]) ? d[i] : 0
		maxEnd = Math.max(maxEnd, sv + dv)
	}
	return maxEnd
}

import { finiteNumberOr } from "../valueGuards";

export const reduceTrackAppendStart = (
	starts: unknown,
	durations: unknown,
): number => {
	const s = Array.isArray(starts) ? starts : [];
	const d = Array.isArray(durations) ? durations : [];
	let maxEnd = 0;
	const len = Math.max(s.length, d.length);
	for (let i = 0; i < len; i += 1) {
		const sv = finiteNumberOr(s[i], 0);
		const dv = finiteNumberOr(d[i], 0);
		maxEnd = Math.max(maxEnd, sv + dv);
	}
	return maxEnd;
};

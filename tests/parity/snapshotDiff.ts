import type { ParitySnapshot } from "./sharedScenario";

const near = (a: number | null, b: number | null, tolerance: number): boolean =>
	a === b || (a !== null && b !== null && Math.abs(a - b) <= tolerance);

/**
 * Differences between two snapshots, one line each; empty when they are equal.
 * Times (start, in, duration, resource duration, cursor) match within
 * `timeTolerance` seconds, everything else exactly.
 */
export const diffSnapshots = (web: ParitySnapshot, desktop: ParitySnapshot, timeTolerance: number): string[] => {
	const diffs: string[] = [];
	const check = (label: string, a: unknown, b: unknown, equal: boolean = Object.is(a, b)): void => {
		if (!equal) diffs.push(`${label}: web ${JSON.stringify(a)} != desktop ${JSON.stringify(b)}`);
	};
	for (const key of ["fps", "width", "height"] as const) check(`project.${key}`, web.project[key], desktop.project[key]);

	check("track names", web.tracks.map((track) => track.name), desktop.tracks.map((track) => track.name),
		JSON.stringify(web.tracks.map((track) => track.name)) === JSON.stringify(desktop.tracks.map((track) => track.name)));
	for (const track of web.tracks) {
		const other = desktop.tracks.find((candidate) => candidate.name === track.name);
		if (!other) continue;
		check(`${track.name}.kind`, track.kind, other.kind);
		check(`${track.name} clip count`, track.clips.length, other.clips.length);
		track.clips.slice(0, other.clips.length).forEach((clip, index) => {
			const peer = other.clips[index];
			const label = `${track.name}[${index}] ${clip.name}`;
			check(`${label}.name`, clip.name, peer.name);
			check(`${label}.mediaKind`, clip.mediaKind, peer.mediaKind);
			check(`${label}.resource`, clip.resource, peer.resource);
			for (const key of ["start", "in", "duration"] as const) {
				check(`${label}.${key}`, clip[key], peer[key], near(clip[key], peer[key], timeTolerance));
			}
			for (const key of ["fadeIn", "fadeOut", "gain", "pan", "opacity"] as const) {
				check(`${label}.${key}`, clip[key], peer[key], near(clip[key], peer[key], 0.001));
			}
		});
	}

	check("resource names", web.resources.map((r) => r.name), desktop.resources.map((r) => r.name),
		JSON.stringify(web.resources.map((r) => r.name)) === JSON.stringify(desktop.resources.map((r) => r.name)));
	for (const resource of web.resources) {
		const other = desktop.resources.find((candidate) => candidate.name === resource.name);
		if (!other) continue;
		check(`resource ${resource.name}.kind`, resource.kind, other.kind);
		check(`resource ${resource.name}.duration`, resource.duration, other.duration, near(resource.duration, other.duration, timeTolerance));
	}

	check("session.cursor", web.session.cursor, desktop.session.cursor, near(web.session.cursor, desktop.session.cursor, 0.005));
	check("session.isPlaying", web.session.isPlaying, desktop.session.isPlaying);
	check("session.selectedClip", web.session.selectedClip, desktop.session.selectedClip,
		JSON.stringify(web.session.selectedClip) === JSON.stringify(desktop.session.selectedClip));
	return diffs;
};

import { acceptedPublication, publicationIdentity, publicationProposal, publicationTuple, recordOf, samePublicationCandidate, samePublicationTuple, samePublicationValue, type AcceptedPublication, type PublicationProposal, type PublicationBindingResult, type PublicationRetirement } from "./mediaPublicationProtocol";

/** Physical ownership only. A retained record exists before staging/resolution enters I/O. */
export type RetainedPublication = { proposal: PublicationProposal | null; request: Record<string, unknown>; retired: boolean; settled: boolean; started?: boolean; accepted: AcceptedPublication | null; lastResult: PublicationBindingResult | null; file?: File; stagedAssetRef?: string | null; stagedHandleRef?: string | null; playbackUrl?: string; transferUrl?: string; playbackEntered: boolean; transferEntered: boolean; nativeAssetId?: string; nativePath?: string; retirement?: PublicationRetirement };
const keyOf = (value: unknown) => JSON.stringify(publicationTuple(value));
type QueueItem = { kind: "install"; record: RetainedPublication; decision: AcceptedPublication } | { kind: "release"; record: RetainedPublication; retirement: PublicationRetirement } | { kind: "notify"; result: PublicationBindingResult } | { kind: "notify-decision"; decision: AcceptedPublication; outcome: PublicationBindingResult["outcome"] } | { kind: "rollback"; record: RetainedPublication };
type Mailbox = { highestObserved: number; active: boolean; pending: QueueItem | null; releases: QueueItem[] };
export const createMediaPublicationConsumer = (host: {
	installTransfer(record: RetainedPublication, decision: AcceptedPublication): void;
	installPlayback(record: RetainedPublication, decision: AcceptedPublication): void;
	release(record: RetainedPublication, retirement: PublicationRetirement): void;
	reject(record: RetainedPublication): void;
	result(result: PublicationBindingResult): void;
	now(): number;
}) => {
	const records = new Map<string, RetainedPublication>();
	const mailboxes = new Map<string, Mailbox>();
	let disposed = false;
	const mailbox = (resourceId: string) => { let box = mailboxes.get(resourceId); if (!box) { box = { highestObserved: 0, active: false, pending: null, releases: [] }; mailboxes.set(resourceId, box); } return box; };
	const result = (decision: AcceptedPublication, outcome: PublicationBindingResult["outcome"], reason?: string): PublicationBindingResult => ({ ...publicationTuple(decision)!, sequence: decision.sequence, candidateFingerprint: decision.candidateFingerprint, candidateFingerprintVersion: decision.candidateFingerprintVersion, outcome, boundaryUpdatedAt: host.now(), ...(reason ? { reason } : {}) });
	const drain = (box: Mailbox) => {
		if (box.active || disposed) return;
		box.active = true;
		try {
			while (!disposed && (box.releases.length || box.pending)) {
				const item = box.releases.shift() ?? box.pending!;
				if (item === box.pending) box.pending = null;
				if (item.kind === "notify" || item.kind === "notify-decision") {
					try {
						const notification = item.kind === "notify" ? item.result : result(item.decision, item.outcome);
						if (!disposed) host.result(notification);
					} catch { /* Delivery uncertainty preserves the retained receipt. */ }
					continue;
				}
				if (item.kind === "rollback") { try { host.reject(item.record); } catch { /* Exact unaccepted cleanup remains uncertain. */ } continue; }
				if (item.kind === "release") { if (item.record.settled) { try { host.release(item.record, item.retirement); } catch { /* Retain uncertain physical ownership for teardown. */ } } continue; }
				const { record, decision } = item;
				if (record.retired || decision.sequence < box.highestObserved) { record.lastResult = result(decision, "obsolete"); }
				else {
					try {
						record.transferEntered = true; host.installTransfer(record, decision);
						if (disposed) break;
						if (!record.retired) { record.playbackEntered = true; host.installPlayback(record, decision); }
						if (disposed) break;
						record.lastResult = result(decision, record.retired ? "obsolete" : "installed");
					} catch (error) { record.lastResult = result(decision, "indeterminate", error instanceof Error ? error.message : "publication-install-unknown"); }
				}
				if (!disposed && record.lastResult) { try { host.result(record.lastResult); } catch { /* Never relabel an entered host call as unaccepted. */ } }
			}
		} finally { box.active = false; }
	};
	return {
		retain(request: Record<string, unknown>): RetainedPublication | null {
			if (disposed || !publicationTuple(request)) return null;
			const key = keyOf(request); const existing = records.get(key); if (existing) return existing;
			const record: RetainedPublication = { request, proposal: null, retired: false, settled: false, accepted: null, lastResult: null, playbackEntered: false, transferEntered: false };
			records.set(key, record); return record;
		},
		get(value: unknown) { return records.get(keyOf(value)) ?? null; },
isDisposed() { return disposed; },
		consumeDecision(payload: unknown) {
			if (disposed) return;
			const envelope = recordOf(payload); if (!envelope) return;
			if (envelope.kind === "rejected") {
				const record = records.get(keyOf(envelope));
				if (record && !record.accepted && envelope.candidateDisposition === "rollback-unaccepted") { record.retired = true; if (record.settled) { const box = mailbox(String(record.request.resourceId)); box.releases.push({ kind: "rollback", record }); drain(box); } }
				return;
			}
			const decision = acceptedPublication(envelope.decision); const proposal = publicationProposal(decision);
			if (!decision || decision.kind !== "accepted" || !proposal || !Number.isSafeInteger(decision.sequence) || decision.sequence < 1) return;
			const record = records.get(keyOf(decision));
			if (!record?.proposal || !record.settled || !samePublicationCandidate(record.proposal, decision) || !samePublicationValue(record.proposal.pointer, proposal.pointer) || !samePublicationValue(record.proposal.candidateFileMetadata, proposal.candidateFileMetadata)) return;
			record.accepted = decision;
			const box = mailbox(decision.resourceId);
			if (envelope.bindingEligibility !== "current" || record.retired) { box.releases.push({ kind: "notify-decision", decision, outcome: "obsolete" }); drain(box); return; }
			if (decision.sequence <= box.highestObserved) { if (record.lastResult) { box.releases.push({ kind: "notify", result: record.lastResult }); drain(box); } return; }
			box.highestObserved = decision.sequence;
			if (box.pending?.kind === "install") box.releases.push({ kind: "notify-decision", decision: box.pending.decision, outcome: "obsolete" });
			box.pending = { kind: "install", record, decision };
			drain(box);
		},
		consumeRetirement(payload: unknown) {
			if (disposed) return;
			const retirement = recordOf(payload) as PublicationRetirement | null; if (!retirement || !publicationTuple(retirement)) return;
			let record = records.get(keyOf(retirement));
			const nullableRef = (value: unknown) => value === null || typeof value === "string" && value.length > 0;
			if (![retirement.assetRef, retirement.handleRef, retirement.excludedAssetRef, retirement.excludedHandleRef].every(nullableRef) || typeof retirement.reason !== "string" || !retirement.reason || (retirement.sequence === null ? retirement.disposition !== "unaccepted" || retirement.accepted !== null : retirement.disposition !== "no-longer-current")) return;
			if (retirement.sequence !== null && (!Number.isSafeInteger(retirement.sequence) || retirement.sequence < 1 || record?.accepted && retirement.sequence !== record.accepted.sequence)) return;
			if (retirement.sequence === null ? retirement.releaseTransferToken !== null || retirement.releasePlaybackToken !== null : retirement.releaseTransferToken !== publicationIdentity(retirement, retirement.sequence) || retirement.releasePlaybackToken !== publicationIdentity(retirement, retirement.sequence)) return;
			if (retirement.sequence !== null) {
				const canonical = acceptedPublication(retirement.accepted);
				if (!canonical || canonical.sequence !== retirement.sequence || !samePublicationTuple(canonical, retirement) || !samePublicationValue(retirement.pointer, canonical.pointer) || retirement.assetRef !== canonical.pointer.assetRef || retirement.handleRef !== (canonical.pointer.sourceKind === "file-handle" ? canonical.pointer.sourceRef : null)) return;
				if (record && (!record.proposal || !samePublicationCandidate(record.proposal, canonical) || !samePublicationValue(record.proposal.pointer, canonical.pointer))) return;
				if (!record) {
					// A committed exact retirement also owns durable refs after the old host disappears.
					// Retire before any host callback; this record has no installable physical capability.
					record = { request: canonical, proposal: canonical, accepted: canonical, retired: true, settled: true, lastResult: null, playbackEntered: false, transferEntered: false };
					records.set(keyOf(retirement), record);
				}
			}
			if (!record) return;
			record.retired = true; record.retirement = retirement;
			const box = mailbox(retirement.resourceId); if (retirement.sequence !== null) box.highestObserved = Math.max(box.highestObserved, retirement.sequence);
			box.releases.push({ kind: "release", record, retirement }); drain(box);
		},
		settle(record: RetainedPublication) {
			record.settled = true;
			if (record.retired && !disposed) { const box = mailbox(String(record.request.resourceId)); box.releases.push(record.retirement ? { kind: "release", record, retirement: record.retirement } : { kind: "rollback", record }); drain(box); }
		},
		dispose() { disposed = true; for (const record of records.values()) record.retired = true; for (const box of mailboxes.values()) { box.pending = null; box.releases.length = 0; } return [...records.values()]; },
	};
};

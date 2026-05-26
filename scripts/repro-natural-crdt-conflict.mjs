import { createCrdtWorkerPair } from '../src/video-editor/dkt/test/createCrdtWorkerPair.ts'

const roomId = process.env.MINICUT_REPRO_ROOM ?? `natural-conflict-${Date.now()}`

const readConflictStore = (runtime, filter) =>
	runtime.crdt_runtime?.conflict_store?.readConflicts?.(filter) ?? []

const readNumber = (peer, model, attr) => {
	const value = peer.ctx.getAttr(model, attr)
	return typeof value === 'number' ? value : Number(value ?? 0)
}

const summarizeTransport = (pair) => ({
	relayLog: pair.relay.getRoomSnapshot(roomId).log.map((packet) => ({
		peerId: packet.peerId,
		profileId: packet.profileId,
		batchIds: packet.payload.batches.map((batch) => batch?.batch_id ?? null),
		opCount: packet.payload.batches.reduce(
			(sum, batch) => sum + (batch?.ops?.length ?? 0),
			0,
		),
	})),
	receivedA: pair.transportA.received.length,
	receivedB: pair.transportB.received.length,
})

const main = async () => {
	const pair = await createCrdtWorkerPair({
		roomId,
		profileId: 'minicut-crdt-v1',
		profileVersion: 1,
	})

	try {
		await pair.a.dispatch(pair.a.videoTrack, 'addClip', {
			name: 'natural-conflict-fixture.webm',
			mediaKind: 'video',
			start: 0,
			in: 0,
			duration: 4,
		})
		await pair.waitForConvergence()

		const clipA = (await pair.a.ctx.queryRel(pair.a.videoTrack, 'clips'))[0]
		const clipB = (await pair.b.ctx.queryRel(pair.b.videoTrack, 'clips'))[0]
		if (!clipA || !clipB) {
			throw new Error('Expected matching baseline clips')
		}
		if (clipA._node_id !== clipB._node_id) {
			throw new Error(`Expected shared clip id, got ${clipA._node_id} and ${clipB._node_id}`)
		}

		// Natural conflict: peers edit the same CRDT timing field independently before
		// either peer receives the other's batch.
		try {
			pair.partition()
			await pair.a.dispatch(clipA, 'trim', { edge: 'end', delta: -1 })
			await pair.b.dispatch(clipB, 'trim', { edge: 'end', delta: -2 })
			pair.heal()
			await pair.waitForConvergence()
		} catch (error) {
			console.log(JSON.stringify({
				ok: false,
				roomId,
				clipId: clipA._node_id,
				diagnostic: error instanceof Error ? error.message : String(error),
				transport: summarizeTransport(pair),
			}, null, 2))
			return
		}

		const conflictsA = readConflictStore(pair.a.ctx.runtime, {
			node_id: clipA._node_id,
			aggregate: 'clipTiming',
			status: 'open',
		})
		const conflictsB = readConflictStore(pair.b.ctx.runtime, {
			node_id: clipB._node_id,
			aggregate: 'clipTiming',
			status: 'open',
		})
		const openTimingA = readNumber(
			pair.a,
			clipA,
			'$meta$aggregates$crdt$clipTiming$open_conflicts_count',
		)
		const openTimingB = readNumber(
			pair.b,
			clipB,
			'$meta$aggregates$crdt$clipTiming$open_conflicts_count',
		)
		const openDurationA = readNumber(
			pair.a,
			clipA,
			'$meta$attrs$crdt$duration$open_conflicts_count',
		)
		const openDurationB = readNumber(
			pair.b,
			clipB,
			'$meta$attrs$crdt$duration$open_conflicts_count',
		)

		if (conflictsA.length === 0 || conflictsB.length === 0) {
			throw new Error('Expected open timing conflicts in both peer conflict stores')
		}
		if (Math.max(openTimingA, openDurationA) <= 0 || Math.max(openTimingB, openDurationB) <= 0) {
			throw new Error('Expected generated conflict meta on both peer clips')
		}

		const result = {
			ok: true,
			roomId,
			clipId: clipA._node_id,
			peerA: {
				duration: pair.a.ctx.getAttr(clipA, 'duration'),
				openTiming: openTimingA,
				openDuration: openDurationA,
				conflicts: conflictsA,
			},
			peerB: {
				duration: pair.b.ctx.getAttr(clipB, 'duration'),
				openTiming: openTimingB,
				openDuration: openDurationB,
				conflicts: conflictsB,
			},
			transport: summarizeTransport(pair),
		}
		console.log(JSON.stringify(result, null, 2))
	} finally {
		pair.close()
		await pair.a.ctx.close()
		await pair.b.ctx.close()
	}
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})

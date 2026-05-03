import { isProtocolCompatible, parseProtocolVersion } from './protocolCompatibility'

describe('protocol compatibility policy', () => {
	it('parses numeric and semantic protocol values', () => {
		expect(parseProtocolVersion(1)).toEqual({ major: 1, minor: 0 })
		expect(parseProtocolVersion('2.3')).toEqual({ major: 2, minor: 3 })
		expect(parseProtocolVersion('7')).toEqual({ major: 7, minor: 0 })
	})

	it('rejects malformed protocol values', () => {
		expect(parseProtocolVersion('bad')).toBeNull()
		expect(parseProtocolVersion('1.bad')).toBeNull()
		expect(parseProtocolVersion(-1)).toBeNull()
	})

	it('requires strict major and tolerates minor differences', () => {
		expect(isProtocolCompatible({ major: 1, minor: 2 }, { major: 1, minor: 0 })).toBe(true)
		expect(isProtocolCompatible({ major: 1, minor: 0 }, { major: 1, minor: 99 })).toBe(true)
		expect(isProtocolCompatible({ major: 1, minor: 4 }, { major: 2, minor: 0 })).toBe(false)
	})
})

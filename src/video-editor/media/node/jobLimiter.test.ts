import { describe, expect, it } from "vitest";
import { JobLimiter } from "./jobLimiter";
import { parseProgressLine } from "./ffmpegRunner";

describe("JobLimiter", () => {
	it("grants up to the limit and queues the rest in FIFO order", async () => {
		const limiter = new JobLimiter(1);
		const first = limiter.acquire();
		const second = limiter.acquire();
		const third = limiter.acquire();
		const releaseFirst = await first.ready;
		expect(limiter.activeCount).toBe(1);
		expect(limiter.queuedCount).toBe(2);
		releaseFirst();
		const releaseSecond = await second.ready;
		expect(limiter.queuedCount).toBe(1);
		releaseSecond();
		(await third.ready)();
		expect(limiter.activeCount).toBe(0);
	});

	it("aborting a queued waiter rejects it without taking a slot", async () => {
		const limiter = new JobLimiter(1);
		const first = limiter.acquire();
		const second = limiter.acquire();
		second.abort();
		await expect(second.ready).rejects.toThrow("aborted");
		expect(limiter.queuedCount).toBe(0);
		(await first.ready)();
		expect(limiter.activeCount).toBe(0);
	});

	it("rejects an invalid limit", () => {
		expect(() => new JobLimiter(0)).toThrow();
	});
});

describe("parseProgressLine", () => {
	it("reads microsecond out_time lines only", () => {
		expect(parseProgressLine("out_time_us=1500000")).toBe(1.5);
		expect(parseProgressLine("out_time_ms=2000000")).toBe(2);
		expect(parseProgressLine("out_time=00:00:01.5")).toBeNull();
		expect(parseProgressLine("out_time_us=-9223372036854775807")).toBeNull();
		expect(parseProgressLine("progress=end")).toBeNull();
	});
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaJobController } from "./mediaJob";

describe("MediaJobController", () => {
	afterEach(() => vi.restoreAllMocks());

	it("isolates throwing listeners from the job and other listeners", () => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
		const job = new MediaJobController<number>("j");
		const seen: string[] = [];
		job.onProgress(() => {
			throw new Error("progress boom");
		});
		job.onProgress((e) => seen.push(`p:${e.stage}`));
		job.onDone(() => {
			throw new Error("done boom");
		});
		job.onDone((n) => seen.push(`d:${n}`));
		job.emitProgress({ stage: "queued", ratio: 0 });
		job.done(7);
		expect(seen).toEqual(["p:queued", "d:7"]);
		expect(errorLog).toHaveBeenCalledTimes(2);
		// late subscribers that throw during replay do not throw either
		expect(() =>
			job.onDone(() => {
				throw new Error("late boom");
			}),
		).not.toThrow();
	});

	it("replays error and cancelled terminals to late subscribers", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const failed = new MediaJobController<number>("f");
		failed.fail({ code: "process-failed", message: "x" });
		const codes: string[] = [];
		failed.onError((e) => codes.push(e.code));
		failed.onCancelled(() => codes.push("cancelled-should-not-fire"));
		expect(codes).toEqual(["process-failed"]);

		const cancelled = new MediaJobController<number>("c");
		const events: string[] = [];
		cancelled.onCancelled(() => events.push("live"));
		cancelled.cancelled();
		cancelled.onCancelled(() => events.push("late"));
		cancelled.onDone(() => events.push("done-should-not-fire"));
		expect(events).toEqual(["live", "late"]);
	});

	it("settles once", async () => {
		const job = new MediaJobController<number>("s");
		job.done(1);
		job.fail({ code: "process-failed", message: "x" });
		job.cancelled();
		expect(await job.outcome).toEqual({ status: "done", artifact: 1 });
	});
});

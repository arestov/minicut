/** FIFO limiter with cancellable waiters. */
export class JobLimiter {
	private active = 0;
	private waiters: Array<() => void> = [];

	constructor(readonly limit: number) {
		if (!Number.isInteger(limit) || limit < 1) {
			throw new Error(`Concurrency limit must be a positive integer: ${limit}`);
		}
	}

	get activeCount(): number {
		return this.active;
	}

	get queuedCount(): number {
		return this.waiters.length;
	}

	/**
	 * Resolves with a release function once a slot is free, or null if
	 * `isCancelled()` turned true while waiting (checked via `wake()`).
	 */
	acquire(): { ready: Promise<() => void>; abort: () => void } {
		let aborted = false;
		let wakeFn: (() => void) | null = null;
		const ready = new Promise<() => void>((resolve, reject) => {
			const grant = (): void => {
				this.active += 1;
				let released = false;
				resolve(() => {
					if (released) return;
					released = true;
					this.active -= 1;
					this.next();
				});
			};
			if (this.active < this.limit) {
				grant();
				return;
			}
			wakeFn = () => {
				if (aborted) {
					reject(new Error("aborted"));
					return;
				}
				grant();
			};
			this.waiters.push(wakeFn);
		});
		ready.catch(() => undefined);
		return {
			ready,
			abort: () => {
				if (aborted) return;
				aborted = true;
				const index = wakeFn ? this.waiters.indexOf(wakeFn) : -1;
				if (index >= 0) {
					this.waiters.splice(index, 1);
					wakeFn?.();
				}
			},
		};
	}

	private next(): void {
		while (this.active < this.limit && this.waiters.length > 0) {
			this.waiters.shift()?.();
		}
	}
}

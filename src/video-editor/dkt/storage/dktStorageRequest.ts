import { requestToPromise } from "dkt-all/libs/provoda/crdt/storage/atomic/requestor.js";

export type DktStorageRequest<Result, Args extends unknown[] = []> = (
	done: (error: unknown, value?: Result) => void,
	...args: Args
) => void;

export const runDktStorageRequest = <Result, Args extends unknown[] = []>(
	request: DktStorageRequest<Result, Args>,
	...args: Args
): Promise<Result> => requestToPromise(request, ...args) as Promise<Result>;

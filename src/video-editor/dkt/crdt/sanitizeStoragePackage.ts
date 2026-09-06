type StoragePackage = {
	dktStorage: unknown;
	crdtStorage: unknown;
	whenReady?: () => Promise<void> | void;
	close?: () => Promise<void> | void;
};

const cloneAssert = (value: unknown, label: string): void => {
	if (typeof structuredClone !== "function") {
		return;
	}
	try {
		structuredClone(value);
	} catch (error) {
		const reason =
			error instanceof Error ||
			(typeof DOMException !== "undefined" && error instanceof DOMException)
				? `${error.name}: ${error.message}`
				: String(error);
		const message = `MiniCut DKT storage value is not structured-cloneable at ${label}: ${reason}`;
		if (typeof DOMException !== "undefined") {
			throw new DOMException(message, "DataCloneError");
		}
		throw new Error(`DataCloneError: ${message}`);
	}
};

export const sanitizeStorageValue = (
	value: unknown,
	seen: WeakSet<object> = new WeakSet(),
): unknown => {
	if (value == null) return value;
	if (typeof value === "function") return undefined;
	if (typeof value !== "object") return value;
	if (typeof (value as Promise<unknown>).then === "function") return undefined;
	if (seen.has(value)) return undefined;
	seen.add(value);
	if (Array.isArray(value)) {
		return value
			.map((item) => sanitizeStorageValue(item, seen))
			.filter((item) => item !== undefined);
	}
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, "value")) continue;
		const next = sanitizeStorageValue(descriptor.value, seen);
		if (next !== undefined) {
			result[key] = next;
		}
	}
	return result;
};

const sanitizeChangesList = (changesList: unknown): unknown => {
	if (!Array.isArray(changesList)) return sanitizeStorageValue(changesList);
	const result = [];
	for (let index = 0; index < changesList.length; index += 2) {
		const name = changesList[index];
		const value = sanitizeStorageValue(changesList[index + 1]);
		if (value !== undefined) {
			result.push(name, value);
		}
	}
	return result;
};

export const sanitizeDktCrdtStoragePackage = <Package extends StoragePackage>(
	storagePackage: Package,
): Package => {
	const dktStorage = storagePackage.dktStorage as Record<string, unknown> | null;
	const crdtStorage = storagePackage.crdtStorage as Record<string, unknown> | null;
	if (!dktStorage || typeof dktStorage !== "object") return storagePackage;
	const wrapGenericStorage = (storage: Record<string, unknown> | null) => {
		if (!storage || typeof storage !== "object") return storage;
		const wrappedStorage: Record<string, unknown> = { ...storage };
		for (const [key, value] of Object.entries(storage)) {
			if (typeof value !== "function") continue;
			wrappedStorage[key] = (...args: unknown[]) =>
				(value as (...args: unknown[]) => unknown)(
					...args.map((item) => sanitizeStorageValue(item)),
				);
		}
		return wrappedStorage;
	};
	const wrappedDktStorage = {
		...dktStorage,
		putSchema(value: unknown) {
			const sanitized = sanitizeStorageValue(value);
			cloneAssert(sanitized, "dkt.putSchema");
			return (dktStorage.putSchema as (value: unknown) => unknown)?.(sanitized);
		},
		putProjectMeta(value: unknown) {
			const sanitized = sanitizeStorageValue(value);
			cloneAssert(sanitized, "dkt.putProjectMeta");
			return (dktStorage.putProjectMeta as (value: unknown) => unknown)?.(sanitized);
		},
		createModel(
			id: string,
			modelName: string,
			attrs?: Record<string, unknown>,
			rels?: Record<string, unknown>,
			mentions?: Record<string, unknown>,
		) {
			const sanitizedAttrs = sanitizeStorageValue(attrs) as Record<
				string,
				unknown
			>;
			const sanitizedRels = sanitizeStorageValue(rels) as Record<
				string,
				unknown
			>;
			const sanitizedMentions = sanitizeStorageValue(mentions) as Record<
				string,
				unknown
			>;
			cloneAssert(
				{
					attrs: sanitizedAttrs,
					rels: sanitizedRels,
					mentions: sanitizedMentions,
				},
				`dkt.createModel:${modelName}:${id}`,
			);
			return (
				dktStorage.createModel as (
					id: string,
					modelName: string,
					attrs?: Record<string, unknown>,
					rels?: Record<string, unknown>,
					mentions?: Record<string, unknown>,
				) => unknown
			)?.(id, modelName, sanitizedAttrs, sanitizedRels, sanitizedMentions);
		},
		updateModelAttrs(id: string, changesList: unknown[]) {
			const sanitized = sanitizeChangesList(changesList) as unknown[];
			cloneAssert(sanitized, `dkt.updateModelAttrs:${id}`);
			return (
				dktStorage.updateModelAttrs as (
					id: string,
					changesList: unknown[],
				) => unknown
			)?.(id, sanitized);
		},
		updateModelRel(id: string, relName: string, value: unknown) {
			const sanitized = sanitizeStorageValue(value);
			cloneAssert(sanitized, `dkt.updateModelRel:${id}:${relName}`);
			return (
				dktStorage.updateModelRel as (
					id: string,
					relName: string,
					value: unknown,
				) => unknown
			)?.(id, relName, sanitized);
		},
		updateModelMention(
			id: string,
			modelName: string,
			mentionName: string,
			value: unknown,
		) {
			const sanitized = sanitizeStorageValue(value);
			cloneAssert(
				sanitized,
				`dkt.updateModelMention:${modelName}:${id}:${mentionName}`,
			);
			return (
				dktStorage.updateModelMention as (
					id: string,
					modelName: string,
					mentionName: string,
					value: unknown,
				) => unknown
			)?.(id, modelName, mentionName, sanitized);
		},
		createExpectedRel(key: string, data: unknown) {
			const sanitized = sanitizeStorageValue(data);
			cloneAssert(sanitized, `dkt.createExpectedRel:${key}`);
			return (
				dktStorage.createExpectedRel as (key: string, data: unknown) => unknown
			)?.(key, sanitized);
		},
		commitChanges(done: unknown, meta?: unknown) {
			const sanitized = sanitizeStorageValue(meta);
			cloneAssert(sanitized, "dkt.commitChanges.meta");
			return (
				dktStorage.commitChanges as (done: unknown, meta?: unknown) => unknown
			)?.(done, sanitized);
		},
	};
	return {
		...storagePackage,
		dktStorage: wrappedDktStorage,
		crdtStorage: wrapGenericStorage(crdtStorage),
	} as Package;
};

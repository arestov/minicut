type StoragePackage = {
	dktStorage: unknown;
	crdtStorage: unknown;
	whenReady?: () => Promise<void> | void;
	close?: () => Promise<void> | void;
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
			return (dktStorage.putSchema as (value: unknown) => unknown)?.(
				sanitizeStorageValue(value),
			);
		},
		putProjectMeta(value: unknown) {
			return (dktStorage.putProjectMeta as (value: unknown) => unknown)?.(
				sanitizeStorageValue(value),
			);
		},
		createModel(
			id: string,
			modelName: string,
			attrs?: Record<string, unknown>,
			rels?: Record<string, unknown>,
			mentions?: Record<string, unknown>,
		) {
			return (
				dktStorage.createModel as (
					id: string,
					modelName: string,
					attrs?: Record<string, unknown>,
					rels?: Record<string, unknown>,
					mentions?: Record<string, unknown>,
				) => unknown
			)?.(
				id,
				modelName,
				sanitizeStorageValue(attrs) as Record<string, unknown>,
				sanitizeStorageValue(rels) as Record<string, unknown>,
				sanitizeStorageValue(mentions) as Record<string, unknown>,
			);
		},
		updateModelAttrs(id: string, changesList: unknown[]) {
			return (
				dktStorage.updateModelAttrs as (
					id: string,
					changesList: unknown[],
				) => unknown
			)?.(id, sanitizeChangesList(changesList) as unknown[]);
		},
		updateModelRel(id: string, relName: string, value: unknown) {
			return (
				dktStorage.updateModelRel as (
					id: string,
					relName: string,
					value: unknown,
				) => unknown
			)?.(id, relName, sanitizeStorageValue(value));
		},
		updateModelMention(
			id: string,
			modelName: string,
			mentionName: string,
			value: unknown,
		) {
			return (
				dktStorage.updateModelMention as (
					id: string,
					modelName: string,
					mentionName: string,
					value: unknown,
				) => unknown
			)?.(id, modelName, mentionName, sanitizeStorageValue(value));
		},
		createExpectedRel(key: string, data: unknown) {
			return (
				dktStorage.createExpectedRel as (key: string, data: unknown) => unknown
			)?.(key, sanitizeStorageValue(data));
		},
		commitChanges(meta?: unknown) {
			return (dktStorage.commitChanges as (meta?: unknown) => unknown)?.(
				sanitizeStorageValue(meta),
			);
		},
	};
	return {
		...storagePackage,
		dktStorage: wrappedDktStorage,
		crdtStorage: wrapGenericStorage(crdtStorage),
	} as Package;
};

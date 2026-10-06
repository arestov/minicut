let nextShapeId = 1;

export type ReactShapeSpec = {
	attrs?: readonly string[];
	rels?: readonly string[];
	one?: Record<string, DefinedReactShape>;
	many?: Record<string, DefinedReactShape>;
};

export type DefinedReactShape = Readonly<ReactShapeSpec> & {
	readonly id: string;
};

export const defineShape = (shape: ReactShapeSpec): DefinedReactShape => {
	const normalized: DefinedReactShape = Object.freeze({
		attrs: Object.freeze([...(shape.attrs ?? [])]),
		rels: Object.freeze([...(shape.rels ?? [])]),
		one: Object.freeze({ ...(shape.one ?? {}) }),
		many: Object.freeze({ ...(shape.many ?? {}) }),
		id: `shape-${nextShapeId++}`,
	});

	return normalized;
};

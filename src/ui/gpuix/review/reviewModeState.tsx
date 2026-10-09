import {
	type Accessor,
	type JSX,
	createContext,
	createSignal,
	useContext,
} from "solid-js";

/**
 * UI state of review mode: whether it is open and which review item (by node
 * id) is selected. Like Web's ProjectReviewMode this is local view state; the
 * items and every resolution live in the model.
 */
export type ReviewMode = {
	isOpen: Accessor<boolean>;
	open(): void;
	close(): void;
	selectedNodeId: Accessor<string | null>;
	select(nodeId: string | null): void;
};

export const createReviewMode = (): ReviewMode => {
	const [isOpen, setIsOpen] = createSignal(false);
	const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
	return {
		isOpen,
		open: () => setIsOpen(true),
		close: () => setIsOpen(false),
		selectedNodeId,
		select: setSelectedNodeId,
	};
};

const ReviewModeContext = createContext<ReviewMode>();

export const ReviewModeProvider = (props: { children: JSX.Element }) => (
	<ReviewModeContext.Provider value={createReviewMode()}>
		{props.children}
	</ReviewModeContext.Provider>
);

export const useReviewMode = (): ReviewMode => {
	const mode = useContext(ReviewModeContext);
	if (!mode) {
		throw new Error("review mode is required. render inside ReviewModeProvider");
	}
	return mode;
};

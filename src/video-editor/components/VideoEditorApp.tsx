import {
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { ScopeContext } from "../../dkt-react-sync/context/ScopeContext";
import { useActions } from "../../dkt-react-sync/hooks/useActions";
import { useAttrs } from "../../dkt-react-sync/hooks/useAttrs";
import { useReactScopeRuntime } from "../../dkt-react-sync/hooks/useReactScopeRuntime";
import { useScope } from "../../dkt-react-sync/hooks/useScope";
import { Inspector } from "./Inspector";
import { MediaBin } from "./MediaBin";
import { createPreviewMediaElementRegistry } from "./mediaElementRegistry";
import { PreviewPanel } from "./PreviewPanel";
import { TimelineView } from "./TimelineView";
import { Toolbar } from "./Toolbar";

const playbackUiFrameMs = 1000 / 30;
const inspectorWidthMin = 240;
const inspectorWidthMax = 460;
const previewWidthMin = 360;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

/**
 * Provides project scope to children when an active project is set.
 * Transparent (renders children at session scope) when there is no active project.
 */
const ActiveProjectScope = ({ children }: { children: React.ReactNode }) => {
	const runtime = useReactScopeRuntime();
	const sessionScope = useScope();
	const projectScope = useSyncExternalStore(
		(listener) =>
			sessionScope
				? runtime.subscribeOne(sessionScope, "activeProject", listener)
				: () => {},
		() =>
			sessionScope ? runtime.readOne(sessionScope, "activeProject") : null,
		() =>
			sessionScope ? runtime.readOne(sessionScope, "activeProject") : null,
	);
	return (
		<ScopeContext.Provider value={projectScope ?? sessionScope}>
			{children}
		</ScopeContext.Provider>
	);
};

const PlaybackLoop = () => {
	const sessionDispatch = useActions();
	const { isPlaying } = useAttrs(["isPlaying"]) as { isPlaying?: unknown };

	useEffect(() => {
		if (!isPlaying) {
			return;
		}

		// Fill buffer immediately when playback starts
		sessionDispatch("startPreviewBuffer");

		let lastTime = performance.now();
		let accumulatedMs = 0;
		let frameId = 0;
		const tick = (time: number) => {
			const elapsedMs = time - lastTime;
			lastTime = time;
			accumulatedMs += elapsedMs;
			if (accumulatedMs >= playbackUiFrameMs) {
				const deltaSeconds = Math.min(accumulatedMs / 1000, 0.25);
				accumulatedMs = 0;
				sessionDispatch("tickPlayback", { deltaSeconds });
			}
			frameId = requestAnimationFrame(tick);
		};

		frameId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frameId);
	}, [sessionDispatch, isPlaying]);

	return null;
};

export const VideoEditorApp = () => {
	const { activeInspectorTab } = useAttrs(["activeInspectorTab"]) as {
		activeInspectorTab?: unknown;
	};
	const mediaElementRegistryRef = useRef(createPreviewMediaElementRegistry());
	const mainTopRef = useRef<HTMLDivElement | null>(null);
	const isResizingInspectorRef = useRef(false);
	const stopDocumentResizeRef = useRef<(() => void) | null>(null);
	const [inspectorWidth, setInspectorWidth] = useState(280);
	const [isResizingInspector, setIsResizingInspector] = useState(false);
	const showColorScopes = activeInspectorTab === "color";
	const resizeInspector = (clientX: number): void => {
		const rect = mainTopRef.current?.getBoundingClientRect();
		if (!rect) {
			return;
		}

		const availableMax = Math.max(
			inspectorWidthMin,
			rect.width - 280 - previewWidthMin - 8,
		);
		setInspectorWidth(
			clamp(
				rect.right - clientX,
				inspectorWidthMin,
				Math.min(inspectorWidthMax, availableMax),
			),
		);
	};
	const startInspectorResize = (clientX: number): void => {
		if (isResizingInspectorRef.current) {
			return;
		}

		isResizingInspectorRef.current = true;
		setIsResizingInspector(true);
		resizeInspector(clientX);
		const handleDocumentPointerMove = (pointerEvent: PointerEvent): void => {
			if (!isResizingInspectorRef.current) {
				return;
			}

			resizeInspector(pointerEvent.clientX);
			pointerEvent.preventDefault();
		};
		const stopDocumentResize = (): void => {
			isResizingInspectorRef.current = false;
			setIsResizingInspector(false);
			window.removeEventListener("pointermove", handleDocumentPointerMove);
			window.removeEventListener("pointerup", stopDocumentResize);
			window.removeEventListener("pointercancel", stopDocumentResize);
			window.removeEventListener("mousemove", handleDocumentMouseMove);
			window.removeEventListener("mouseup", stopDocumentResize);
			stopDocumentResizeRef.current = null;
		};
		const handleDocumentMouseMove = (mouseEvent: MouseEvent): void => {
			if (!isResizingInspectorRef.current) {
				return;
			}

			resizeInspector(mouseEvent.clientX);
			mouseEvent.preventDefault();
		};
		stopDocumentResizeRef.current?.();
		stopDocumentResizeRef.current = stopDocumentResize;
		window.addEventListener("pointermove", handleDocumentPointerMove);
		window.addEventListener("pointerup", stopDocumentResize);
		window.addEventListener("pointercancel", stopDocumentResize);
		window.addEventListener("mousemove", handleDocumentMouseMove);
		window.addEventListener("mouseup", stopDocumentResize);
	};
	const handleResizePointerDown = (
		event: ReactPointerEvent<HTMLDivElement>,
	): void => {
		event.currentTarget.setPointerCapture?.(event.pointerId);
		startInspectorResize(event.clientX);
		event.preventDefault();
	};
	const handleResizeMouseDown = (
		event: ReactMouseEvent<HTMLDivElement>,
	): void => {
		startInspectorResize(event.clientX);
		event.preventDefault();
	};
	const handleResizePointerMove = (
		event: ReactPointerEvent<HTMLDivElement>,
	): void => {
		if (!isResizingInspectorRef.current) {
			return;
		}

		resizeInspector(event.clientX);
		event.preventDefault();
	};
	const stopResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (!isResizingInspectorRef.current) {
			return;
		}

		isResizingInspectorRef.current = false;
		setIsResizingInspector(false);
		stopDocumentResizeRef.current?.();
		event.currentTarget.releasePointerCapture?.(event.pointerId);
	};

	return (
		<div className="ve-shell">
			<PlaybackLoop />
			<Toolbar />
			<main className="ve-main">
				<div
					ref={mainTopRef}
					className={`ve-main__top${showColorScopes ? " ve-main__top--scopes" : ""}`}
					style={
						{ "--ve-inspector-width": `${inspectorWidth}px` } as CSSProperties
					}
				>
					<MediaBin />
					<ActiveProjectScope>
						<PreviewPanel
							mediaElementRegistry={mediaElementRegistryRef.current}
						/>
						<hr
							className={`ve-panel-resizer${isResizingInspector ? " is-dragging" : ""}`}
							tabIndex={0}
							onPointerDown={handleResizePointerDown}
							onPointerMove={handleResizePointerMove}
							onPointerUp={stopResize}
							onPointerCancel={stopResize}
							onMouseDown={handleResizeMouseDown}
						/>
						<Inspector mediaElementRegistry={mediaElementRegistryRef.current} />
					</ActiveProjectScope>
				</div>
				<ActiveProjectScope>
					<TimelineView />
				</ActiveProjectScope>
			</main>
		</div>
	);
};

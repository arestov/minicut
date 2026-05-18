export const WORKSPACE_OPEN_STATUS = {
	OPENING: 0,
	READY: 1,
	EMPTY_INITIALIZED: 2,
	FAILED: 3,
} as const;

export const WORKSPACE_OPEN_FAILURE = {
	NONE: 0,
	UNSUPPORTED_NEWER_VERSION: 1,
	MIGRATION_REQUIRED: 2,
	INCOMPATIBLE: 3,
	STORAGE_ERROR: 4,
} as const;

export type WorkspaceOpenStatus =
	(typeof WORKSPACE_OPEN_STATUS)[keyof typeof WORKSPACE_OPEN_STATUS];

export type WorkspaceOpenFailure =
	(typeof WORKSPACE_OPEN_FAILURE)[keyof typeof WORKSPACE_OPEN_FAILURE];

export type WorkspaceOpenState =
	| {
			status: typeof WORKSPACE_OPEN_STATUS.OPENING;
			failureReason: typeof WORKSPACE_OPEN_FAILURE.NONE;
	  }
	| {
			status: typeof WORKSPACE_OPEN_STATUS.READY;
			failureReason: typeof WORKSPACE_OPEN_FAILURE.NONE;
	  }
	| {
			status: typeof WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED;
			failureReason: typeof WORKSPACE_OPEN_FAILURE.NONE;
	  }
	| {
			status: typeof WORKSPACE_OPEN_STATUS.FAILED;
			failureReason: Exclude<
				WorkspaceOpenFailure,
				typeof WORKSPACE_OPEN_FAILURE.NONE
			>;
	  };

export const WORKSPACE_OPENING_STATE: WorkspaceOpenState = {
	status: WORKSPACE_OPEN_STATUS.OPENING,
	failureReason: WORKSPACE_OPEN_FAILURE.NONE,
};

export const WORKSPACE_READY_STATE: WorkspaceOpenState = {
	status: WORKSPACE_OPEN_STATUS.READY,
	failureReason: WORKSPACE_OPEN_FAILURE.NONE,
};

export const WORKSPACE_EMPTY_INITIALIZED_STATE: WorkspaceOpenState = {
	status: WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED,
	failureReason: WORKSPACE_OPEN_FAILURE.NONE,
};

export const createWorkspaceOpenFailedState = (
	failureReason: Exclude<
		WorkspaceOpenFailure,
		typeof WORKSPACE_OPEN_FAILURE.NONE
	>,
): WorkspaceOpenState => ({
	status: WORKSPACE_OPEN_STATUS.FAILED,
	failureReason,
});

export const WORKSPACE_OPEN_STATUS_LABEL = {
	[WORKSPACE_OPEN_STATUS.OPENING]: "opening",
	[WORKSPACE_OPEN_STATUS.READY]: "ready",
	[WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED]: "empty_initialized",
	[WORKSPACE_OPEN_STATUS.FAILED]: "failed",
} as const satisfies Record<WorkspaceOpenStatus, string>;

export const WORKSPACE_OPEN_FAILURE_LABEL = {
	[WORKSPACE_OPEN_FAILURE.NONE]: "none",
	[WORKSPACE_OPEN_FAILURE.UNSUPPORTED_NEWER_VERSION]:
		"unsupported_newer_version",
	[WORKSPACE_OPEN_FAILURE.MIGRATION_REQUIRED]: "migration_required",
	[WORKSPACE_OPEN_FAILURE.INCOMPATIBLE]: "incompatible",
	[WORKSPACE_OPEN_FAILURE.STORAGE_ERROR]: "storage_error",
} as const satisfies Record<WorkspaceOpenFailure, string>;

export const getWorkspaceOpenStatusLabel = (
	status: WorkspaceOpenStatus | number,
): string =>
	WORKSPACE_OPEN_STATUS_LABEL[status as WorkspaceOpenStatus] ?? "unknown";

export const getWorkspaceOpenFailureLabel = (
	failureReason: WorkspaceOpenFailure | number,
): string =>
	WORKSPACE_OPEN_FAILURE_LABEL[failureReason as WorkspaceOpenFailure] ?? "unknown";

export const isWorkspaceOpenFailed = (
	state: WorkspaceOpenState | null | undefined,
): state is Extract<
	WorkspaceOpenState,
	{ status: typeof WORKSPACE_OPEN_STATUS.FAILED }
> => state?.status === WORKSPACE_OPEN_STATUS.FAILED;

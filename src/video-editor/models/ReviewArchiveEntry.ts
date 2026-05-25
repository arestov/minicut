import { model } from "dkt/model.js";

export const REVIEW_ARCHIVE_ENTRY_CREATION_SHAPE = {
	attrs: [
		"archiveEntryId",
		"conflictId",
		"reviewItemId",
		"projectId",
		"sourceConflictClipId",
		"editedVariant",
		"createdAt",
	],
} as const;

export const ReviewArchiveEntry = model({
	model_name: "review_archive_entry",
	crdt: { mode: "local" },
	attrs: {
		archiveEntryId: ["input", ""],
		conflictId: ["input", ""],
		reviewItemId: ["input", ""],
		projectId: ["input", ""],
		sourceConflictClipId: ["input", ""],
		editedVariant: ["input", null],
		createdAt: ["input", 0],
	},
});

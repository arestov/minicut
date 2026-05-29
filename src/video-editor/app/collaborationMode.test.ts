import { describe, expect, test } from "vitest";
import { resolveCollaborationMode, TEST_SINGLE_MODE_PARAM } from "./collaborationMode";

const params = (query = "") => new URLSearchParams(query);

describe("resolveCollaborationMode", () => {
	test("uses p2p by default", () => {
		expect(resolveCollaborationMode({ env: {}, searchParams: params() })).toBe(
			"p2p",
		);
	});

	test("ignores the test-only single mode param in production-like envs", () => {
		expect(
			resolveCollaborationMode({
				env: { DEV: false, MODE: "production" },
				searchParams: params(`${TEST_SINGLE_MODE_PARAM}=1`),
			}),
		).toBe("p2p");
	});

	test("allows the secret single mode param in dev and test runtimes", () => {
		expect(
			resolveCollaborationMode({
				env: { DEV: true, MODE: "development" },
				searchParams: params(`${TEST_SINGLE_MODE_PARAM}=1`),
			}),
		).toBe("single");
		expect(
			resolveCollaborationMode({
				env: { DEV: false, MODE: "test" },
				searchParams: params(`${TEST_SINGLE_MODE_PARAM}=true`),
			}),
		).toBe("single");
	});

	test("allows an internal env flag for test runners", () => {
		expect(
			resolveCollaborationMode({
				env: { DEV: false, MODE: "test", VITE_MINICUT_TEST_SINGLE_MODE: "1" },
				searchParams: params(),
			}),
		).toBe("single");
	});
});

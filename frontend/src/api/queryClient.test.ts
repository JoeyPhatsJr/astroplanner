import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { retryDelay, shouldRetry, TRANSIENT_RETRY_DELAYS_MS } from "./queryClient";

describe("query retries", () => {
  it("never retries a 401", () => {
    expect(shouldRetry(0, new ApiError(401, "Sign in"))).toBe(false);
  });

  it.each([0, 429, 502, 503, 504])("retries a transient %i up to three times with growing waits", (status) => {
    const e = new ApiError(status, "busy");
    expect([0, 1, 2, 3].map((n) => shouldRetry(n, e))).toEqual([true, true, true, false]);
    expect([0, 1, 2].map((n) => retryDelay(n, e))).toEqual(TRANSIENT_RETRY_DELAYS_MS);
  });

  it("retries anything else once", () => {
    const e = new ApiError(500, "boom");
    expect([0, 1].map((n) => shouldRetry(n, e))).toEqual([true, false]);
    expect(retryDelay(0, e)).toBe(1_000);
  });
});

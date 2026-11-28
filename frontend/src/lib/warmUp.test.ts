import { describe, expect, it, vi } from "vitest";
import { warmUpApi } from "./warmUp";

describe("warmUpApi", () => {
  it("asks the API for /api/health without cookies or cache", () => {
    const f = vi.fn(async () => new Response("{}"));
    warmUpApi(f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith("/api/health", { cache: "no-store", credentials: "omit" });
  });

  it("stays silent when the request fails", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(() => warmUpApi(f as unknown as typeof fetch)).not.toThrow();
    await Promise.resolve();
  });
});

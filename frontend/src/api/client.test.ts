import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, assertUploadSize, detailMessage, resetLimitsCache } from "./client";

describe("detailMessage", () => {
  it("prefers the API's own detail", () => {
    expect(detailMessage({ detail: "File is too large; the limit is 4 MB." }, 413)).toBe("File is too large; the limit is 4 MB.");
  });

  it("explains a bare 413 from a proxy", () => {
    expect(detailMessage(null, 413)).toBe("That file is too large for this server.");
  });

  it.each([502, 503, 504])("explains a bare %i as a waking or busy server", (status) => {
    expect(detailMessage(null, status)).toMatch(/starting up or busy/);
  });

  it("falls back to the status for anything else", () => {
    expect(detailMessage(null, 500)).toBe("Request failed (HTTP 500)");
  });
});

describe("assertUploadSize", () => {
  const MB = 1024 * 1024;
  const fileOf = (bytes: number, name = "stack.fit") => {
    const f = new File(["x"], name);
    Object.defineProperty(f, "size", { value: bytes });
    return f;
  };

  beforeEach(() => resetLimitsCache());
  afterEach(() => vi.unstubAllGlobals());

  it("refuses a file over the server's limit before uploading, naming both sizes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ max_upload_mb: 4 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await assertUploadSize(fileOf(6.5 * MB)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(413);
    expect((err as ApiError).message).toBe("stack.fit is 6.5 MB; this server accepts files up to 4 MB.");
    await assertUploadSize(fileOf(4 * MB)); // exactly at the limit is fine
    expect(fetchMock).toHaveBeenCalledTimes(1); // the limit is fetched once
  });

  it("lets the file through when the limit can't be fetched (the server still checks)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("offline");
    }));
    await expect(assertUploadSize(fileOf(500 * MB))).resolves.toBeUndefined();
  });

  it("retries the limit after a failed fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(new Response(JSON.stringify({ max_upload_mb: 4 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await assertUploadSize(fileOf(10 * MB));
    await expect(assertUploadSize(fileOf(10 * MB))).rejects.toBeInstanceOf(ApiError);
  });
});

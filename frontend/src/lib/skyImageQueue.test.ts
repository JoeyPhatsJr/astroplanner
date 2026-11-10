import { describe, expect, it, vi } from "vitest";
import { createSkyImageQueue } from "./skyImageQueue";

type Pending = { url: string; resolve: (r: Response) => void };

/** A fetch whose responses the test releases by hand, recording how many are in flight at once. */
function manualFetch() {
  const pending: Pending[] = [];
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = vi.fn((url: string) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    return new Promise<Response>((resolve) => {
      pending.push({
        url,
        resolve: (r) => {
          inFlight--;
          resolve(r);
        },
      });
    });
  });
  return { fetchImpl, pending, peak: () => peak };
}

// Bytes rather than a Blob body: Node 22's Response rejects jsdom's Blob (no .stream()).
const jpeg = () => new Response(new Uint8Array([0xff, 0xd8]), { status: 200, headers: { "content-type": "image/jpeg" } });
const busy = (s = "5") => new Response("busy", { status: 503, headers: { "Retry-After": s } });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("sky image queue", () => {
  it("never has more than two image requests in flight", async () => {
    const f = manualFetch();
    const q = createSkyImageQueue({ fetchImpl: f.fetchImpl, wait: () => Promise.resolve() });
    const loads = Array.from({ length: 9 }, (_, i) => q.load(`/api/targets/t${i}/sky-image`));
    await flush();
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    while (f.pending.length) {
      f.pending.shift()!.resolve(jpeg());
      await flush();
      await flush();
      expect(f.peak()).toBeLessThanOrEqual(2);
    }
    const blobs = await Promise.all(loads);
    expect(f.fetchImpl).toHaveBeenCalledTimes(9);
    expect(f.peak()).toBe(2);
    // Shape, not instanceof: under jsdom on Node 22, res.blob() returns Node's Blob class, not the jsdom global.
    expect(blobs.every((b) => b?.type === "image/jpeg" && b.size === 2)).toBe(true);
  });

  it("retries a busy 503 once after its Retry-After, with the slot freed while it waits", async () => {
    const waits: number[] = [];
    const responses = [busy("5"), jpeg()];
    const fetchImpl = vi.fn(() => Promise.resolve(responses.shift()!));
    const q = createSkyImageQueue({ fetchImpl, wait: (ms) => (waits.push(ms), Promise.resolve()) });
    const blob = await q.load("/api/targets/m31/sky-image");
    expect(blob).toMatchObject({ type: "image/jpeg", size: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([5000]);
  });

  it("gives up after one retry", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(busy("1")));
    const q = createSkyImageQueue({ fetchImpl, wait: () => Promise.resolve() });
    expect(await q.load("/api/targets/m31/sky-image")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 503 without Retry-After (the survey is unavailable)", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("unavailable", { status: 503 })));
    const q = createSkyImageQueue({ fetchImpl, wait: () => Promise.resolve() });
    expect(await q.load("/api/targets/m31/sky-image")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats a network error as no image", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError("offline")));
    const q = createSkyImageQueue({ fetchImpl, wait: () => Promise.resolve() });
    expect(await q.load("/api/targets/m31/sky-image")).toBeNull();
  });

  it("drops a request that is cancelled before its turn without fetching it", async () => {
    const f = manualFetch();
    const q = createSkyImageQueue({ fetchImpl: f.fetchImpl, wait: () => Promise.resolve() });
    const a = q.load("/a");
    const b = q.load("/b");
    const ctl = new AbortController();
    const c = q.load("/c", ctl.signal);
    await flush();
    ctl.abort();
    f.pending.shift()!.resolve(jpeg());
    f.pending.shift()!.resolve(jpeg());
    await Promise.all([a, b]);
    expect(await c).toBeNull();
    expect(f.fetchImpl.mock.calls.map((call) => call[0])).toEqual(["/a", "/b"]);
  });
});

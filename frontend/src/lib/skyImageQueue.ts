/**
 * A small shared queue for sky-image requests.
 *
 * A cold survey fetch can take many seconds, and a browser opens only about six connections per host,
 * so loading every card's picture at once would stall the API calls the page needs. At most two image
 * requests run at a time. A 503 that carries Retry-After means the server is busy fetching another
 * image: it is retried once after that delay, with the slot given up while waiting. Any other failure
 * resolves to null and the card keeps its framing diagram.
 */

export interface SkyImageQueueOptions {
  limit?: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  wait?: (ms: number) => Promise<void>;
}

const MAX_RETRY_AFTER_S = 60;

export function createSkyImageQueue({
  limit = 2,
  fetchImpl = (url, init) => fetch(url, init),
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
}: SkyImageQueueOptions = {}) {
  let active = 0;
  const waiting: (() => void)[] = [];

  async function inSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T | null> {
    if (active >= limit) await new Promise<void>((r) => waiting.push(r));
    else active++;
    // The slot is now held (handed over by release, or taken above).
    try {
      if (signal?.aborted) return null;
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }

  type Attempt = { blob: Blob } | { retryAfterS: number } | null;

  const attempt = (url: string, signal?: AbortSignal) =>
    inSlot<Attempt>(async () => {
      try {
        const res = await fetchImpl(url, { signal });
        if (res.ok) return { blob: await res.blob() };
        const ra = Number(res.headers.get("Retry-After"));
        if (res.status === 503 && Number.isFinite(ra) && ra > 0) return { retryAfterS: Math.min(ra, MAX_RETRY_AFTER_S) };
        return null;
      } catch {
        return null;
      }
    }, signal);

  async function load(url: string, signal?: AbortSignal): Promise<Blob | null> {
    const first = await attempt(url, signal);
    if (!first) return null;
    if ("blob" in first) return first.blob;
    await wait(first.retryAfterS * 1000);
    if (signal?.aborted) return null;
    const second = await attempt(url, signal);
    return second && "blob" in second ? second.blob : null;
  }

  return { load };
}

/** The one queue every sky thumbnail shares. */
export const skyImageQueue = createSkyImageQueue();

const objectUrls = new Map<string, string>();

/** An object URL for a sky image through the shared queue, or null when none is available. Loaded images are kept for the session. */
export async function loadSkyImageUrl(url: string, signal?: AbortSignal): Promise<string | null> {
  const hit = objectUrls.get(url);
  if (hit) return hit;
  const blob = await skyImageQueue.load(url, signal);
  if (!blob) return null;
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(url, objectUrl);
  return objectUrl;
}

/**
 * Wake the API as soon as the site opens. The free host can sleep, and waking takes up to a minute; the homescreen
 * and site pages need no API, so a visitor reading them gives the API that minute before Tonight asks for anything.
 * Fire-and-forget: the answer is ignored and a failure is silent (pages handle their own errors).
 */
export function warmUpApi(fetchImpl: typeof fetch = fetch): void {
  try {
    void fetchImpl("/api/health", { cache: "no-store", credentials: "omit" }).catch(() => undefined);
  } catch {
    // fetch unavailable: nothing to warm
  }
}

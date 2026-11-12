/**
 * Where to go after signing in. `next` comes from the address bar, so anyone can set it: only a path on
 * this site is followed, never another origin, and never the sign-in pages themselves (that would loop).
 */
export function safeNext(raw: string | null): string | null {
  if (!raw || raw[0] !== "/") return null;
  // "//host" and "/\host" are other origins to a browser; tabs and newlines are dropped from URLs, so
  // "/\t/host" would become "//host" too.
  if (raw[1] === "/" || raw.includes("\\") || /[\u0000- \u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://astroplanner.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://astroplanner.invalid") return null;
  // Dot segments can normalise to "//host" ("/.//evil.com", "/%2e//evil.com", "/a/..//evil.com").
  if (url.pathname.startsWith("//")) return null;
  const path = url.pathname.toLowerCase(); // routes match without regard to case
  if (path.startsWith("/login") || path.startsWith("/signup")) return null;
  // Follow the normalised form, never the raw string.
  return url.pathname + url.search + url.hash;
}

export const loginHref = (path: string) => `/login?next=${encodeURIComponent(path)}`;
export const signupHref = (path: string) => `/signup?next=${encodeURIComponent(path)}`;

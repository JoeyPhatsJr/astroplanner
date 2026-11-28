import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * A new page opens at its top. Keyed on the path only: changing a filter in the query string keeps your place,
 * and in-page "#" links keep the browser's own jump. Used by the site layout and the app shell alike.
 */
export function useScrollToTop(): void {
  const { pathname, hash } = useLocation();
  useLayoutEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
}

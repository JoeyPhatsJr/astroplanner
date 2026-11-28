import { useEffect } from "react";

/** The tab title for a page: "Tonight · AstroPlanner", as the site pages use. */
export const docTitle = (title: string) => `${title} · AstroPlanner`;

/**
 * Sets the tab title while the page is mounted and puts the previous one back when it goes. Call it from one
 * component per route only: a parent's effect runs after its child's and would overwrite the child's title.
 * `null` leaves the title alone (for a page whose name is still loading).
 */
export function useDocTitle(title: string | null) {
  useEffect(() => {
    if (title === null) return;
    const previous = document.title;
    document.title = docTitle(title);
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** For a route whose page cannot call the hook itself: renders nothing, sets the title. */
export function DocTitle({ title }: { title: string }) {
  useDocTitle(title);
  return null;
}

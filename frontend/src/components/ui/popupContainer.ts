import { useCallback, useState } from "react";

/**
 * Popups portal to <body> by default, but a modal <dialog> makes everything outside it inert and paints above it.
 * Inside one (the phone header sheet), portal into that dialog instead. Attach the returned ref to the trigger.
 */
export function usePopupContainer() {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    setContainer(el?.closest<HTMLElement>("dialog") ?? null);
  }, []);
  return [container, ref] as const;
}

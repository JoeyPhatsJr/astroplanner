import { useEffect, useState } from "react";

/** Matches the stylesheet's phone breakpoint, where the drawer becomes a bottom sheet. */
export const PHONE_QUERY = "(max-width: 639.98px)";

/** True on phone widths. False where matchMedia is missing (jsdom) so desktop behaviour is the default. */
export function usePhone(): boolean {
  const read = () => typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
  const [phone, setPhone] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return phone;
}

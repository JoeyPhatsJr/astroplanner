import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { NAV_LINKS } from "./links";

/**
 * Phones (below md): the header's section links behind one button, a disclosure of links (not an ARIA menu).
 * It behaves and looks like the account menu beside it: a press outside, Escape, or tabbing away closes it,
 * Escape puts focus back on the button, and a keyboard open skips the entrance motion.
 */
export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const [byKeyboard, setByKeyboard] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
  };
  const onBlur = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (open && to && !wrap.current?.contains(to)) setOpen(false);
  };

  return (
    // Shares the account menu's classes, so the two disclosures in this header look and move alike.
    <div ref={wrap} className="account-menu-wrap relative flex flex-none items-center md:hidden" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="account-avatar"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(e) => {
          setByKeyboard(e.detail === 0); // Enter or Space: a click with no pointer
          setOpen((o) => !o);
        }}
      >
        {open ? <X className="size-[1.125rem]" aria-hidden /> : <Menu className="size-[1.125rem]" aria-hidden />}
      </button>
      {open && (
        <div id={panelId} className="account-menu" data-instant={byKeyboard || undefined}>
          <ul>
            {NAV_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} onClick={() => setOpen(false)}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

import { Link } from "react-router-dom";
import { AccountSlot } from "../account/AccountSlot";
import { Logo } from "../layout/Logo";
import { NAV_LINKS } from "./links";
import { SiteMenu } from "./SiteMenu";

/** Header shared by the homescreen and the site pages. */
export function SiteHeader() {
  return (
    <header className="landing-header sticky top-0 z-20">
      {/* Below 360 px (22.5 rem) the gaps and the pill's side padding tighten so the menu button still fits the row. */}
      <nav aria-label="Site" className="flex items-center justify-between gap-2 px-3 py-4 min-[22.5rem]:gap-4 min-[22.5rem]:px-4 sm:px-10">
        <Link to="/" aria-label="AstroPlanner home" className="landing-press flex items-center gap-2.5">
          <Logo />
          {/* Below 440 px (27.5 rem, so it tracks text size) the wordmark folds to the logo mark, so the logo, the
              account slot and the pill share one row. */}
          <span className="sr-only text-lg font-semibold min-[27.5rem]:not-sr-only">AstroPlanner</span>
        </Link>
        {/* Text over the blurred header is a step heavier so it stays legible as photos pass under it. */}
        <ul className="m-0 hidden list-none gap-7 p-0 text-sm font-medium text-ink-2 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="landing-press hover:text-ink">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex shrink-0 items-center gap-1.5 min-[22.5rem]:gap-3 sm:gap-4">
          <AccountSlot variant="site" />
          <Link to="/tonight" className="btn landing-pill landing-cta-primary min-h-11 !px-3.5 !py-2 text-[0.8125rem] min-[22.5rem]:!px-5">
            See tonight’s sky
          </Link>
          {/* Phones: the section links above are hidden, so they live behind this button. */}
          <SiteMenu />
        </div>
      </nav>
    </header>
  );
}

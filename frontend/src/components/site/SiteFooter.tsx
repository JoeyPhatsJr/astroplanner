import { Link } from "react-router-dom";
import { ABOUT_LINKS, NAV_LINKS } from "./links";

const linkClass = "landing-press hover:text-ink";
const extClass = "underline decoration-line underline-offset-2 hover:text-ink";

/** Footer shared by the homescreen and the site pages. */
export function SiteFooter() {
  return (
    <footer className="mx-auto mt-28 w-full max-w-[1160px] border-t border-line-soft px-4 pt-8 pb-16 text-sm text-muted sm:px-10">
      <div className="grid gap-8 sm:grid-cols-[1.4fr_1fr_1fr]">
        <p className="m-0 max-w-[30ch] leading-relaxed">Plan the night, keep the record, learn to process. Free, for personal use.</p>
        <nav aria-label="App">
          <h2 className="m-0 mb-3 text-xs font-semibold tracking-wide text-ink-2 uppercase">App</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            <li>
              <Link to="/tonight" className={linkClass}>
                See tonight’s sky
              </Link>
            </li>
            {NAV_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className={linkClass}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="About">
          <h2 className="m-0 mb-3 text-xs font-semibold tracking-wide text-ink-2 uppercase">About</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {ABOUT_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className={linkClass}>
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <a className={linkClass} href="https://github.com/JoeyPhatsJr/astroplanner" target="_blank" rel="noreferrer">
                Source on GitHub
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <p className="mt-8 mb-0 text-xs leading-relaxed">
        Targets from{" "}
        <a className={extClass} href="https://github.com/mattiaverga/OpenNGC" target="_blank" rel="noreferrer">
          OpenNGC
        </a>{" "}
        (CC BY-SA 4.0). Weather from{" "}
        <a className={extClass} href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{" "}
        (CC BY 4.0, non-commercial). Positions computed with Astropy. Scores are heuristic planning estimates.
      </p>
    </footer>
  );
}

import { Link } from "react-router-dom";
import { SitePageIntro } from "../../components/site/SitePageIntro";
import { CONTACT_URL } from "../../lib/contact";

interface Item {
  name: string;
  kind: string;
  where: string;
  purpose: string;
  lasts: string;
}

/** Everything AstroPlanner stores in your browser. Keep in step with the code: prefs.tsx, AppShell.tsx, browserForecast.ts, accounts/deps.py. */
export const STORED: Item[] = [
  {
    name: "astroplanner_session",
    kind: "Cookie · strictly necessary",
    where: "Set by AstroPlanner when you sign in",
    purpose:
      "Keeps you signed in. It holds a random token (the server keeps only a hash of it), can’t be read by scripts on the page, is sent only over HTTPS and only to AstroPlanner.",
    lasts: "30 days, renewed while you use the site; removed when you sign out or delete your account",
  },
  {
    name: "astroplanner.prefs.v1",
    kind: "Browser storage · strictly necessary",
    where: "Saved in this browser only, never sent as a cookie",
    purpose:
      "Remembers the choices you make on the site: your place (including a place kept only in this browser), equipment, night, minimum altitude, darkness, plan and night vision.",
    lasts: "Until you clear this site’s data in your browser",
  },
  {
    name: "astroplanner.sidebar",
    kind: "Browser storage · strictly necessary",
    where: "Saved in this browser only",
    purpose: "Remembers whether you collapsed the sidebar.",
    lasts: "Until you clear this site’s data in your browser",
  },
  {
    name: "astroplanner.forecastClient",
    kind: "Tab storage · strictly necessary",
    where: "Saved for this browser tab only",
    purpose:
      "A random id for this tab, sent with planning requests so the server can use the forecast your browser fetched from Open-Meteo for 30 minutes.",
    lasts: "Until you close the tab",
  },
];

export function CookiesPage() {
  return (
    <div className="site-page">
      <SitePageIntro
        docTitle="Cookies"
        eyebrow="Cookies"
        title="One cookie, no trackers."
        lede="Everything AstroPlanner stores in your browser, what it’s for, and how long it stays."
        meta="Updated 28 Nov 2026"
      />
      <div className="site-doc">
        <p>
          AstroPlanner uses only what it needs to work: one cookie to keep you signed in, and a few saved choices in your browser. There
          are no advertising, analytics or tracking cookies, and nothing from other sites. Because everything here is strictly necessary
          for the site to do what you ask, there’s no cookie banner to click through.
        </p>
        <h2 className="site-h2">What’s stored</h2>
        {STORED.map((s) => (
          <div key={s.name} className="site-credit">
            <h3 className="site-credit-name">
              <code translate="no">{s.name}</code>
            </h3>
            <span className="site-credit-lic">{s.kind}</span>
            <p>
              {s.purpose} <span className="text-muted">{s.where}.</span>
            </p>
            <p className="text-muted">Lasts: {s.lasts}.</p>
          </div>
        ))}
        <h2 className="site-h2">Other services</h2>
        <p>
          The sites that host AstroPlanner (Vercel and Render) set no cookies on it. When your browser asks Open-Meteo for a forecast, it
          sends no cookies. See <Link to="/privacy">Privacy</Link> for what each service sees.
        </p>
        <h2 className="site-h2">Your choices</h2>
        <p>
          Sign out to remove the cookie, or clear this site’s data in your browser’s settings to remove everything above. Blocking cookies
          stops sign-in from working; planning without an account still works.
        </p>
        <h2 className="site-h2">Changes and questions</h2>
        <p>
          If what’s stored changes, this page and its date change too. Questions:{" "}
          <a href={CONTACT_URL} target="_blank" rel="noreferrer">
            open an issue on GitHub
          </a>
          .
        </p>
      </div>
    </div>
  );
}

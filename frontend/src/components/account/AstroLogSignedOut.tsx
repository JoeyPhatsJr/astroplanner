import { Check } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { loginHref, signupHref } from "../../lib/returnTo";

const OPEN = ["Tonight’s sky and score", "Explore and target details", "Variable Hunter star pages"];

/** AstroLog signed out: what it is, the way in (which comes back to this very page), and what works without one. */
export function AstroLogSignedOut() {
  const loc = useLocation();
  const here = loc.pathname + loc.search;
  return (
    <div className="page-wide">
      <div className="max-w-xl pt-4 md:pt-10">
        <h1 className="text-3xl font-semibold text-ink md:text-display">Your nights live in your account.</h1>
        <p className="mt-3 max-w-prose text-base text-ink-2">
          AstroLog keeps your library, final pictures and processing notes with your account. Sign in to open it.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to={loginHref(here)} className="btn btn-primary min-h-11 px-5">
            Sign in
          </Link>
          <Link to={signupHref(here)} className="btn min-h-11 px-5">
            Create an account
          </Link>
        </div>
        <ul aria-label="Works without an account" className="mt-6 flex flex-col gap-2 text-sm text-ink-2">
          {OPEN.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <Check className="size-4 shrink-0 text-ok" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

import { Outlet, useLocation } from "react-router-dom";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/** Header, main landmark and footer shared by the homescreen and the public site pages (no app shell). */
export function SiteLayout() {
  const loc = useLocation();
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip text-ink">
      <a href="#site-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 btn btn-primary">
        Skip to content
      </a>
      <SiteHeader />
      <main id="site-main" className="flex-1">
        <ErrorBoundary resetKey={loc.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <SiteFooter />
    </div>
  );
}

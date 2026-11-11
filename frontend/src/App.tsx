import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { SiteLayout } from "./components/site/SiteLayout";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { EmptyState } from "./components/ui/States";
import { LandingPage } from "./pages/LandingPage";
import { HowItWorksPage } from "./pages/site/HowItWorksPage";
import { PrivacyPage } from "./pages/site/PrivacyPage";
import { TermsPage } from "./pages/site/TermsPage";
import { TonightPage } from "./pages/TonightPage";

// The landing page (/) and Tonight, its main call to action, stay in the main bundle;
// other sections load on demand.
const ExplorePage = lazy(() => import("./pages/ExplorePage").then((m) => ({ default: m.ExplorePage })));
const VariableHunterPage = lazy(() => import("./pages/VariableHunterPage").then((m) => ({ default: m.VariableHunterPage })));
const StarPage = lazy(() => import("./pages/StarPage").then((m) => ({ default: m.StarPage })));
const AstroLogPage = lazy(() => import("./pages/AstroLogPage").then((m) => ({ default: m.AstroLogPage })));
const LibraryPage = lazy(() => import("./pages/LibraryPage").then((m) => ({ default: m.LibraryPage })));
const TargetLogPage = lazy(() => import("./pages/TargetLogPage").then((m) => ({ default: m.TargetLogPage })));
const AstroLogImportPage = lazy(() => import("./pages/AstroLogImportPage").then((m) => ({ default: m.AstroLogImportPage })));
const ProcessingCoachPage = lazy(() => import("./pages/ProcessingCoachPage").then((m) => ({ default: m.ProcessingCoachPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

function NightRedirect() {
  const { sessionId } = useParams();
  return <Navigate to={`/astrolog/nights/${sessionId ?? ""}`} replace />;
}

/** Page-shaped skeleton, shown only if the route takes longer than 200 ms so quick loads never flash. */
function PageLoading() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLate(true), 200);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div role="status" aria-label="Loading page" className="mx-auto mt-6 flex max-w-[1120px] flex-col gap-4">
      <span className="sr-only">Loading…</span>
      {late && (
        <div aria-hidden className="page-loading flex flex-col gap-4">
          <div className="skeleton h-9 w-1/3" />
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-40 w-full" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="skeleton h-28" />
            <div className="skeleton h-28" />
          </div>
        </div>
      )}
    </div>
  );
}

/** Every app page shares the shell (sidebar, header controls, tab bar); the landing page does not. */
function ShellLayout() {
  const loc = useLocation();
  return (
    <AppShell>
      <ErrorBoundary resetKey={loc.pathname}>
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Route>
      <Route element={<ShellLayout />}>
        <Route path="/tonight" element={<TonightPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/variables" element={<VariableHunterPage />} />
        <Route path="/variables/:slug" element={<StarPage />} />
        <Route path="/research" element={<Navigate to="/variables" replace />} />
        <Route path="/astrolog" element={<LibraryPage />} />
        <Route path="/astrolog/targets/:targetId" element={<TargetLogPage />} />
        <Route path="/astrolog/import" element={<AstroLogImportPage />} />
        <Route path="/astrolog/nights" element={<AstroLogPage />} />
        <Route path="/astrolog/nights/:sessionId" element={<AstroLogPage />} />
        <Route path="/astrolog/process/:captureSetId" element={<ProcessingCoachPage />} />
        <Route path="/astrolog/:sessionId" element={<NightRedirect />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="*"
          element={
            <EmptyState title="Page not found" action={<Link to="/tonight" className="btn btn-primary">Go to Tonight</Link>}>
              That address doesn’t match a page in AstroPlanner.
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  );
}

import { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { EmptyState } from "./components/ui/States";
import { TonightPage } from "./pages/TonightPage";

// Tonight is the landing page and stays in the main bundle; other sections load on demand.
const ExplorePage = lazy(() => import("./pages/ExplorePage").then((m) => ({ default: m.ExplorePage })));
const ResearchLabPage = lazy(() => import("./pages/ResearchLabPage").then((m) => ({ default: m.ResearchLabPage })));
const AstroLogPage = lazy(() => import("./pages/AstroLogPage").then((m) => ({ default: m.AstroLogPage })));
const AstroLogImportPage = lazy(() => import("./pages/AstroLogImportPage").then((m) => ({ default: m.AstroLogImportPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

function NightRedirect() {
  const { sessionId } = useParams();
  return <Navigate to={`/astrolog/nights/${sessionId ?? ""}`} replace />;
}

function PageLoading() {
  return (
    <div role="status" className="mx-auto mt-10 max-w-[960px] text-sm text-muted">
      Loading…
    </div>
  );
}

export default function App() {
  const loc = useLocation();
  return (
    <AppShell>
      <ErrorBoundary resetKey={loc.pathname}>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<TonightPage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/research" element={<ResearchLabPage />} />
            <Route path="/astrolog" element={<AstroLogPage />} />
            <Route path="/astrolog/import" element={<AstroLogImportPage />} />
            <Route path="/astrolog/nights" element={<AstroLogPage />} />
            <Route path="/astrolog/nights/:sessionId" element={<AstroLogPage />} />
            <Route path="/astrolog/:sessionId" element={<NightRedirect />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="*"
              element={
                <EmptyState title="Page not found" action={<Link to="/" className="btn btn-primary">Go to Tonight</Link>}>
                  That address doesn’t match a page in AstroPlanner.
                </EmptyState>
              }
            />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

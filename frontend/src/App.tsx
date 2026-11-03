import { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { EmptyState } from "./components/ui/States";
import { TonightPage } from "./pages/TonightPage";

// Tonight is the landing page and stays in the main bundle; other sections load on demand.
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

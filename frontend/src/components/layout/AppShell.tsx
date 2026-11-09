import { BookOpen, ChevronsLeft, ChevronsRight, Moon, Settings, Sparkles, Telescope } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { HeaderControls } from "./HeaderControls";

const NAV = [
  { to: "/", label: "Tonight", icon: Moon, end: true },
  { to: "/explore", label: "Explore", icon: Telescope },
  { to: "/variables", label: "Variable Hunter", icon: Sparkles },
  { to: "/astrolog", label: "AstroLog", icon: BookOpen },
  { to: "/settings", label: "Settings", icon: Settings },
];

function readCollapsed() {
  try {
    return window.localStorage.getItem("astroplanner.sidebar") === "collapsed";
  } catch {
    return false;
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("astroplanner.sidebar", c ? "open" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 btn btn-primary">
        Skip to content
      </a>

      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line-soft bg-night-deep/80 md:flex ${
          collapsed ? "w-[72px]" : "w-60"
        }`}
        aria-label="Primary"
      >
        <div className={`flex items-center gap-2.5 px-4 pb-6 pt-5 ${collapsed ? "justify-center px-0" : ""}`}>
          <Logo />
          {!collapsed && (
            <span className="font-semibold tracking-tight text-[1.35rem] leading-none  text-ink">AstroPlanner</span>
          )}
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  collapsed ? "justify-center px-0" : ""
                } ${isActive ? "bg-panel-2 text-ink" : "text-muted hover:bg-panel hover:text-ink"}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`size-[18px] shrink-0 ${isActive ? "text-ice" : ""}`} aria-hidden />
                  <span className={collapsed ? "sr-only" : ""}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 pb-4">
          <button
            type="button"
            onClick={toggle}
            className={`btn btn-ghost w-full text-muted ${collapsed ? "px-0" : "justify-start"}`}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-30 border-b md:sticky md:top-0 border-line-soft bg-night/90">
          <div className="flex items-center gap-3 px-4 py-3 md:px-6">
            <div className="flex items-center gap-2 md:hidden">
              <Logo />
              <span className="font-semibold tracking-tight text-lg text-ink">AstroPlanner</span>
            </div>
            <HeaderControls />
          </div>
        </header>

        <main id="main" className="flex-1 px-4 pb-28 pt-5 md:px-6 md:pb-10">
          {children}
        </main>

        <footer className="hidden border-t border-line-soft px-6 py-4 text-xs text-muted md:block">
          <FooterText />
        </footer>
        <div className="px-4 pb-24 text-xs text-muted md:hidden">
          <FooterText />
        </div>
      </div>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line-soft md:hidden bottom-nav"
      >
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-2.5 text-[0.68rem] font-medium ${isActive ? "text-ink" : "text-muted"}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`size-5 ${isActive ? "text-ice" : ""}`} aria-hidden />
                <span>{label === "Variable Hunter" ? "Variables" : label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function FooterText() {
  return (
    <p>
      Data:{" "}
      <a className="underline decoration-line underline-offset-2 hover:text-ink" href="https://github.com/mattiaverga/OpenNGC" target="_blank" rel="noreferrer">
        OpenNGC
      </a>{" "}
      (CC BY-SA 4.0) · Weather:{" "}
      <a className="underline decoration-line underline-offset-2 hover:text-ink" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
        Open-Meteo
      </a>{" "}
      (CC BY 4.0, non-commercial) · Positions computed with Astropy. Scores are heuristic planning estimates.
    </p>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7 shrink-0 text-ink" aria-hidden>
      <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="2" />
      
      
      <circle cx="22.5" cy="8.5" r="3" style={{ fill: "var(--color-ice)" }} />
    </svg>
  );
}

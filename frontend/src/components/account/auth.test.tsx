import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import type { ImportItem } from "../../api/astrolog";
import { applyAuth, authKey, type Me } from "../../api/auth";
import { ApiError, request } from "../../api/client";
import { createQueryClient, markSignedOutIf401 } from "../../api/queryClient";
import { clearImportStash, setImportStash, takeImportStash } from "../../lib/importStash";
import { safeNext } from "../../lib/returnTo";
import { DEFAULT_PREFS, PrefsProvider } from "../../state/prefs";
import { seedSignedIn, seedSignedOut, signedOutMe, TEST_ME } from "../../test/auth";
import { ConfirmProvider } from "../ui/ConfirmDialog";
import { AccountSlot } from "./AccountSlot";

const SIGN_IN_FAILED = "That email and password don’t match. Check them, or reset your password.";
const RESET_COMMAND = "cd backend && .venv/bin/python -m app.accounts reset-password you@example.com";

type Handler = (init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let calls: { method: string; path: string; init?: RequestInit }[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  handlers = {};
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = url.split("?")[0];
      calls.push({ method, path, init });
      const h = handlers[`${method} ${path}`];
      if (h) return h(init);
      return signedOutMe(url, init) ?? json({ detail: "Not found." }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname + loc.search}</output>;
}

function renderApp(path: string, setup?: (qc: QueryClient) => void, qc: QueryClient = createQueryClient()) {
  setup?.(qc);
  render(
    <QueryClientProvider client={qc}>
      <PrefsProvider initial={DEFAULT_PREFS}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
            <LocationProbe />
          </MemoryRouter>
        </ConfirmProvider>
      </PrefsProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const location = () => screen.getByTestId("location").textContent;
const banner = () => screen.getByRole("banner");

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("returnTo", () => {
  it("safeNext accepts only same-origin paths", () => {
    expect(safeNext("/astrolog/targets/x?a=1")).toBe("/astrolog/targets/x?a=1");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil", "/login?next=/x", null, ""]) {
      expect(safeNext(bad), String(bad)).toBeNull();
    }
    // Browsers drop tabs and newlines inside URLs, so "/\t/evil.com" would become "//evil.com".
    expect(safeNext("/\t/evil.com")).toBeNull();
    expect(safeNext("/signup")).toBeNull();
    expect(safeNext("/Login")).toBeNull();
    expect(safeNext("javascript:alert(1)")).toBeNull();
    // Dot segments that normalise to a protocol-relative "//host".
    for (const bad of ["/.//evil.com", "/%2e//evil.com", "/a/..//evil.com"]) expect(safeNext(bad), bad).toBeNull();
    // What is followed is the normalised path, not the raw string.
    expect(safeNext("/astrolog/./import")).toBe("/astrolog/import");
  });

  it("the password toggle says what it will do and shows the password", async () => {
    renderApp("/login", seedSignedOut);
    const password = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveTextContent(/^Show password$/);
    expect(toggle).not.toHaveAttribute("aria-pressed");
    expect(toggle).toHaveAttribute("aria-controls", password.id);
    expect(password).toHaveAttribute("type", "password");
    await userEvent.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(toggle).toHaveAccessibleName("Hide password");
    await userEvent.click(toggle);
    expect(password).toHaveAttribute("type", "password");
    expect(toggle).toHaveAccessibleName("Show password");
  });
});

describe("sign in", () => {
  it("sign in returns to the page that asked", async () => {
    const reply = deferred<Response>();
    handlers["POST /api/auth/login"] = () => reply.promise;
    renderApp("/login?next=%2Fastrolog%2Fimport", seedSignedOut);
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back." })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery staple");
    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(await screen.findByRole("button", { name: "Signing in…" })).toBeInTheDocument();
    reply.resolve(json(TEST_ME));
    await waitFor(() => expect(location()).toBe("/astrolog/import"));
    const login = calls.find((c) => c.path === "/api/auth/login")!;
    expect(login.method).toBe("POST");
    expect((login.init?.headers as Record<string, string>)["X-Requested-With"]).toBe("AstroPlanner");
    expect(JSON.parse(String(login.init?.body))).toEqual({ email: "owner@example.com", password: "correct horse battery staple" });
  });

  it("sign in errors", async () => {
    renderApp("/login", seedSignedOut);
    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(password).toHaveAttribute("autocomplete", "current-password");

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")).toContain("signin-email-err");
    expect(document.activeElement).toBe(email);
    expect(calls.some((c) => c.path === "/api/auth/login")).toBe(false);

    handlers["POST /api/auth/login"] = () => json({ detail: SIGN_IN_FAILED }, 401);
    await userEvent.type(email, "owner@example.com");
    await userEvent.type(password, "wrong password here");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(SIGN_IN_FAILED);
    expect(screen.queryByText("Enter your email.")).not.toBeInTheDocument();

    handlers["POST /api/auth/login"] = () => json({ detail: SIGN_IN_FAILED + " Try again in a few minutes." }, 429);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(`${SIGN_IN_FAILED} Try again in a few minutes.`));
  });

  it("links to reset help and to create account, keeping next", () => {
    renderApp("/login?next=%2Fastrolog%2Fimport", seedSignedOut);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/login/reset-help");
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/signup?next=%2Fastrolog%2Fimport");
  });

  it("already signed in, /login goes straight to next", async () => {
    renderApp("/login?next=%2Fastrolog%2Fnights", seedSignedIn);
    await waitFor(() => expect(location()).toBe("/astrolog/nights"));
  });
});

describe("create account", () => {
  it("create account checks length before sending", async () => {
    renderApp("/signup", seedSignedOut);
    expect(screen.getByRole("heading", { level: 1, name: "Keep every night." })).toBeInTheDocument();
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(password, "1234567");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("That’s 7 characters. Use at least 12.")).toBeInTheDocument();
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(password);
    expect(calls.some((c) => c.path === "/api/auth/signup")).toBe(false);
  });

  it("existing email offers sign in", async () => {
    handlers["POST /api/auth/signup"] = () => json({ detail: "An account with this email already exists. Sign in instead." }, 409);
    renderApp("/signup", seedSignedOut);
    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/^An account with this email already exists\. Sign in instead\.?$/);
    expect(within(alert).getByRole("link", { name: "Sign in instead" })).toHaveAttribute("href", "/login?next=%2Fastrolog");
  });

  it("shows a server 422 on its field and a 429 in the alert", async () => {
    handlers["POST /api/auth/signup"] = () => json({ detail: "Enter a valid email address." }, 422);
    renderApp("/signup", seedSignedOut);
    const email = screen.getByLabelText("Email");
    await userEvent.type(email, "not-an-email");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(email);

    handlers["POST /api/auth/signup"] = () => json({ detail: "Too many attempts from here. Try again in a few minutes." }, 429);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts from here. Try again in a few minutes.");
  });

  it("success signs in and opens next, else AstroLog", async () => {
    handlers["POST /api/auth/signup"] = () => json({ ...TEST_ME, email: "new@example.com" }, 201);
    renderApp("/signup", seedSignedOut);
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(location()).toBe("/astrolog"));
  });
});

describe("reset help", () => {
  it("reset help shows the exact command", () => {
    renderApp("/login/reset-help", seedSignedOut);
    expect(screen.getByRole("heading", { level: 1, name: "Reset your password." })).toBeInTheDocument();
    expect(screen.getByRole("code").textContent).toBe(RESET_COMMAND);
    expect(screen.getByText("If sign-in was locked after wrong tries, wait 15 minutes or restart the backend.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });
});

describe("header slot", () => {
  it("signed out: Sign in returns to this page; empty on the sign-in pages", async () => {
    renderApp("/privacy");
    const link = await within(banner()).findByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/login?next=%2Fprivacy");
    cleanup();
    renderApp("/login", seedSignedOut);
    expect(within(banner()).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(within(banner()).queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
  });

  it("signed in: the initial opens a disclosure of links, Escape closes it, Sign out signs out", async () => {
    handlers["POST /api/auth/logout"] = () => new Response(null, { status: 204 });
    renderApp("/privacy", seedSignedIn);
    const button = within(banner()).getByRole("button", { name: "Account menu" });
    expect(button).toHaveTextContent(/^O$/);
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const nav = screen.getByRole("navigation", { name: "Account" });
    expect(button).toHaveAttribute("aria-controls", nav.id);
    expect(within(nav).getByText("owner@example.com")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "AstroLog" })).toHaveAttribute("href", "/astrolog");
    expect(within(nav).getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
    expect(within(nav).getByRole("button", { name: "Sign out" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Account" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(button);

    await userEvent.click(button);
    await userEvent.click(within(screen.getByRole("navigation", { name: "Account" })).getByRole("button", { name: "Sign out" }));
    expect(await within(banner()).findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fprivacy");
    const logout = calls.find((c) => c.path === "/api/auth/logout")!;
    expect(logout.method).toBe("POST");
    expect(location()).toBe("/privacy");
  });

  it("an outside click and tabbing out close the disclosure", async () => {
    renderApp("/privacy", seedSignedIn);
    const button = within(banner()).getByRole("button", { name: "Account menu" });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole("heading", { level: 1 }));
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    await userEvent.tab(); // AstroLog
    await userEvent.tab(); // Account
    await userEvent.tab(); // Sign out
    expect(button).toHaveAttribute("aria-expanded", "true");
    await userEvent.tab(); // out of the disclosure
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("the app shell top bar carries the same slot", async () => {
    renderApp("/settings", seedSignedIn);
    expect(within(banner()).getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });
});

describe("query cache and accounts", () => {
  it("sign-in resets cached queries", async () => {
    // Person A's session expired in this tab (auth is null) while A's plans are still cached; B signs in.
    handlers["POST /api/auth/login"] = () => json({ ...TEST_ME, email: "b@example.com" });
    const qc = renderApp("/login", (qc) => {
      qc.setQueryData(["sessions"], [{ id: "a-plan", title: "A’s plan" }]);
      seedSignedOut(qc);
    });
    await userEvent.type(screen.getByLabelText("Email"), "b@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(location()).toBe("/astrolog"));
    expect(qc.getQueryData(["sessions"])).toBeUndefined();
    expect(qc.getQueryData<Me>(authKey)?.email).toBe("b@example.com");
  });

  it("sign-out requests nothing owned and shows no previous user’s data", async () => {
    handlers["POST /api/auth/logout"] = () => new Response(null, { status: 204 });
    handlers["GET /api/sessions"] = () => json([{ id: "a-plan", title: "A’s plan" }]);
    handlers["GET /api/locations"] = () => json([{ id: "home", label: "Back garden" }]);
    handlers["GET /api/variables"] = () => json({ progress: calls.some((c) => c.path === "/api/auth/logout") ? null : 3 });
    // Saved places are shared, not owned: signing out leaves them on screen. Variable Hunter is open but adds
    // the user's own progress, so it refetches without it.
    function OpenProbe() {
      const places = useQuery({ queryKey: ["locations"], queryFn: () => request<{ label: string }[]>("/api/locations") });
      const vars = useQuery({ queryKey: ["variables", "UTC"], queryFn: () => request<{ progress: number | null }>("/api/variables") });
      return (
        <>
          <p data-testid="open">{places.data?.map((l) => l.label).join(", ") ?? "none"}</p>
          <p data-testid="progress">{vars.data ? String(vars.data.progress) : "pending"}</p>
        </>
      );
    }
    function OwnedProbe() {
      const [, setTick] = useState(0);
      const q = useQuery({ queryKey: ["sessions"], queryFn: () => request<{ title: string }[]>("/api/sessions") });
      return (
        <div>
          <p data-testid="owned">{q.data?.map((s) => s.title).join(", ") ?? "none"}</p>
          <button type="button" onClick={() => setTick((t) => t + 1)}>
            Rerender
          </button>
        </div>
      );
    }
    const qc = createQueryClient();
    seedSignedIn(qc);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/privacy"]}>
          <AccountSlot variant="site" />
          <OwnedProbe />
          <OpenProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("A’s plan")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("progress")).toHaveTextContent("3"));
    const sessionFetches = () => calls.filter((c) => c.path === "/api/sessions").length;
    expect(sessionFetches()).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByTestId("owned")).toHaveTextContent("none");
    // The page re-rendering for any other reason must not send the owned request either.
    await userEvent.click(screen.getByRole("button", { name: "Rerender" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(sessionFetches()).toBe(1);
    expect(qc.getQueryData(authKey)).toBeNull();
    // Shared places stay as they were; personal progress is fetched again, now without A's.
    expect(screen.getByTestId("open")).toHaveTextContent("Back garden");
    expect(calls.filter((c) => c.path === "/api/locations")).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId("progress")).toHaveTextContent("null"));
  });

  it("a /me answer still in flight cannot undo a sign-in", async () => {
    const me = deferred<Response>();
    handlers["GET /api/auth/me"] = () => me.promise;
    handlers["POST /api/auth/login"] = () => json(TEST_ME);
    const qc = renderApp("/login?next=%2Fastrolog%2Fnights");
    await userEvent.type(screen.getByLabelText("Email"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(location()).toBe("/astrolog/nights"));
    expect(qc.getQueryData<Me>(authKey)?.email).toBe("owner@example.com");
    // The /me request sent before signing in answers late, signed out.
    await act(async () => {
      me.resolve(json({ detail: "Sign in to continue." }, 401));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(qc.getQueryData<Me>(authKey)?.email).toBe("owner@example.com");
  });

  it("a 401 from any query marks the user signed out", async () => {
    const qc = createQueryClient();
    seedSignedIn(qc);
    const queryFn = vi.fn(() => Promise.reject(new ApiError(401, "Sign in to continue.")));
    function Owned() {
      const q = useQuery({ queryKey: ["astrolog", "library"], queryFn });
      return <p>{q.isError ? "failed" : "loading"}</p>;
    }
    render(
      <QueryClientProvider client={qc}>
        <Owned />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(qc.getQueryData(authKey)).toBeNull());
    expect(await screen.findByText("failed")).toBeInTheDocument();
    expect(queryFn).toHaveBeenCalledTimes(1); // a 401 is never retried
  });
  describe("the AstroLog import stash never crosses accounts", () => {
    // Person A stashed their files to create a location in Settings; then the account changes in this tab.
    const stashA = () =>
      setImportStash({ items: [{ name: "a-light_001.fit" } as unknown as ImportItem], readSkipped: [], ignored: 0, images: 0 });
    afterEach(() => clearImportStash());

    it("sign-out clears it", async () => {
      const qc = createQueryClient();
      seedSignedIn(qc);
      stashA();
      await applyAuth(qc, null);
      expect(takeImportStash()).toBeNull();
    });

    it("signing in as someone else clears it", async () => {
      const qc = createQueryClient();
      seedSignedOut(qc);
      stashA();
      await applyAuth(qc, { ...TEST_ME, email: "b@example.com" });
      expect(takeImportStash()).toBeNull();
    });

    it("a 401 (the session ended) clears it", () => {
      const qc = createQueryClient();
      seedSignedIn(qc);
      stashA();
      expect(markSignedOutIf401(qc, new ApiError(401, "Sign in to continue."))).toBe(true);
      expect(takeImportStash()).toBeNull();
    });
  });
});

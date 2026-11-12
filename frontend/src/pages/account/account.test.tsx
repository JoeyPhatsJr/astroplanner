import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { createQueryClient } from "../../api/queryClient";
import { ConfirmProvider } from "../../components/ui/ConfirmDialog";
import { DEFAULT_PREFS, PrefsProvider } from "../../state/prefs";
import { seedSignedIn, seedSignedOut, signedOutMe, TEST_ME } from "../../test/auth";

type Handler = (init?: RequestInit) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let calls: { method: string; path: string; init?: RequestInit }[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noContent = () => new Response(null, { status: 204 });

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

function renderApp(path: string, setup?: (qc: QueryClient) => void) {
  const qc = createQueryClient();
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
const posts = (path: string) => calls.filter((c) => c.method === "POST" && c.path === path);

describe("account page", () => {
  it("account shows email, date and the claim note only when claimed", async () => {
    renderApp("/account", (qc) => seedSignedIn(qc, { ...TEST_ME, created_at: "2026-11-11T10:00:00Z", claimed_existing: true }));
    expect(screen.getByRole("heading", { level: 1, name: "Account" })).toBeInTheDocument();
    const signedIn = screen.getByRole("region", { name: "Signed in" });
    expect(within(signedIn).getByText("owner@example.com")).toBeInTheDocument();
    expect(within(signedIn).getByText("Account created")).toBeInTheDocument();
    expect(within(signedIn).getByText("11 Nov 2026")).toBeInTheDocument();
    expect(within(signedIn).getByText("Your existing plans and AstroLog library were added to this account.")).toBeInTheDocument();
    const data = screen.getByRole("region", { name: "Your data" });
    expect(within(data).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(data).toHaveTextContent(
      "Your session plans, AstroLog library, final-picture previews and processing notes are stored with this account. Privacy lists everything.",
    );
    expect(screen.getByText("Change it here; you’ll stay signed in on this device.")).toBeInTheDocument();
    expect(screen.getByText("Removes your account and everything stored with it. This can’t be undone.")).toBeInTheDocument();
    cleanup();

    renderApp("/account", (qc) => seedSignedIn(qc, { ...TEST_ME, created_at: "2026-11-11T10:00:00Z", claimed_existing: false }));
    expect(screen.getByText("11 Nov 2026")).toBeInTheDocument();
    expect(screen.queryByText(/were added to this account/)).toBeNull();
  });

  it("change password", async () => {
    let reply: Response = json({ detail: "That password isn’t right." }, 400);
    handlers["POST /api/auth/password"] = () => reply;
    renderApp("/account", seedSignedIn);
    expect(screen.queryByLabelText("Current password")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    const current = screen.getByLabelText("Current password");
    const next = screen.getByLabelText("New password");
    expect(current).toHaveAttribute("autocomplete", "current-password");
    expect(next).toHaveAttribute("autocomplete", "new-password");
    expect(next).toHaveAccessibleDescription("At least 12 characters.");
    // The button that opened the form is gone, so focus starts in the form.
    expect(current).toHaveFocus();

    // Too short: said inline, before any request.
    await userEvent.type(current, "old password here");
    await userEvent.type(next, "1234567");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(screen.getByText("That’s 7 characters. Use at least 12.")).toBeInTheDocument();
    expect(next).toHaveAttribute("aria-invalid", "true");
    expect(next).toHaveFocus();
    expect(posts("/api/auth/password")).toHaveLength(0);

    // A wrong current password: inline on that field, which takes focus.
    await userEvent.clear(next);
    await userEvent.type(next, "a new long password");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("That password isn’t right.")).toBeInTheDocument();
    expect(current).toHaveAttribute("aria-invalid", "true");
    expect(current).toHaveAccessibleDescription("That password isn’t right.");
    expect(current).toHaveFocus();
    expect(JSON.parse(String(posts("/api/auth/password")[0].init?.body))).toEqual({
      current_password: "old password here",
      new_password: "a new long password",
    });

    // Success: the form closes and says what happened.
    reply = noContent();
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("Password changed. Other devices were signed out.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(screen.getByRole("button", { name: "Change password" })).toHaveFocus();

    // Cancel closes the form without a request.
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(screen.getByRole("button", { name: "Change password" })).toHaveFocus();
    expect(posts("/api/auth/password")).toHaveLength(2);
  });

  it("delete dialog", async () => {
    let reply: Response = json({ detail: "That password isn’t right." }, 400);
    handlers["POST /api/auth/delete"] = () => reply;
    renderApp("/account", seedSignedIn);
    const trigger = screen.getByRole("button", { name: "Delete account…" });

    // Cancel closes it and puts focus back on the button that opened it.
    await userEvent.click(trigger);
    let dialog = screen.getByRole("alertdialog", { name: "Delete your account?" });
    expect(dialog).toHaveAccessibleDescription(
      "This permanently removes your session plans, AstroLog library, final-picture previews and processing notes. Your original files on your computer are not touched.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());

    // Escape (the dialog's cancel event) does the same.
    await userEvent.click(trigger);
    dialog = screen.getByRole("alertdialog", { name: "Delete your account?" });
    act(() => {
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());

    await userEvent.click(trigger);
    dialog = screen.getByRole("alertdialog", { name: "Delete your account?" });
    const password = within(dialog).getByLabelText("Password");
    const confirm = within(dialog).getByLabelText("Type DELETE to confirm");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(confirm).toHaveAttribute("autocomplete", "off");
    expect(confirm).toHaveAttribute("spellcheck", "false");
    const del = within(dialog).getByRole("button", { name: "Delete account" });
    expect(del).toBeDisabled();
    await userEvent.type(password, "correct horse battery staple");
    await userEvent.type(confirm, "delete");
    expect(del).toBeDisabled();
    await userEvent.clear(confirm);
    await userEvent.type(confirm, "DELETE");
    expect(del).toBeEnabled();

    // A wrong password: inline on Password.
    await userEvent.click(del);
    expect(await within(dialog).findByText("That password isn’t right.")).toBeInTheDocument();
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveFocus();

    reply = noContent();
    await userEvent.click(del);
    await waitFor(() => expect(location()).toBe("/"));
    expect(await within(screen.getByRole("banner")).findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    const sent = posts("/api/auth/delete");
    expect(sent).toHaveLength(2);
    expect(JSON.parse(String(sent[1].init?.body))).toEqual({ password: "correct horse battery staple", confirm: "DELETE" });
  });

  it("sign out from the account page goes home", async () => {
    handlers["POST /api/auth/logout"] = noContent;
    renderApp("/account", seedSignedIn);
    await userEvent.click(within(screen.getByRole("region", { name: "Your data" })).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(location()).toBe("/"));
    expect(await within(screen.getByRole("banner")).findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("signed out /account goes to sign in", async () => {
    renderApp("/account", seedSignedOut);
    await waitFor(() => expect(location()).toBe("/login?next=%2Faccount"));
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back." })).toBeInTheDocument();
  });
});

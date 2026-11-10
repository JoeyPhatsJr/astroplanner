import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, PrefsProvider, usePrefs } from "../state/prefs";
import { useThemeColors } from "./theme";

const CSS = ':root{--color-ice:#5aa9ff}:root[data-vision="night"]{--color-ice:#e0352b}';
let style: HTMLStyleElement;

beforeEach(() => {
  vi.useFakeTimers();
  style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  (document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => void) => {
    setTimeout(cb, 16);
    return { skipTransition: vi.fn() };
  };
  window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  style.remove();
  Reflect.deleteProperty(document, "startViewTransition");
  vi.useRealTimers();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <PrefsProvider initial={{ ...DEFAULT_PREFS, nightVision: true }}>{children}</PrefsProvider>
);

describe("useThemeColors across an asynchronous night-vision exit", () => {
  it("ends on the palette that matches the pref", () => {
    const { result } = renderHook(() => ({ colors: useThemeColors(), prefs: usePrefs() }), { wrapper });
    expect(result.current.colors.accent).toBe("#e0352b");
    act(() => result.current.prefs.update({ nightVision: false }));
    act(() => void vi.advanceTimersByTime(30));
    expect(result.current.prefs.prefs.nightVision).toBe(false);
    expect(result.current.colors.accent).toBe("#5aa9ff");
  });

  it("off then quickly on keeps the red palette", () => {
    const { result } = renderHook(() => ({ colors: useThemeColors(), prefs: usePrefs() }), { wrapper });
    act(() => result.current.prefs.update({ nightVision: false }));
    act(() => result.current.prefs.update({ nightVision: true }));
    act(() => void vi.advanceTimersByTime(100));
    expect(document.documentElement.dataset.vision).toBe("night");
    expect(result.current.colors.accent).toBe("#e0352b");
  });
});

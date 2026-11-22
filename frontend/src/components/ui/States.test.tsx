import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlowLoadHint } from "./States";

describe("SlowLoadHint", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says nothing for a quick load, then explains a slow one", () => {
    render(<SlowLoadHint afterMs={5000} />);
    expect(screen.queryByText(/wake up/)).toBeNull();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText("Still loading. After a quiet spell the server needs up to a minute to wake up.")).toBeTruthy();
  });
});

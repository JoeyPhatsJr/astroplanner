import { act, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScrollToTop } from "./useScrollToTop";

let go: (to: string) => void = () => {};
function Probe() {
  useScrollToTop();
  go = useNavigate();
  return null;
}

describe("useScrollToTop", () => {
  afterEach(() => vi.restoreAllMocks());

  it("scrolls to the top on a new path, but not for a query change or a # link", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={["/tonight"]}>
        <Probe />
      </MemoryRouter>,
    );
    scroll.mockClear();
    act(() => go("/variables"));
    expect(scroll).toHaveBeenCalledWith(0, 0);
    scroll.mockClear();
    act(() => go("/variables?type=mira"));
    expect(scroll).not.toHaveBeenCalled();
    act(() => go("/variables#ss-cyg"));
    expect(scroll).not.toHaveBeenCalled();
  });
});

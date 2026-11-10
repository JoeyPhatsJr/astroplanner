import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyVision, VISION_EVENT } from "./vision";

type Doc = Document & { startViewTransition?: (cb: () => void) => unknown };
let svt: ReturnType<typeof vi.fn>;

function setMotion(reduced: boolean) {
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes("reduce") })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  svt = vi.fn((cb: () => void) => cb());
  (document as Doc).startViewTransition = svt as unknown as Doc["startViewTransition"];
  setMotion(false);
});
afterEach(() => {
  Reflect.deleteProperty(document, "startViewTransition");
});

describe("applyVision", () => {
  it("turning night vision on is instant and never uses a view transition", () => {
    applyVision(true, { animate: true });
    expect(svt).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.vision).toBe("night");
  });

  it("turning it off crossfades via a view transition", () => {
    applyVision(false, { animate: true });
    expect(svt).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.vision).toBe("normal");
  });

  it("leaving is instant when motion is reduced or animate is not requested", () => {
    setMotion(true);
    applyVision(false, { animate: true });
    setMotion(false);
    applyVision(false);
    expect(svt).not.toHaveBeenCalled();
  });

  describe("with an asynchronous startViewTransition", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Like browsers: the update callback runs later, after the old state is captured.
      svt.mockImplementation((cb: () => void) => {
        setTimeout(cb, 16);
        return { skipTransition: vi.fn() };
      });
    });
    afterEach(() => vi.useRealTimers());

    it("fires the applied event when the deferred update lands", () => {
      applyVision(true);
      const seen = vi.fn();
      window.addEventListener(VISION_EVENT, seen);
      applyVision(false, { animate: true });
      expect(document.documentElement.dataset.vision).toBe("night");
      vi.advanceTimersByTime(20);
      expect(document.documentElement.dataset.vision).toBe("normal");
      expect(seen).toHaveBeenCalledTimes(1);
      window.removeEventListener(VISION_EVENT, seen);
    });

    it("off then quickly on ends in night vision", () => {
      applyVision(true);
      applyVision(false, { animate: true });
      applyVision(true, { animate: true });
      vi.advanceTimersByTime(100);
      expect(document.documentElement.dataset.vision).toBe("night");
    });
  });
});

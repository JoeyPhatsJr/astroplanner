import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Overlay } from "./Overlay";

let showModal: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  HTMLDialogElement.prototype.showModal = showModal as unknown as () => void;
  HTMLDialogElement.prototype.close = close as unknown as () => void;
});

afterEach(() => {
  vi.useRealTimers();
});

function ui(open: boolean, onClosed = () => {}, onDismiss?: () => void) {
  return (
    <Overlay open={open} onClosed={onClosed} onDismiss={onDismiss} variant="drawer" labelledBy="t">
      <h2 id="t">Title</h2>
    </Overlay>
  );
}

const dialog = (c: HTMLElement) => c.querySelector("dialog") as HTMLDialogElement;

describe("Overlay", () => {
  it("opens with showModal and data-state open", () => {
    const { container } = render(ui(true));
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog(container).dataset.state).toBe("open");
  });

  it("closes after transitionend", () => {
    const onClosed = vi.fn();
    const { container, rerender } = render(ui(true, onClosed));
    rerender(ui(false, onClosed));
    expect(dialog(container).dataset.state).toBe("closing");
    expect(close).not.toHaveBeenCalled();
    fireEvent.transitionEnd(container.querySelector(".overlay-panel")!);
    expect(close).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("closes after 260 ms when no transitionend arrives", () => {
    const onClosed = vi.fn();
    const { container, rerender } = render(ui(true, onClosed));
    rerender(ui(false, onClosed));
    act(() => void vi.advanceTimersByTime(259));
    expect(close).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2));
    expect(close).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(dialog(container).open).toBe(false);
  });

  it("test_reopen_during_close: stays open and does not call onClosed", () => {
    const onClosed = vi.fn();
    const { container, rerender } = render(ui(true, onClosed));
    rerender(ui(false, onClosed));
    act(() => void vi.advanceTimersByTime(100));
    rerender(ui(true, onClosed));
    act(() => void vi.advanceTimersByTime(1000));
    expect(dialog(container).open).toBe(true);
    expect(dialog(container).dataset.state).toBe("open");
    expect(onClosed).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("test_unmount_while_open: leaves no open dialog and no timer", () => {
    const { unmount, rerender } = render(ui(true));
    rerender(ui(false));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector("dialog[open]")).toBeNull();
    const second = render(ui(true));
    second.unmount();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("takes the alertdialog role when asked, and keeps the native dialog role otherwise", () => {
    const alert = render(
      <Overlay open onClosed={() => {}} variant="modal" role="alertdialog" labelledBy="a">
        <h2 id="a">Delete?</h2>
      </Overlay>,
    );
    expect(dialog(alert.container)).toHaveAttribute("role", "alertdialog");
    alert.unmount();
    const plain = render(ui(true));
    expect(dialog(plain.container)).not.toHaveAttribute("role");
  });

  it("Esc runs the close path and asks the parent to dismiss", () => {
    const onDismiss = vi.fn();
    const { container } = render(ui(true, () => {}, onDismiss));
    const ev = new Event("cancel", { cancelable: true });
    act(() => void dialog(container).dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(dialog(container).dataset.state).toBe("closing");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("scrim click closes, panel click does not", () => {
    const { container } = render(ui(true));
    fireEvent.click(container.querySelector(".overlay-panel")!);
    expect(dialog(container).dataset.state).toBe("open");
    fireEvent.click(container.querySelector(".overlay-scrim")!);
    expect(dialog(container).dataset.state).toBe("closing");
  });

  it("not dismissible: Escape and the scrim do nothing, and the native close is still prevented", () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <Overlay open onClosed={() => {}} onDismiss={onDismiss} variant="modal" dismissible={false} labelledBy="t">
        <h2 id="t">Busy</h2>
      </Overlay>,
    );
    const ev = new Event("cancel", { cancelable: true });
    act(() => void dialog(container).dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    fireEvent.click(container.querySelector(".overlay-scrim")!);
    expect(dialog(container).dataset.state).toBe("open");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("a tap on a select's own full-screen backdrop beside the panel does not dismiss it", () => {
    const onDismiss = vi.fn();
    const { container } = render(ui(true, () => {}, onDismiss));
    const backdrop = document.createElement("div");
    backdrop.setAttribute("role", "presentation"); // Base UI's modal Select backdrop, outside .pop-positioner
    dialog(container).appendChild(backdrop);
    fireEvent.click(backdrop);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(dialog(container).dataset.state).toBe("open");
  });

  it("a text selection dragged from the panel onto the scrim does not dismiss it", () => {
    const onDismiss = vi.fn();
    const { container } = render(ui(true, () => {}, onDismiss));
    // A drag that ends outside where it began fires click on the common ancestor: the dialog itself.
    fireEvent.click(dialog(container));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(dialog(container).dataset.state).toBe("open");
  });

  it("a click inside a themed popup portaled into the dialog does not dismiss it", () => {
    const onDismiss = vi.fn();
    const { container } = render(ui(true, () => {}, onDismiss));
    const positioner = document.createElement("div");
    positioner.className = "pop-positioner";
    const item = document.createElement("button");
    positioner.appendChild(item);
    dialog(container).appendChild(positioner); // outside the panel, as a portal container puts it
    fireEvent.click(item);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(dialog(container).dataset.state).toBe("open");
  });
});

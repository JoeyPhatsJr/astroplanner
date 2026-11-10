import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { NightPicker, addMonths, monthGrid } from "./NightPicker";
import { Select } from "./Select";

describe("month helpers", () => {
  it("clamps the day when the next month is shorter", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });
  it("lays November 2026 out Monday first", () => {
    const weeks = monthGrid("2026-11-09");
    expect(weeks[0].indexOf("2026-11-01")).toBe(6); // a Sunday
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

function PickerHarness({ onPick }: { onPick: (d: string) => void }) {
  const [v, setV] = useState("2026-11-09");
  return (
    <NightPicker
      id="n"
      ariaLabel="Night date (evening of)"
      value={v}
      onChange={(d) => {
        setV(d);
        onPick(d);
      }}
    />
  );
}

describe("NightPicker", () => {
  it("opens a labelled grid, moves with arrows, chooses with Enter and closes", async () => {
    const picks: string[] = [];
    render(<PickerHarness onPick={(d) => picks.push(d)} />);
    await userEvent.click(screen.getByRole("button", { name: "Night date (evening of)" }));
    const grid = await screen.findByRole("grid");
    expect(await within(grid).findByRole("button", { name: "Monday, 9 November 2026" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}{ArrowDown}");
    expect(within(grid).getByRole("button", { name: "Tuesday, 17 November 2026" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(picks).toEqual(["2026-11-17"]);
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("closes on Escape without choosing", async () => {
    const picks: string[] = [];
    render(<PickerHarness onPick={(d) => picks.push(d)} />);
    await userEvent.click(screen.getByRole("button", { name: "Night date (evening of)" }));
    await screen.findByRole("grid");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("grid")).toBeNull();
    expect(picks).toEqual([]);
  });

  it("marks the chosen night with aria-selected only, not aria-current (which means today)", async () => {
    render(<PickerHarness onPick={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Night date (evening of)" }));
    const grid = await screen.findByRole("grid");
    const chosen = within(grid).getByRole("button", { name: "Monday, 9 November 2026" });
    expect(chosen.closest('[role="gridcell"]')).toHaveAttribute("aria-selected", "true");
    expect(grid.querySelector("[aria-current]")).toBeNull();
  });
});

describe("Select", () => {
  it("is named by its label, shows the chosen option and reports a new one", async () => {
    const got: string[] = [];
    render(
      <>
        <label htmlFor="s">Type</label>
        <Select
          id="s"
          value="a"
          options={[
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ]}
          onChange={(v) => got.push(v)}
        />
      </>,
    );
    const trigger = screen.getByLabelText("Type");
    expect(trigger).toHaveTextContent("Alpha");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: "Beta" }));
    expect(got).toEqual(["b"]);
  });
});

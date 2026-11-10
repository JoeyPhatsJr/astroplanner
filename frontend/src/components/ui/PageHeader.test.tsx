import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders the notice under the subtitle, outside the actions", () => {
    render(
      <MemoryRouter>
        <PageHeader title="T" subtitle="Sub" notice={<span>Sample notice</span>} actions={<button type="button">Act</button>} />
      </MemoryRouter>,
    );
    const sub = screen.getByText("Sub");
    const notice = screen.getByText("Sample notice");
    expect(sub.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.closest("p")).not.toBeNull();
    const act = screen.getByRole("button", { name: "Act" });
    expect(act.contains(notice)).toBe(false);
    // the notice sits in the title column, the actions are its sibling
    expect(notice.closest("h1")).toBeNull();
    expect(notice.parentElement?.contains(act)).toBe(false);
  });
});

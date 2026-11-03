import { FIXTURE_NOTICE } from "../../api/variables";
import { Notice } from "../ui/States";

/** Shown wherever fixture-mode data appears, in place of the AAVSO observations attribution. */
export function FixtureNotice() {
  return (
    <Notice tone="warn">
      <strong className="font-semibold text-ink">{FIXTURE_NOTICE}.</strong> This server reads synthetic CSV files (ASTROPLANNER_AAVSO_FIXTURE_DIR).
    </Notice>
  );
}

/**
 * Framing diagram: the target's catalog size drawn against the camera's field.
 * The field is always a dashed circle of fovDeg. The S30's published 2.46 deg axis is not known to be
 * horizontal or vertical, so a rectangle would claim more than we know. The target is an unrotated
 * ellipse from the catalog size (no position angle in the catalog).
 *
 * This component is the picture slot of a card: a later survey image can be layered inside the same
 * square without changing the card.
 */

const VIEW = 112;
const FIELD_RADIUS = 38.1;

export function framingNote(
  major: number | null,
  fovDeg: number | null,
): { text: string; warn: boolean } | null {
  if (major == null || fovDeg == null || fovDeg <= 0) return null;
  const ratio = major / (fovDeg * 60);
  if (ratio > 1) return { text: "Larger than the field", warn: true };
  if (ratio >= 0.75) return { text: "Fills the field", warn: false };
  if (ratio <= 0.15) return { text: "Small in the field", warn: false };
  return { text: "Fits the field", warn: false };
}

export function FramingDiagram({
  major,
  minor,
  fovDeg,
  size = 112,
}: {
  major: number | null;
  minor: number | null;
  fovDeg: number | null;
  size?: number;
}) {
  if (major == null || fovDeg == null || fovDeg <= 0) return null;
  const perArcmin = (FIELD_RADIUS * 2) / (fovDeg * 60);
  const max = VIEW / 2 - 1;
  const rx = Math.min(max, Math.max(1.2, (major / 2) * perArcmin));
  const ry = Math.min(max, Math.max(1.2, ((minor ?? major) / 2) * perArcmin));
  const c = VIEW / 2;
  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      width={size}
      height={size}
      aria-hidden
      className="block rounded-[10px] bg-night-deep"
    >
      <circle
        cx={c}
        cy={c}
        r={FIELD_RADIUS}
        fill="none"
        strokeWidth={1}
        strokeDasharray="3 3"
        style={{ stroke: "var(--color-muted)" }}
      />
      <ellipse
        cx={c}
        cy={c}
        rx={rx}
        ry={ry}
        fillOpacity={0.42}
        strokeWidth={1}
        style={{ fill: "var(--color-ice)", stroke: "var(--color-ice)" }}
      />
    </svg>
  );
}

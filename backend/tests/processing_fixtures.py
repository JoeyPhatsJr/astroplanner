"""Synthetic Siril-style text for processing tests (no real data, no real paths)."""
from __future__ import annotations

from app.processing.seq import RegData

SENTINEL_DIR = "/private/sentinel/ZZ_PATH"


def synthetic_seq(
    name: str,
    rows: list[tuple[bool, RegData | None]],
    version: int = 6,
    reference: int = 0,
    layer: int | None = 1,
    filenums: list[int] | None = None,
) -> str:
    """Build a .seq text. `filenums` defaults to 1..n; `layer=None` omits all R lines."""
    nums = filenums if filenums is not None else list(range(1, len(rows) + 1))
    assert len(nums) == len(rows)
    n_sel = sum(1 for sel, _ in rows if sel)
    out = [
        "#Siril sequence file. Contains list of images (selection, registration data)",
        "#S sequence_name beginning_file number_of_images number_selected fixed_len reference_image version variable_size fz_flag drizzle",
        f"S '{name}' {nums[0] if nums else 1} {len(rows)} {n_sel} 5 {reference} {version} 0 0 0",
        "L 3" if layer is not None else "L -1",
    ]
    for num, (sel, _) in zip(nums, rows):
        out.append(f"I {num} {1 if sel else 0}")
    if layer is not None:
        for _, reg in rows:
            if reg is None:
                out.append(f"R{layer} 0 0 0 0 0 0 H 0 0 0 0 0 0 0 0 0")
            else:
                out.append(
                    f"R{layer} {reg.fwhm} {reg.wfwhm} {reg.roundness} {reg.quality} "
                    f"{reg.background} {reg.stars} H 1 0 0 0 1 0 0 0 1"
                )
    return "\n".join(out) + "\n"


def synthetic_conversion(basenames: list[str], src_dir: str = SENTINEL_DIR) -> str:
    return "".join(
        f"'{src_dir}/{b}' -> '../process/light_{i:05d}.fit'\n"
        for i, b in enumerate(basenames, start=1)
    )

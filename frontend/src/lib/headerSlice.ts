/** Browser-side header slicing for AstroLog import: only header bytes ever leave the browser. */

export const FITS_BLOCK = 2880;
export const FITS_MAX_BLOCKS = 10;
export const EXIF_SLICE_BYTES = 131072;

export class HeaderReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeaderReadError";
  }
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error("Could not read file"));
    r.readAsArrayBuffer(blob);
  });
}

const SPACE = 0x20;

/** True when a 2880-byte block holds an `END` card (E, N, D, then spaces to column 80). */
function hasEnd(block: Uint8Array): boolean {
  for (let off = 0; off + 80 <= block.length; off += 80) {
    if (block[off] !== 0x45 || block[off + 1] !== 0x4e || block[off + 2] !== 0x44) continue;
    let ok = true;
    for (let i = 3; i < 80; i++) {
      if (block[off + i] !== SPACE) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Read 2880-byte blocks until one contains END (max 10 blocks). */
export async function readFitsHeader(file: Blob): Promise<Uint8Array> {
  for (let n = 1; n <= FITS_MAX_BLOCKS; n++) {
    const block = await bytesOf(file.slice((n - 1) * FITS_BLOCK, n * FITS_BLOCK));
    if (block.length < FITS_BLOCK) throw new HeaderReadError("The file ended before the FITS header did.");
    if (hasEnd(block)) return bytesOf(file.slice(0, n * FITS_BLOCK));
  }
  throw new HeaderReadError("No FITS END card within the first 10 header blocks.");
}

export async function readExifSlice(file: Blob): Promise<Uint8Array> {
  return bytesOf(file.slice(0, EXIF_SLICE_BYTES));
}

export type FileClass = "fits" | "cr2" | "image" | "ignored";

const IGNORED_EXT = new Set([".seq", ".lst", ".txt", ".dylib", ".onnx", ".mp4"]);
const IGNORED_PREFIX = ["pp_", "r_", "."];
const FITS_EXT = new Set([".fit", ".fits", ".fts"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff"]);

/** Same ignore list as the backend (`is_ignored`), then by extension. */
export function classifyFile(relativePath: string): FileClass {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter((p) => p !== "");
  const name = (parts[parts.length - 1] ?? "").toLowerCase();
  if (!name) return "ignored";
  if (parts.some((p) => p.toLowerCase() === "process")) return "ignored";
  if (IGNORED_PREFIX.some((p) => name.startsWith(p))) return "ignored";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  if (IGNORED_EXT.has(ext)) return "ignored";
  if (FITS_EXT.has(ext)) return "fits";
  if (ext === ".cr2") return "cr2";
  if (IMAGE_EXT.has(ext)) return "image";
  return "ignored";
}

export function batch<T>(items: T[], size = 300): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

import type { ImportItem, SkippedItem } from "../api/astrolog";

/**
 * The AstroLog import's header slices, kept for one trip to Settings (create location) and back. Set only right
 * before navigating there, taken on return, cleared on any other exit and whenever the account changes, so one
 * person's files are never previewed under another account in the same tab. In memory only, never persisted.
 */
export interface ImportStash {
  items: ImportItem[];
  readSkipped: SkippedItem[];
  ignored: number;
  images: number;
}

let stash: ImportStash | null = null;

export function setImportStash(s: ImportStash): void {
  stash = s;
}

/** Returns the stash, if any, and clears it. */
export function takeImportStash(): ImportStash | null {
  const s = stash;
  stash = null;
  return s;
}

export function clearImportStash(): void {
  stash = null;
}

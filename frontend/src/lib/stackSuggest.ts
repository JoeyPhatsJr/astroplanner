import type { StackOut } from "../api/astrolog";

const STACK_RE = /(\d+)x(\d+(?:\.\d+)?)sec/;

/** Frame count from a Siril-style "<N>x<S>sec" name, or null. */
export function stackCountFromName(name: string): number | null {
  const m = STACK_RE.exec(name);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * The stack to pre-select for a picture about to be uploaded, from the CHOSEN file's name (same
 * rule as the backend's suggest_stack_id): the stack whose count matches the name's <N>; nothing
 * when the name's count contradicts every stack; the latest stack when the name has no count.
 * `stacks` is the target payload's list, newest first.
 */
export function suggestStackId(fileName: string, stacks: StackOut[]): string | null {
  if (!stacks.length) return null;
  const n = stackCountFromName(fileName);
  if (n === null) return stacks[0].id;
  const hit = stacks.find((s) => (stackCountFromName(s.source_filename) ?? s.stack_count) === n);
  return hit ? hit.id : null;
}

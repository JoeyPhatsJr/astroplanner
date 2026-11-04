// Reads a picked Siril night folder in the browser. Privacy rule: `.text()` is called ONLY on `*.seq` and
// `*_conversion.txt` files directly inside a first-level subfolder, each at most 5 MB. Every other file (light
// frames, previews, caches) is seen by name only; no pixel data is ever read.

export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const CALIBRATION_DIR = /^(dark|flat|bias|offset)/i;

export interface FolderRun {
  runDir: string;
  files: { path: string; text: string }[];
}

export interface NightFolder {
  runs: FolderRun[];
  calibrationDirs: string[];
  skipped: string[];
}

const isSeq = (name: string) => name.toLowerCase().endsWith(".seq");
const isConversion = (name: string) => name.toLowerCase().endsWith("_conversion.txt");

export async function readNightFolder(files: File[]): Promise<NightFolder> {
  const groups = new Map<string, File[]>();
  const calibration = new Set<string>();
  for (const f of files) {
    const parts = (f.webkitRelativePath || f.name).split("/");
    if (parts.length < 3) continue; // a file directly in the picked folder, not in a subfolder
    const dir = parts[1];
    if (CALIBRATION_DIR.test(dir)) calibration.add(dir);
    if (parts.length === 3 && (isSeq(f.name) || isConversion(f.name))) {
      groups.set(dir, [...(groups.get(dir) ?? []), f]);
    }
  }

  const skipped: string[] = [];
  const runs: FolderRun[] = [];
  for (const dir of [...groups.keys()].sort()) {
    const candidates = groups.get(dir) as File[];
    if (!candidates.some((f) => isSeq(f.name))) continue;
    const read: FolderRun["files"] = [];
    for (const f of candidates) {
      if (f.size > MAX_TEXT_BYTES) {
        skipped.push(`${dir}/${f.name}`);
        continue;
      }
      read.push({ path: `${dir}/${f.name}`, text: await f.text() });
    }
    if (read.some((r) => isSeq(r.path))) runs.push({ runDir: dir, files: read });
  }
  return { runs, calibrationDirs: [...calibration].sort(), skipped };
}

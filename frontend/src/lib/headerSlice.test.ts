import { describe, expect, it } from "vitest";
import { batch, classifyFile, HeaderReadError, readExifSlice, readFitsHeader } from "./headerSlice";

const card = (s: string) => s.padEnd(80, " ");
function block(cards: string[]): Uint8Array {
  const text = cards.map(card).join("").padEnd(2880, " ");
  return new TextEncoder().encode(text);
}
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe("readFitsHeader", () => {
  it("returns the blocks up to the one holding END, never the data", async () => {
    const file = new Blob([cat(block(["SIMPLE  = T"]), block(["OBJECT  = 'M 27'", "END"]), new Uint8Array(5000).fill(7))]);
    const out = await readFitsHeader(file);
    expect(out.length).toBe(5760);
  });
  it("throws when no END appears within 10 blocks", async () => {
    const file = new Blob([cat(...Array.from({ length: 12 }, () => block(["COMMENT x"])))]);
    await expect(readFitsHeader(file)).rejects.toBeInstanceOf(HeaderReadError);
  });
  it("throws when the file ends before END", async () => {
    await expect(readFitsHeader(new Blob([new Uint8Array(100)]))).rejects.toBeInstanceOf(HeaderReadError);
  });
});

describe("readExifSlice", () => {
  it("reads at most the first 131072 bytes", async () => {
    expect((await readExifSlice(new Blob([new Uint8Array(300000)]))).length).toBe(131072);
    expect((await readExifSlice(new Blob([new Uint8Array(1000)]))).length).toBe(1000);
  });
});

describe("classifyFile", () => {
  it("ignores working files like the backend", () => {
    expect(classifyFile("Bubble Nebula/process/pp_light_00001.fit")).toBe("ignored");
    expect(classifyFile("a/pp_x.fit")).toBe("ignored");
    expect(classifyFile("a/r_x.fit")).toBe("ignored");
    expect(classifyFile("a/.hidden.fit")).toBe("ignored");
    expect(classifyFile("a/seq.SEQ")).toBe("ignored");
    expect(classifyFile("a/clip.mp4")).toBe("ignored");
    expect(classifyFile("a\\process\\x.fit")).toBe("ignored");
  });
  it("classifies frames", () => {
    expect(classifyFile("x/IMG_5578.CR2")).toBe("cr2");
    expect(classifyFile("M 27/Light_001.fit")).toBe("fits");
    expect(classifyFile("M 27/stack.fits")).toBe("fits");
    expect(classifyFile("x/final.jpg")).toBe("image");
    expect(classifyFile("x/notes.pdf")).toBe("ignored");
  });
});

describe("batch", () => {
  it("splits into chunks", () => {
    const sizes = batch(Array.from({ length: 650 }, (_, i) => i), 300).map((b) => b.length);
    expect(sizes).toEqual([300, 300, 50]);
    expect(batch([], 300)).toEqual([]);
  });
});

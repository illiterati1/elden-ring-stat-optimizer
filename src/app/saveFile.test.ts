import { createHash } from "crypto";
import { describe, expect, test } from "vitest";
import { md5, readSaveFile, SaveFileError } from "./saveFile.ts";

const slotSize = 0x280000;

/** A save with one character in slot 1, laid out like the game's (only what's read is filled in) */
function makeSave({ corrupt = false } = {}) {
  const firstSlot = 0x300;
  const buffer = new ArrayBuffer(firstSlot + 10 * (slotSize + 16));
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  bytes.set([..."BND4"].map((c) => c.charCodeAt(0)));
  for (let slot = 0; slot < 10; slot++) {
    view.setUint32(0x40 + slot * 0x20 + 0x10, firstSlot + slot * (slotSize + 16), true);
  }
  const start = firstSlot + (slotSize + 16) + 16;
  const at = (offset: number, value: number) => view.setUint32(start + offset, value, true);
  at(0, 262);
  // The item table: a weapon with an Ash of War, the Ash of War, and the rest empty
  let position = start + 0x20;
  const addItem = (handle: number, id: number, ashHandle?: number) => {
    view.setUint32(position, handle, true);
    view.setUint32(position + 4, id, true);
    position += 8;
    if (ashHandle != null) {
      view.setUint32(position + 8, ashHandle, true);
      position += 13;
    }
  };
  addItem(0x80800001, 2040125, 0xc0800002);
  addItem(0xc0800002, 0x8000fde8);
  for (let i = 2; i < 5120; i++) addItem(0, 0);

  const stats = position - start + 0x34;
  [60, 31, 30, 54, 16, 7, 33, 9].forEach((stat, i) => at(stats + i * 4, stat));
  at(stats + 44, 161);
  [..."Rick"].forEach((c, i) =>
    view.setUint16(start + stats + 0x60 + i * 2, c.charCodeAt(0), true),
  );
  view.setUint8(start + stats + 0x83, 11);
  at(stats + 0x2a4, 3);
  at(stats + 0x2a8, 1);
  at(stats + 0x2ac, 0);
  const equipped = [
    34040025, 2040125, 40500025, 1030425, 43050010, 110000, 50000000, 52060000, 50330000, -1, -1,
    -1, 1700000, 1700100, 1700200, 1700300, -1, 8220, 1231, -1, -1, -1,
  ];
  equipped.forEach((id, i) => at(stats + 0x2c0 + i * 4, id >>> 0));
  at(stats + 0x2c0 + 22 * 4 + 1 * 4, 0x80800001);
  view.setUint8(start + stats + 0xc0, 19);
  // The clear count, after sections of the lengths readClearCount skips: two ammo and three regions
  const ammo = stats - 0x34 + 0x1b0 + 0xd0 + 0x58 + 0x74 + 0x58 + 0x9010 + 0x74 + 0x8c + 0x18;
  at(ammo, 2);
  const regions = ammo + 4 + 2 * 8 + 0x9c + 8 + 4 + 0x12f + 0x6010 + 0x100;
  at(regions, 3);
  at(regions + 4 + 3 * 4 + 0x28 + 1 + 0x40 + 4, 1);

  const slotData = bytes.subarray(start, start + slotSize);
  bytes.set(createHash("md5").update(slotData).digest(), start - 16);
  if (corrupt) bytes[start + 0x1000] ^= 1;
  return buffer;
}

describe("readSaveFile", () => {
  test("reads a character's stats and gear", () => {
    const [character, ...rest] = readSaveFile(makeSave());
    expect(rest).toEqual([]);
    expect(character).toEqual({
      slot: 1,
      name: "Rick",
      level: 161,
      classIndex: 11,
      stats: { vig: 60, min: 31, end: 30, str: 54, dex: 16, int: 7, fai: 33, arc: 9 },
      grip: "2hRight",
      activeLeft: 1,
      activeRight: 0,
      weapons: {
        L1: { id: 34040025, ashId: null },
        R1: { id: 2040125, ashId: 65000 },
        L2: { id: 40500025, ashId: null },
        R2: { id: 1030425, ashId: null },
        L3: { id: 43050010, ashId: null },
        R3: { id: 110000, ashId: null },
      },
      ammo: [50000000, 52060000, 50330000],
      armor: [1700000, 1700100, 1700200, 1700300],
      talismans: [8220, 1231],
      scadutreeBlessing: 19,
      clearCount: 1,
    });
  });

  test("rejects a save read while it was being written", () => {
    expect(() => readSaveFile(makeSave({ corrupt: true }))).toThrow(SaveFileError);
  });

  test("rejects other files", () => {
    expect(() => readSaveFile(new ArrayBuffer(100))).toThrow(SaveFileError);
  });
});

test("md5 matches Node's", () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 1000]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 7) & 255);
    expect(md5(bytes)).toBe(createHash("md5").update(bytes).digest("hex"));
  }
});

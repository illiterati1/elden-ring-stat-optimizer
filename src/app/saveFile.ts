import type { Stats } from "../optimizer/startingClasses.ts";

/**
 * Reads characters from an Elden Ring save file (ER0000.sl2). The PC save is a BND4 container
 * whose first ten files are the character slots, each an MD5 of the slot followed by its data.
 *
 * In a slot: a version, then a table of the character's items (each handle and item ID, with more
 * for weapons and armor), then the character's stats. What comes before the stats varies in length,
 * so they're found by what they look like: eight attributes, with the level three words later.
 * Everything else read is at a fixed offset from them.
 */

/** Weapon slots in the order the save lists them: left and right hand, 1 to 3 */
export const weaponSlots = ["L1", "R1", "L2", "R2", "L3", "R3"] as const;
export type WeaponSlot = typeof weaponSlots[number];

/** How the character holds their weapons: with one hand, or one of them with both */
export type SaveGrip = "1h" | "2hLeft" | "2hRight";

export interface SaveWeapon {
  /** The EquipParamWeapon ID: the base weapon's, plus 100 × affinity, plus upgrade level */
  id: number;
  /** The attached Ash of War's EquipParamGem ID, or null for the weapon's own skill */
  ashId: number | null;
}

export interface SaveCharacter {
  /** The character slot, 0 to 9 */
  slot: number;
  name: string;
  level: number;
  /** The starting class: CharaInitParam row 3000 + this */
  classIndex: number;
  /** Levelled stats, without talismans' and other bonuses */
  stats: Stats;
  grip: SaveGrip;
  /** Which of the left and right hands' three weapons is in use, 0 to 2 */
  activeLeft: number;
  activeRight: number;
  weapons: Record<WeaponSlot, SaveWeapon>;
  /** Arrows and bolts, two of each (EquipParamWeapon IDs), and armor and talismans, by ID */
  ammo: number[];
  armor: number[];
  talismans: number[];
}

export class SaveFileError extends Error {}

const slotCount = 10;
const slotDataSize = 0x280000;
const emptyId = 0xffffffff;
const gripsById: Record<number, SaveGrip> = { 1: "1h", 2: "2hLeft", 3: "2hRight" };

/** @returns the characters in the save's slots, in slot order */
export function readSaveFile(buffer: ArrayBuffer): SaveCharacter[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 0x40 || String.fromCharCode(...bytes.subarray(0, 4)) !== "BND4") {
    throw new SaveFileError("Not an Elden Ring save file (ER0000.sl2)");
  }
  const characters: SaveCharacter[] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    const header = 0x40 + slot * 0x20;
    if (header + 0x20 > bytes.length) break;
    const offset = view.getUint32(header + 0x10, true);
    if (offset + 16 + slotDataSize > bytes.length) {
      throw new SaveFileError("The save file is incomplete");
    }
    const data = bytes.subarray(offset + 16, offset + 16 + slotDataSize);
    const character = readSlot(slot, new DataView(buffer, offset + 16, slotDataSize));
    if (!character) continue;
    // A save read while the game was writing it may mix old and new data
    if (toHex(bytes.subarray(offset, offset + 16)) !== md5(data)) {
      throw new SaveFileError("The save file was being written: try again");
    }
    characters.push(character);
  }
  return characters;
}

function readSlot(slot: number, view: DataView): SaveCharacter | undefined {
  const version = view.getUint32(0, true);
  if (version === 0) return undefined;

  // Each item's handle and ID; weapons also have the handle of their Ash of War
  const ashHandles = new Map<number, number>();
  const itemIds = new Map<number, number>();
  let position = 0x20;
  const itemCount = version <= 81 ? 5118 : 5120;
  for (let i = 0; i < itemCount && position + 8 <= view.byteLength; i++) {
    const handle = view.getUint32(position, true);
    itemIds.set(handle, view.getUint32(position + 4, true));
    position += 8;
    const kind = (handle & 0xf0000000) >>> 0;
    if (handle !== 0 && kind === 0x80000000) {
      ashHandles.set(handle, view.getUint32(position + 8, true));
      position += 13;
    } else if (handle !== 0 && kind === 0x90000000) {
      position += 8;
    }
  }

  const statsOffset = findStats(view, position);
  if (statsOffset == null) return undefined;
  const u32 = (at: number) => view.getUint32(statsOffset + at, true);
  const [vig, min, end, str, dex, int, fai, arc] = Array.from({ length: 8 }, (_, i) => u32(i * 4));

  const nameBytes = new Uint8Array(view.buffer, view.byteOffset + statsOffset + 0x60, 32);
  const name = new TextDecoder("utf-16le").decode(nameBytes).split("\0")[0];

  // The equipped items' IDs, then their handles: weapons, ammo, two unknown, armor, an unknown,
  // talismans
  const equipped = Array.from({ length: 22 }, (_, i) => u32(0x2c0 + i * 4));
  const handles = Array.from({ length: 22 }, (_, i) => u32(0x2c0 + 22 * 4 + i * 4));
  const weapons = Object.fromEntries(
    weaponSlots.map((weaponSlot, i) => {
      const ashHandle = ashHandles.get(handles[i]);
      const ashItemId = ashHandle ? itemIds.get(ashHandle) : undefined;
      const ashId = ashItemId != null ? ashItemId & 0x0fffffff : null;
      return [weaponSlot, { id: equipped[i], ashId }];
    }),
  ) as Record<WeaponSlot, SaveWeapon>;

  return {
    slot,
    name,
    level: u32(44),
    classIndex: view.getUint8(statsOffset + 0x83),
    stats: { vig, min, end, str, dex, int, fai, arc },
    grip: gripsById[u32(0x2a4)] ?? "1h",
    activeLeft: Math.min(u32(0x2a8), 2),
    activeRight: Math.min(u32(0x2ac), 2),
    weapons,
    ammo: equipped.slice(6, 10).filter((id) => id !== emptyId),
    armor: equipped.slice(12, 16).filter((id) => id !== emptyId),
    talismans: equipped.slice(17, 21).filter((id) => id !== emptyId),
  };
}

/**
 * @returns where the stats start: eight attributes from 1 to 99, with their level 3 words later.
 * In every save seen, 0x34 bytes after the item table; looked for after it otherwise.
 */
function findStats(view: DataView, itemsEnd: number): number | undefined {
  const isStats = (offset: number) => {
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      const stat = view.getUint32(offset + i * 4, true);
      if (stat < 1 || stat > 99) return false;
      sum += stat;
    }
    return view.getUint32(offset + 44, true) === sum - 79;
  };
  if (itemsEnd + 0x34 + 48 <= view.byteLength && isStats(itemsEnd + 0x34)) return itemsEnd + 0x34;
  for (let offset = itemsEnd; offset + 48 <= view.byteLength; offset += 4) {
    if (isStats(offset)) return offset;
  }
  return undefined;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const md5Shifts = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const md5Constants = Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32),
);

/** @returns the MD5 of the bytes, in hex (Web Crypto has no MD5) */
export function md5(bytes: Uint8Array): string {
  const length = bytes.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(padded.length - 8, (length * 8) >>> 0, true);
  paddedView.setUint32(padded.length - 4, Math.floor(length / 2 ** 29), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const words = new Uint32Array(16);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) words[i] = paddedView.getUint32(chunk + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + md5Constants[i] + words[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << md5Shifts[i]) | (sum >>> (32 - md5Shifts[i])))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  const digest = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((word, i) => digest.setUint32(i * 4, word, true));
  return toHex(new Uint8Array(digest.buffer));
}

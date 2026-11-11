import { Box, Typography } from "@mui/material";
import {
  describeBuff,
  getBuffKey,
  isWeaponOnlyBuff,
  type Buff,
  type BuffKind,
  type BuffType,
} from "./useBuffs.ts";

// Kinds of buff in the stacking group pickers, in order, with their sections' labels
export const typedKinds: [BuffKind, string][] = [
  ["skill", "Skills"],
  ["spell", "Spells"],
  ["consumable", "Items"],
  ["spirit", "Spirit ashes"],
  ["weaponEffect", "Weapon effects"],
];
export const kindLabels = new Map(typedKinds);

/**
 * Orders buffs by name, with drawstring greases after their normal ones and buffs only some weapons
 * get (their own skills') first
 */
export function compareBuffs(a: Buff, b: Buff) {
  const key = (buff: Buff) => [
    isWeaponOnlyBuff(buff) ? 0 : 1,
    buff.name.replace(/^Drawstring /, ""),
    buff.name.startsWith("Drawstring ") ? 1 : 0,
  ];
  const [keyA, keyB] = [key(a), key(b)];
  for (let i = 0; i < keyA.length; i++) {
    if (keyA[i] !== keyB[i]) return keyA[i] < keyB[i] ? -1 : 1;
  }
  return 0;
}

/** @returns buffs by kind, each kind's in order (compareBuffs) */
export function groupBuffsByKind(buffs: readonly Buff[]) {
  const groups = new Map<BuffKind, Buff[]>();
  for (const buff of [...buffs].sort(compareBuffs)) {
    groups.set(buff.kind, [...(groups.get(buff.kind) ?? []), buff]);
  }
  return groups;
}

/**
 * @returns the consumables, spells, skills, spirit ashes, and weapon effects of a stacking group, as
 * its picker lists them: by kind (typedKinds), each kind's in order (compareBuffs), so weapons' own
 * skills' buffs come first
 */
export function getTypedBuffs(byKind: ReadonlyMap<BuffKind, Buff[]>, type: BuffType) {
  return typedKinds.flatMap(([kind]) =>
    (byKind.get(kind) ?? []).filter((buff) => buff.type === type),
  );
}

/** @returns the label of the section a buff is listed in, by its kind */
export function groupByKind(buff: Buff) {
  return kindLabels.get(buff.kind) ?? "";
}

/** A buff option's name, with what it does underneath */
export function BuffOption(props: React.HTMLAttributes<HTMLLIElement>, buff: Buff) {
  return (
    <li
      {...props}
      key={getBuffKey(buff)}
      {...(isWeaponOnlyBuff(buff) && { "data-unique-skills": true })}
    >
      <Box>
        <Typography variant="body2">{buff.name}</Typography>
        <Typography variant="caption" color="text.secondary">
          {describeBuff(buff)}
          {buff.note
            ? ` · ${buff.note}`
            : isWeaponOnlyBuff(buff)
            ? ` · ${Object.keys(buff.weapons!).join(", ")}'s skill`
            : ""}
        </Typography>
      </Box>
    </li>
  );
}

import { memo, useMemo } from "react";
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { allAttributes, type Weapon } from "../calculator/calculator.ts";
import { getStatLabel } from "../optimizer/startingClasses.ts";
import Section from "./Section.tsx";
import NumberTextField from "./NumberTextField.tsx";
import type { AppState, UpdateAppState } from "./useAppState.ts";
import {
  buffsConflict,
  getBuffKey,
  getBuffStats,
  getHpStops,
  getSpellScalingAttribute,
  hasStackTiers,
  isWeaponOnlyBuff,
  stackTiers,
  type ArmorSlot,
  type Buff,
  type BuffKind,
  type BuffType,
} from "./useBuffs.ts";
import {
  BuffOption,
  getTypedBuffs,
  groupBuffsByKind,
  groupByKind,
  typedKinds,
} from "./buffListing.tsx";

interface Props {
  buffs: readonly Buff[];
  selectedBuffs: AppState["buffs"];
  stackTier: AppState["stackTier"];
  /** Staves and seals that weapon buff spells can be cast with, one of each */
  catalysts: readonly Weapon[];
  catalyst: AppState["catalyst"];
  catalystUpgradeLevel: AppState["catalystUpgradeLevel"];
  equipWeight: AppState["equipWeight"];
  health: AppState["health"];
  /** The weapon in the left hand when powerstancing, whose weight counts towards equip weight */
  leftHandWeapon: string | null;
  /** Names of the weapons picked by name or type, for buffs only some weapons get */
  pickedWeapons: ReadonlySet<string>;
  onChange: UpdateAppState;
}

const maxTalismans = 4;
const maxTears = 2;

const armorSlots: [ArmorSlot, string][] = [
  ["head", "Head"],
  ["body", "Body"],
  ["arms", "Arms"],
  ["legs", "Legs"],
];

// Consumables, spells, skills, and spirit ashes, by stacking group: one body and aura buff (weapon
// buffs have their own picker)
const buffTypes: [BuffType, string][] = [
  ["body", "Body buff"],
  ["aura", "Aura buff"],
];

/**
 * Scrolls an open picker's list to its selected option (preferring a weapon buff to a weapon's own
 * skill's), since multiple selection pickers often open at the top
 */
function scrollToSelected(id: string) {
  requestAnimationFrame(() => {
    const listbox = document.getElementById(`${id}-listbox`);
    const option =
      listbox?.querySelector('[aria-selected="true"]:not([data-unique-skills])') ??
      listbox?.querySelector('[aria-selected="true"]');
    option?.scrollIntoView({ block: "nearest" });
  });
}

/**
 * Pickers for talismans, armor, physick tears, consumables, spells, skills, spirit ashes, and
 * Godrick's Great Rune, which add stats and multiply damage, and enemy debuffs, which make the enemy
 * take more damage
 */
function BuffSettings({
  buffs,
  selectedBuffs,
  stackTier,
  catalysts,
  catalyst,
  catalystUpgradeLevel,
  equipWeight,
  health,
  leftHandWeapon,
  pickedWeapons,
  onChange,
}: Props) {
  const byKind = useMemo(() => groupBuffsByKind(buffs), [buffs]);
  const selected = buffs.filter((buff) => selectedBuffs.includes(getBuffKey(buff)));
  const selectedOf = (kinds: BuffKind[]) => selected.filter((buff) => kinds.includes(buff.kind));
  // A buff that needs no armor (the Lamenter's Mask) can't be picked while any armor is, and the
  // other way around
  const wearingArmor = selected.some((buff) => buff.kind === "armor");
  const noArmor = selected.some((buff) => buff.exclusive?.includes("armor"));
  /** True if another selected buff can't be used with this one */
  const conflicts = (option: Buff) =>
    selected.some((buff) => buff !== option && buffsConflict(buff, option));

  /** Replaces the selected buffs of some kinds (and of an armor slot or stacking group, if given) */
  const setSelected = (
    kinds: BuffKind[],
    newBuffs: Buff[],
    { slot, type }: { slot?: ArmorSlot; type?: BuffType } = {},
  ) => {
    const result = [
      ...selected.filter(
        (buff) =>
          !kinds.includes(buff.kind) ||
          (slot && buff.slot !== slot) ||
          (type && buff.type !== type),
      ),
      ...newBuffs,
    ];
    onChange({ buffs: result.map(getBuffKey) });
  };

  // A buff replaces any with an effect of the same group, like in game (e.g. only one oil coating
  // on an enemy)
  const setGrouped = (kinds: BuffKind[], newBuffs: Buff[], type?: BuffType) => {
    const added = newBuffs.find((buff) => !selected.includes(buff));
    const groups = new Set(added?.effects.map((effect) => effect.group).filter(Boolean));
    setSelected(
      kinds,
      newBuffs.filter(
        (buff) => buff === added || !buff.effects.some((effect) => groups.has(effect.group)),
      ),
      { type },
    );
  };

  /** Consumables, spells, skills, and spirit ashes of a stacking group */
  const ofType = (type: BuffType) => getTypedBuffs(byKind, type);
  const typedKindList = typedKinds.map(([kind]) => kind);

  const multiPicker = (
    label: string,
    kinds: BuffKind[],
    max: number | null,
    onPick: (newBuffs: Buff[]) => void,
    type?: BuffType,
  ) => {
    const value = selectedOf(kinds).filter((buff) => !type || buff.type === type);
    const id = `buff-picker-${label.toLowerCase().replace(/\W+/g, "-")}`;
    return (
      <Autocomplete
        multiple
        id={id}
        onOpen={() => scrollToSelected(id)}
        size="small"
        // Buffs only some weapons get are offered when one of those weapons is picked
        options={(type ? ofType(type) : kinds.flatMap((kind) => byKind.get(kind) ?? [])).filter(
          (buff) =>
            !isWeaponOnlyBuff(buff) ||
            value.includes(buff) ||
            Object.keys(buff.weapons!).some((name) => pickedWeapons.has(name)),
        )}
        groupBy={kinds.length > 1 ? groupByKind : undefined}
        value={value}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(option, other) => getBuffKey(option) === getBuffKey(other)}
        getOptionDisabled={(option) =>
          (max != null && value.length >= max && !value.includes(option)) ||
          conflicts(option) ||
          (wearingArmor && !!option.exclusive?.includes("armor"))
        }
        renderOption={BuffOption}
        onChange={(_, newBuffs) => onPick(newBuffs)}
        renderInput={(params) => (
          <TextField {...params} label={max != null ? `${label} (up to ${max})` : label} />
        )}
      />
    );
  };

  const godrick = byKind.get("rune")?.[0];
  const counter = byKind.get("counter")?.[0];
  const stats = getBuffStats(selected);
  // Buffs whose effects only apply to counterattacks do nothing unless Counterattack is checked
  const inactive = selected.filter(
    (buff) =>
      buff.effects.length > 0 &&
      buff.effects.every((effect) => effect.counter) &&
      !(counter && selected.includes(counter)),
  );
  const stacking = selected.filter(hasStackTiers);
  // Buffs that depend on HP, and the HP percentages that change which of their effects apply
  const byHp = selected.filter((buff) => buff.effects.some((effect) => effect.hp));
  const hpStops = getHpStops(byHp);

  // The weight of the talismans, armor, and off-hand weapon picked (the weapons' own are added for
  // each result)
  const equippedWeight =
    Math.round(selected.reduce((sum, buff) => sum + (buff.weight ?? 0), 0) * 100) / 100;

  // Buffs that shrink with equip weight (the Blue Dancer Charm)
  const byEquipWeight = selected.filter((buff) =>
    buff.effects.some((effect) => effect.byEquipWeight),
  );
  // A weapon buff spell whose attack scales with the catalyst's Int (sorceries) or Faith
  // (incantations) spell scaling
  const spellScaling = getSpellScalingAttribute(selected.filter((buff) => buff.type === "weapon"));
  const catalystOptions = catalysts.filter((weapon) =>
    spellScaling === "int" ? weapon.sorceryTool : weapon.incantationTool,
  );
  const selectedCatalyst = catalystOptions.find((weapon) => weapon.weaponName === catalyst) ?? null;

  return (
    <Section id="buffs" title="Buffs">
      <Box display="grid" gap={1.5}>
        {multiPicker("Talismans", ["talisman"], maxTalismans, (newBuffs) =>
          setSelected(["talisman"], newBuffs),
        )}
        <Box display="grid" gridTemplateColumns="1fr 1fr" gap={1}>
          {armorSlots.map(([slot, label]) => (
            <Autocomplete
              key={slot}
              size="small"
              options={(byKind.get("armor") ?? []).filter((buff) => buff.slot === slot)}
              value={selected.find((buff) => buff.kind === "armor" && buff.slot === slot) ?? null}
              disabled={noArmor}
              getOptionLabel={(option) => option.name}
              isOptionEqualToValue={(option, other) => getBuffKey(option) === getBuffKey(other)}
              renderOption={BuffOption}
              onChange={(_, armor) => setSelected(["armor"], armor ? [armor] : [], { slot })}
              renderInput={(params) => <TextField {...params} label={label} />}
            />
          ))}
        </Box>
        <Autocomplete
          size="small"
          options={byKind.get("offhand") ?? []}
          value={selected.find((buff) => buff.kind === "offhand") ?? null}
          getOptionLabel={(option) => option.name}
          isOptionEqualToValue={(option, other) => getBuffKey(option) === getBuffKey(other)}
          getOptionDisabled={conflicts}
          renderOption={BuffOption}
          onChange={(_, weapon) => setSelected(["offhand"], weapon ? [weapon] : [])}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Off-hand weapon"
              helperText="For its passive effect, which applies in either hand"
            />
          )}
        />
        {byEquipWeight.length > 0 && (
          <Box display="flex" gap={1} alignItems="flex-start">
            <NumberTextField
              sx={{ flex: 1 }}
              label="Other equip weight"
              size="small"
              value={equipWeight}
              min={0}
              step={0.1}
              onChange={(value) => onChange({ equipWeight: value })}
              helperText={`For ${byEquipWeight
                .map((buff) => buff.name)
                .join(", ")}: armor, talismans, and anything else. Each weapon's own weight${
                leftHandWeapon ? `, and the ${leftHandWeapon}'s in the left hand,` : ""
              } is added.`}
            />
            <Button
              size="small"
              variant="outlined"
              sx={{ mt: 0.5, whiteSpace: "nowrap" }}
              title="The talismans, armor, and off-hand weapon picked here (armor without effects isn't listed, so add its weight yourself)"
              onClick={() => onChange({ equipWeight: equippedWeight })}
            >
              From equipped
            </Button>
          </Box>
        )}
        {hpStops.length > 0 && (
          <NumberTextField
            label="HP %"
            size="small"
            spinButtons
            value={health}
            min={1}
            max={100}
            stops={hpStops}
            onChange={(value) => onChange({ health: value })}
            helperText={`For ${byHp.map((buff) => buff.name).join(", ")}`}
          />
        )}
        {multiPicker("Physick tears", ["tear"], maxTears, (newBuffs) =>
          setSelected(["tear"], newBuffs),
        )}
        {/* One weapon buff, plus weapons' own skills', which are on weapons that can't be buffed */}
        {multiPicker(
          "Weapon buffs",
          typedKindList,
          null,
          (newBuffs) => {
            const added = newBuffs.find((buff) => !selected.includes(buff));
            setSelected(
              typedKindList,
              newBuffs.filter(
                (buff) =>
                  isWeaponOnlyBuff(buff) || !added || isWeaponOnlyBuff(added) || buff === added,
              ),
              { type: "weapon" },
            );
          },
          "weapon",
        )}
        {spellScaling && (
          <Box>
            <Box display="grid" gridTemplateColumns="1fr 80px" gap={1}>
              <Autocomplete
                size="small"
                options={catalystOptions}
                value={selectedCatalyst}
                getOptionLabel={(option) => option.weaponName}
                isOptionEqualToValue={(option, other) => option.weaponName === other.weaponName}
                // A new catalyst starts fully upgraded
                onChange={(_, weapon) =>
                  onChange({
                    catalyst: weapon?.weaponName ?? "",
                    ...(weapon && { catalystUpgradeLevel: weapon.attack.length - 1 }),
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={spellScaling === "int" ? "Staff" : "Seal"}
                    error={!selectedCatalyst}
                  />
                )}
              />
              <TextField
                select
                size="small"
                label="Level"
                disabled={!selectedCatalyst}
                value={
                  selectedCatalyst
                    ? Math.min(catalystUpgradeLevel, selectedCatalyst.attack.length - 1)
                    : ""
                }
                onChange={(evt) => onChange({ catalystUpgradeLevel: +evt.target.value })}
              >
                {(selectedCatalyst?.attack ?? []).map((_, level) => (
                  <MenuItem key={level} value={level}>
                    +{level}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <Typography
              variant="caption"
              color={selectedCatalyst ? "text.secondary" : "error"}
              display="block"
              mt={0.5}
              mx={1.75}
            >
              {selectedCatalyst
                ? `The buff scales with its ${
                    spellScaling === "int" ? "Intelligence" : "Faith"
                  } spell scaling. `
                : "Pick the catalyst the spell is cast with (the buff doesn't scale until then). "}
              No levels are spent meeting its and the spell&apos;s requirements: results that
              don&apos;t meet them are marked with an asterisk.
            </Typography>
          </Box>
        )}
        {buffTypes.map(([type, label]) => (
          <Autocomplete
            key={type}
            size="small"
            options={ofType(type)}
            groupBy={groupByKind}
            value={selected.find((buff) => buff.type === type) ?? null}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, other) => getBuffKey(option) === getBuffKey(other)}
            renderOption={BuffOption}
            onChange={(_, buff) => setSelected(typedKindList, buff ? [buff] : [], { type })}
            renderInput={(params) => <TextField {...params} label={label} />}
          />
        ))}
        {multiPicker(
          "Unique buffs",
          typedKindList,
          null,
          (newBuffs) => setGrouped(typedKindList, newBuffs, "unique"),
          "unique",
        )}
        {multiPicker("Enemy debuffs", ["debuff"], null, (newBuffs) =>
          setGrouped(["debuff"], newBuffs),
        )}
        {stacking.length > 0 && (
          <TextField
            select
            size="small"
            label="Successive attack tier"
            value={stackTier}
            onChange={(evt) =>
              onChange({ stackTier: Number(evt.target.value) as typeof stackTier })
            }
            helperText={`For ${stacking.map((buff) => buff.name).join(", ")}`}
          >
            {stackTiers.map((tier) => (
              <MenuItem key={tier} value={tier}>
                {/* The buffs multiply each other's */}
                Tier {tier}: ×
                {stacking
                  .reduce(
                    (product, buff) =>
                      product *
                      buff.effects.find((effect) => effect.tierRates)!.tierRates![tier - 1],
                    1,
                  )
                  .toFixed(3)
                  .replace(/\.?0+$/, "")}
              </MenuItem>
            ))}
          </TextField>
        )}
        {counter && (
          <FormControlLabel
            label="Counterattack"
            sx={{ mt: -0.5 }}
            control={
              <Checkbox
                size="small"
                checked={selected.includes(counter)}
                onChange={(evt) =>
                  setSelected(["counter"], evt.currentTarget.checked ? [counter] : [])
                }
              />
            }
          />
        )}
        {godrick && (
          <FormControlLabel
            label="Godrick's Great Rune"
            sx={{ mt: -0.5 }}
            control={
              <Checkbox
                size="small"
                checked={selected.includes(godrick)}
                onChange={(evt) =>
                  setSelected(["rune"], evt.currentTarget.checked ? [godrick] : [])
                }
              />
            }
          />
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" mt={1}>
        Bonus stats:{" "}
        {allAttributes.some((attribute) => stats[attribute])
          ? allAttributes
              .filter((attribute) => stats[attribute])
              .map((attribute) => `${getStatLabel(attribute).slice(0, 3)} +${stats[attribute]}`)
              .join(", ")
          : "none"}{" "}
        (not counted towards level)
      </Typography>
      {inactive.length > 0 && (
        <Typography variant="body2" color="text.secondary" mt={0.5}>
          Assumed inactive:{" "}
          {inactive.map((buff) => `${buff.name} (not a counterattack)`).join(", ")}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" mt={0.5}>
        Buffs that only apply to some attacks (e.g. the Axe Talisman&apos;s charged attacks) only
        apply to the chosen attack&apos;s hits of that kind. Weapon buffs only apply to buffable
        weapons, Ashes of War&apos;s to weapons that can take them, and unique skills&apos; only to
        their own weapons. Status buildup from buffs adds to the weapon&apos;s and scales the same
        way, e.g. poison, blood loss, and sleep with the weapon&apos;s Arcane scaling.
      </Typography>
    </Section>
  );
}

export default memo(BuffSettings);

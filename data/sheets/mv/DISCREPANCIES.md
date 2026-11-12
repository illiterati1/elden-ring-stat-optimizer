# Motion value sheet vs. game data

Found by `scripts/check_movesets.py` (2026-10-23). The full list of disagreements is in
`check-movesets.csv`. The app uses the sheet; these are open questions to settle by testing in game,
e.g. hitting the Boss Arena training dummy (defense 123.2, no negation) and comparing damage numbers.

Where the sheet and the game list the same hits for an attack, motion values, status, stance and
physical type agree (apart from the stance cases below). The disagreements are about hit structure,
which the game sets in animation (TAE) files that aren't decoded yet.

## Tested in game

On the Boss Arena training dummy (defense 123.2, no negation):

- **Dagger-class two handed R2 #2 / charged R2 #2:** the sheet is correct (see below).
- **Wing of Astel two handed R2 #1, +10, 99 in every stat:** the projectile does 470 alone (at a
  distance) and the blade and projectile 881 together up close, matching the calculator once the
  projectile is magic only. The sheet gives one motion value per hit, so per-damage-type motion
  values now come from the game's attack rows (including projectiles, via Bullet params) wherever a
  sheet hit matches one: 117 hits on 35 weapons, e.g. Rellana's Twin Blades and the seals. The game
  rounds each hit's damage down.

- **Grafted Dragon can't be two handed** (the only weapon with EquipParamWeapon
  bothHandEquipable = 0), though the sheet lists two handed attacks for it. The two handing
  setting is now ignored for it: no Strength bonus and one handed attacks.

## Known differences

- **Projectile falloff.** Some projectiles do less at range, shown in the sheet as e.g.
  "105 Bullet (50 Far)". The calculator always uses the close value.

- **Rounding.** The game rounds each hit's damage down before adding hits up (Wing of Astel R2:
  470 + 411 = 881, unrounded 882.4). The Hits column rounds each hit, but the Total column and the
  optimizer use unrounded damage, so a total can be up to about 1 point per hit higher than in game.

- **Golem Fist one handed R2 #1, fully upgraded, 99 in every stat:** 846 total; the calculator
  predicts 351 (fist, MV 80) + 495 (bullet, MV 105) = 846. A separate 487 bullet hit matches MV
  ≈103.5, between the sheet's close (105) and "Far" (50) bullet values: confirmed as distance
  falloff (487 was the bullet alone from further away).
- **Smithscript Dagger:** the sheet is correct.
- **Rellana's Twin Blades, +10, 99 in every stat:** two handed R2 and charged R2 use the one handed
  animation and damage; two handed jumping R2 hits once for 708. The sheet's values were right, but
  the per-damage-type motion values came from the wrong game rows. Its one handed attacks and its
  magic blade have no fire; the fire blade has no magic. Fixed in `game_attacks.py`: paired
  weapons' two handed R1s also use the rows 5 IDs later (the second blade), two handed paired
  weapons fall back to their one handed attacks, and unmatched hits look through the weapon's own
  unique rows (nearest first). The 708 is a single 107 hit without fire.
- **Bloodfiend's Arm R2 / charged R2 area attack, +25, 99 in every stat:** Standard 119 / 158,
  Flame Art 250 / 316, matching the formula below. Blood affinity bleed from the area attack alone
  "about" 144 / 187 (calculator 146 / 188, status motion values 70% / 90%), and about 290 for a
  whole R2 (calculator 292): the punch and the area attack both build up bleed, as in the sheet.
- **Flat attack (isAddBaseAtk):** a hit's flat AtkParam attack (e.g. 50 fire) is multiplied by
  ReinforceParamWeapon baseAtkRate (1 at +0 to 4 fully upgraded, linear, regular and somber) and
  then scaled by stats like the weapon's base attack of that type. The sheet only lists these in
  BaseMovesetUnique (Bloodfiend's Arm R2s, Black Steel Greathammer guard counter bullet), which the
  build now reads. These hits also don't get two handing's Strength bonus
  (isDisableBothHandsAtkBonus), which is now handled; see the Lizard Greatsword below.
- **Erdtree Greatbow, +10, 99 in every stat:** Great Arrow 467, Golden Great Arrow 524, matching
  the ammunition model (arrow base attack added to the bow's, scaled by the bow, with the two
  handing Strength bonus). An earlier mismatch was a respec mistake.
- **Lion Greatbow + Radahn's Spear:** the bow's resident SpEffect 1937 gives ×1.2 physical attack to
  attack subCategory 113, which only Radahn's Spear has. Tested in game (+10, 99 in every stat):
  844, which is ×1.2 damage *after* defenses (×1.2 attack power would be 859). SpEffect attack
  rates like this are applied as damage multipliers (`Weapon.damageMultipliers`). The Golden Great Arrow's hit spawns a burst
  (Bullet 20005201) that applies SpEffect 1730 (damage dealt ×1.025 vs players / ×1.115 vs enemies,
  damage taken ×0.985 / ×0.925, 45 s) to everyone it hits; not modeled.
- **Serpent Bow, +10, 99 in every stat:** about 243 poison with Serpent Arrows, about 40 with plain
  arrows (calculator was 120 / 0). Two causes: its resident SpEffect 1938 triggers SpEffect 1939
  (15 poison) on every arrow hit (subCategory 105), and it scales poison with CalcCorrectGraph 5
  (3.0 at 99 Arcane) instead of the default 6 (1.0). The original calculator's data only recorded
  status curves for weapons with their own status, so `scripts/patch_regulation_data.py` adds
  them; the ammunition build adds the on-hit status. Now 244 / 39.
- **Ammunition poise:** Stormwing Bone Arrows do 5 poise damage from a +25 Longbow (the bow's own
  is 2): ammunition's saWeaponDamage replaces the weapon's, unchanged by the bow's upgrade level. Now applied.
- **Greatbow +25 with Golem's Great Arrow, 99 in every stat:** 698, the arrow alone (calculator 698).
  Its "Impact AoE" hit (Bullet 20005101, MV 100, radius 1.9) doesn't add to a direct hit, so impact
  hits from ammunition are left out. Shot at the ground nearby, the impact hit does the same damage
  and poise: it's an alternative to a direct hit, not an extra one.
- **Arbalest +25 with Explosive Bolts:** 241 direct and at the ground (calculator 241: the bolt's own
  15 physical and 70 fire). The explosion's flat 100 fire (AtkParam of Bullet on hit) adds nothing,
  and Lightning Bolts work the same way, so impact hits of ammunition are alternatives to a direct
  hit. Crossbows and ballistas have no stat scaling, so their bolts don't scale either.
- **Spread Crossbow with Black-Key Bolts:** about 140 scarlet rot when all three bolts connect. It
  fires three bolts per shot (each bolt's behavior judge 341: Bullet numShoot 3), each with full
  damage and 80% status (60% for Sleepbone Bolts): 3 × 60 × 80% = 144. Base is now three hits.
- **Pulley Crossbow:** fires three shots in quick succession (from its animations, not the params),
  so Base is three regular shots. Each shot has the regular 100% status (confirmed in game).
- **Ammunition physical type:** every arrow and bolt attack is pierce (AtkParam atkAttribute), which
  replaces the bow's or crossbow's own type (slash in the data) for Base.
- **Lizard Greatsword +25, two handed R2 projectile:** 328 (calculator was 340). The projectile's
  AtkParam has isDisableBothHandsAtkBonus, so it scales without two handing's 1.5× Strength. Now
  each hit can opt out of the bonus (`noTwoHandBonus`), and the optimizer gives those hits their own
  terms. On weapons that aren't paired, this affects the Lizard Greatsword's projectiles, the
  Bloodfiend's Arm's area attacks, and every two handed Unarmed attack; paired weapons never get
  the bonus anyway.
- **Black Steel Greathammer +25, two handed guard counter, Weeping Peninsula Erdtree Avatar:** 148
  area attack and 964 total (calculator was 171 / 987). The area attack's flat 58 holy scales with an
  overwritten attack element correction (51070: every damage type scales with Faith at 25%, times
  the upgrade's scaling growth) instead of the weapon's own. Flat attack is now its own optimizer
  terms, each with its hit's scaling (AttackElementCorrectParam, decoded to
  `data/AttackElementCorrectParam-vanilla.csv`). Catalysts' melee hits also overwrite their scaling,
  with 10000 (standard weapon scaling): see Lusat's Glintstone Staff below.
- **Smithscript Greathammer +25, two handed R2:** the thrown hammer does 587, matching the
  calculator (motion value 84, with the two handing Strength bonus).
- **Golem Fist +25, two handed charged R2:** 1734 in total on Standard, 1662 on Blood (calculator
  was 1612 / 1561), projectiles slightly lower from distance falloff. The original calculator
  never gives paired weapons two handing's Strength bonus, but the game decides it per hit
  (isDisableBothHandsAtkBonus): paired weapons' two handed R1s etc. don't get it, but these
  charged R2 hits do. With a chosen attack, each hit's flag now decides; the Base attack keeps the
  paired rule, as do paired weapons' hits that can't be matched to a game row. Other paired
  weapons' two handed hits that get the bonus by this rule (untested): Golem Fist running R1 (1 of 2 hits), Madding Hand and Poisoned Hand running R1
  (1 of 2), Curseblade's Cirque guard counter (1 of 4).
- **Dancing Blade of Ranah:** like Rellana's Twin Blades, its two handed R2 and charged R2 are the
  one handed ones, with the same damage (no Strength bonus), though the sheet lists different two
  handed values and its params have two handed R2 rows. So are the Falx's and Horned
  Warrior's Sword's two handed R2s. `TWO_HANDED_USES_ONE_HANDED` in `build_moveset_data.py` lists
  these tested weapons.
- **Death Knight's Twin Axes +25:** R2 does 844 one handed and 880 two handed: its two handed R2
  gets the Strength bonus, though it's paired and its hits aren't matched to game rows (which
  default to no bonus). Its charged R2 too: 1255 one handed, 1298 two handed. `TWO_HANDED_STRENGTH_BONUS` lists both.
- **Ornamental Straight Sword:** one handed R1 is right, and so are the first four steps of the two
  handed R1, but there's no fifth (the sheet's 113 is a regular straight sword's).
  `CHAIN_LENGTHS` cuts it to four. Similar-looking final single hits after paired hits: Dryleaf Arts'
  two handed R1 6 actually hits twice (the full chain does 4428 at +25, 99 in every stat;
  `STEP_HIT_COUNTS`). Dane's Footwork's is one hit, as in the sheet (full chain 4019). Beast Claw's and Red Bear's Claw's
  two handed R1 4 (155) is one hit, as in the sheet; the Beast Claw's chain total matches in game.
- **Lusat's Glintstone Staff +10, 99 in every stat:** its melee (R1) does 30 one handed and 34 two
  handed. Staves' and seals' melee hits use standard weapon scaling (Strength and Dexterity for
  physical; AttackElementCorrectParam 10000 via the hits' overwriteAttackElementCorrectId) instead
  of the catalyst's own (Intelligence for Lusat's). Hits with their own scaling now get their own
  optimizer terms; per-hit damage and the breakdown are computed from the same terms.
- **Poise (stance) and status motion values:** the user found a way to check them; Rellana's Twin
  Blades' two handed R2 poise is correct.
  Status not checked yet.

## Hit count disagreements

- **Repeated hits from one game row.** The sheet has more hits than the game has rows, e.g. "92 + 92"
  vs. one 92. Mostly two handed fists, claws, and paired weapons (Caestus, Hookclaws, Unarmed, Golem
  Fist, Twinblade, Falx, Reverse-Bladed Sword), and Lance/Sword Lance running R2 ("45 + 45 + 110" vs.
  45, 45, 45). Test: does the attack really land that many times on one target?
- **Final hits the game data doesn't show.** e.g. Halberd-class two handed charged R2 "50 + 150",
  Twinblade charged R2 "50 + 50 + 50 + 165", Beast Claw guard counter. The last hit is probably
  at a judge ID the checker treats as an alternate (3–4 past the attack).
- **Extra game rows the sheet leaves out.** Dagger-class two handed R2 #2 and charged R2 #2 (game
  adds "44 + 44" / "32 + 32" after the main hit; **user tested a few daggers 2026-10-23: the sheet
  is correct**, so these rows aren't real hits), Halberd running R1 and backstep (105 + 105),
  Shotel charged R2 (160 + 160), Omen Cleaver, Dark Moon Greatsword two handed R2 (+53, likely its
  moonlight wave). Test: are these real extra hits?
- **Different values with the same hit count.** Starscourge Greatsword and both Greatswords of Radahn
  two handed (they two-hand as a pair; the game's class rows at those judge IDs don't apply), and
  some of Rellana's Twin Blades' two handed attacks (e.g. charged R2 95 + 100 vs. 95 + 105).

## Stance

- Base stance fixed from the game (`BASE_POISE_FIXES` in `build_moveset_data.py`): Black Steel
  Greathammer 7.5 (sheet 7), Hookclaws 3 (sheet 4).
- Rellana's Twin Blades two handed R2: sheet 100, game 110. Dryleaf Arts / Dane's Footwork two
  handed R1 5: sheet 180 + 120, game 180 + 180.
- Stance shown is base × stance MV; the sheet's "Poise Damage – PvE" tab also scales with upgrade
  level, which isn't applied yet.

## Gaps in the sheet

- No basic attacks for bows or crossbows (arrow damage is in the sheet's Ammo Attack Data tab).
- Attacks the game has but the sheet doesn't: two handed R1 5–6 on Falx, Dancing Blade of Ranah,
  Horned Warrior's Sword; two handed R1 5 on Death Knight's Twin Axes; Rellana's Twin Blades two
  handed R1 5 and guard counter; R2 #2 / charged R2 #2 on the Smithscript Axe, Greathammer, Spear,
  Spear of the Impaler, and Golem Fist.
- Thrown weapons (Smithscript Dagger, perfume bottles) are projectiles in the game data, so they
  couldn't be checked. The Smithscript Dagger was confirmed in game.

## Assumptions to verify

- A note in parentheses after a "+" is a separate hit (projectile, thrown, AoE); one without a "+"
  (e.g. "100 (90 Far)") is a variant of the same hit and is ignored.
- Hits that can't be matched to a game row get the sheet's motion value for every damage type. The
  unmatched projectiles found so far (Lizard Greatsword bullet, Ruins Greatsword shockwave) are
  uniform in the game data, so this is right for them.

## Ashes of War (untested)

Built by `scripts/build_ash_data.py` from the sheet's Ashes of War tab (`AshesOfWarAttackData.csv`)
and EquipParamGem / SwordArtsParam. The weapon art damage guide (`data/docs/aow-doc.txt`) agrees
with the model: weapon hits are AR × motion value; "bullet" hits are flat attack × base attack rate
× (1 + overwritten rate (0.25, or 0.15 for two stats) × the affinity's upgrade multiplier × stat
curve); "enhanced" hits are a weapon hit plus flat attack scaled by the weapon's own scaling. Things
to check in game:

- Flat attack without isAddBaseAtk (21 hits on unique skills, e.g. Promised Consort, Lightspeed
  Slash) is assumed to be fixed, unscaled damage.
- Skills whose own activation does no damage (stances like Unsheathe, buffs like War Cry) use their
  first follow-up as the main attack.
- Versions the sheet marks without saying which weapons use them ("[Var1]"/"[Var2]" Spinning
  Slash, "[Slow]" Double Slash, Euporia's luster tiers) are shown as extra lines.
- AttackElementCorrectParam 1005, used by 2 hits in the sheet, isn't in 1.17's params, so those hits
  use the weapon's own scaling.
- Ticks of weapon hits (e.g. War Cry's charged R2 ticks) have no known interval, so show per tick;
  projectile ticks use Bullet dmgHitRecordLifeTime.
- Skills with no damage in the sheet: buffs, parries, movement, and bow skills (their damage is from
  arrows).
- **Sacred Blade, +25, 99 in every stat:** Longsword: slash 306, whole skill 1232; Sacred Longsword:
  projectile 1020, whole skill 1375; the projectile does 13 poise damage. Skill hits have flat poise
  (AtkSuperArmor), now added. The skill puts a 40 second weapon buff on (SpEffect 821/823: 90 holy,
  unscaled), which its slash gets (an R1 with the buff does 512 on the Longsword); the params don't
  link it to the skill, so `SKILL_BUFFS` in `build_ash_data.py` lists it. The buff's holy is added
  to the hit's holy attack before defenses (Sacred Longsword slash 355, not 300 if separate), so a
  hit's attack of each damage type from every source (weapon, flat attack, buffs) is now added up
  before defenses. The buff's effect on later attacks isn't modeled.
- **War Cry and Barbaric Roar, Heavy Longsword +25, 99 in every stat, one handed:** War Cry's buffed
  R2 #1 742, charged R2 #1 973; Barbaric Roar's R2 #1 (three hits) 1024; an unbuffed R1 463 (menu
  attack power 562, the calculator's 563.2). Their buffs (SpEffectParam 1681 and 1811, matching
  the wiki) give ×1.075 physical attack power and +5 Strength scaling (changeStrengthPoint: +0.05,
  not growing with upgrades), which gives all three exactly. (A ×1.1 of the menu's rounded attack
  power also fit at 99 Strength, but that was a coincidence.) A plain one-handed R1 #1 under either buff
  does 519 (unbuffed 463), as predicted: the buff applies to every attack, not just the skill's R2s.
  The calculator only applies it to the skill's R2 chains for now (buffs deferred). The running charge's poise is one hit in
  game: 3 for charged R2 #1 (two tick rows of 1 in the data) and 2 for #2 (one row), set by
  MERGED_TICKS in build_ash_data.py (also Braggart's Roar, which uses War Cry's R2s).
- **Braggart's Roar (confirmed):** changes only two handed R2s, to War Cry's animations (the user's
  observation), so its chains are War Cry's two handed attacks. Its buff is taken as SpEffectParam 1861: ×1.1 physical attack power, no
  Strength bonus (also 10% less damage taken, faster stamina recovery, 60 s). Predicted on a Heavy
  Longsword +25 with 99 in every stat: two handed R2 #1 875, charged R2 #1 1116, both confirmed in game.
- **Bow skills (low priority):** Barrage, Enchanted Shot, Igon's Drake Hunt, Mighty Shot, Rain of
  Arrows, Sky Shot and Through and Through do damage through the arrows, but the sheet gives them no
  motion values, so they're hidden from the Ash of War picker with the skills that do no damage.
- **Beast's Roar, Quality Longsword +25, 99 in every stat:** bullet 542 on a direct hit, AoE 363 on a
  glancing one, sometimes 457 between them; never both (both match the data). Its damage and poise
  are the bullet's only (MAIN_HIT_KINDS in build_ash_data.py), leaving out the roar's 6 poise.
- **Black Flame Tornado, Standard Twinblade +25, 99 in every stat, training dummy (74212 HP):**
  wind-up and finisher 2449, one loop 4297, every loop 11689 (no weapon hits). Fits exactly: each
  loop is one loop hit (273) plus a full black flame burn (SpEffectParam 835: 0.1% of max HP every
  0.1 s for 2 s, 21 ticks of 75 = 1575, so 0.1% of 74212 rounded up), 1848 per loop, at most 5
  loops; the finisher is 874 + 1575. Tapped up close it's 2881: two weapon swings of 216 (50%
  motion values, AtkParam 300000305, which the sheet calls "Loop (Lacking FP)" but a669 40000 and
  the release 40001 use with FP too) before the finisher. The picker has "Tap" (2 swings and the
  finisher) and "Fully charged" (1 swing, 5 loops and the finisher: 11905 up close, tested); tapped timing
  measured on a Twinblade: swings 68 and 84 frames after L2, finisher 144 (the start animation, then
  the release 40001 from 78 frames in; ANIMATION_SEQUENCES, HIT_TIME_FITS), stamina 35, used again
  212 frames after the press (CANCEL_FITS; the release's L2 cancel says 214). Its release has a
  roll window before the finisher (111 frames after L2 in game, skipping it) and one after (about
  192), so skills' roll is now the first roll window open once the last counted hit's window starts
  (projectiles: when created; not for loops). That moved the roll of 15 other skill parts that
  had one before their last hit (Flame Dance, Eochaid's Dancing Blade, Savage Claws, I Command
  Thee Kneel #1, The Queen's Black Flame #1, Alabaster/Onyx Lords', Euporia Vortex Luster Tier 2,
  Shadow Sunflower Headbutt #2, Spinning Wheel, Familial Rancor; untested). The finisher is an AoE
  ("Final Hit AoE"), its time measured; black flame counts with the enemy
  picker's HP (HP_DAMAGE_EFFECTS in build_ash_data.py). Other skills' bullets with percent-HP
  effects (e.g. Destined Death, Corpse Wax Cutter, Blade of Death) are untested and not counted.
- **To do: percent-HP effects in Shadow of the Erdtree.** Black flame and Destined Death (maybe
  others) are weaker against enemies in the DLC, which the calculator doesn't model: it uses the same
  rate for every enemy the picker has. Needs the DLC's rule (and whether it goes by the enemy or the
  area) and in-game tests.
- **Critical hits, powerstance, and mounted attacks (Longsword +25 backstab 1220 and Cold Dagger +25 backstab 1879 confirmed):** from the sheet's Backstab,
  Riposte, Riposte (Large PvE), Paired L1, and Mounted columns (SHARED_ATTACKS in
  build_moveset_data.py). The crit motion values already include the weapon's critical multiplier
  (EquipParamWeapon throwAtkRate: a Dagger's 30 gives 294 × 1.3 = 382.2), so it isn't applied again.
  "Small PvE" crits (only small enemies like the Vulgar Militia) are left out. Powerstance is always
  one handed and assumes the same weapon in both hands. Mounted attacks use the right side (the Messmer
  Soldier's Axe's left charged attack is 163, not 180) and follow the two handing setting (confirmed
  in game: mounted attacks get two handing's Strength bonus). None are
  matched to game rows, so they don't have per-damage-type motion values or per-hit two handing flags.
  Mounted R2 Charging (the hit while charging) and BS Whiff are left out.
  Crits don't get two handing's Strength bonus (tested for backstabs; assumed for ripostes).
- **Cross-class powerstance (untested, not modeled):** powerstance motion values are the same within
  each weapon class except the Main-gauche and Wakizashi. The Wakizashi has higher values paired with
  a katana ("90 + 100 (115 w/Katana)" for L1 #1; which hit is 115 isn't known). The Rusted Anchor
  (Greataxe values) can reportedly powerstance with hammers and/or great hammers; the sheet doesn't
  say, so its values with them are unknown.
- **Riposte on the Limgrave Crucible Knight (Longsword +25, 99 in every stat):** 833, 1h and 2h
  (R1 and R2 match the calculator, so her defenses are right). The calculator's riposte (345) gives
  1190; 833 is exactly 345 × 0.7 (before or after defenses; both floor to 833). No combination of the
  straight sword's crit rows (AtkParam 2005xx: 230, 200, 100, 345, 250, 60, 240, 420, 400, 132 + 331)
  fits. Her model (c2500) has its own critical animations in ThrowParam (throw types 20 and 25 rather
  than the default 1), so the 0.7 may come from the enemy or its animation. Needs a riposte on an
  ordinary enemy to tell.
- **Large riposte confirmed:** Longsword +25 (99 in every stat) on the Dragonbarrow Putrid Avatar does
  2199 in game, as calculated (132 + 331 against 122 defense, 10% pierce negation). So the Crucible
  Knight's 0.7 isn't a general PvE riposte reduction for large enemies; ordinary-size ripostes are
  still untested.
- **Normal riposte confirmed:** Longsword +0 (99 in every stat) on the Writheblood Ruins Sanguine
  Noble does 596 in game, as calculated (345). So the Limgrave Crucible Knight's 0.7 is specific to
  her (or her kind of enemy / critical animation), not PvE ripostes in general.
- **Normal riposte confirmed:** Longsword +0 (99 in every stat) on the Writheblood Ruins Sanguine
  Noble does 596 in game, as calculated (345). So the Limgrave Crucible Knight's 0.7 is specific to
  her (or her kind of enemy / critical animation), not PvE ripostes in general.
- **Crucible Knights take 30% less critical damage** (per the wiki; fits the Limgrave one's 833).
  Modeled as enemy data (criticalDamageRate 0.7 for model c2500, incl. Tanith's Knight, and names
  starting "Crucible Knight", incl. Devonia) applied to backstabs and ripostes after defenses (confirmed:
  a +0 Longsword riposte does 274 to the Stormhill Evergaol one; before defenses would be 254). Editing the defenses by hand resets it.
- **Riposte types by enemy (ThrowParam):** the player's critical animations for an enemy's model say
  which ripostes it takes: 31700 normal, 31720 small (a downward stab; the sheet's "Riposte (Small
  PvE)"), 31750 large. Tested: Longsword +0 small riposte on Mini Midra 587 (420), Quality Longsword
  +25 on the Dragonbarrow Night's Cavalry 2219 (small). By hand: Mad Pumpkin Heads large; Night's
  Cavalry and Black Knights normal, and small when they fall from their horse (noted in the picker);
  Onze small; Nox both (unknown). Models with none can't be riposted (Tree Sentinels, Loretta,
  Rykard, Tibia Mariners, Mimic Tear, ...). 31730 (soldiers, the Vulgar Militia, etc.) is unknown and
  ignored. The named Black Knights (Edredd, Garrew)
  never ride horses, so they only get the normal riposte.
- **Enemy HP includes every permanent SpEffect's maxHpRate**, not just area scaling (Morne Tunnel
  Scaly Misbegotten 1360 in game: 531 × 1.281 × 2 from SpEffect 4410). 105 picker entries changed,
  nearly all boss versions of regular enemies (×2 or ×3). Damage-taken effects on NPCs aren't
  applied since they look situational: Crystalians ×0.1 except strike (until their shell breaks),
  Living Jars ×0.3, Jar Innards ×0.5, Alexander ×0.3, Rennala phase 1 and Basilisk Eyes ×0, D ×0.25
  magic, a Giant Ant ×0.85.
- **Buffs (untested):** from scripts/build_buff_data.py (see data/docs/buffs-research.md). Assumed:
  damage multipliers (attack rates and vs-enemy damage rates) apply after defenses and multiply
  each other (the user's call); attack power rates (e.g. Blue Dancer Charm) before defenses; weapon
  buff flat attack (greases, Electrify Armament) is unscaled, added before defenses, only to hits
  with a weapon motion value, and only on buffable weapons; buffs apply fully to every hit (the
  per-attack AtkParam spEffectAtkPowerCorrectRate_* values aren't used); condition-only buffs (e.g.
  Red-Feathered Branchsword below 20% HP, the Exultations) are assumed active. Hits not matched to
  game rows get subcategories by the usual pattern (CATEGORY_FALLBACKS in build_moveset_data.py).

### Triggered buffs (untested)

- Successive-hit stacks use the tier picked in the Buffs panel (default 3). All share the cutoffs
  (accumuOverVal 17, 30, 45; tier 4 at 60 has tier 3's multiplier, so it's left out): Winged Sword Insignia 1.03/1.05/1.1,
  Rotten Winged Sword Insignia 1.06/1.08/1.13, Millicent's Prosthesis 1.04/1.06/1.11, Thorny
  Cracked Tear 1.09/1.13/1.2. All are atkEnemyDmgCorrectRate (after defenses), and they multiply
  with each other although their stages share spCategory 120: confirmed by the user, a Dagger +0
  one handed R2 with the Rotten Winged Sword Insignia and the Thorny Cracked Tear does 108, 114,
  127 at tiers 1-3 (model 108.5, 114.6, 127.4; adding would give 108, 113, 124).
- Crusade Insignia ×1.15 (after defeating an enemy, 20s), Dried Bouquet ×1.2 (after a summoned
  spirit dies, 30s), Blade of Mercy ×1.2 (after a critical hit, 20s), assumed active. Rellana's
  Cameo ×1.45 (user: while in a stance, after holding it for 1s, until leaving it; only attacks
  from certain weapon skills' stances). The game sets the stance state in the skill's animation,
  not the params, so it's applied to all skill attacks (subcategory 112) for now.
- Talismans of the same accessoryGroup can't be worn together (e.g. the two Winged Sword
  Insignias), and the Red-Feathered Branchsword (below 20% HP) and Ritual Sword Talisman (full HP)
  can't be active together (user), so the picker doesn't allow either.
- Sharpshot Talisman ×1.12 on ammunition, ranged skill, and arrow effect hits (categories 105, 113,
  118), assumed to be aimed.
- Oil-Soaked Tear: the oil makes enemies take ×1.2 fire damage (fireDamageCutRate), assumed to
  multiply with the player's damage multipliers.
- Stonebarb Cracked Tear: ×1.3 stance damage (saAttackPowerRate) on every hit. Its ×1.3
  staminaAttackRate (guard damage) isn't modeled.

### Animation check (2026-10-27)

`scripts/check_animations.py` compares every basic attack step in the sheet against the game's
animations (hit windows and the AtkParam row each uses) and writes `ANIMATION_CHECK.md` here, plus
every hit's timing to `data/animation-hits.csv`. It covers basic attacks, powerstance L1s (animations
034xxx), and mounted attacks (038xxx right side, 039xxx left); critical hits have no attack windows.
As of the last run 19909 steps match. Also listed there: steps only in a weapon's class's animations
(e.g. the Smithscript weapons' R2 2; unreachable: the user found the Smithscript Axe's R2 is always its throw), mounted charged attacks whose animation has
no charging hit (e.g. scythes), and steps with no animation hits (staves' and seals' jumping
attacks, shields' mounted R2s). `build_moveset_data.py` adds each step's hit and cancel times from
the same code to `movesets.json` ("timing").

Hit counting rules for the animation check, from in-game tests (user, 2026-10-27):
- A swing split into back-to-back windows, the second an alternate version (judge 3 or 4 later), is
  one hit: Milady R1 2 (1h and 2h), Milady 1h running R2 (2 hits: 70 + 95, not 70 + 95 + 95).
- Overlapping windows with the same motion values are one hit: Dryleaf Arts 1h R1 3 (two limbs),
  Dryleaf Arts 2h R1 2 (2 hits, each two limbs), Dueling Shield 1h running R2, a perfume bottle's
  1h jumping R1 (bottle and spray). Except paired weapons' two handed attacks (one per weapon, as
  the sheet has them; not hand-to-hand arts).
- A stream of the same projectile is one hit: a perfume bottle's 1h R1.
- A sheet hit's alternate projectile ("120 (105 Bullet)") is the same hit: Dryleaf Arts 1h R2 1
  does 479 directly or 404 with its AoE, never both.
- The light greatswords' extra hitboxes (judges 990-999) don't add damage: Milady 1h R2 1 matches.
- Touching windows with the same motion values are one hit if they have the same AttackIndex:
  Backhand Blade 1h charged R2 1 (160, judges 105 then 106, both index 0) is 1 hit, Black Steel
  Twinblade 2h charged R2 1 (spins on indexes 0-2, then the finisher) is 3 hits plus the finisher.
- Simultaneous windows are one hit if their hitboxes are on the same weapon or limb (AtkParam
  hit0_DmyPoly1), else separate: Dryleaf Arts 2h R2 2 (feet, dummy polys 1 and 2) does 908 directly
  (454 + 454; the calculator has 454 a kick at +10, 99 in every stat), its AoE alone 654, or
  sometimes one kick 454 at the edge of its range. Dryleaf Arts' R1 3 (both on dummy poly 5) is 1.
- Perfume bottle 2h jumping R1 is 2 hits (each bottle's bottle hit and spray together).
- Unarmed two handed punches with both fists, like paired weapons: 2h R2 1 does 10 at 99 in every
  stat (5 + 5; the calculator has 5.5 a hit).
- A projectile stream is its AtkParam row's, wherever it comes from: perfume bottle 2h R2 2 is 2
  hits (each bottle's row, 6150310 and 6150313).

- Dancing Blade of Ranah +10 2h R2 1 does 699 in all at 99 in every stat (user): the calculator's
  85 + 74 (the one handed rows, as in the animations), not the sheet's 87 + 76 (about 718).
- Backhand Blade +25 1h jumping R2 (user): 702 early in the jump (127, animations 031230-031250,
  AtkParam 6400161), 670 late (122, animation 031270, 6400160, the sheet's). The backhand blades
  (Reverse-Bladed Sword, Backhand Blade, Curseblade's Cirque) are the only weapons whose early and
  late jumping attacks differ; the calculator uses the early one (MOTION_VALUE_FIXES).
- Backhand Blade +25 2h guard counter (user): 1955 in all on Margit, matching the animations' last
  hit of 80 (AtkParam row), not the sheet's 100 (2098); fixed for the backhand blades.
- Death Knight's Twin Axes +10 2h jumping R2 (user): 855 on the dummy, matching the animations'
  row (the one handed jumping R2's, 1400160: 127, which doesn't disable two handing's Strength bonus),
  not the sheet's 132 (860, or 896 with the bonus); fixed.
- Rakshasa's Great Katana +25 powerstance L1 2 (user): 1426 on the dummy, matching the animations'
  92 + 92, not the sheet's 94 + 94 (1462); fixed.
- Death Knight's Twin Axes +10 2h guard counter (user): 866 on Margit, matching the one handed
  guard counter's row (125) with two handing's Strength bonus, not the sheet's 130 (873, or 907 with
  the bonus); fixed.
- Dryleaf Arts and Dane's Footwork mounted R2/L2: the alternate AoE is 115 in the game's rows, not
  the sheet's 90 (game values trusted, untested). The calculator doesn't use alternates; this only
  affects the animation check.
- Dryleaf Arts 2h R1 6 is 2 hits (user, again): both feet. Now in MOTION_VALUE_FIXES ("106 + 106")
  rather than the old STEP_HIT_COUNTS.
- Dane's Footwork +10 2h guard counter (user): 1616 on Margit = 113 + 113 + 160, both kicks and one
  of the two AoEs (the sheet has the AoEs as alternates); fixed. Its animation's extra 94 and 126
  windows (Dane's own rows 6301311 and 6301314) don't add damage, which the animation check can't
  tell, so it still lists it.
- Claws of Night 2h R2 2 (user): 635 point blank on the dummy = its two claws' 69 projectiles (the
  calculator has 318.2 each, 636 rounded per hit; one off), not with the 76 swing window.
- Perfume bottle powerstance jumping L1 (user): 814 = 82 + 82 (Firespark or Chilling at +25, 99 in
  every stat), each bottle's spray, not with the 71 swing. Perfume bottles' and claws' swings from
  the hand don't add to a projectile at the same time; blades' and fists' do (e.g. the Lizard
  Greatsword's R2, the Golem Fist's R2), going by the sheet.

### Stamina costs (untested)

- A step's stamina cost is the stamina (BehaviorParam_PC stamina) of each of its animation's windows'
  behaviors, added up, times the weapon's staminaConsumptionRate (e.g. Longsword R1 12, 2h R2 24,
  2h charged R2 36; Black Knife 1h R1 9.99). Usually only a multi-hit attack's first behavior has
  any, but the Twinblade's charged R2 spins each cost 10 (40 in all), and paired weapons' two handed
  dual wielding rows add up (Starscourge Greatsword 2h R1 30.9). Whether each window costs its
  behavior's stamina, or only the first, isn't tested.
- Skills and critical hits have no stamina cost shown yet.
- Open: spamming two handed Longsword R2s with infinite stamina hit 27 times in about 33 seconds
  (~1.22s each), where the animations' cancel windows give 0.833s each. Not explained yet.
- Resolved: tapped R2s start about 10 frames (1/3s) after the press, while the game tells a tap from
  a hold, which isn't in the animations. Infinite stamina, Longsword +25 two handed (user): 50 tapped
  R2s in 58s (1.16s each; animations 0.833s), 50 R1s in ~40s (0.80s; animations 0.78s), 16 charged
  R2s in 32s (2.0s; animations 1.97s). Movesets' R2 timings have "start": 0.333.
  Confirmed with a frame count (user, Longsword +25 two handed): a two handed R1 1 takes 0.466s from
  the sword moving to its damage number (animation: hit at 0.500s, so numbers appear on the hit and
  movement starts about a frame in); a tapped R2 1 takes 0.533s (0.333s start + 0.267s hit = 0.600s,
  less that frame), with the charged wind-up showing until its swing starts moving forward at about
  0.367s.
  DSAnimStudio (user): the uncharged R2 animation (a023_032505) starts with the sword already drawn
  back, so a tapped R2's wind-up is the start of the charged R2, before the game switches to it.
- Why (decompiled c0000.hks with DSLuaDecompiler, AttackRightHeavy1Start_onUpdate): an R2 press
  always starts the charged R2's animation, and the script only switches to the uncharged R2 once R2
  is released and the charged animation's charging window is on (SpEffect 100280 or
  TAE_FLAG_CHARGING). So a tapped R2 starts when that window opens (plus about 2 frames, fitted),
  which differs by weapon and step: 0.033s to 0.833s (Longsword 2h: 0.233s and 0.267s, so 0.300s
  and 0.333s). Movesets' R2 "start" comes from each step's charged animation.

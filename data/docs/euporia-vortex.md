# Euporia Vortex's Luster Tiers (investigation, 2026-11-14)

The calculator's Luster Tier versions are far off below +25. Their extra damage was fitted as flat
holy (FOLLOW_UP_BUFFS in scripts/build_ash_data.py: Tier 1 22 on projectiles / 20 on swings, Tier 2
9 / 10) to totals measured only at +25, in the Boss Arena mod. The mod's params are the same as
vanilla's for Euporia (AtkParam, Bullet, SwordArts, Behavior, Reinforce, AttackElementCorrect, and the
luster SpEffects 19880-19885 checked), so the mod isn't the cause.

## Measurements

### +25 (Boss Arena mod, training dummy: 123.2 defense, no negation), one handed

| Stats | Plain | Tier 1 (projectiles alone) | Tier 2 (projectiles alone) |
|---|---|---|---|
| 99 in every stat | 2040 | 2530 (2117) | 6921 (5345), 61 poise |
| 89 STR/DEX, 99 INT, 25 FAI, 99 ARC | | 1676 | 4416 |

How "projectiles alone" was measured isn't recorded.

### +0 (vanilla, NG+ Haligtree Foot Soldier: 147.6 defense, -10% pierce, 20% holy), two handed, 80 STR, 80 DEX, 23 INT, 43 FAI, 61 ARC

The game's running damage total (hits close together merge into one step):

- Plain: 29, 58, 87, 116, 145 (5 hits of 29; the calculator's 29 each, exact)
- Tier 1: 47, 82, 129, 134, 144, 149, 154, 159, 164, 169, 174, 179
  - steps: 47, 35, 47, then 5, 10, 5, 5, 5, 5, 5, 5, 5, 5 (11 hits of 5)
- Tier 2: 84, 144, 148, 156, 160, 164, 172, 176, 180, 192, 196, 200, 208, 212, 216, 224, 228, 233,
  248, 253, 258, 268, 273, 278, 288, 293, 298, 313, 318, 323, 333, 337, 341, 346
  - steps: 84, 60, then about 45 hits of 4-5 (202 in all). The target was staggered partway through;
    the small hits go from 4 to 5 and back, cause unknown.

R1 #3 with the Tier 2 luster buff (+120 holy): 191 in game, 190 calculated, so the buff itself is
right on normal attacks.

## The calculator's hits

- Plain: 5 swings, motion value 70.
- Tier 1: 5 swings (MV 25) and 9 projectiles: 4 Bullet 200002341 (AtkParam 600000801, 41 holy,
  dmgHitRecordLifeTime 0.2), 4 Bullet 200002342 (600000802, 41, record 0), 1 Bullet 200002343
  (600000803, 45).
- Tier 2: 11 swings (MV 35, buff motion value 50) and 27 projectiles: 13 Bullet 200002351 (AtkParam
  600000811, 37 holy, record 0.2), 13 Bullet 200002352 (600000812, record 0), 1 final (42).
- Bullets live 0.25 s and pass through characters; a 0.2 s hit record may let 341/351 hit twice.

## Totals by model (calculator, 2026-11-14)

"×2" counts Bullet 341/351 twice. Fitted is the current model.

| Model | +0 T2 | +25 T1 | +25 T2 | +25 89/25 T1 | +25 89/25 T2 |
|---|---|---|---|---|---|
| Game | 346 | 2530 | 6921 | 1676 | 4416 |
| No extra holy, ×1 | 197 | 2268 | 6651 | 1431 | 4148 |
| Fitted, ×1 | 235 | 2530 | 6922 | 1680 | 4420 |
| No extra holy, ×2 | 249 | 3120 | 9108 | 1967 | 5630 |
| Fitted, ×2 | 300 | 3458 | 9483 | 2300 | 6006 |
| Full luster buff on everything, ×1 | 1375 | 3493 | 9403 | 2572 | 6955 |

Projectiles alone, no extra holy, ×1: +0 T1 45 (5 each), T2 109 (4 each); +25 T1 1943, T2 5133.

Two more projectiles per tier aren't in the calculator: Bullet 200002344 / 200002354 (AtkParam
600000804 / 814: 23 holy, radius 0.1 to 1.5, hits once), and Bullet 200002340 / 200002350 (AtkParam
600000800 / 810: no attack values, probably an effect pulse). The swings' AtkParam rows take 100%
of weapon buffs for Tier 1 (600000791/792, spEffectAtkPowerCorrectRate_byPoint 100) and 50% for
Tier 2 (600000793).

## Best candidate so far: buffed swings, plain projectiles

Swings get the luster buff (+95 Tier 1, +120 x 50% Tier 2); projectiles get no extra holy and count
once. No fitted numbers:

| Total | Game | Fitted (current) | Candidate |
|---|---|---|---|
| +0 Tier 1 | 179 | 122 | 215 (+20%) |
| +0 Tier 2 | 346 | 235 | 318 (-8%) |
| +25/99 Tier 1 | 2530 | 2530 | 2708 (+7%) |
| +25/99 Tier 2 | 6921 | 6922 | 7157 (+3%) |
| +25 89/25 Tier 1 | 1676 | 1680 | 1826 (+9%) |
| +25 89/25 Tier 2 | 4416 | 4420 | 4610 (+4%) |

Per hit at +0: projectiles 5 (T1) and 4 (T2), as seen; buffed swings 34 (T1) and 19 (T2), the right
size for the big steps (T1's 47, 35, 47 is about four 34s plus merged projectiles).

Doesn't fit: Tier 2's 144 is about 7-8 swings' worth (11 in the calculator); Tier 1's 129 about 4 (5
in the calculator); and the +25 "projectiles alone" split implies swings worth 413 (T1) and 1576
(T2), close to unbuffed swings (325, 1518) rather than buffed (765, 2024). Likely: not every swing
connects on a human-sized target.

Counting Bullet 341/351 twice overshoots everywhere, so they probably hit once. Adding the 23-holy
projectile changes little.

## Next

Count how many swings connect (Tier 1 at +0 first: test #24 in data/in-game-tests.md), then rebuild
the tiers as buffed swings plus plain projectiles, with that swing count.

## Solved (2026-11-14)

The luster buff applies to the first three hits only, then runs out. At +0 with 99 in every stat on
the training dummy, one handed, Tier 1 hit by hit (frames after the press / running total): 87/77,
91/136, 93/213, 100/222, 106/238, 112/247, 117/256, 120/263, 123/272, 129/281, 133/288, 139/299,
146/306. That's a projectile 77, a swing 59, and a projectile 77 with the buff, then projectiles 9,
swings 7, and the last projectile 11, exactly as calculated with the buff on the first three hits,
in the same order. The same rule gives the +25 totals exactly (2530, 6921, 1676, 4416), with no
fitted numbers. The 5 swings and 9 projectiles of Tier 1 all land; Bullet 341/351 hit once.

Left over: on the NG+ Haligtree Foot Soldier at +0 (two handed, 80/80/23/43/61), Tier 1 179 against
183 calculated and Tier 2 346 against 325. The soldier was staggered partway through Tier 2, which
may explain it. The 23-holy projectiles (Bullet 200002344 / 200002354) and the effect-only ones
(340 / 350) aren't counted; the tests match without them.

Tier 2's timing, the same way (2026-11-14): its 34 steps' damage exactly as calculated (528), at
91, 98, 106, 107, 111, 117, 121, 122, 129, 134, 141, 146, 149, 153, 158, 162, 165, 170, 177, 182, 189,
190, 194, 200, 204, 206, 211, 218, 224, 230, 232, 236, 242, 254 frames after the press: 3-6 frames
after the calculator's (swings and projectiles alike, mostly 4-5). Tier 1 was 3-4 later. Whether the
plain skill shares the offset is test #18.

The plain skill's hits (2026-11-14): 90, 104, 117, 131, 145 frames after the press, 1-2 after the
calculator's (88-144). So the Luster Tiers start 2-4 frames later than the plain skill, perhaps
from the luster being used up; not modeled (about 1% of the skill's length).

Tier 2's early roll (2026-11-14): pressed at 865, rolling as soon as possible: the hit for 375 at
1036 (171 after the press), the roll visibly starting at 1045 (180); the next hits (about 1042)
didn't land. The animation's roll window opens at 160 (the calculator's 162), the same as the plain
skill's after its last hit, but the game doesn't allow it that early. Fitted in CANCEL_FITS to 169
from the press, between the calculator's hits at 166 and 172. Cause unknown.

Rolling mid-skill (2026-11-14): pressed at 1845; roll pressed at 2029 (184) with 401 shown; the
total reached 420 at 2035 (190: a projectile and a swing, the calculator's 184 and 186 plus the
5-frame delay); the next step (about 195) didn't land; the roll visibly started at 2042 (197). So
the window stays open to the end, and a roll takes effect about 7-11 frames after it's pressed
(maybe waiting out the swing), visible 2-6 after that. The first run fits the same (effect between
171 and 177, visible 180), so the 169 fit, based on which hits land, stands.

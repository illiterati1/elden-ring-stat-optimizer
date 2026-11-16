# In-game tests to do

What the calculator predicts but nobody has checked in game yet. Timings are frames at 60 fps,
from the press that starts the attack (the skill's L2, or the first R1/R2), with each next press as
soon as possible. Record the press and each hit, as for the tests already done. Tested results go
in the tests (`src/optimizer/optimizer.test.ts`) and the build scripts' comments; then remove them
from here.

## Timing

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 15 | Mounted R1 chain | Longsword (any) | Hits 26, 66, and 104; the next chain's first hit 172 |
| 49 | Crouching R1, crouch, crouching R1 (no crouching animation of its own: assumed to be its rolling R1; the next one 15 frames into the crouch, fitted on the Greatsword) | Dagger, one handed | Hit 18 after the crouching R1 press; the next crouching R1 press 55 after the first; same damage as its rolling R1 |
| 50 | Crouching R1, crouch, crouching R1 (its own crouching animation, 030310) | Longsword, one handed | Hit 24; the next crouching R1 press 69 after the first |
| 51 | Powerstance crouching L1, crouch, crouching L1 (assumed to be its rolling L1, like #49) | Two Daggers | Hits 22; the next L1 press 67 after the first |

## Stamina

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 20 | Blind Spot | Backhand Blade | 39 (was 30) |
| 21 | Jumping R2 | Backhand Blade | 19 (its landing's behavior) |
| 22 | Familial Rancor and Rain of Arrows (one bow class) | — | 0 in the data, so not known |
| 43 | Starcaller Cry's chain (its #2's duplicate window left out, like Great-Serpent Hunt's) | Starscourge Greatsword | 30, then 15 (was 30.9) |
| 44 | Promised Consort's chain (its #3's duplicate slash window left out) | Greatsword of Radahn (Lord) | 42, 42, then 33 (was 49.44) |

## Damage

At +10 with 99 in every stat, on the training dummy (123.2 defense, no negation).

| # | Test | Calculated |
|---|---|---|
| 42 | Causality's Wrath Tier 2 and 3 (Tier 1's 893 is right) | Tier 2 1352 with 18 poise, Tier 3 1940 with 24 |

## Discrepancies to look into

| # | Test | In game | Calculated |
|---|---|---|---|
| 25 | Powerstance jumping L1 with Flare, O Serpent's buff: two Serpent Flails +10, 99 in every stat, training dummy | 2652 in all | 2674 (2672 in tests: each swing 786 with the buff's 90 fire, each explosion 550). Next: each hit's damage, to see which one is ~20 low |

## Roll-outs

These skills have a roll window before their last hit (an early roll-out, skipping the hits after
it), shown on the line of the hit before it. Most also have one after, a separate window: check both
rolls. Where the early window stays open past the last hit, it's the only roll: check when it
opens. Black Flame Tornado's tap was tested (2026-11-11: early 111, after 192), and Euporia Vortex
Luster Tier 2's (one window, from 169, fitted: 2026-11-14). Frames are from the press (for a chain
step, from that step's press).

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 26 | Alabaster Lords' Pull | Alabaster Lord's Sword | Hits 67, 115; early roll 105; roll after 155 |
| 27 | Onyx Lords' Repulsion | Onyx Lord's Greatsword | Hits 80, 134; early 122; after 178 |
| 28 | Eochaid's Dancing Blade, uncharged | Regalia of Eochaid (or Marais Executioner's Sword) | Hits 46 to 102 (every 8), 140; early 112; after 174 |
| 29 | Eochaid's Dancing Blade, charged | Regalia of Eochaid | Hits 94 to 172, 206; early 180; after 244 |
| 31 | Familial Rancor (one window, open past its last hit) | Family Heads | Hits 72 to 116; roll from 110 |
| 32 | Flame Dance | Giant's Red Braid | Hits 78, 116, 146, 176, 210; early 104 and 198; after 275 |
| 33 | I Command Thee, Kneel! #1 | Axe of Godrick | Hits 70, 127; early 95; after 183 |
| 34 | Savage Claws | Beast Claw | Hits 36, 50, 66, 84, 106, 144; early 94; after 178 |
| 35 | Shadow Sunflower Headbutt #2 | Shadow Sunflower Blossom | Hits 56, 104; early 72; after 146 |
| 37 | The Queen's Black Flame #1 | Godslayer's Greatsword | Hits 36, 138; early 86; after 186 |

## Enemy scaling

| # | Test | Calculated |
|---|---|---|
| 38 | Scadutree Blessing's damage bonus: the same hit on a Realm of Shadow enemy at blessing +0 and +20 | ×2.05 at +20 (SpEffectParam 20000100-20000120 atkEnemyDmgCorrectRate), after defenses |
| 39 | Whether the blessing also raises black flame's %-HP damage (e.g. Black Flame Blade on a DLC enemy) | Not applied |
| 40 | Whether beating Promised Consort Radahn in NG alone raises DLC enemies' HP at NG+2 (e.g. a Hornsent Inquisitor in the Abyssal Woods, NpcParam 53110586), and whether beating him first in NG+ raises it later in that journey | Hornsent Inquisitor: 2,711 HP at NG+2 without, 3,004 with |

## Not timed: need measurements

Nothing to compare yet; measure from the press, as above.

- Backstabs and ripostes (their animations have no attack windows)
- Shields' mounted R2
- Bow and crossbow jump shots (Jumping R1)
- Carian Retaliation
- Lifesteal Fist (a grab)
- Spinning Chain's loop length
- How fast Feeble Lord's Frenzied Flame can be used again

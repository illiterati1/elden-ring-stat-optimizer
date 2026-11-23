# In-game tests to do

What the calculator predicts but nobody has checked in game yet. Timings are frames at 60 fps,
from the press that starts the attack (the skill's L2, or the first R1/R2), with each next press as
soon as possible. Record the press and each hit, as for the tests already done. Tested results go
in the tests (`src/optimizer/optimizer.test.ts`) and the build scripts' comments; then remove them
from here.

## Timing

| # | Test | Weapon | Calculated |
|---|---|---|---|

## Stamina

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 62 | Night-and-Flame Stance's R1 (its swing's 25, then its beam's window's 45 at 1.03; the R2 charges only one of its two windows at once, so is the beam's charged too?) | Sword of Night and Flame | 71 |

## Damage

At +10 with 99 in every stat, on the training dummy (123.2 defense, no negation).

| # | Test | Weapon | Calculated |
|---|---|---|---|

## Discrepancies to look into

| # | Test | In game | Calculated |
|---|---|---|---|
| 25 | Powerstance jumping L1 with Flare, O Serpent's buff: two Serpent Flails +10, 99 in every stat, training dummy | 2652 in all | 2674 (2672 in tests: each swing 786 with the buff's 90 fire, each explosion 550). Next: each hit's damage, to see which one is ~20 low |
| 69 | Jumping R2's hits, from the jump press: Rellana's Twin Blades (er-logger, 2026-11-22). Two handed (R2 pressed 17 and 14 frames into the jump): damage (678 on the NG+1 dummy) and stamina (10 at the jump, 10 just before the hit) match; the landing started 51-52 frames after the jump (53 assumed). One handed (R2 pressed 4-17 frames into the jump; 5 jumps): damage matches (457, then 578 from the landing); the landing started 50-51 after the jump's animation, its hit 14-19 after the landing | Two handed 47 both times; one handed 47, 47, 48, then 51 and 47 from the jump's animation (+1) when buffered from a landing (the 51 on the landing's frame); landing hit 66 and 69 | Two handed 42 (attack from 14, its window at 26); one handed 44 and 64 (attack from 16). The hit comes 47 after the jump however early R2 is pressed. Does a jumping R2 start later than a jumping R1 (Rapier's, measured)? Next: another weapon's jumping R2 |

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

## Not timed: need measurements

Nothing to compare yet; measure from the press, as above.

- Backstabs and ripostes (their animations have no attack windows)
- Shields' mounted R2
- Bow and crossbow jump shots (Jumping R1)
- Carian Retaliation
- Lifesteal Fist (a grab)
- Spinning Chain's loop length
- How fast Feeble Lord's Frenzied Flame can be used again

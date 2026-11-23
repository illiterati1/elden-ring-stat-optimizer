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

## Damage

At +10 with 99 in every stat, on the training dummy (123.2 defense, no negation).

| # | Test | Weapon | Calculated |
|---|---|---|---|

## Discrepancies to look into

| # | Test | In game | Calculated |
|---|---|---|---|
| 25 | Powerstance jumping L1 with Flare, O Serpent's buff: two Serpent Flails +10, 99 in every stat, training dummy | 2652 in all (NG). er-logger 2026-11-22 (NG+1 dummy, 144.4): swings 744 and 744, both explosions 1058 together (2 × 529), stance 14.4, 14.4, 14 | NG: each swing 786, each explosion 550 (2672). NG+1: swings 754, explosions 529. The explosions match; each swing is 10 low. Without the buff (er-logger 2026-11-22, NG+1) both swings do 656 (one HP drop of 1312, stance 28.8), as calculated, so it's the buff: +88 per swing in game, +98 calculated (the R2's +104 at NG matches). Both swings are MV 105, sweet spot 1.125 |
| 38 | Powerstance jumping L1 with Flare, O Serpent's buff: explosion timing | er-logger 2026-11-22: swings +49 from the jump press, explosions +53 (4 frames after the swings). The game played 034570 (the buffed attack: swings at 0.533 s, explosions 7360/7364 at 0.633) and then landed in 034571 (no windows). It plays 034570 without the buff too (swings at +52 from the jump press, L1 pressed at +18), so 034570 is the jumping L1 itself and its 7360/7364 windows are the buff's explosions | Swings 48 from the jump press, explosions 57 (9 after): build_ash_data.py times them in the landing 034581 (BUFFED_JUMP_OFFSET + JUMP_LANDING_OFFSET), which the game didn't play. Timing them from 034570 would give 6 after the swings. The jumping R2's buffed 031270 (explosions at 0.633 and 0.733) is probably the same, untested |

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

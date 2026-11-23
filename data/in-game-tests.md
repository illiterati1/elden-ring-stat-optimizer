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
| 72 | Black flame on a DLC boss (e.g. Rellana), with the boss's HP from the save's NG+ level and Radahn flag. Only tested on the dummy and a Scadu Altus Omenkiller (not a boss) so far | Godslayer's Greatsword (The Queen's Black Flame) or Black Flame Tornado | 21 ticks per burn of 0.1% of the boss's max HP + 1, each rounded down (ticks on the same frame added first) |

## Discrepancies to look into

| # | Test | In game | Calculated |
|---|---|---|---|
| 25 | Powerstance jumping L1 with Flare, O Serpent's buff: two Serpent Flails +10, 99 in every stat, training dummy | 2652 in all (NG). er-logger 2026-11-22 (NG+1 dummy, 144.4): swings 744 and 744, both explosions 1058 together (2 × 529), stance 14.4, 14.4, 14 | NG: each swing 786, each explosion 550 (2672). NG+1: swings 754, explosions 529. The explosions match; each swing is 10 low. Without the buff (er-logger 2026-11-22, NG+1) both swings do 656 (one HP drop of 1312, stance 28.8), as calculated, so it's the buff: +88 per swing in game, +98 calculated (the R2's +104 at NG matches). Both swings are MV 105, sweet spot 1.125 |
| 71 | The Queen's Black Flame's black flame ticks, NG+1 training dummy (416171 HP) | er-logger 2026-11-23: 21 ticks of 520 after each of #1 and #2 (0.125% of its HP, no +1) | 21 ticks of 417 (SpEffect 855: 0.1% + 1, which matched at NG: 75 of 74212). Not NG+ in general: on a Scadu Altus Omenkiller in NG+3 (7813 HP) it was 0.1% + 1 (commit 09bfee8). So likely the dummy's NG+1 scaling in the Boss Arena mod, e.g. the HP it's a percentage of isn't its NG+1 HP |
| 74 | Lifesteal Fist (grabs are throws): Iron Ball, training dummy. Timing from the grab animation's critical-hit events (a655 40090: judges 3026 ×3, 3027 ×2 at anim frames 0, 52, 116, 194, 196), not attack windows | er-logger 2026-11-23, 6 logs. Grab connects ~67 after the press (stance 5, no damage), confirmed animation at 69, hits at 70, 121, 186, 263, 265 from the press, animation ends 357; 14 FP. +25, NG: 99 all 281/341; Str/Dex 99 Arc 10 167/227; Str 15 Dex 10 Arc 99 256/303; Str 15 Dex 99 Arc 99 270/323 (old untimed 15/10/10: 142/189). +25, NG+1: 99 all 265/323, same one handed with a Miséricorde in the left hand. +0, NG+1, 99 all: 14/21 | 434 ×3, 567 ×2 (NG+1, 99 all). Fits every log: each type through defense separately; magic = 42 × upgrade rate (1-4) × (1 + 0.5 × scaling growth × g(Arc)), with NO motion value; physical = MV 62/91 × the weapon's base physical × (0.6846 + 0.1128 × (g(Str) + g(Dex))), Str and Dex equal, no two handed bonus (g = the weapon's physical CalcCorrectGraph). Constants are fitted; Clinging Bone's old 1729 total fits too (1738) |

## Roll-outs

These skills have a roll window before their last hit (an early roll-out, skipping the hits after
it), shown on the line of the hit before it. Most also have one after, a separate window: check both
rolls. Where the early window stays open past the last hit, it's the only roll: check when it
opens. Black Flame Tornado's tap was tested (2026-11-11: early 111, after 192), and Euporia Vortex
Luster Tier 2's (one window, from 169, fitted: 2026-11-14). Frames are from the press (for a chain
step, from that step's press).

All tested (the last, The Queen's Black Flame #1, on 2026-11-23).

## Not timed: need measurements

Nothing to compare yet; measure from the press, as above.

- Small and large ripostes' and other classes' backstabs' and ripostes' leads (press to animation
  start), taken as the riposte's 4 frames and the backstab's 16 (check_animations.py's
  CRITICAL_STARTS: Miséricorde's riposte and Godslayer's Greatsword's backstab, 2026-11-23). Their hits
  and stamina are from the game's data (each class group has its own animations). On an unaware
  enemy (stealth) Godslayer's Greatsword's backstab's first hit did 446 rather than 346: ×1.2 before
  defenses (MV 52 as 62.4), the second hit unchanged (1525). The calculator has no unaware option
- Shields' mounted R2
- Bow and crossbow jump shots (Jumping R1)
- Carian Retaliation
- Spinning Chain's loop length
- How fast Feeble Lord's Frenzied Flame can be used again

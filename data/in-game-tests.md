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
| 73 | Godslayer's Greatsword +10 backstab's first hit, 99 in every stat, NG+1 dummy (144.4) | er-logger 2026-11-23: 446 + 1525 the first time (backstab started from animation 2022100), 346 + 1525 the second (from standing). AtkParam 400500's MV is 52, like the sheet | 346 + 1525. The first time's extra 100 isn't explained yet |

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

- Backstabs and ripostes (their animations have no attack windows; their hits are TAE event 304,
  judges 500/501, e.g. a32_031710). Measured 2026-11-23 (er-logger): Godslayer's Greatsword's
  backstab (a26_031710, from a32) starts 15 frames after the press, hits at 33 and 123 from its start
  (TAE 16 and 62 at 30 fps), and costs 12 + 13 stamina (calculated: none)
- Shields' mounted R2
- Bow and crossbow jump shots (Jumping R1)
- Carian Retaliation
- Lifesteal Fist (a grab)
- Spinning Chain's loop length
- How fast Feeble Lord's Frenzied Flame can be used again

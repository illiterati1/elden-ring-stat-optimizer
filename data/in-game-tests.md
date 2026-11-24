# In-game tests to do

What calculator predicts but nobody checked in game yet. Timings: frames at 60 fps, from press that starts attack (skill's L2, or first R1/R2), each next press ASAP. Record press and each hit, as for tests already done. Put tested results in tests (`src/optimizer/optimizer.test.ts`) and build scripts' comments; then remove from here.

## Timing

| # | Test | Weapon | Calculated |
|---|---|---|---|

## Stamina

| # | Test | Weapon | Calculated |
|---|---|---|---|

## Damage

At +10, 99 in every stat, on training dummy (123.2 defense, no negation).

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 72 | Black flame on DLC boss (e.g. Rellana), boss HP from save's NG+ level and Radahn flag. So far only tested on dummy and Scadu Altus Omenkiller (not boss) | Godslayer's Greatsword (The Queen's Black Flame) or Black Flame Tornado | 21 ticks per burn of 0.1% of boss max HP + 1, each rounded down (same-frame ticks added first) |

## Discrepancies to look into

| # | Test | In game | Calculated |
|---|---|---|---|
| 25 | Powerstance jumping L1 with Flare, O Serpent's buff: two Serpent Flails +10, 99 in every stat, training dummy | 2652 total (NG). er-logger 2026-11-22 (NG+1 dummy, 144.4): swings 744 and 744, both explosions 1058 together (2 × 529), stance 14.4, 14.4, 14 | NG: each swing 786, each explosion 550 (2672). NG+1: swings 754, explosions 529. Explosions match; each swing 10 low. Without buff (er-logger 2026-11-22, NG+1) both swings do 656 (one HP drop of 1312, stance 28.8), as calculated, so buff is cause: +88 per swing in game, +98 calculated (R2's +104 at NG matches). Both swings MV 105, sweet spot 1.125 |
| 71 | The Queen's Black Flame's black flame ticks, NG+1 training dummy (416171 HP) | er-logger 2026-11-23: 21 ticks of 520 after each of #1 and #2 (0.125% of its HP, no +1) | 21 ticks of 417 (SpEffect 855: 0.1% + 1, matched at NG: 75 of 74212). Not NG+ in general: on Scadu Altus Omenkiller in NG+3 (7813 HP) was 0.1% + 1 (commit 09bfee8). Likely dummy's NG+1 scaling in Boss Arena mod, e.g. HP it's percentage of isn't its NG+1 HP |

## Roll-outs

These skills have roll window before last hit (early roll-out, skipping hits after it), shown on line of hit before it. Most also have separate window after: check both rolls. Where early window stays open past last hit, it's only roll: check when it opens. Black Flame Tornado's tap tested (2026-11-11: early 111, after 192), and Euporia Vortex Luster Tier 2's (one window, from 169, fitted: 2026-11-14). Frames from press (for chain step, from that step's press).

All tested (last, The Queen's Black Flame #1, on 2026-11-23).

## Not timed: need measurements

Nothing to compare yet; measure from press, as above.

- Small and large ripostes' and other classes' backstabs' and ripostes' leads (press to animation
  start), taken as riposte's 4 frames and backstab's 16 (check_animations.py's
  CRITICAL_STARTS: Miséricorde's riposte and Godslayer's Greatsword's backstab, 2026-11-23). Hits
  and stamina from game's data (each class group has own animations). On unaware
  enemy (stealth) Godslayer's Greatsword's backstab's first hit did 446 not 346: ×1.2 before
  defenses (MV 52 as 62.4), second hit unchanged (1525). Calculator has no unaware option
- Shields' mounted R2
- Golden Crux's NPC grab (Greatsword of Damnation): when grab lands after L2 (its throw animation
  a923 40090's hit is 1.733 s in)
- Bow and crossbow jump shots (Jumping R1)
- Carian Retaliation
- Spinning Chain's loop length
- How fast Feeble Lord's Frenzied Flame can be used again
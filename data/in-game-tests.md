# In-game tests to do

What the calculator predicts but nobody has checked in game yet. Timings are frames at 60 fps,
from the press that starts the attack (the skill's L2, or the first R1/R2), with each next press as
soon as possible. Record the press and each hit, as for the tests already done. Tested results go
in the tests (`src/optimizer/optimizer.test.ts`) and the build scripts' comments; then remove them
from here.

## Timing

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 63 | Cursed-Blood Slice #1: what its second hit (80 flat fire, 70 physical MV; the sheet's "Bullet", now called an explosion) is, and when it lands | Morgott's Cursed Sword | Swing and explosion both at 68 (the explosion's time approximate: when it's created) |
| 64 | Ghostflame Call and Ghostflame Ignition: the skill, then its R1 and R2 follow-ups (frames from each press). The flare's ticks and the R1's ground fire tick every 0.4 and 0.5 s: when do they start, and how many land? | Any weapon with Ghostflame Call; Death's Poker | Same for both. Skill: swing 52, flare and explosion 56 (flare ticks to 1.46 s). R1: swing 54, explosion and ground fire 58 (ground fire for 5 s). R2: swing 46, explosion 50. The flare's, explosions' and ground fire's times are approximate (when created) |
| 66 | Golden Land #1: its explosion and four projectiles (frames from the press) | Any weapon with Golden Land | Swings 74, 110; explosion 80; projectiles 80, 92, 104, 116 (approximate: when created) |
| 67 | Swift Slash, uncharged and charged: when its vacuum (120 MV, 160 charged) lands, compared with the slash | Any weapon with Swift Slash | The app's times: uncharged vacuum 0.10 s, slash 0.13 s; charged vacuum 0.90 s, slash 0.93 s. The vacuum's is approximate (when it's created) and comes before the slash, which looks wrong |
| 55 | Mounted R1 chain while running (low priority: is the Longsword's 7 frame slowdown per R1 after the first the same for other classes?) | Dagger, Claymore, Zweihander | Standing still: Dagger 26, 58, 92, next chain 158; Claymore 36, 90, 148, 250; Zweihander 46, 152, 270, 398. Running, if the same: each hit after the first 7 later per R1 before it (Dagger 26, 65, 106, 179) |

## Stamina

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 62 | Night-and-Flame Stance's R1 (its swing's 25, then its beam's window's 45 at 1.03; the R2 charges only one of its two windows at once, so is the beam's charged too?) | Sword of Night and Flame | 71 |
| 56 | One handed jumping R2 (its hits' behaviors, 163 and 164, cost nothing; 160's 10 assumed, as on the Backhand Blade, rather than its landing's 17) | Rellana's Twin Blades | 10 (was 17) |

## Damage

At +10 with 99 in every stat, on the training dummy (123.2 defense, no negation).

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 65 | Ghostflame Call and Ghostflame Ignition, hit by hit: the swing, each flare tick, the explosion, and the R1's ground fire ticks (with #64's timing) | Any weapon with Ghostflame Call; Death's Poker | Each hit's damage in the app's breakdown, with the same setup |

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

## Not timed: need measurements

Nothing to compare yet; measure from the press, as above.

- Backstabs and ripostes (their animations have no attack windows)
- Shields' mounted R2
- Bow and crossbow jump shots (Jumping R1)
- Carian Retaliation
- Lifesteal Fist (a grab)
- Spinning Chain's loop length
- How fast Feeble Lord's Frenzied Flame can be used again

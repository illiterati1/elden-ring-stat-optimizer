# In-game tests to do

What the calculator predicts but nobody has checked in game yet. Timings are frames at 60 fps,
from the press that starts the attack (the skill's L2, or the first R1/R2), with each next press as
soon as possible. Record the press and each hit, as for the tests already done. Tested results go
in the tests (`src/optimizer/optimizer.test.ts`) and the build scripts' comments; then remove them
from here.

## Timing

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 5 | Flare, O Serpent then R2, repeated as fast as possible (its explosion is spent on one) | Serpent Flail | From L2: swing 103, explosion 107, next L2 139 (2h 101, 107, 137) |
| 6 | Flare, O Serpent then charged R2, repeated | Serpent Flail | From L2: swing 184, explosion 188, next L2 228 (2h 186, 190, 228) |
| 7 | Deadly Poison Spray, repeated (status only, approximate) | Deadly Poison Perfume Bottle | First hit 42, then every 146 |
| 8 | Fires of Slumber, repeated (status only, approximate) | St. Trina's Torch | First hit 60, then every 218 |
| 9 | Great-Serpent Hunt's chain | Serpent-Hunter | #1 hit 154; #2 168 later, its hit 258; next #1's hit 518 |
| 10 | Loretta's Slash, repeated | Loretta's War Sickle | Hits 44 and 98, then every 162 |
| 11 | Wall of Sparks, repeated | Firespark Perfume Bottle | Hit 30, then every 214 |
| 12 | Rolling Sparks, repeated | Firespark Perfume Bottle | Hits 34 to 52, then every 110 |
| 13 | Revenge of the Night's guard counter | Shield of Night | Hit 58 after the press |
| 14 | Rolling R1, then R1 again | Greatsword | Hit 30; the next R1 can be pressed 62 after the first |
| 15 | Mounted R1 chain | Longsword (any) | Hits 26, 66, and 104; the next chain's first hit 172 |
| 16 | Jump Shot + Landing Shot (assumed the Shortbow's) | Black Bow or Ansbach's Longbow | Jump shot 33 after the jump press, landing shot 90, a pair every 116 |
| 17 | Standard shot, repeated (assumed the Jar Cannon's) | Hand Ballista or Rabbath's Cannon | Hit 85, then every 264 |
| 18 | Euporia Vortex, repeated | Euporia | Hits 88 to 144 (every 14), then every 176 |
| 19 | Euporia Vortex's Luster Tier 1 and 2 versions | Euporia | Not timed yet |
| 20 | Black Flame Blade, then R1 as soon as possible; also at low and high Dex (casting speed isn't counted) | Any buffable weapon, seal in the left hand | R1 press 112 after the cast press (start animation 70 frames at full length, release 40, plus 2) |

## Stamina

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 20 | Blind Spot | Backhand Blade | 39 (was 30) |
| 21 | Jumping R2 | Backhand Blade | 19 (its landing's behavior) |
| 22 | Fires of Slumber, Familial Rancor, and Rain of Arrows (one bow class) | — | 0 in the data, so not known |

## Damage, in vanilla (not the Boss Arena mod)

At +25 with 99 in every stat, on a 123.2-defense target with no negation.

| # | Test | Calculated |
|---|---|---|
| 23 | The Carian Sorcery Sword's Impaling Thrust, and its R1s (the mod drops its INT scaling) | Impaling Thrust 1035 |
| 24 | Euporia Vortex's Luster Tiers (fitted in the mod, cause unknown) | Tier 1 2530 (projectiles alone 2117), Tier 2 6921 (5345); at 89 STR/DEX and 25 FAI, 1676 and 4416 |

## Discrepancies to look into

| # | Test | In game | Calculated |
|---|---|---|---|
| 25 | Powerstance jumping L1 with Flare, O Serpent's buff: two Serpent Flails +10, 99 in every stat, training dummy | 2652 in all | 2674 (2672 in tests: each swing 786 with the buff's 90 fire, each explosion 550). Next: each hit's damage, to see which one is ~20 low |

## Roll-outs

These skills have a roll window before their last hit (an early roll-out, skipping the hits after
it) as well as one after. Black Flame Tornado's tap was tested (2026-11-11: early 111, after 192).
The calculator now gives the roll after the last hit, and shows the early one on the line of the
hit before it. Frames are from the press (for a chain step, from that step's press). Check both rolls.

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 26 | Alabaster Lords' Pull | Alabaster Lord's Sword | Hits 67, 115; early roll 105; roll after 155 |
| 27 | Onyx Lords' Repulsion | Onyx Lord's Greatsword | Hits 80, 134; early 122; after 178 |
| 28 | Eochaid's Dancing Blade, uncharged | Regalia of Eochaid (or Marais Executioner's Sword) | Hits 46 to 102 (every 8), 140; early 112; after 174 |
| 29 | Eochaid's Dancing Blade, charged | Regalia of Eochaid | Hits 94 to 172, 206; early 180; after 244 |
| 30 | Euporia Vortex, Luster Tier 2 | Euporia | Hits 88 to 250; early 162; after 250 |
| 31 | Familial Rancor | Family Heads | Hits 72 to 116; early 110; after 116 |
| 32 | Flame Dance | Giant's Red Braid | Hits 78, 116, 146, 176, 210; early 104 and 198; after 275 |
| 33 | I Command Thee, Kneel! #1 | Axe of Godrick | Hits 70, 127; early 95; after 183 |
| 34 | Savage Claws | Beast Claw | Hits 36, 50, 66, 84, 106, 144; early 94; after 178 |
| 35 | Shadow Sunflower Headbutt #2 | Shadow Sunflower Blossom | Hits 56, 104; early 72; after 146 |
| 36 | Spinning Wheel | Ghiza's Wheel | Hits 32 to 125; early 109; after 125 |
| 37 | The Queen's Black Flame #1 | Godslayer's Greatsword | Hits 36, 138; early 86; after 186 |

## Not timed: need measurements

Nothing to compare yet; measure from the press, as above.

- Backstabs and ripostes (their animations have no attack windows)
- Shields' mounted R2
- Bow and crossbow jump shots (Jumping R1)
- Carian Retaliation
- Lifesteal Fist (a grab)
- Spinning Chain's loop length
- How fast Spinning Wheel and Feeble Lord's Frenzied Flame can be used again

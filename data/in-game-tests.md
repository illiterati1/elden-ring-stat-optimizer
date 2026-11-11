# In-game tests to do

What the calculator predicts but nobody has checked in game yet. Timings are frames at 60 fps,
from the press that starts the attack (the skill's L2, or the first R1/R2), with each next press as
soon as possible. Record the press and each hit, as for the tests already done. Tested results go
in the tests (`src/optimizer/optimizer.test.ts`) and the build scripts' comments; then remove them
from here.

## Timing

| # | Test | Weapon | Calculated |
|---|---|---|---|
| 3 | Golden Tempering's R2, repeated | Ornamental Straight Sword | Hit 43, then every 69 |
| 4 | Golden Tempering's charged R2, repeated | Ornamental Straight Sword | First hit 73, last 213, then every 239 |
| 5 | Flare, O Serpent's R2, repeated | Serpent Flail | Hit 41, then every 81 |
| 6 | Flare, O Serpent's charged R2, repeated | Serpent Flail | Hit 122, then every 166 |
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

## Not timed: need measurements

Nothing to compare yet; measure from the press, as above.

- Backstabs and ripostes (their animations have no attack windows)
- Shields' mounted R2
- Bow and crossbow jump shots (Jumping R1)
- Carian Retaliation
- Lifesteal Fist (a grab)
- Spinning Chain's loop length
- How fast Spinning Wheel and Feeble Lord's Frenzied Flame can be used again

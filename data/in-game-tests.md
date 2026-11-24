# In-game tests to do

What the calculator predicts but nobody has checked in game yet. Timings are frames at 60 fps,
from the press that starts the attack (the skill's L2, or the first R1/R2), with each next press as
soon as possible. Tested results go in the tests (`src/optimizer/optimizer.test.ts`) and the build
scripts' comments; then remove them from here. `scripts/predict.ts` gives the calculated values.

## Damage

| # | Test | Calculated |
|---|---|---|
| 72 | Black flame (The Queen's Black Flame or Black Flame Tornado) on a DLC boss, e.g. Rellana, with the boss's HP from the save's NG+ level and Radahn flag. Only tested on the dummy and a Scadu Altus Omenkiller (not a boss) so far | 21 ticks per burn of 0.1% of the boss's max HP + 1, each rounded down (ticks on the same frame added first) |
| 76 | Backstab with a Critical other than 100 or 130: Hookclaws +25 (Critical 110), one handed, 99 in every stat, NG training dummy (123.2), enemy aware | 209 and 1186 |
| 77 | Dagger Talisman on a throw's critical hits: Lifesteal Fist on the Iron Ball +25, two handed, 99 in every stat, NG training dummy. The calculator applies it only to backstabs and ripostes | 281 ×3, 341 ×2 (the same as without it) |

## Discrepancies to look into

None open.

## Not timed

Nothing to compare yet; measure from the press.

- Small and large ripostes' leads (press to animation start), and other classes' backstabs' and
  ripostes'. Taken as 4 frames for ripostes and 16 for backstabs (`CRITICAL_STARTS` in
  `scripts/check_animations.py`, from the Miséricorde's riposte and Godslayer's Greatsword's
  backstab).
- Shields' mounted R2
- Golden Crux's NPC grab (Greatsword of Damnation): when the grab lands after L2 (its throw
  animation a923 40090's hit is 1.733 s in)
- Bow and crossbow jump shots (Jumping R1)
- Carian Retaliation
- Spinning Chain's loop length
- How fast Feeble Lord's Frenzied Flame can be used again

## Not modeled

- Backstabs on an unaware enemy (stealth): Godslayer's Greatsword's first hit did 446 instead of
  346, ×1.2 before defenses (MV 52 as 62.4); the second hit was unchanged (1525)

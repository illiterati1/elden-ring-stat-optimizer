# In-game tests to do

What the calculator predicts but nobody has checked in game yet. Timings are frames at 60 fps,
from the press that starts the attack (the skill's L2, or the first R1/R2), with each next press as
soon as possible. Tested results go in the tests (`src/optimizer/optimizer.test.ts`) and the build
scripts' comments; then remove them from here. `scripts/predict.ts` gives the calculated values.

## Damage

| # | Test | Calculated |
|---|---|---|
| 76 | Backstab with a Critical other than 100 or 130: Hookclaws +25 (Critical 110), one handed, 99 in every stat, NG training dummy (123.2), enemy aware | 209 and 1186 |
| 77 | Dagger Talisman on a throw's critical hits: Lifesteal Fist on the Iron Ball +25, two handed, 99 in every stat, NG training dummy. The calculator applies it only to backstabs and ripostes | 281 ×3, 341 ×2 (the same as without it) |
| 78 | Weapon buff on powerstance hits below 90% (AtkParam spEffectAtkPowerCorrectRate_byPoint, 2026-11-24; only Serpent Flails' 90% with Flare, O Serpent tested): Powerstance L1 chain (L1 repeatedly) with a Dagger +25 in each hand, both greased with Lightning Grease (one application each), 99 in every stat, NG training dummy. #1 and #4 get 88%, #2 and #3 90% | #1 270 ×3, #2 346 ×2, #3 354 ×2, #4 286 ×3 (without the grease 255, 331, 339, 272; at 100% it would be 274, 350, 358, 291) |
| 79 | Same with a Beast Claw +25 in each hand, both greased: #2 gets 82% | #1 350 and 392, #2 286, 296, 327, #3 350 and 419, #4 752 (without the grease 335 and 377, 274, 284, 314, 335 and 404, 733; at 100%, #2 would be 293, 303, 333) |

## Discrepancies to look into

- Godslayer's Greatsword +10 two handed on Rellana (53000082) in the Boss Arena mod, 99 in every
  stat, NG+1 with Radahn (43,743 HP), Scadutree Blessing 7 (×1.5) (log 2026-11-24 22-20-24). Most
  hits match the calculator ×1.5: The Queen's Black Flame 711 and 2422 (473 and 1614), R2 1540
  (1026), charged R2 2000 (1333), large riposte 1271 and 3363 (847 and 2242). But some hits did about
  2.5% less: the skill's 693 and 2352 (on and off through the fight, at any HP), and all three R1s
  1078 (736 × 1.5 = 1104). Not the boss's HP phase or animation (a 693 and a 711 both landed in
  her anim 3008). What changes between them isn't known. On Chief Bloodfiend (50810990, same
  character, log 2026-11-24 22-35-34) every hit was the lower kind, about ×1.474: the skill 793
  and 2659 (538 and 1809), R1 #2 1265 (857), R1 #1 1484 (838, also ×1.2 for the stance break, see
  "Not modeled"). Both bosses' params have every part's damage rate at 1, so if it's a body part,
  the rate is in the model's hitboxes.

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

- Hits on a stance-broken enemy (its anim 8700, before the riposte's 11060) did ×1.2 (in known-issues.md):
  Rellana took the skill's big hit at 2906 (2422 otherwise, log 2026-11-24 22-20-24), and Chief
  Bloodfiend took R1 #1 at 1484 (1257 expected, log 22-35-34). Godslayer's Greatsword, Boss Arena
  mod. Not known yet: whether it's always 1.2, and whether it applies to every hit or only the first.
- Hits on an unaware enemy (stealth), any hit, not only backstabs (in known-issues.md): a
  Godslayer's Greatsword backstab's first hit did 446 instead of 346, ×1.2 before defenses (MV 52
  as 62.4). The second hit was unchanged (1525), presumably because the first hit had alerted the enemy.

# In-game tests to do

What the calculator predicts but nobody has checked in game yet. Timings are frames at 60 fps,
from the press that starts the attack (the skill's L2, or the first R1/R2), with each next press as
soon as possible. Tested results go in the tests (`src/optimizer/optimizer.test.ts`) and the build
scripts' comments; then remove them from here. `scripts/predict.ts` gives the calculated values.

## Damage

| # | Test | Calculated |
|---|---|---|

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
- Powerstance L1 chain with a Dagger +25 in each hand (log 2026-11-25 00-19-33): #4's 2nd and 3rd
  hits land at anim +38 and +42/43, 3 frames after the calculator's 35 and 40, though their TAE
  windows open at 34.8 and 39.8. All other hits are within 2 frames. Same with an Erdsteel Dagger
  +25 in each hand (log 2026-11-25 21-21-13): +38 and +42, +38 and +43. Damage matched.
- Powerstance L1 chain with a Beast Claw +25 in each hand (log 2026-11-25 00-33-00): #3's 1st hit
  lands at anim +33 and +32 (two tries), 4–5 frames after the calculator's 28, where its TAE window
  opens. Its 2nd hit (41) and all other hits are within 2 frames. Retested (log 2026-11-25
  21-21-13): +33 and +32 again; damage and stance matched, #2's bleed 17 per hit (calculated 18).


## Not timed

Nothing to compare yet; measure from the press.

- Small and large ripostes' leads (press to animation start), and other classes' ripostes'. Taken
  as 4 frames (`CRITICAL_STARTS` in `scripts/check_animations.py`, from the Miséricorde's riposte).
  The Godslayer's Greatsword large ripostes logged so far were in boss fights, where the logger's
  frames fall behind, so they don't count.
- Shields' mounted R2
- Carian Retaliation
- How fast Feeble Lord's Frenzied Flame can be used again

## Not modeled

- Hits on a stance-broken enemy (its anim 8700, before the riposte's 11060) did ×1.2 (in known-issues.md):
  Rellana took the skill's big hit at 2906 (2422 otherwise, log 2026-11-24 22-20-24), and Chief
  Bloodfiend took R1 #1 at 1484 (1257 expected, log 22-35-34). Godslayer's Greatsword, Boss Arena
  mod. Not known yet: whether it's always 1.2, and whether it applies to every hit or only the first.
- Hits on an unaware enemy (stealth), any hit, not only backstabs (in known-issues.md): a
  Godslayer's Greatsword backstab's first hit did 446 instead of 346, ×1.2 before defenses (MV 52
  as 62.4). The second hit was unchanged (1525), presumably because the first hit had alerted the enemy.
  Flail +25 backstab (log 2026-11-25 18-51-18): same pattern, 1st hit 291 instead of 234, 2nd 1057 as
  calculated. Backstabs logged 2026-11-25 (18-56-33, 18-58-52, 19-00-47) did either ×1.2 or exactly
  the calculated damage, the same weapon both ways (Noble's Slender Sword 1469 or 1224), so the
  calculated backstab damage is right and the extra is this bonus when the dummy happened to be
  unaware. Its awareness doesn't show in its animation (anim 20 before both kinds). Not only
  backstabs: a Longhaft Axe +25 R2 as the log's first action (2026-11-25 19-12-19) did 1142 and
  15.84 stance instead of 948 and 13.2, so stance damage gets the ×1.2 too.

# In-game tests to do

What the calculator predicts but nobody has checked in game yet. Timings are frames at 60 fps,
from the press that starts the attack (the skill's L2, or the first R1/R2), with each next press as
soon as possible. Tested results go in the tests (`src/optimizer/optimizer.test.ts`) and the build
scripts' comments; then remove them from here. `scripts/predict.ts` gives the calculated values.

## Discrepancies to look into

- Magic Dagger +25 (1000825) with Carian Grandeur, one handed, on the training dummy, 99 in every
  stat, NG+1 (log 2026-11-26 16-43-34). Every level's damage, stance and stamina match (Level 1
  1320/20/30, Level 2 1890/30/40, Level 3 2400/45/60), and each hit lands at the calculated
  animation frame (30, 30, 159 vs 161). But on a tap (held 7-9 frames) the Level 1 animation
  (666040001) started +56 from the press twice, where the calculator's lead is 59 (hit @86 vs @89).

- Magic Dagger +25 (1000825) with Carian Sovereignty, one handed, on the training dummy, 99 in
  every stat, NG+1 (log 2026-11-26 16-47-01). Damage, stance and stamina match for Uncharged #1
  (1890/30/45), Uncharged #2 (885040020: 1890/30/35), Charged #1 (1704 + 953 bullet, 37 + 11, 60)
  and Charged #2 (2400/45/45), and those hits land at the calculated animation frames (35 vs 34,
  72-73 vs 72, 172/176, 72). But on a tap the uncharged release animation (885040001) starts +71
  from the press (hit @106 vs @108), where the calculator's lead is 74.

- Keen Watchdog's Greatsword +25 (4010225) with Ghostflame Call, one handed, on the training dummy,
  OFFLINE ONLY (99 in every stat, NG+1, Shard of Alexander, Magic Scorpion Charm, four Rakshasa
  pieces) (logs 2026-11-26 01-13-20 and 01-18-40). Each hit's damage and tick count matches (Flare
  ×4 every 24 frames, Ground Fire ×10 every ~31; L2 + R1 2918, as predict.ts gives), but the R1
  slash landed anim+57 and +58 (four R1s), where the calculator gives 54 (its window starts at 54).

- Keen Highland Axe +25 (14100225) with Beast's Roar, one handed, on the training dummy, 99 in
  every stat, NG+1 (log 2026-11-26 00-13-18). With the axe's own ×1.1 passive for roars, the
  Shockwave did 681 (matches), but with the Roar Medallion and Shard of Alexander added it did 897,
  where the calculator gives 900 (681 × 1.15 × 1.15). (The hit landing anim+43 to +49 vs the
  calculator's 42 is travel distance.)

- Powerstance L1 chain with a Dagger +25 in each hand (log 2026-11-25 00-19-33): #4's 2nd and 3rd
  hits land at anim +38 and +42/43, 3 frames after the calculator's 35 and 40, though their TAE
  windows open at 34.8 and 39.8. All other hits are within 2 frames. Same with an Erdsteel Dagger
  +25 in each hand (log 2026-11-25 21-21-13): +38 and +42, +38 and +43. Damage matched.
- Powerstance L1 chain with a Beast Claw +25 in each hand (log 2026-11-25 00-33-00): #3's 1st hit
  lands at anim +33 and +32 (two tries), 4–5 frames after the calculator's 28, where its TAE window
  opens. Its 2nd hit (41) and all other hits are within 2 frames. Retested (log 2026-11-25
  21-21-13): +33 and +32 again; damage and stance matched, #2's bleed 17 per hit (calculated 18).
- Thrusting shields' mounted R2 (Magic Carian Thrusting Shield +25 on Tree Sentinel, log 2026-11-25
  22-10-52): held, it raises the shield (anim 57038100), hits at anim +29 for 550 and 3.3 stance with
  no stamina cost, drains 1 stamina about every 6 frames while held, then does the charged hit at
  anim +140.5: 945 and 33 stance for 36 stamina, as calculated, but the calculator times it at anim
  30 (the animation's first window; its costing window opens at 134). The 550 hit is presumably a
  charging hit (a hit while the attack charges), which the calculator doesn't model yet (see "Not
  modeled"). A tap is an attack (log 2026-11-25 22-15-17), unlike other shields' guard: the press
  raises the shield, and the release starts the thrust (anim 57038110) 23 frames after the press,
  26 stamina and 11 stance at its anim +31, as calculated (lead 24, anim 32). It did 751: 689
  without buffs, and 720 with the Counterattack buff (pierce, and Tree Sentinel was attacking, its
  anim 3013), so still 31 short. Not known why: maybe a bigger counter bonus on mounted attacks. Other
  shields' uncharged mounted R2 was dropped as a guard (build_moveset_data.py SHIELD_TYPES), and
  the same log agrees: Scorpion Kite Shield +25 and Gilded Greatshield +25 taps only guarded, and
  their charged R2s matched (374, 33 stance, 27 stamina at anim 132; 695, 36, 37 at about 137,
  calculated 136). Thrusting shields (wepType 90) stay in.
- Keen Backhand Blade +25 (64500225) jumping R2, two handed, on the training dummy, 99 in every
  stat, NG+1 (log 2026-11-26 15-17-01). Damage, stance and stamina match (569 + 569, 11 stance
  each, 13 + 14 stamina), but the hits land 45–49 frames after the jump press (R2 pressed 6–14
  frames after it, five tries), where the calculator gives 42 for both. The two hits also land 1–2
  frames apart (+45/+47, +45/+46), not together. Jumping R1 matched: 476 + 476, +36 and +37 (calculated 36).

## Not timed

Nothing to compare yet; measure from the press.

- Carian Retaliation

## Not modeled

- Charging hits: hits during a charged attack's charge, before its main hit. A Magic Carian
  Thrusting Shield +25's held mounted R2 hit for 550 and 3.3 stance at anim +29, with no stamina
  cost, before its charged hit at +140.5 (log 2026-11-25 22-10-52).
- Hits on a stance-broken enemy (its anim 8700, before the riposte's 11060) did ×1.2 (in known-issues.md):
  Rellana took the skill's big hit at 2906 (2422 otherwise, log 2026-11-24 22-20-24), and Chief
  Bloodfiend took R1 #1 at 1484 (1235 expected while wet, see below; log 22-35-34). Godslayer's
  Greatsword, Boss Arena mod. Not known yet: whether it's always 1.2, and whether it applies to
  every hit or only the first.
- Wet enemies (in known-issues.md): a wet enemy takes fire ×0.9 and lightning ×1.1 after
  negation, from the wet SpEffects (4010 refreshed every 0.06 s; 4511/4512/4600/4601 last 30 s,
  4512 with wetConditionDepth 2; presumably water and rain, not checked which is which).
  Godslayer's Greatsword +10 two handed (phys 750, fire 324), 99 in every stat, NG+1, Scadutree
  Blessing 7 (×1.5), Boss Arena mod. Rellana (53000082, fire negation 25, so 32.5 wet) on
  2026-11-26 (log 15-03-59), every hit wet; calculated wet × 1.5 in brackets: R1 #1 1078 (1077),
  R1 #2 1102 (1102), rolling R1 1315 (1314), R2 1500 (1500), charged R2 1946 (1945), The Queen's
  Black Flame 693 and 2352 (691 and 2352), riposte 1238 and 3264. Dry, the calculator × 1.5
  matches: on 2026-11-24 (log 22-20-24) she was dry for the skill's 711 and 2422, R2 1540, charged
  R2 2000 and riposte 1271 and 3363, and wet for the R1s' 1078 and some of the skill's 693 and
  2352, on and off at any HP. Chief Bloodfiend (50810990, log 22-35-34) was wet throughout: R1 #2
  1265 (1263 wet, 1286 dry). Which wet SpEffect each had wasn't logged; er-logger doesn't read
  SpEffects.
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

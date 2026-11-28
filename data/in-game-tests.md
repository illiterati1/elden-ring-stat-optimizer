# In-game tests to do

What the calculator predicts but nobody has checked in game yet. Timings are frames at 60 fps,
from the press that starts the attack (the skill's L2, or the first R1/R2), with each next press as
soon as possible. Tested results go in the tests (`src/optimizer/optimizer.test.ts`) and the build
scripts' comments; then remove them from here. `scripts/predict.ts` gives the calculated values.

- Flails' sweet spot (×1.125) is only for hits that land in it: when their window opens, or
  check_animations.py's HIT_DELAYS after (tested: powerstance L1, crouching L1, two handed R1s and
  R2s, logs 2026-11-27 17-32-52 and 17-48-58). Untested hits whose window opens a frame before it,
  so calculated without it: mounted R1 #2, mounted R2, mounted charged R2. Check one on the dummy.

- Heavy thrusting swords' skill animations: like light greatswords (wepmotionOneHandId 3,
  wepmotionBothHandId 10), so calculated with each skill's 40000s, not the spears' 40300s (a Keen
  Milady plays Spinning Slash's 40000, log 2026-11-27 20-57-36). Check Impaling Thrust on a Great
  Épée +25, one handed: the logger should show animation 6xx040000, the hit 47 frames after the
  press and the earliest roll 77 (its 40300 would be ~52 and 88).

## Discrepancies to look into

- Flame Art Great Mace +25 (12060525) with Prelate's Charge, one handed, tapped, on the training
  dummy (log 2026-11-27 19-34-36, L2 held 7 frames). Damage and stamina match (1055, ticks of 5,
  ground fire 248 every ~60, 864; 31, 4, 4, 4, 31), and the initial attack lands at 74, but the
  finish (40004) starts ~107 frames after the press and its final attack ~143 (by wall clock; the
  logger's frames lagged), not the calculated 111 and 147 (from an earlier Great Mace test). Tap it
  with a few hold lengths to see whether the finish's start depends on the release.

- Quality Guardian's Swordspear +25 (18110325) with Phantom Slash, one handed, on the training
  dummy (log 2026-11-27 18-58-14). Damage and stance match (#1 976/8 and 917/7.5, #2 1005/8 and
  955/7.75), stamina too (15: 5 at 1, then 10 at 97 in #1 and 86 in #2), and #1's hits land
  67-68 and 106 frames in (calculated ~66 and 104; one cast's phantom hit 59), #2's phantom 56-57
  (calculated ~57). But #2's slash lands 89 frames in, two casts, not the calculated 86, 3 frames
  after its window opens.

- Keen Great Katana +25 (66500225) with Overhead Stance, one handed, on the training dummy (log
  2026-11-27 18-54-00). The R2 (878040070) matches in damage, stance and bleed (619/5.5/38,
  708/5.5/41, 761/11/46), stamina (20 at 34, 56 and 100 from its animation's start, 60 in all) and
  FP (10 at 34). But its hits land 36, 60 and 100-101 frames in, both times, not the calculated 34,
  56 and 100: the second hit is 4 frames after its window opens. The stance R1 (1136/11/55 at 25)
  and the R1 after it (61030000, 735/10.18/55 at 33) match (log 2026-11-27 18-51-18).

- Lightning Uchigatana +25 (9000625) with Lightning Slash, one handed, on the training dummy (log
  2026-11-27 18-43-43). Damage, stance, bleed and stamina match (158/2, 1260/15 with 45 bleed,
  771/10; 10 then 15 stamina), and the stomp and slash land 38 and 80-81 frames in, as calculated.
  But the projectile (Bolt) hit 108 frames in, four casts, not the calculated ~98 (its window opens
  at 98). An R1 pressed during the skill's recovery (29030010, the chain's step 2) did 691, the
  calculated value with the skill's 85 lightning buff still on, about 4 seconds after the slash.

- Sacred Bloodfiend's Arm +25 (12530725) with Golden Land, one handed, on the training dummy (log
  2026-11-27 18-01-24). #1 matches (45 stamina, 35 at 74 then 10 at 110; 1126, 593 and the 1346
  explosion at 75, 111, 143-144), and #2's damage and stamina match (1710, stance 7.5; 35). But
  #2's hit lands 52 frames into its animation by wall clock (50 game frames), not the calculated
  44, and its stamina drops at 41-44, as with Earthshaker's #2 (both are anim 662040010).

- Flame Art Greatsword +25 (4000525) with Flame Skewer, one handed, on the training dummy (log
  2026-11-26 18-00-31). #1 matches (45 stamina at 52, 1507, stance 24, hit 52-53) and #2's damage,
  stance and stamina match (798, 15, 22 at 36), but #2's hit lands 40-41 frames into its
  animation, not the calculated 36 (marked approximate). Two casts agree.

- Occult Giant-Crusher +25 (23111225) with Earthshaker, one handed, on the training dummy (log
  2026-11-26 17-52-21). Damage, stance and stamina match both steps (#1's 42 is two drops, 32 then
  10 at about frame 91), and #1's hits land at the calculated frames. #2's hit lands 49-52 frames into its animation, 5-8 after the calculated 44 (three casts); its
  45 stamina drops at 40-42, 2-4 frames before the TAE window.
- Heavy Great Katana +25 (66500125) with Earthshaker, one handed, on the training dummy (log
  2026-11-27 18-24-28). Damage, stance and stamina match both steps (1321 and 1501, stance 20,
  25 each), and #2 (718040010) lands 76-77 frames in, as calculated. But #1 (718040000) cast from
  idle hits 118-121 frames in (five casts), inside the window that opens at 92, not the calculated
  123; its stamina drops at 117-120, before the 123.3 window. Only a buffered recast hit at 124.
  The Initial Roar's 15 stance and the Roar Ticks didn't show as separate hits.
- Quality Twinned Knight Swords +25 (10030325) with Double Slash, one handed, on the training
  dummy (log 2026-11-26 17-37-47). Damage, stance and stamina match every step, and the hits land
  at the calculated animation frames, except #1's second hit: 67 and 66 frames in, where its window
  (612040300) opens at 64. On a Quality Gargoyle's Halberd +25 the same hit landed at 63. On a
  Quality Uchigatana +25 (9000325, log 2026-11-26 17-45-25) everything matched too (587/691,
  523/539/772, 1010), but #1's second hit landed 55 and 53 frames in, where its window opens at 52,
  and #2's third 60 vs 58. On a Quality Beastman's Cleaver +25 (8080325, log 2026-11-26
  17-47-10) everything matched (748/875, 669/688/971, 1236) and every hit landed within 1 frame,
  except #2's first: 45 vs 42.

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
  calculator's 42 is travel distance.) Retested (log 2026-11-27 16-43-09): 681 with no talismans,
  780 with the Roar Medallion and 780 with the Shard of Alexander (calculator 783 each), 897 with
  both (calculator 900). So the
  first ×1.15 gives only ×1.145 on top of the axe's ×1.1 (780 = 619.1 × 1.26, not × 1.265), and
  the second gives a full ×1.15 (897 = 780 × 1.15). Each ×1.15 alone matches on a Keen Dagger
  +25 with Beast's Roar (586 → 674, log 2026-11-27 16-36-45), and so does the axe's ×1.1 alone
  from the left hand (586 → 645), so it's only the axe's passive combined with a talisman. Same on
  the Keen Dagger with a Highland Axe +25 in the left hand (log 2026-11-27 16-48-21): 739 twice
  with one ×1.15 talisman (calculator 741), 850 with both (calculator 853). Both weapons give
  ×1.26 for the passive and one talisman together (739/586, 780/619.1), not 1.1 × 1.15 = 1.265.
  Adding four Rakshasa pieces (log 2026-11-27 16-51-45): 698 with the passive alone (matches), 799
  with the Roar Medallion (calculator 803), 920 with both talismans (setup assumed) (calculator
  923), so the first talisman again gives ×1.145 (799/698). Without the axe (log 2026-11-27
  16-55-22, setups assumed from the numbers): 674 with one talisman, 774 with both (calculator
  775), 730 with Rakshasa and one (matches), 838 with Rakshasa and both (calculator 839), all
  within 1, so the gap needs the axe's passive together with a talisman. Golden Vow (the skill's,
  ×1.115, cast from a Sacred Highland Axe +25 in the left hand) with the passive matches: 719 (log
  2026-11-27 16-58-36), as does Rakshasa with it (above), and Frostbite (×1.2) with it: 774 (log
  2026-11-27 17-00-33). The
  SpEffects are plain \*AttackRate rows: the axe's 5141000 (×1.1, categories 106/116), the Roar
  Medallion's 321900 (×1.15, 106/116) and the Shard's 312310 (×1.15, 112/111).

- Powerstance L1 chain with a Dagger +25 in each hand (log 2026-11-25 00-19-33): #4's 2nd and 3rd
  hits land at anim +38 and +42/43, 3 frames after the calculator's 35 and 40, though their TAE
  windows open at 34.8 and 39.8. All other hits are within 2 frames. Same with an Erdsteel Dagger
  +25 in each hand (log 2026-11-25 21-21-13): +38 and +42, +38 and +43. Damage matched.
- Powerstance L1 chain with a Beast Claw +25 in each hand (log 2026-11-25 00-33-00): #3's 1st hit
  lands at anim +33 and +32 (two tries), 4–5 frames after the calculator's 28, where its TAE window
  opens. Its 2nd hit (41) and all other hits are within 2 frames. Retested (log 2026-11-25
  21-21-13): +33 and +32 again; damage, stance and bleed matched.
- Thrusting shields' mounted R2 (Magic Carian Thrusting Shield +25 on Tree Sentinel, log 2026-11-25
  22-10-52): held, it raises the shield (anim 57038100), then does the charged hit at anim +140.5:
  945 and 33 stance for 36 stamina, as calculated, but 6 frames after its window (134, the
  calculator's time). The 550 and 3.3 stance at anim +29 before it, with no stamina cost, is its
  charging hit (window judge 630, AtkParam 6100630, MV 90: 434, and 550 with the unaware ×1.2, as
  the log's first hit; see "Not modeled"). A tap is an attack (log 2026-11-25 22-15-17), unlike other
  shields' guard: the press raises the shield, and the release starts the thrust (anim 57038110) 23
  frames after the press, 26 stamina and 11 stance at its anim +31, as calculated (lead 24, anim
  32). It did 751 during Tree Sentinel's attack (anim 3013), as calculated with the Counterattack
  buff, now enemies' counter window (SpEffect 31, pierce ×1.3; it was the player's 45, ×1.15). Other
  shields' uncharged mounted R2 was dropped as a guard (build_moveset_data.py SHIELD_TYPES), and
  the same log agrees: Scorpion Kite Shield +25 and Gilded Greatshield +25 taps only guarded, and
  their charged R2s matched (374, 33 stance, 27 stamina at anim 132; 695, 36, 37 at about 137,
  calculated 136). Thrusting shields (wepType 90) stay in.
- Keen Backhand Blade +25 (64500225) jumping R2, two handed, on the training dummy, 99 in every
  stat, NG+1 (log 2026-11-26 15-17-01). Damage, stance and stamina match (569 + 569, 11 stance
  each, 13 + 14 stamina), but the hits land 45–49 frames after the jump press (R2 pressed 6–14
  frames after it, five tries), where the calculator gives 42 for both. The two hits also land 1–2
  frames apart (+45/+47, +45/+46), not together. Jumping R1 matched: 476 + 476, +36 and +37 (calculated 36).

## Not modeled

- Charging hits: hits during a charged attack's charge, before its main hit. A Magic Carian
  Thrusting Shield +25's held mounted R2 hit for 550 and 3.3 stance at anim +29, with no stamina
  cost, before its charged hit at +140.5 (log 2026-11-25 22-10-52): MV 90, ×1.2 as the enemy was
  unaware. The moveset leaves these out (check_animations.py get_timings times only the charged hit).
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

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
| 75 | Lifesteal Fist on the Clinging Bone (its fixed skill), training dummy. Its fitted scaling (build_ash_data.py ELEMENT_CORRECT_FITS) is from the Iron Ball, whose scaling grows ×1.5 to +25; the Clinging Bone's grows ×1.8 to +10, and it has its own magic (24 base) | er-logger 2026-11-23, timing (hits 68-70/120-122/184-185/262-263/264-265 from the press) and stamina (16) matching: +10, 99 in every stat, NG+1 (144.4): 299 ×3, 366 ×2, stance 5 each. +10, Arcane 16 (its requirement), NG (123.2): 207 ×3, 266 ×2. +0, 99 in every stat, NG+1: 19 ×3, 27 ×2. +10, Str 10 / Dex 99 / Arc 99, NG: 309 ×3, 373 ×2 (318/391 calculated; physical ×0.86 gives 309/373 exactly). (Arcane 10 did 77/126: below the requirement, which isn't modeled.) Earlier hand-recorded +10: 1729, 30 stance (2026-11-02) | 308/384, 219/286, 20/28. Fitting a rate on physical and one on the weapon's own magic across both +10 runs: magic ×1.00 and physical ×0.87 give exactly 299/366 and 207/266 (+0: 19/26). So the magic is right, and the Iron Ball's physical fit is 13% high on the Clinging Bone, for a reason not known (the fit's Str/Dex rate is equal and weapon-independent; the Clinging Bone's own scaling is Dex-heavy, the Iron Ball's Str-heavy). The Str 10 run fits the same factor, so Str and Dex do scale it equally: it's a flat factor on physical, about ×0.865 (0.6845 × 0.865 ≈ 0.592 of the motion value vs the Iron Ball's 0.6845), so per weapon or weapon type (both are Fists, so not the weapon type). Beast Claw +25 (Lifesteal Fist as an Ash of War, two handed), 99 in every stat, NG+1, er-logger 2026-11-23: 307 ×3, 391 ×2, stance 4, timing as on the others; calculated 261/317, so physical ×~1.38 there. Weapon base / implied physical base at 100 motion value: Iron Ball 101 / 69.1, Clinging Bone 80 / 47.4, Beast Claw 98 / 92.5. Beast Claw, Str 13 / Dex 99 / Arc 10, NG, two handed: 149 ×3, 199 ×2, calculated 152/202 (physical ×~0.97), so the ×1.38 goes away with low Str and Arcane. Str 99 / Dex 99 / Arc 10, NG: 211 ×3, 294 ×2 (163/221 calculated, ×1.4 again), so it's Strength. Equal Str/Dex rates can't fit all three Beast Claw runs (Str 13's comes out 166, not 149); separate rates fit along a ridge, from Str 0.55 / Dex 0 × 0.70 to Str 1.0 / Dex 0.6 × 0.38 (as fractions of the motion value, the Iron Ball's 0.11 / 0.11 × 0.6845), Str 99 / Dex 11 / Arc 10, NG: 142 ×3, 188 ×2 (calculated 151/202). Fitting physical = base × p × (1 + rs × Str bonus + rd × Dex bonus) (the bonuses at rate 1 with the weapon's growth and graph), defense per damage type, flat magic added to the weapon's own magic (the calculator's model): Iron Ball rs 0.10-0.11, rd 0.10-0.11, p 0.68-0.70; Clinging Bone rs 0.10, rd 0, p 0.70 (exact); Beast Claw rs ~3.5, rd ~3.7, p ~0.11 (within 1-2; base barely counts, nearly all scaling). Applying defense to the grab's total instead fits worse for all three. No weapon param explains the Beast Claw (same rows, reinforcement and graph as the Iron Ball). Hookclaws +25 (two handed), Str 10 / Dex 99 / Arc 99, NG: 286 ×3, 334 ×2; the Iron Ball's fit gives 259/307, the Beast Claw's 253/298; Critical 110 (throwAtkRate 10): the confirmed grab is a critical hit (throwFlag 2); now calculated 285/337 with ×1.1 after defenses, but see below. Exact attack power from the game's hit struct (Cheat Engine breakpoint at eldenring.exe+448B34, the hit struct at R14: +0x0 physical attack × motion value, +0x4 magic, +0x228 final damage, +0x238 magic's damage; me3 profile needs disable_arxan = true and CE's VEH debugger), first hit (motion value 62), two handed: Hookclaws Str 10 / Dex 99 / Arc 99 physical 112.96 (0.7996 × base 227.85), magic 343.5 (= flat 312.3 × 1.1: Critical multiplies magic before defense and not physical), damage 286; Hookclaws Str 99 / Dex 99 / Arc 10 physical 143.03 (1.0125 × base), magic 204.18 (185.62 × 1.1), damage 189; Beast Claw Str 99 / Dex 99 / Arc 10 physical 186.33 (1.2517 × base 240.1, exactly erdb's Influence formula base × (1 − 0.6 + 0.7 × own Str/Dex bonus)), magic 185.62, damage 211. Hookclaws Str 10 → 99 adds 0.213 × base ≈ 0.7 × its own Str bonus (two handed), so Influence 70 seems to apply per stat, but the constant part differs (Hookclaws ~0.16-0.19, Beast Claw 0.32-0.40) Same AtkParam rows (300000025-27, attack type 3) for all, the dummy has no per-type negation, and no weapon param found that explains it |

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

- Small and large ripostes' and other classes' backstabs' and ripostes' leads (press to animation
  start), taken as the riposte's 4 frames and the backstab's 16 (check_animations.py's
  CRITICAL_STARTS: Miséricorde's riposte and Godslayer's Greatsword's backstab, 2026-11-23). Their hits
  and stamina are from the game's data (each class group has its own animations). On an unaware
  enemy (stealth) Godslayer's Greatsword's backstab's first hit did 446 rather than 346: ×1.2 before
  defenses (MV 52 as 62.4), the second hit unchanged (1525). The calculator has no unaware option
- Shields' mounted R2
- Golden Crux's NPC grab (Greatsword of Damnation): when the grab lands after L2 (its throw animation
  a923 40090's hit is 1.733 s in)
- Bow and crossbow jump shots (Jumping R1)
- Carian Retaliation
- Spinning Chain's loop length
- How fast Feeble Lord's Frenzied Flame can be used again

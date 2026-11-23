---
name: logger
description: Start er-logger (the in-game memory logger) for a test session, wait for the user to say "done", then stop it and summarize the log. Use when the user says "start the logger", "start it", "log this", or is about to test something in game.
---

# Logger session

er-logger reads the game's memory (presses, animations, stamina, FP, enemy HP/stance/buildup,
equipment) into a per-frame CSV. It needs EAC off (Boss Arena via me3, or vanilla offline).
Details and pitfalls are in memory `er-logger`.

## 1. Start it

Run in the background (`run_in_background: true`), so the session stays free:

```
~/elden_ring/er-logger/er-logger.exe --for 600
```

`--for 600` stops it after 10 minutes. Use a longer time if the user asks for one. `timeout`
doesn't kill Windows exes. Then tell the user, in one line, that it's running and to say "done"
when they've finished. Don't poll its output, don't sleep, and don't do anything else: wait for
their reply.

If the user's reply isn't "done" (or "finished", "stop", etc.), answer it and keep the logger
running.

## 2. On "done"

Stop it and summarize the newest log in one call:

```
powershell.exe -NoProfile -Command 'Get-Process er-logger | Stop-Process'; node ~/elden_ring/er-logger/summarize.mjs
```

Stopping it makes the background task end with exit code 255. That's expected, not a failure, so
don't mention it. If the 10 minutes ran out first, the log is still complete: just summarize it.
Check the head of the task's output file for the log's path if the summary picks the wrong file.

## 3. Report

Say what was tested: the weapon, skill and grip from the summary's equipment lines. Then give, per
attack, the press → animation start, the stamina drop vs the game's animation data (✓/✗), and the
hits, with damage, stance and buildup. Use frames from each animation's start. Explain the summary's
✗s where the log shows why, e.g. ticks from an earlier cast that land during the next attack.

Then compare with the calculator, unless the user only asked for the log: follow the
`in-game-test` skill. The summary already does a first pass: after each press, a `calc` line
(from `scripts/predict.ts`) with the calculator attack whose damage is closest, each hit's damage
and frame from the press (✓ within 1 damage and 2 frames, else ✗ with the game's), its stance and
buildup, and logged hits it has no hit for. It assumes 99 in every stat, NG+1 and no buffs, and
uses the defenses of the enemy hit (`vs <name>`; the training dummy's if enemies.json doesn't have
that NpcParam ID); rerun with `--ng 0` or `--stat N` if those were different. It only knows skills
(040000 on), the basic and mounted moveset animations, so check the right version was picked. A
buffered press (its animation starting well after the press) puts the hits later than the calc's
frames. Things to check first:

- **Stats and NG+:** assume 99 in every stat and NG+1, where the training dummy's defense is
  144.4, not 123.2. Only if the damage doesn't match, read the character from the save with
  `readSaveFile` (`src/app/saveFile.ts`; the Boss Arena save is `BossArenaSandbox.sl2` in
  `/mnt/c/Users/brend/AppData/Roaming/EldenRing/<steamid>/`). Its `stats` are the attributes, and
  its `clearCount` is the NG+ level. The save can lag behind what's equipped, so trust the log's
  equipment over it.
- **Weapon ID:** the logged one is base + affinity × 100 + upgrade, e.g. 3180825 = Claymore,
  Magic (8), +25.

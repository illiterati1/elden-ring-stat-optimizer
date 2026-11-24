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
~/elden_ring/stat-calculator/tools/er-logger/er-logger.exe --for 600
```

`--for 600` stops it after 10 minutes. Use a longer time if the user asks for one. `timeout`
doesn't kill Windows exes.

**Don't tell the user it's ready until it's actually logging.** It takes several seconds to attach
to the game, and anything the user does before that is lost (2026-11-22: a whole Onyx Lords'
Repulsion cast with an early roll-out happened before the log began). It prints
`ready: logging, right weapon <id>, left <id>` once it has written its first rows. Wait for that
line in a second background Bash call, using the task's output file path from the start call's
result:

```
f=<output file>; for i in $(seq 120); do grep -q '^ready' "$f" && { grep -m1 '^ready' "$f"; exit 0; }; sleep 0.5; done; tail -5 "$f"; exit 1
```

When it exits 0, tell the user, in one line, that it's logging (with the right weapon's ID from
the ready line) and to say "done" when they've finished. If it exits 1, or the logger's own task
ends first, it isn't logging: show its output (e.g. the game isn't running, or EAC is on) and
don't say it's ready. After that, don't poll its output, don't sleep, and don't do anything else:
wait for their reply.

If the user's reply isn't "done" (or "finished", "stop", etc.), answer it and keep the logger
running.

## 2. On "done"

Stop it and summarize the newest log in one call:

```
powershell.exe -NoProfile -Command 'Get-Process er-logger | Stop-Process'; node ~/elden_ring/stat-calculator/tools/er-logger/summarize.mjs
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
`in-game-test` skill, but get the calculator's numbers from `scripts/predict.ts`, not by editing
a test. Pass the weapon's logged ID from the summary's equipment line (in brackets):

```
npx vite-node scripts/predict.ts -- 67520010 --2h [--attack "jumping r2"] [--anim 918040060,918040010]
```

It prints, per attack (every moveset attack and every version of the skill, or those `--attack`'s
text or `--anim`'s logged animations pick), each step's stamina, lead (frames before its animation
starts), cycle and cancels from the press, and each hit's damage, stance, buildup and frame, both
from the press (`@56`) and from the animation's start (`anim 36`). It assumes 99 in every stat,
NG+1 (the dummy's 144.4) and no buffs: `--ng 0`, `--stat N` (or one stat: `--str N`, `--arc N`, …), `--enemy <NpcParam ID>` (from the log's
`npc <id>@...` rows) for others, `--ash <id>` for an Ash of War, `--json` for JSON. Compare its
`anim` frames with the summary's `anim+N` (a buffered press starts its animation late). Things to
check first:

- **Stats and NG+:** assume 99 in every stat and NG+1, where the training dummy's defense is
  144.4, not 123.2. Only if the damage doesn't match, read the character from the save with
  `readSaveFile` (`src/app/saveFile.ts`; the Boss Arena save is `BossArenaSandbox.sl2` in
  `/mnt/c/Users/brend/AppData/Roaming/EldenRing/<steamid>/`). Its `stats` are the attributes, and
  its `clearCount` is the NG+ level. The save can lag behind what's equipped, so trust the log's
  equipment over it.
- **Weapon ID:** the logged one is base + affinity × 100 + upgrade, e.g. 3180825 = Claymore,
  Magic (8), +25.
- **Stamina:** the summary shows only an animation's first stamina drop. A step whose windows each
  cost stamina drops several times (Moon-and-Fire Stance's R1 #1: four 10s), and predict.ts gives the
  step's total, so check the log's `stamina` rows before calling it a mismatch.
- **Jumping attacks:** the log shows the jump (anim 3202000, 10 stamina at the A press) and then the
  landing, never the attack's own animation, so time its hit from the jump press: predict.ts's
  `@` frame for a jumping attack is from the jump press (its lead is the jump's start).

Always check `data/in-game-tests.md` too: for each attack logged, look for its rows (weapon, skill,
attack, and the other grip or version, which doesn't count as tested). Remove the rows the log
settles, as the `in-game-test` skill says, and add a row under "Discrepancies to look into" for
anything the log shows off by more than 2 frames or 1 damage that isn't fixed now. Say in the report
which rows were checked, removed or added.

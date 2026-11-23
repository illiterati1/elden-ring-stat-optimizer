# er-logger

Reads Elden Ring's memory (read-only, from outside the game) about once per millisecond and logs every
change to a CSV, numbered by game frame: controller presses, player animation/stamina/FP/HP, and every
loaded enemy's HP, stance (super armor), toughness and status buildup, plus the player's equipped
weapons, their Ashes of War and arm style (`armstyle`, `lweapon`, `rweapon`, `lash`, `rash`: logged
at the start and on each change; an Ash is its EquipParamGem ID, 0 for the weapon's own skill). The
summary prints equipment changes by name, from the stat calculator's `public/saveItems.json`.

## Use

    er-logger.exe [outdir] [--for seconds]       # default outdir: %USERPROFILE%\Videos\er-logs
    node summarize.mjs [log.csv] [--ng 0] [--stat N] [--no-calc]   # default: newest log

The summary prints one line per player animation: the press, the animation start, the stamina drop
and each hit (damage, stance, buildup), checked against the animation's TAE hit windows
(`tae_windows.py`, which uses the stat calculator's `scripts/check_animations.py`). Stamina should drop
on the frame the first window whose behavior costs stamina opens, by that much (from the weapon in use:
the right hand's, or the left's when two-handing it; logs without the weapon match any window's
start); mismatches are marked ✗.

Equipment lines give each weapon's and Ash's logged ID in brackets. To compare with the stat
calculator, run its `scripts/predict.ts` with that ID (from `../stat-calculator`):
`npx vite-node scripts/predict.ts -- 67520010 --2h [--attack <text>] [--anim <ids>] [--enemy <NpcParam ID>]`
prints each attack's stamina, cancels, and hits (damage, stance, buildup, frames from the press
and from the animation's start), assuming 99 in every stat (`--stat`), NG+1 (`--ng 0` for NG) and no
buffs.

## Build

Uses the C# 5 compiler that ships with Windows (.NET Framework 4):

    powershell.exe -NoProfile -Command "& \"$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe\" /nologo /optimize /platform:x64 /out:er-logger.exe Mem.cs Logger.cs"

Stop a running logger before rebuilding. `Probe.cs`, `EquipProbe.cs` and `Find.cs` (dump, value search, pointer
and code references, AOB check) are scratch programs for finding new fields (build one with Mem.cs instead of Logger.cs); `EquipProbe.cs` prints PlayerGameData changes
next to pad presses, which is how the equipment offsets were found.

## Notes

- The current animation is at `[[ChrIns+0x190]+0x18]+0xD0`. Offsets `+0x20..+0xB0` there are a
  10-frame history ring; reading a slot (e.g. `+0x40`) lags up to 9 frames.
- GameDataMan play time (`+0xA0`) changes once per frame but adds a flat 16 ms, so it counts frames
  rather than measuring time.

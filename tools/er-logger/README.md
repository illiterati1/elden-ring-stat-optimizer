# er-logger

A read-only memory logger for Elden Ring, for measuring attacks in game: frame timings, stamina
costs, damage, stance damage and status buildup.

It reads the game's memory from outside the process (no injection, no writes) about once per
millisecond and logs every change to a CSV, numbered by game frame: controller presses, player
animation/stamina/FP/HP, and every loaded enemy's HP, stance (super armor), toughness and status
buildup, plus the player's equipped weapons, their Ashes of War and arm style (`armstyle`,
`lweapon`, `rweapon`, `lash`, `rash`: logged at the start and on each change; an Ash is its
EquipParamGem ID, 0 for the weapon's own skill).

It was written to check this calculator's attack timings and damage against the game.

## Requirements

- Windows, with the game running **offline with Easy Anti-Cheat disabled** (for example through
  a mod launcher such as me3, or by starting `eldenring.exe` directly). EAC blocks other processes
  from reading the game's memory. Never run this with EAC on or online: reading game memory there
  risks a ban.
- The game version the offsets were found on (2026). Globals are found by AOB scan, but structure
  offsets may change with game updates.
- For `summarize.mjs` and `tae_windows.py`: WSL with Node 18+ and Python 3. They use the
  calculator's TAE reader and param data from this repo; `tae_windows.py` expects the game at the
  default Steam install path.

## Use

    er-logger.exe [outdir] [--for seconds]       # default outdir: %USERPROFILE%\Videos\er-logs
    node summarize.mjs [log.csv]                 # default: newest log in that folder

Log columns: `frame,ms,gametime,who,field,old,new,note`. Regenerating meters log drops, the first
rise ("recovering"), and "full".

The summary prints one line per player animation: the press, the animation start, the stamina drop
and each hit (damage, stance, buildup), checked against the animation's TAE hit windows
(`tae_windows.py`, which uses the calculator's `scripts/check_animations.py`). Stamina should
drop on the frame the first window whose behavior costs stamina opens, by that much (from the
weapon in use: the right hand's, or the left's when two-handing it; logs without the weapon match
any window's start); mismatches are marked ✗. Equipment changes are named from the calculator's
`public/saveItems.json`.

Equipment lines give each weapon's and Ash's logged ID in brackets. To compare with the
calculator, run `scripts/predict.ts` with that ID (from the repo root):
`npx vite-node scripts/predict.ts -- 67520010 --2h [--attack <text>] [--anim <ids>] [--enemy <NpcParam ID>]`
prints each attack's stamina, cancels, and hits (damage, stance, buildup, frames from the press
and from the animation's start), assuming 99 in every stat (`--stat`), NG+1 (`--ng 0` for NG) and no
buffs.

## Build

Uses the C# 5 compiler that ships with Windows (.NET Framework 4); no SDK needed. From WSL:

    powershell.exe -NoProfile -Command "& \"$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe\" /nologo /optimize /platform:x64 /out:er-logger.exe Mem.cs Logger.cs"

Stop a running logger before rebuilding. The other programs are tools for finding new fields; build
one by putting it in place of `Logger.cs` in the command above (it still needs `Mem.cs`):

- `Probe.cs`: scratch probe.
- `EquipProbe.cs`: prints PlayerGameData changes next to pad presses (how the equipment offsets
  were found).
- `Find.cs`: memory dump, value search, pointer and code references, AOB check.
- `ChrProbe.cs`: lists every character set and vector in WorldChrMan; given an NpcParam ID, finds
  that character anywhere in memory and the pointers to it.

## Notes

- The current animation is at `[[ChrIns+0x190]+0x18]+0xD0`. Offsets `+0x20..+0xB0` there are a
  10-frame history ring; reading a slot (e.g. `+0x40`) lags up to 9 frames.
- GameDataMan play time (`+0xA0`) changes once per frame but adds a flat 16 ms, so it counts frames
  rather than measuring time.
- Characters are read from WorldChrMan's character sets and its ChrIns vectors, so enemies spawned
  by mods (e.g. Boss Arena) are tracked too.

## License

MIT, under the repo's [LICENSE](../../LICENSE). Not affiliated with FromSoftware or Bandai Namco.

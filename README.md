# er-logger

Reads Elden Ring's memory (read-only, from outside the game) about once per millisecond and logs every
change to a CSV, numbered by game frame: controller presses, player animation/stamina/FP/HP, and every
loaded enemy's HP, stance (super armor), toughness and status buildup.

## Use

    er-logger.exe [outdir] [--for seconds]       # default outdir: %USERPROFILE%\Videos\er-logs
    node summarize.mjs [log.csv]                 # default: newest log

The summary prints one line per player animation: the press, the animation start, the stamina drop
and each hit (damage, stance, buildup), checked against the animation's TAE hit windows
(`tae_windows.py`, which uses the stat calculator's `scripts/check_animations.py`). Stamina should drop
on the frame the first window opens; mismatches are marked ✗.

## Build

Uses the C# 5 compiler that ships with Windows (.NET Framework 4):

    powershell.exe -NoProfile -Command "& \"$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe\" /nologo /optimize /platform:x64 /out:er-logger.exe Mem.cs Logger.cs"

Stop a running logger before rebuilding. `Probe.cs` is a scratch program for finding new fields
(build it with Mem.cs instead of Logger.cs).

## Notes

- The current animation is at `[[ChrIns+0x190]+0x18]+0xD0`. Offsets `+0x20..+0xB0` there are a
  10-frame history ring; reading a slot (e.g. `+0x40`) lags up to 9 frames.
- GameDataMan play time (`+0xA0`) changes once per frame but adds a flat 16 ms, so it counts frames
  rather than measuring time.

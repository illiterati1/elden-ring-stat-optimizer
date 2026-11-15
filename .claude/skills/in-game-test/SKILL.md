---
name: in-game-test
description: Record or investigate an in-game test result for the stat calculator — timing (frames from the press), stamina, damage, roll-outs, enemy stats — or pick the next test to run. Use when the user reports numbers seen in game ("X timing: l2 859, hit 996…", "X does 1234 on the dummy"), asks what to test next, or asks why a calculated value disagrees with the game.
---

# In-game tests

The user tests the calculator's predictions in game and reports raw numbers. Your job: compare them
with what the calculator says, find why any differ, fix the data or code, lock the result into a
test, and update the to-do lists.

## Where things live

- `data/in-game-tests.md` — predictions not yet checked in game, numbered (#), by section: Timing,
  Stamina, Damage, Discrepancies to look into, Roll-outs, Enemy scaling, Not timed. Its header says
  how tests are measured. New rows take the next unused number (check `git log -p` on the file too:
  numbers aren't reused).
- `known-issues.md` — public list of what's wrong or untested in the app (linked from the page).
  Update it when a test fixes or confirms an issue listed there, or finds a new one that won't be
  fixed now.
- `src/optimizer/optimizer.test.ts` — tested results, mostly as `it("matches <Skill> in game", …)`
  in `describe("Ashes of War")`. The comment says what was seen in game, the assertions pin the
  calculator's values (note when they're off by a frame or two: "164 … (162 here)").
- `scripts/build_ash_data.py` — skills' data and timing. Override tables, each with comments citing
  the in-game measurement: `HIT_TIME_FITS` and `MEASURED_HIT_TIMES` (projectile/AoE hit times),
  `CANCEL_FITS` (re-use and roll cancels), `ANIMATION_SEQUENCES` (several animations in a row, e.g. a
  tapped charged skill), `LOOP_FITS`, `LANDING_TIMES`, `READY_TIMES`, `ROW_REPEATS` (how many times a
  row hits), `ROW_FOLLOW_UPS` (rows' version/follow-up labels), `SKILL_NOTES`. Keys are usually
  `(skill name, part label)`; the label changes if the skill is split into versions.
- `scripts/check_animations.py` — weapon moveset timing and its tables; also the `Animations` reader.
- Memory: game data paths and how to dump animations (`game-data-paths`), the training dummy's stats
  (`training-dummy-npc`), and `todo-index` for all other to-do lists.

## Conventions

- Timings are frames at 60 fps from the press. The calculator adds a 2-frame delay before a step's
  animation (`STEP_START_DELAY`), so a table entry for something seen N frames after the press is
  `(N - 2) / 60` from the animation's start.
- Animations' own times are at 30 fps (TAE). Quick L2 cancel is flag 103, normal L2 is 104; which
  counts depends on SwordArtsParam `artsSpeedType` (`QUICK_SKILL_SPEED_TYPE`).
- A charged skill's animation 40000 is the start/charged one, 40001 often its tapped release, which
  starts when the charging SpEffect (100285) window opens. Ask which version was tested if unclear.
- Damage tests: usually +25 (or +10 for somber) with 99 in every stat on the Boss Arena training
  dummy (123.2 defense, no negation).
- Within 1–2 frames of the game counts as matching; record both numbers rather than fitting.

## Workflow

1. **Find the prediction.** Look the test up in `data/in-game-tests.md` and the existing test (if
   any). Get the calculator's current numbers by temporarily logging in the test (e.g.
   `stepTimes`, `hitTimes`, `cycleTimes`, `stamina`) and running
   `npx vitest run src/optimizer/optimizer.test.ts -t "<name>"`.
2. **If they differ, find why** from the game data rather than fitting blindly: the skill's
   animation file (600 + `swordArtsTypeNew`), its windows, cancels and charging start (see memory
   `game-data-paths`), and the generated `public/ashes.json` entry. Check you're timing the right
   animation/version. Ask the user only for what the data can't tell you (e.g. was that a second
   press?) — and say what you found first.
3. **Fix** in the build script (a cited override, or a real rule if it generalizes), rebuild with
   `python3 -I scripts/build_ash_data.py "<Game>"`, and check the diff of `public/ashes.json` only
   touches what you meant.
4. **Lock it in:** add the in-game numbers to the test's comment and assert the calculator's values.
5. **Update lists:** remove the row from `data/in-game-tests.md`; add rows for anything new left
   untested (e.g. the other version of a split skill); update `known-issues.md` if affected.
6. **Verify:** `npx vitest run`, `npx prettier --check` on changed files.
7. **Commit** straight to main (allowed), message like "Record <Skill>'s timing as tested", with
   the in-game numbers vs. calculated in the body.

When asked what to test next, suggest a few rows from `data/in-game-tests.md`, grouped by weapon so
one trip in game covers several.

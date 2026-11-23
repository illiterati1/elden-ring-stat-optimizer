// Summarise an er-logger CSV: one line per player animation (attack), with the press that started it,
// when stamina was spent, and each hit's damage and stance/buildup changes.
//
//   node summarize.mjs [log.csv]      default: newest log in %USERPROFILE%\Videos\er-logs
//
// Each attack is checked against its TAE hit windows (via tae_windows.py and the stat calculator's
// TAE reader): stamina should drop on the frame the first window whose behavior costs stamina opens, by that
// much (for logs without the equipped weapon, any window's start); each HP drop is shown after
// the window it falls in. Mismatches are marked ✗ and counted at the end.
//
// Offsets are game frames from the press ("+30") and from the animation start ("anim+29").
// If wall-clock time disagrees with the frame count by 2+ frames (a hitch), it's flagged with "~".
// (The log's gametime column is GameDataMan play time, which adds a flat 16 ms per frame: not a clock.)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = '/mnt/c/Users/USER/Videos/er-logs';
const file = process.argv[2] || path.join(dir, fs.readdirSync(dir).filter(f => f.endsWith('.csv')).sort().at(-1));
const [header, ...lines] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
const cols = header.split(',');
const ev = lines.map(l => { const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
for (const e of ev) { e.frame = +e.frame; e.ms = +e.ms; }
console.log(file);

const isPress = e => e.who === 'pad' && e.new === 'press';
const starts = ev.filter(e => e.who === 'player' && e.field === 'anim' && e.new !== '0');
const off = (from, e) => {
  const f = e.frame - from.frame, w = Math.round((e.ms - from.ms) / (1000 / 60));
  return Math.abs(w - f) >= 2 ? `+${f} (~${w} by wall clock)` : `+${f}`;
};

// The weapon each animation was done with: the right hand's, or the left's when two-handing it (logs
// from before 2026-11-22 20:55 don't have the equipment, so their stamina check matches any window)
const equipped = {};
let next = 0;
for (const s of starts) {
  for (; next < ev.length && ev[next].frame <= s.frame; next++) {
    const e = ev[next];
    if (e.who === 'player' && ['armstyle', 'lweapon', 'rweapon'].includes(e.field)) equipped[e.field] = e.new;
  }
  const weapon = equipped.armstyle === '2' ? equipped.lweapon : equipped.rweapon;
  s.key = weapon ? `${s.new}:${weapon}` : s.new;
}
const ids = [...new Set(starts.map(s => s.key))];
let tae = {};
try {
  tae = JSON.parse(execFileSync('python3', ['-I', new URL('tae_windows.py', import.meta.url).pathname, ...ids], { encoding: 'utf8' }));
} catch (e) { console.log('(TAE check unavailable: ' + e.message.split('\n')[0] + ')'); }
let checked = 0;
const badAttacks = new Set();

starts.forEach((s, i) => {
  const end = i + 1 < starts.length ? starts[i + 1].frame : Infinity;
  const press = ev.filter(e => isPress(e) && e.frame <= s.frame).at(-1);
  const seg = ev.filter(e => e.frame >= s.frame && e.frame < end);
  const parts = [];
  const ref = press || s;
  const rel = press && ev.find(e => e.who === 'pad' && e.field === press.field && e.new === 'release' && e.frame > press.frame);
  const held = rel ? ` held ${rel.frame - press.frame}` : '';
  const a = s;
  parts.push((press ? `${press.field} f${press.frame}${held} → anim ${s.new} ${off(press, a)}` : `anim ${s.new} f${a.frame}`));
  const st = seg.find(e => e.who === 'player' && e.field === 'stamina' && +e.note < 0);
  const t = tae[s.key], windows = t && t.windows.length ? t.windows : null;
  if (st) {
    let check = '';
    if (windows) {
      // Stamina is taken when the first window whose behavior costs any opens (an earlier one can be a
      // hitbox that costs and does nothing, e.g. Cursed-Blood Slice's judge 3900 push at 25, before
      // its slash at 68). Without the weapon (older logs) which ones cost isn't known, so any window's
      // start counts. Window starts are fractional frames: a drop less than a frame from one matches it
      const at = st.frame - a.frame;
      const costs = t.stamina, paying = costs ? costs.findIndex(c => c > 0) : -1;
      const near = w => Math.abs(at - w[0]) < 1;
      if (paying >= 0) {
        const want = windows[paying], d = Math.round((at - want[0]) * 10) / 10, cost = costs[paying];
        const ok = near(want) && cost === -st.note;
        checked++; if (!ok) badAttacks.add(i);
        const which = paying ? ` (window ${paying + 1}: the ${paying === 1 ? 'first costs' : 'earlier ones cost'} none)` : '';
        check = ok ? ` ✓ TAE ${want[0]}, ${cost}${which}`
          : ` ✗ TAE window opens ${want[0]}${which}, costing ${cost}` +
            (near(want) ? '' : ` (off by ${d > 0 ? '+' : ''}${d})`) + (cost === -st.note ? '' : ` (spent ${-st.note})`);
      } else {
        const w = windows.findIndex(near);
        checked++; if (w < 0) badAttacks.add(i);
        const d = Math.round((at - windows[0][0]) * 10) / 10;
        const why = costs ? '; its windows cost no stamina' : '; weapon not logged, so any window counts';
        check = w < 0 ? ` ✗ TAE window opens ${windows[0][0]} (off by ${d > 0 ? '+' : ''}${d}; no window opens then${why})`
          : ` ✓ TAE ${windows[w][0]}${w ? ` (window ${w + 1}${why})` : ''}`;
      }
    }
    parts.push(`stamina ${st.note} ${off(ref, st)} (anim${off(a, st)})${check}`);
  } else if (windows) parts.push(`no stamina drop (TAE window ${windows[0][0]})`);
  for (const h of seg.filter(e => e.who.startsWith('npc') && e.field === 'hp' && +e.note < 0)) {
    const same = seg.filter(e => e.who === h.who && e.frame === h.frame && e.field !== 'hp' && e.field !== 'anim' && e.note && e.note !== 'recovering' && e.note !== 'full');
    let win = '';
    if (windows) {
      const at = h.frame - a.frame, w = windows.filter(w => w[0] < at + 1).at(-1);
      win = w ? ` [window ${w[0]}${at >= w[0] ? "+" : ""}${Math.round((at - w[0]) * 10) / 10}]` : ` ✗ [before the first window, ${windows[0][0]}]`;
      if (!w) badAttacks.add(i);
    }
    parts.push(`hit ${off(ref, h)} (anim${off(a, h)})${win}: ${-h.note} dmg` + same.map(e => `, ${e.field} ${e.note}`).join(''));
  }
  // damage with no HP drop at the same time (e.g. status procs land later) shows as its own hit above
  if (!t && s.new) parts.push('(no TAE data)');
  console.log(parts.join('  |  '));
});
console.log(`TAE check: ${checked} attacks with a stamina drop; ${badAttacks.size ? badAttacks.size + ' disagree (✗)' : 'all match'}`);
// Logs from before 2026-11-22 20:25 read a 10-slot animation history (one slot per frame), so
// animation changes only showed up every 10 frames and starts are up to 9 frames late
if (starts.length >= 4 && new Set(starts.map(s => s.frame % 10)).size === 1)
  console.log('warning: every animation change in this log is on a frame ending in ' + starts[0].frame % 10 + ': it was recorded with the old, lagging animation field, so anim+N and the TAE check are off by up to 9 frames');

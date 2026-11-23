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
// Each press is also compared with the stat calculator (its scripts/predict.ts): the attack it
// could be whose damage is closest, assuming 99 in every stat and the NG+1 training dummy (--ng 0
// for NG, --stat N for other stats), no buffs. Damage within 1 and hit frames within 2 count as ✓.
//
//   node summarize.mjs [log.csv] [--ng 0] [--stat 80] [--no-calc]
//
// Offsets are game frames from the press ("+30") and from the animation start ("anim+29").
// If wall-clock time disagrees with the frame count by 2+ frames (a hitch), it's flagged with "~".
// (The log's gametime column is GameDataMan play time, which adds a flat 16 ms per frame: not a clock.)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = '/mnt/c/Users/USER/Videos/er-logs';
const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i < 0 ? null : argv.splice(i, name === '--no-calc' ? 1 : 2).at(-1); };
const ngFlag = flag('--ng'), statFlag = flag('--stat'), noCalc = flag('--no-calc') != null;
const file = argv[0] || path.join(dir, fs.readdirSync(dir).filter(f => f.endsWith('.csv')).sort().at(-1));
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
    if (e.who === 'player' && ['armstyle', 'lweapon', 'rweapon', 'lash', 'rash'].includes(e.field)) equipped[e.field] = e.new;
  }
  const left = equipped.armstyle === '2', weapon = left ? equipped.lweapon : equipped.rweapon;
  s.key = weapon ? `${s.new}:${weapon}` : s.new;
  s.equip = weapon && { weapon: +weapon, ash: +(left ? equipped.lash : equipped.rash) || 0, twoHanding: ['2', '3'].includes(equipped.armstyle) };
}
const ids = [...new Set(starts.map(s => s.key))];
let tae = {};
try {
  tae = JSON.parse(execFileSync('python3', ['-I', new URL('tae_windows.py', import.meta.url).pathname, ...ids], { encoding: 'utf8' }));
} catch (e) { console.log('(TAE check unavailable: ' + e.message.split('\n')[0] + ')'); }
let checked = 0;
const badAttacks = new Set();

// Equipment changes (and the starting equipment), by name from the stat calculator's saveItems.json,
// printed before the next animation's line
let names = { weapons: {}, ashes: {} };
try { names = JSON.parse(fs.readFileSync(new URL('../stat-calculator/public/saveItems.json', import.meta.url), 'utf8')); } catch {}
const AFFINITIES = ['', 'Heavy', 'Keen', 'Quality', 'Fire', 'Flame Art', 'Lightning', 'Sacred', 'Magic', 'Cold', 'Poison', 'Blood', 'Occult'];
const weaponName = id => {
  const n = +id, base = Math.floor(n / 10000) * 10000, affinity = Math.floor(n % 10000 / 100), level = n % 100;
  const name = names.weapons[base] || `weapon ${id}`;
  return n === 110000 ? 'Unarmed' : `${AFFINITIES[affinity] ? AFFINITIES[affinity] + ' ' : ''}${name} +${level}`;
};
const ashName = id => id === '0' ? 'its own skill' : id === '?' ? 'unknown Ash' : names.ashes[id] || `Ash ${id}`;
const equipEvents = ev.filter(e => e.who === 'player' && ['armstyle', 'lweapon', 'rweapon', 'lash', 'rash'].includes(e.field));
let shown = 0;
// Lines are collected, so each press's comparison with the calculator can go after its last one
const out = [];
const say = (text, start) => out.push({ text, start });
const showEquipment = upTo => {
  const now = {};
  while (shown < equipEvents.length && equipEvents[shown].frame <= upTo) { const e = equipEvents[shown++]; now[e.frame] = (now[e.frame] || []).concat(e); }
  for (const [frame, es] of Object.entries(now)) {
    const parts = [];
    for (const hand of ['r', 'l']) {
      const w = es.find(e => e.field === hand + 'weapon'), a = es.find(e => e.field === hand + 'ash');
      if (!w && !a) continue;
      const weapon = w ? w.new : equipEvents.filter(e => e.field === hand + 'weapon' && e.frame <= +frame).at(-1)?.new;
      // the Ash too when only the weapon changed (e.g. two weapons with their own skills, both 0)
      const ash = a ? a.new : equipEvents.filter(e => e.field === hand + 'ash' && e.frame <= +frame).at(-1)?.new;
      parts.push(`${hand === 'r' ? 'right' : 'left'} ${weapon ? weaponName(weapon) : '?'}` + (ash ? ` (${ashName(ash)})` : ''));
    }
    const style = es.find(e => e.field === 'armstyle');
    if (style) parts.push(['empty-handed', 'one-handed', 'two-handing left', 'two-handing right'][+style.new] || `arm style ${style.new}`);
    say(`equipment f${frame}: ${parts.join(', ')}`);
  }
};

starts.forEach((s, i) => {
  showEquipment(s.frame);
  const end = i + 1 < starts.length ? starts[i + 1].frame : Infinity;
  const press = ev.filter(e => isPress(e) && e.frame <= s.frame).at(-1);
  const seg = ev.filter(e => e.frame >= s.frame && e.frame < end);
  const parts = [];
  const ref = press || s;
  s.press = press;
  s.hits = [];
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
    s.hits.push({ frame: h.frame - ref.frame, damage: -h.note });
    parts.push(`hit ${off(ref, h)} (anim${off(a, h)})${win}: ${-h.note} dmg` + same.map(e => `, ${e.field} ${e.note}`).join(''));
  }
  // damage with no HP drop at the same time (e.g. status procs land later) shows as its own hit above
  if (!t && s.new) parts.push('(no TAE data)');
  say(parts.join('  |  '), s);
});
showEquipment(Infinity);
if (!noCalc) compareWithCalculator();
for (const { text } of out) console.log(text);
console.log(`TAE check: ${checked} attacks with a stamina drop; ${badAttacks.size ? badAttacks.size + ' disagree (✗)' : 'all match'}`);
// Logs from before 2026-11-22 20:25 read a 10-slot animation history (one slot per frame), so
// animation changes only showed up every 10 frames and starts are up to 9 frames late
if (starts.length >= 4 && new Set(starts.map(s => s.frame % 10)).size === 1)
  console.log('warning: every animation change in this log is on a frame ending in ' + starts[0].frame % 10 + ': it was recorded with the old, lagging animation field, so anim+N and the TAE check are off by up to 9 frames');

/**
 * Adds a line after each press's last animation: the calculator attack (of those its animations could
 * be) whose damage is closest to the press's hits, with each hit's damage and frame from the press
 */
function compareWithCalculator() {
  const groups = new Map();
  for (const s of starts) {
    if (!s.press || !s.equip) continue;
    const g = groups.get(s.press) || { ...s.equip, anims: [], hits: [], last: s };
    g.anims.push(+s.new); g.hits.push(...s.hits); g.last = s;
    groups.set(s.press, g);
  }
  const list = [...groups.values()].filter(g => g.hits.length);
  if (!list.length) return;
  let predicted;
  try {
    const calc = new URL('../stat-calculator/', import.meta.url).pathname;
    const args = ['vite-node', 'scripts/predict.ts', '--', ...(ngFlag != null ? ['--ng', ngFlag] : []), ...(statFlag != null ? ['--stat', statFlag] : [])];
    predicted = JSON.parse(execFileSync('npx', args, { cwd: calc, encoding: 'utf8', input: JSON.stringify(list.map(({ weapon, ash, twoHanding, anims }) => ({ weapon, ash, twoHanding, anims }))) }));
  } catch (e) { out.push({ text: '(calculator comparison unavailable: ' + e.message.split('\n')[0] + ')' }); return; }
  out.unshift({ text: `calculator: ${predicted.stat} in every stat, ${predicted.ngPlus ? 'NG+1' : 'NG'} dummy (${predicted.defense} defense), no buffs` });
  list.forEach((g, i) => {
    const candidates = predicted.results[i];
    let text;
    if (!candidates.length) text = '  calc: no attack in the calculator for these animations';
    else {
      // Each predicted hit is paired with a logged one of the same damage (within 1), nearest in time,
      // and the rest with the nearest unpaired one within 10 frames; the closest attack is the one
      // with the least damage unaccounted for (logged hits left over count half: e.g. ticks of an
      // earlier cast)
      const pair = c => {
        const used = new Set(), pairs = c.hits.map(() => null);
        const nearest = (j, ok) => {
          let best = -1;
          g.hits.forEach((h, k) => {
            if (used.has(k) || !ok(h)) return;
            const t = c.hits[j][3] ?? h.frame;
            if (best < 0 || Math.abs(h.frame - t) < Math.abs(g.hits[best].frame - t)) best = k;
          });
          if (best >= 0) { used.add(best); pairs[j] = g.hits[best]; }
        };
        c.hits.forEach(([damage], j) => nearest(j, h => Math.abs(h.damage - damage) <= 1));
        c.hits.forEach(([, , , frame], j) => { if (!pairs[j]) nearest(j, h => frame == null || Math.abs(h.frame - frame) <= 10); });
        const left = g.hits.filter((_, k) => !used.has(k));
        const cost = c.hits.reduce((d, [damage], j) => d + Math.abs(damage - (pairs[j]?.damage ?? 0)), 0)
          + left.reduce((d, h) => d + h.damage / 2, 0);
        return { pairs, left, cost };
      };
      const scored = candidates.map(c => ({ c, ...pair(c) }));
      const { c: best, pairs, left } = scored.reduce((a, b) => b.cost < a.cost ? b : a);
      const hits = best.hits.map(([damage, stance, status, frame], j) => {
        const seen = pairs[j];
        const dmg = seen ? (Math.abs(seen.damage - damage) <= 1 ? ' ✓' : ` ✗ (${seen.damage})`) : ' (not seen)';
        const time = frame == null ? '' : ` @+${frame}` + (seen ? (Math.abs(seen.frame - frame) <= 2 ? ' ✓' : ` ✗ (+${seen.frame})`) : '');
        const extra = [`stance ${stance}`, ...Object.entries(status).map(([k, v]) => `${k} ${v}`)].join(', ');
        return `${damage}${dmg}${time} (${extra})`;
      });
      const more = left.length ? `  |  not in the calculator: ${left.map(h => `${h.damage} @+${h.frame}`).join(', ')}` : '';
      text = `  calc ${best.label}: ${hits.join('  |  ')}${more}`;
    }
    const at = out.findIndex(o => o.start === g.last);
    out.splice(at + 1, 0, { text });
  });
}

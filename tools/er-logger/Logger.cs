// er-logger: polls Elden Ring's memory (read-only) about once per millisecond and logs every change
// to a CSV, numbered by game frame. Ctrl+C to stop.
//
//   er-logger.exe [outdir] [--for seconds]   default outdir: %USERPROFILE%\Videos\er-logs
//
// Frames are counted from GameDataMan's play-time clock, which advances once per game frame;
// gametime is that clock (ms since the log started), which also covers long frames.
// Meters that regenerate (stamina, stance, status resistance) log every drop, the first rise
// after a drop, and the moment they're full again, so recovery doesn't flood the log.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class Logger {
    [DllImport("winmm.dll")] static extern int timeBeginPeriod(int ms);
    [StructLayout(LayoutKind.Sequential)] struct XState { public uint Packet; public ushort Buttons; public byte LT, RT; public short LX, LY, RX, RY; }
    [DllImport("xinput1_4.dll")] static extern int XInputGetState(int i, out XState s);

    static readonly string[] Status = { "poison", "rot", "bleed", "blight", "frost", "sleep", "madness" };
    static readonly string[] Buttons = { "up", "down", "left", "right", "start", "select", "L3", "R3", "L1", "R1", "", "", "A", "B", "X", "Y" };

    class Chr {
        public long Ins, Data, Resist, SA, Tough, Anim; public string Name; public int Param;
        public Dictionary<string, double> Prev = new Dictionary<string, double>();
        public Dictionary<string, int> Trend = new Dictionary<string, int>(); // -1 dropping, +1 rising, 0 full
    }

    static Mem m; static long wcm, gdm, gaitem, chrSetVt;
    static StreamWriter log; static Stopwatch clock = Stopwatch.StartNew();
    static int frame = 0; static int lastPlayTime = int.MinValue, firstPlayTime = int.MinValue;
    static Dictionary<long, Chr> chrs = new Dictionary<long, Chr>();

    static void Emit(string who, string field, string oldV, string newV, string note) {
        string ms = clock.Elapsed.TotalMilliseconds.ToString("F1", CultureInfo.InvariantCulture);
        log.WriteLine(string.Join(",", frame.ToString(), ms, (lastPlayTime - firstPlayTime).ToString(), who, field, oldV, newV, note));
        Console.WriteLine("{0,6} {1,10}ms  {2,-22} {3,-14} {4} -> {5} {6}", frame, ms, who, field, oldV, newV, note);
    }

    static void Main(string[] args) {
        timeBeginPeriod(1);
        Thread.CurrentThread.Priority = ThreadPriority.Highest;
        double runFor = double.MaxValue; var rest = new List<string>();
        for (int i = 0; i < args.Length; i++) { if (args[i] == "--for") runFor = double.Parse(args[++i], CultureInfo.InvariantCulture); else rest.Add(args[i]); }
        args = rest.ToArray();
        string dir = args.Length > 0 ? args[0] : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Videos", "er-logs");
        Directory.CreateDirectory(dir);
        while ((m = Mem.Attach()) == null) { Console.WriteLine("waiting for eldenring.exe..."); Thread.Sleep(2000); }
        wcm = m.Rip(m.Scan("48 8B 05 ?? ?? ?? ?? 48 85 C0 74 0F 48 39 88"), 3, 7);
        gdm = m.Rip(m.Scan("48 8B 05 ?? ?? ?? ?? 48 85 C0 74 05 48 8B 40 58 C3 C3"), 3, 7);
        gaitem = m.Rip(m.Scan("48 8B 0D ?? ?? ?? ?? 8B 84 24 ?? ?? ?? ?? 41 83 C9 FF 3D FF FF FF 0F"), 3, 7);
        string path = Path.Combine(dir, DateTime.Now.ToString("yyyy-MM-dd HH-mm-ss") + ".csv");
        log = new StreamWriter(path) { AutoFlush = true };
        log.WriteLine("frame,ms,gametime,who,field,old,new,note");
        Console.WriteLine("logging to " + path + "  (Ctrl+C to stop)");
        Console.CancelKeyPress += (s, e) => { log.Flush(); };

        ushort prevButtons = 0; bool prevLT = false, prevRT = false; int pad = -1;
        long lastEnum = -100000;
        long lastStatus = 0, loops = 0;
        while (clock.Elapsed.TotalSeconds < runFor) {
            long now = clock.ElapsedMilliseconds;
            loops++;
            if (now - lastStatus >= 5000) { Console.WriteLine("[status] frame {0}, {1} characters tracked, {2} polls/s", frame, chrs.Count, loops * 1000 / Math.Max(1, now - lastStatus)); lastStatus = now; loops = 0; }
            // game frame
            int pt = m.I32(m.Ptr(gdm) + 0xA0);
            if (pt == int.MinValue) { Thread.Sleep(500); m = Mem.Attach() ?? m; continue; }
            if (pt != lastPlayTime) { if (firstPlayTime == int.MinValue) firstPlayTime = pt; frame++; lastPlayTime = pt; }
            // controller
            XState xs;
            if (pad < 0 || XInputGetState(pad, out xs) != 0) { pad = -1; for (int i = 0; i < 4 && pad < 0; i++) if (XInputGetState(i, out xs) == 0) pad = i; }
            if (pad >= 0 && XInputGetState(pad, out xs) == 0) {
                ushort changed = (ushort)(xs.Buttons ^ prevButtons);
                for (int bit = 0; bit < 16; bit++) if ((changed & (1 << bit)) != 0 && Buttons[bit] != "")
                    Emit("pad", Buttons[bit], "", (xs.Buttons & (1 << bit)) != 0 ? "press" : "release", "");
                prevButtons = xs.Buttons;
                bool lt = xs.LT > 30, rt = xs.RT > 30;
                if (lt != prevLT) Emit("pad", "L2", "", lt ? "press" : "release", "");
                if (rt != prevRT) Emit("pad", "R2", "", rt ? "press" : "release", "");
                prevLT = lt; prevRT = rt;
            }
            // characters: re-list every 500 ms, poll every loop
            if (now - lastEnum > 500) { Enumerate(); lastEnum = now; }
            foreach (var c in chrs.Values) Poll(c);
            PollEquipment();
            Thread.Sleep(1);
        }
        log.Close();
    }

    // Characters come from two kinds of list in WorldChrMan's first 0x20000 bytes: ChrSets (vtable
    // [WCM+10EE0], capacity +10, 16-byte entries +18; the world's map blocks) and vectors of ChrIns
    // pointers (begin, end; +1F1C8 holds every character). During a Leonine Misbegotten fight on
    // 2026-11-23 the sets held only the player and one junk entry, hence reading the vectors too.
    static bool InModule(long p) { return p >= m.Base && p < m.Base + m.Size; }
    static bool ValidChr(long ins) {
        if (ins < 0x10000 || (ins & 7) != 0 || !InModule(m.Ptr(ins))) return false;
        long mods = m.Ptr(ins + 0x190); if (mods == 0) return false;
        long data = m.Ptr(mods); if (data == 0) return false;
        var d = m.Read(data + 0x138, 8); if (d == null) return false;
        int hp = BitConverter.ToInt32(d, 0), maxHp = BitConverter.ToInt32(d, 4);
        return maxHp > 0 && maxHp < 100000000 && hp >= 0 && hp <= maxHp;
    }
    static void Add(long ins, long player, HashSet<long> seen) {
        if (ins == 0 || seen.Contains(ins)) return;
        if (!chrs.ContainsKey(ins)) {
            long mods = m.Ptr(ins + 0x190); if (mods == 0) return;
            var c = new Chr { Ins = ins, Param = m.I32(ins + 0x60) };
            c.Data = m.Ptr(mods + 0x0); c.Resist = m.Ptr(mods + 0x20); c.SA = m.Ptr(mods + 0x40); c.Tough = m.Ptr(mods + 0x48); c.Anim = m.Ptr(mods + 0x18);
            c.Name = ins == player ? "player" : "npc " + c.Param + "@" + (ins & 0xFFFFFF).ToString("X");
            chrs[ins] = c;
            Poll(c, true);
        }
        seen.Add(ins);
    }
    static void Enumerate() {
        long w = m.Ptr(wcm); if (w == 0) return;
        long player = m.Ptr(w + 0x1E508);
        if (chrSetVt == 0) chrSetVt = m.Ptr(w + 0x10EE0);
        var b = m.Read(w, 0x20000); if (b == null) return;
        var seen = new HashSet<long>();
        for (int o = 0; o + 0x20 <= b.Length; o += 8) {
            if (BitConverter.ToInt64(b, o) != chrSetVt) continue;
            int cap = BitConverter.ToInt32(b, o + 0x10); long ents = BitConverter.ToInt64(b, o + 0x18);
            if (cap <= 0 || cap > 4096 || ents == 0) continue;
            var eb = m.Read(ents, cap * 16); if (eb == null) continue;
            for (int i = 0; i < cap; i++) Add(BitConverter.ToInt64(eb, i * 16), player, seen);
        }
        for (int o = 0; o + 16 <= b.Length; o += 8) {
            long beg = BitConverter.ToInt64(b, o), end = BitConverter.ToInt64(b, o + 8);
            if (beg < 0x10000 || end <= beg || end - beg > 0x8000 || ((end - beg) & 7) != 0) continue;
            var vb = m.Read(beg, (int)(end - beg)); if (vb == null) continue;
            if (!ValidChr(BitConverter.ToInt64(vb, 0))) continue;
            bool ok = true;
            for (int i = 8; i < vb.Length && ok; i += 8) ok = ValidChr(BitConverter.ToInt64(vb, i));
            if (ok) for (int i = 0; i < vb.Length; i += 8) Add(BitConverter.ToInt64(vb, i), player, seen);
        }
        var gone = new List<long>(); foreach (var k in chrs.Keys) if (!seen.Contains(k)) gone.Add(k);
        foreach (var k in gone) chrs.Remove(k);
    }

    // equipment: PlayerGameData ([GameDataMan]+8) +324 arm style (0 empty, 1 one hand, 2 left two-handed,
    // 3 right two-handed), +328/+32C the left/right hand's current slot (0-2), +398 on the weapons'
    // EquipParamWeapon IDs (with affinity and upgrade level), left and right alternating per slot.
    // (The Hexinton 8.0.4 table has these 4 bytes later; found by watching them change on 2026-11-22.)
    // Each weapon's item handle is at +340 on (likewise), and the mounted Ash of War comes from the
    // item table (the static at that AOB: +8 + (handle & FFFF) * 8 points to the handle's object, with
    // the handle at +8 and the item ID at +C): a weapon's +28 is its Ash's handle (0: its own skill),
    // whose item ID less the 0x80000000 type bit is the EquipParamGem ID.
    // Logged once at the start and on every change, as player armstyle/lweapon/rweapon/lash/rash
    // (lash/rash: the EquipParamGem ID, or 0 for the weapon's own skill)
    static string[] prevEquip;
    static long Item(uint handle) {
        long table = m.Ptr(gaitem); if (table == 0 || handle == 0 || handle == 0xFFFFFFFF) return 0;
        long obj = m.Ptr(table + 8 + (handle & 0xFFFF) * 8);
        return obj != 0 && (uint)m.I32(obj + 8) == handle ? obj : 0;
    }
    static string Ash(uint weaponHandle) {
        long w = Item(weaponHandle); if (w == 0) return "?";
        uint gem = (uint)m.I32(w + 0x28); if (gem == 0) return "0";
        long g = Item(gem); if (g == 0) return "?";
        return ((uint)m.I32(g + 0xC) & 0x0FFFFFFF).ToString();
    }
    static void PollEquipment() {
        long pgd = m.Ptr(m.Ptr(gdm) + 0x8); if (pgd == 0) return;
        var b = m.Read(pgd + 0x324, 0x90); if (b == null) return;
        int lslot = BitConverter.ToInt32(b, 4), rslot = BitConverter.ToInt32(b, 8);
        if (lslot < 0 || lslot > 2 || rslot < 0 || rslot > 2) return;
        var now = new string[] {
            b[0].ToString(),
            BitConverter.ToInt32(b, 0x398 - 0x324 + lslot * 8).ToString(),
            BitConverter.ToInt32(b, 0x39C - 0x324 + rslot * 8).ToString(),
            Ash(BitConverter.ToUInt32(b, 0x340 - 0x324 + lslot * 8)),
            Ash(BitConverter.ToUInt32(b, 0x344 - 0x324 + rslot * 8)),
        };
        string[] names = { "armstyle", "lweapon", "rweapon", "lash", "rash" };
        bool first = prevEquip == null;
        for (int i = 0; i < now.Length; i++)
            if (first || prevEquip[i] != now[i]) Emit("player", names[i], first ? "" : prevEquip[i], now[i], first ? "start" : "");
        prevEquip = now;
        // The first rows are written, so presses from here on are logged
        if (first) Console.WriteLine("ready: logging, right weapon " + now[2] + ", left " + now[1]);
    }

    static void Poll(Chr c) { Poll(c, false); }
    static void Poll(Chr c, bool init) {
        bool isPlayer = c.Name == "player";
        var d = m.Read(c.Data + 0x138, 0x28); if (d == null) return;
        int hp = BitConverter.ToInt32(d, 0), maxHp = BitConverter.ToInt32(d, 4);
        Field(c, "hp", hp, maxHp, false, init);
        if (isPlayer) {
            Field(c, "fp", BitConverter.ToInt32(d, 0x10), BitConverter.ToInt32(d, 0x18), true, init);
            Field(c, "stamina", BitConverter.ToInt32(d, 0x1C), BitConverter.ToInt32(d, 0x20), true, init);
        } else {
            if (hp <= 0 && !init && c.Prev.ContainsKey("hp") && c.Prev["hp"] <= 0) return; // dead: nothing more to watch
            var r = m.Read(c.Resist + 0x10, 0x38);
            if (r != null) for (int i = 0; i < 7; i++) Field(c, Status[i], BitConverter.ToInt32(r, i * 4), BitConverter.ToInt32(r, 0x1C + i * 4), true, init);
            var sa = m.Read(c.SA + 0x10, 8);
            if (sa != null) Field(c, "stance", Math.Round(BitConverter.ToSingle(sa, 0), 2), BitConverter.ToSingle(sa, 4), true, init);
            var tg = m.Read(c.Tough + 0x10, 0xC);
            if (tg != null && BitConverter.ToSingle(tg, 8) > 0) Field(c, "toughness", Math.Round(BitConverter.ToSingle(tg, 0), 2), BitConverter.ToSingle(tg, 8), true, init);
        }
        // current animation: [[ChrIns+190]+18]+D0 (+20..+B0 is a 10-frame history ring, so a slot there lags up to 9 frames)
        int anim = m.I32(c.Anim + 0xD0);
        double pa;
        if (!c.Prev.TryGetValue("anim", out pa) || pa != anim) {
            if (!init && c.Prev.ContainsKey("anim") && (isPlayer || c.Prev.ContainsKey("active"))) Emit(c.Name, "anim", pa.ToString(), anim.ToString(), "");
            c.Prev["anim"] = anim;
        }
    }

    // meter: drops always logged; for regenerating meters only the first rise and reaching max
    static void Field(Chr c, string name, double v, double max, bool regen, bool init) {
        double p;
        if (!c.Prev.TryGetValue(name, out p)) { c.Prev[name] = v; c.Trend[name] = 0; return; }
        if (v == p) return;
        c.Prev[name] = v;
        if (init) return;
        c.Prev["active"] = 1; // this character has changed at least once: worth logging its animations
        string note = "";
        if (v < p) { c.Trend[name] = -1; note = (v - p).ToString(CultureInfo.InvariantCulture); }
        else if (!regen) note = "+" + (v - p).ToString(CultureInfo.InvariantCulture);
        else if (v >= max) { c.Trend[name] = 0; note = "full"; }
        else if (c.Trend[name] == -1) { c.Trend[name] = 1; note = "recovering"; }
        else return;
        Emit(c.Name, name, p.ToString(CultureInfo.InvariantCulture), v.ToString(CultureInfo.InvariantCulture), note);
    }
}

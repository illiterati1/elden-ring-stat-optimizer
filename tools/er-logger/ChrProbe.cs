// Scratch, read-only: chr-probe.exe — lists every ChrSet-like table reachable from WorldChrMan
// (inline in its first 0x20000 bytes, or one pointer away), with how many valid characters each holds.
using System;
using System.Collections.Generic;

public static class ChrProbe {
    static Mem m;
    static bool InModule(long p) { return p >= m.Base && p < m.Base + m.Size; }
    // a ChrIns: module vtable, modules at +190 -> data with sane HP
    static bool ValidChr(long ins, out int param, out int hp, out int maxHp) {
        param = hp = maxHp = 0;
        if (ins < 0x10000 || (ins & 7) != 0) return false;
        if (!InModule(m.Ptr(ins))) return false;
        long mods = m.Ptr(ins + 0x190); if (mods == 0) return false;
        long data = m.Ptr(mods); if (data == 0) return false;
        var d = m.Read(data + 0x138, 8); if (d == null) return false;
        hp = BitConverter.ToInt32(d, 0); maxHp = BitConverter.ToInt32(d, 4);
        param = m.I32(ins + 0x60);
        return maxHp > 0 && maxHp < 100000000 && hp >= 0 && hp <= maxHp;
    }
    // candidate set at a: vtable, cap at +10, entries (16 B) at +18
    static void TrySet(long a, string where, HashSet<long> done) {
        if (done.Contains(a)) return;
        var b = m.Read(a, 0x20); if (b == null) return;
        long vt = BitConverter.ToInt64(b, 0); if (!InModule(vt)) return;
        int cap = BitConverter.ToInt32(b, 0x10); long ents = BitConverter.ToInt64(b, 0x18);
        if (cap <= 0 || cap > 4096 || ents < 0x10000) return;
        var eb = m.Read(ents, cap * 16); if (eb == null) return;
        int n = 0; var sample = new List<string>();
        for (int i = 0; i < cap; i++) {
            long ins = BitConverter.ToInt64(eb, i * 16); if (ins == 0) continue;
            int p, hp, mx; if (!ValidChr(ins, out p, out hp, out mx)) return; // any bad entry: not a set
            n++; if (sample.Count < 6) sample.Add(p + " " + hp + "/" + mx);
        }
        if (n == 0) return;
        done.Add(a);
        Console.WriteLine("{0,-22} set {1:X} vt +{2:X} cap {3} chrs {4}: {5}", where, a, vt - m.Base, cap, n, string.Join(", ", sample));
    }
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct MBI { public long Base, AllocBase; public int AllocProtect, pad0; public long RegionSize; public int State, Protect, Type, pad1; }
    [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr addr, out MBI mbi, IntPtr len);
    static void Regions(Action<long, byte[]> f) {
        long a = 0x10000;
        while (a < 0x7FFFFFFF0000L) {
            MBI mbi;
            if (VirtualQueryEx(m.H, new IntPtr(a), out mbi, new IntPtr(System.Runtime.InteropServices.Marshal.SizeOf(typeof(MBI)))) == IntPtr.Zero) break;
            bool readable = mbi.State == 0x1000 && (mbi.Protect & 0x100) == 0 && (mbi.Protect & 0xEE) != 0;
            if (readable) for (long c = mbi.Base; c < mbi.Base + mbi.RegionSize; c += 0x1000000) {
                int n = (int)Math.Min(0x1000000, mbi.Base + mbi.RegionSize - c);
                var b = m.Read(c, n); if (b != null) f(c, b);
            }
            a = mbi.Base + mbi.RegionSize;
        }
    }
    // chr-probe.exe <NpcParam ID>: every valid ChrIns with that param, and every pointer to each
    static void FindParam(int want, long wcm) {
        var found = new List<long>();
        Regions((c, b) => { for (int o = 0; o + 0x68 <= b.Length; o += 8) if (BitConverter.ToInt32(b, o + 0x60) == want) {
            int p, hp, mx; if (ValidChr(c + o, out p, out hp, out mx)) { found.Add(c + o); Console.WriteLine("chr {0:X} hp {1}/{2}", c + o, hp, mx); } } });
        var set = new HashSet<long>(found);
        Regions((c, b) => { for (int o = 0; o + 8 <= b.Length; o += 8) { long v = BitConverter.ToInt64(b, o); if (set.Contains(v)) {
            long at = c + o; string rel = at >= wcm && at < wcm + 0x20000 ? " (WCM+" + (at - wcm).ToString("X") + ")" : "";
            Console.WriteLine("  ref to {0:X} at {1:X}{2}  [-0x20..]: {3:X} {4:X} {5:X} {6:X}", v, at, rel, m.Ptr(at - 0x20), m.Ptr(at - 0x18), m.Ptr(at - 0x10), m.Ptr(at - 8)); } } });
    }
    public static void Main(string[] args) {
        m = Mem.Attach();
        long wcm = m.Ptr(m.Rip(m.Scan("48 8B 05 ?? ?? ?? ?? 48 85 C0 74 0F 48 39 88"), 3, 7));
        Console.WriteLine("WCM {0:X}  player {1:X}  playerSetVt +{2:X}", wcm, m.Ptr(wcm + 0x1E508), m.Ptr(wcm + 0x10EE0) - m.Base);
        if (args.Length > 0) { FindParam(int.Parse(args[0]), wcm); return; }
        var b = m.Read(wcm, 0x20000);
        var done = new HashSet<long>();
        for (int o = 0; o + 0x20 <= b.Length; o += 8) TrySet(wcm + o, "inline +" + o.ToString("X"), done);
        for (int o = 0; o + 8 <= b.Length; o += 8) {
            long p = BitConverter.ToInt64(b, o);
            if (p < 0x10000 || InModule(p) || (p & 7) != 0 || (p >= wcm && p < wcm + 0x20000)) continue;
            TrySet(p, "ptr at +" + o.ToString("X"), done);
            // also a pointer to an array of set pointers
            var arr = m.Read(p, 0x400); if (arr == null) continue;
            for (int k = 0; k < 0x400; k += 8) {
                long q = BitConverter.ToInt64(arr, k);
                if (q < 0x10000 || InModule(q) || (q & 7) != 0) continue;
                TrySet(q, "[+" + o.ToString("X") + "]+" + k.ToString("X"), done);
            }
        }
        // vectors of ChrIns pointers (begin, end) in WCM
        for (int o = 0; o + 16 <= b.Length; o += 8) {
            long beg = BitConverter.ToInt64(b, o), end = BitConverter.ToInt64(b, o + 8);
            if (beg < 0x10000 || end <= beg || end - beg > 0x8000 || ((end - beg) & 7) != 0) continue;
            var vb = m.Read(beg, (int)(end - beg)); if (vb == null) continue;
            int n = 0; bool ok = true; var sample = new List<string>();
            for (int i = 0; i < vb.Length; i += 8) {
                int p, hp, mx; if (!ValidChr(BitConverter.ToInt64(vb, i), out p, out hp, out mx)) { ok = false; break; }
                n++; if (sample.Count < 6) sample.Add(p + " " + hp + "/" + mx);
            }
            if (ok && n > 0) Console.WriteLine("vector at +{0:X}: {1} chrs: {2}", o, n, string.Join(", ", sample));
        }
    }
}

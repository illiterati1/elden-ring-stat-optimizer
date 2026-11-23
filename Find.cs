using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
// Scratch, read-only: find.exe dump <hex offset> <hex length>    PlayerGameData ([GameDataMan]+8) as u32s
//                     find.exe search <u32> [u32 ...]            every 4-aligned run of these values in memory
//                     find.exe at <hex address> <hex length>     raw u32s at an address
//                     find.exe refs <hex address>                8-byte pointers to an address
public static class Find {
    [StructLayout(LayoutKind.Sequential)] struct MBI { public long Base, AllocBase; public int AllocProtect, pad0; public long RegionSize; public int State, Protect, Type, pad1; }
    [DllImport("kernel32.dll")] static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr addr, out MBI mbi, IntPtr len);
    static Mem m;
    static void Dump(long addr, int len, long label) {
        var b = m.Read(addr, len); if (b == null) { Console.WriteLine("unreadable"); return; }
        for (int o = 0; o + 4 <= b.Length; o += 4) {
            uint v = BitConverter.ToUInt32(b, o);
            Console.WriteLine("+{0:X4}  {1:X8}  {2}", label + o, v, (int)v);
        }
    }
    static void Regions(Action<long, byte[]> f) {
        long a = 0x10000;
        while (a < 0x7FFFFFFF0000L) {
            MBI mbi;
            if (VirtualQueryEx(m.H, new IntPtr(a), out mbi, new IntPtr(Marshal.SizeOf(typeof(MBI)))) == IntPtr.Zero) break;
            bool readable = mbi.State == 0x1000 && (mbi.Protect & 0x100) == 0 && (mbi.Protect & 0xEE) != 0;
            if (readable) {
                for (long c = mbi.Base; c < mbi.Base + mbi.RegionSize; c += 0x1000000) {
                    int n = (int)Math.Min(0x1000000, mbi.Base + mbi.RegionSize - c);
                    var b = m.Read(c, n); if (b != null) f(c, b);
                }
            }
            a = mbi.Base + mbi.RegionSize;
        }
    }
    public static void Main(string[] a) {
        m = Mem.Attach();
        long gdm = m.Ptr(m.Rip(m.Scan("48 8B 05 ?? ?? ?? ?? 48 85 C0 74 05 48 8B 40 58 C3 C3"), 3, 7));
        long pgd = m.Ptr(gdm + 8);
        Console.WriteLine("module {0:X}-{1:X}, PlayerGameData {2:X}", m.Base, m.Base + m.Size, pgd);
        if (a[0] == "dump") Dump(pgd + Convert.ToInt64(a[1], 16), Convert.ToInt32(a[2], 16), Convert.ToInt64(a[1], 16));
        else if (a[0] == "at") Dump(Convert.ToInt64(a[1], 16), Convert.ToInt32(a[2], 16), 0);
        else if (a[0] == "aob") {
            // every match of a pattern in the module, and its rip target (3, 7)
            var parts = a[1].Split(' '); var pat = new int[parts.Length];
            for (int i = 0; i < parts.Length; i++) pat[i] = parts[i] == "??" ? -1 : Convert.ToInt32(parts[i], 16);
            var b = m.Read(m.Base, m.Size); int n = 0;
            for (int i = 0; i + pat.Length <= b.Length; i++) {
                int j = 0; while (j < pat.Length && (pat[j] < 0 || b[i + j] == pat[j])) j++;
                if (j < pat.Length) continue;
                n++; Console.WriteLine("module+{0:X} -> {1:X}", i, m.Base + i + 7 + BitConverter.ToInt32(b, i + 3));
            }
            Console.WriteLine("{0} found", n);
        }
        else if (a[0] == "xref") {
            // rip-relative 7-byte movs/leas (48/4C 8B/8D modrm 05/0D/15/../3D) in the module whose target is the address
            long t = Convert.ToInt64(a[1], 16); var b = m.Read(m.Base, m.Size); int n = 0;
            for (int i = 0; i + 7 <= b.Length && n < 30; i++) {
                if ((b[i] != 0x48 && b[i] != 0x4C) || (b[i + 1] != 0x8B && b[i + 1] != 0x8D && b[i + 1] != 0x39 && b[i + 1] != 0x89) || (b[i + 2] & 0xC7) != 0x05) continue;
                if (m.Base + i + 7 + BitConverter.ToInt32(b, i + 3) != t) continue;
                n++;
                Console.WriteLine("module+{0:X}: {1}", i, BitConverter.ToString(b, i, Math.Min(32, b.Length - i)).Replace("-", " "));
            }
            Console.WriteLine("{0} found", n);
        }
        else if (a[0] == "search" || a[0] == "refs") {
            var want = new List<uint>();
            if (a[0] == "refs") { long t = Convert.ToInt64(a[1], 16); want.Add((uint)t); want.Add((uint)(t >> 32)); }
            else for (int i = 1; i < a.Length; i++) want.Add(a[i].StartsWith("0x") ? Convert.ToUInt32(a[i].Substring(2), 16) : (uint)Convert.ToInt64(a[i]));
            int found = 0;
            Regions((c, b) => {
                for (int o = 0; o + want.Count * 4 <= b.Length && found < 40; o += 4) {
                    int j = 0; while (j < want.Count && BitConverter.ToUInt32(b, o + j * 4) == want[j]) j++;
                    if (j < want.Count) continue;
                    found++;
                    long at = c + o;
                    string where = at >= m.Base && at < m.Base + m.Size ? string.Format(" (module+{0:X})", at - m.Base) : at >= pgd && at < pgd + 0x1000 ? string.Format(" (PlayerGameData+{0:X})", at - pgd) : "";
                    Console.WriteLine("{0:X}{1}", at, where);
                }
            });
            Console.WriteLine("{0} found", found);
        }
    }
}

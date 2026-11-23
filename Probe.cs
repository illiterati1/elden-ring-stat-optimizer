using System;
using System.Collections.Generic;
using System.Threading;
using System.Runtime.InteropServices;
// On an R1 press, snapshot the player's ChrIns, modules and the animation module's children every frame for
// 60 frames, then report ints that become an animation ID and floats that reset and count up, by frame.
public static class Probe {
    [DllImport("winmm.dll")] static extern int timeBeginPeriod(int ms);
    [StructLayout(LayoutKind.Sequential)] struct XState { public uint Packet; public ushort Buttons; public byte LT, RT; public short LX, LY, RX, RY; }
    [DllImport("xinput1_4.dll")] static extern int XInputGetState(int i, out XState s);
    static bool Heap(long v) { return v > 0x7FF000000000L && v < 0x7FFF00000000L; }
    public static void Main(string[] a) {
        timeBeginPeriod(1);
        Thread.CurrentThread.Priority = ThreadPriority.Highest;
        var m = Mem.Attach();
        long wcm = m.Ptr(m.Rip(m.Scan("48 8B 05 ?? ?? ?? ?? 48 85 C0 74 0F 48 39 88"), 3, 7));
        long gdm = m.Ptr(m.Rip(m.Scan("48 8B 05 ?? ?? ?? ?? 48 85 C0 74 05 48 8B 40 58 C3 C3"), 3, 7));
        long p = m.Ptr(wcm + 0x1E508), mods = m.Ptr(p + 0x190), data = m.Ptr(mods);
        var names = new List<string>(); var addrs = new List<long>(); var sizes = new List<int>();
        Action<string, long, int> add = (n, ad, sz) => { if (!addrs.Contains(ad)) { names.Add(n); addrs.Add(ad); sizes.Add(sz); } };
        add("chr", p, 0x2000);
        for (int o = 0; o < 0x100; o += 8) {
            long mod = m.Ptr(mods + o); if (!Heap(mod)) continue;
            add(string.Format("[+190]+{0:X}", o), mod, 0x1000);
            var mb = m.Read(mod, 0x400); if (mb == null) continue;
            for (int q = 0; q < 0x400; q += 8) { long s = BitConverter.ToInt64(mb, q); if (Heap(s)) add(string.Format("[[+190]+{0:X}]+{1:X}", o, q), s, 0x400); }
        }
        Console.WriteLine("{0} blocks. Press R1 in game...", addrs.Count);
        int pad = -1; XState xs; for (int i = 0; i < 4 && pad < 0; i++) if (XInputGetState(i, out xs) == 0) pad = i;
        while (true) { XInputGetState(pad, out xs); if ((xs.Buttons & 0x200) != 0) break; Thread.Sleep(1); }
        const int F = 60;
        var snaps = new byte[F][][]; var stam = new int[F];
        int last = m.I32(gdm + 0xA0), f = 0;
        while (f < F) {
            int t = m.I32(gdm + 0xA0);
            if (t != last) { last = t; Thread.Sleep(3); snaps[f] = new byte[addrs.Count][]; for (int i = 0; i < addrs.Count; i++) snaps[f][i] = m.Read(addrs[i], sizes[i]); stam[f] = m.I32(data + 0x154); f++; }
            Thread.Sleep(1);
        }
        int sf = -1; for (int k = 1; k < F; k++) if (stam[k] < stam[k - 1] && sf < 0) sf = k;
        Console.WriteLine("frames after press; stamina drop at {0}", sf);
        var found = new List<KeyValuePair<int, string>>();
        for (int i = 0; i < addrs.Count; i++) {
            for (int o = 0; o + 4 <= sizes[i]; o += 4) {
                bool ok = true; for (int k = 0; k < F; k++) if (snaps[k][i] == null) ok = false; if (!ok) break;
                // ints becoming an attack ID (29030000-ish or 30000-ish)
                for (int k = 1; k < F; k++) {
                    int v0 = BitConverter.ToInt32(snaps[k - 1][i], o), v = BitConverter.ToInt32(snaps[k][i], o);
                    if (v != v0 && (v == 29030000 || v == 30000 || v == 3030000)) { found.Add(new KeyValuePair<int, string>(k, string.Format("{0}+{1:X} int {2} -> {3}", names[i], o, v0, v))); break; }
                }
                // floats that drop to < 0.04 and then rise ~1/60 per frame for 4 frames
                for (int k = 1; k + 4 < F; k++) {
                    float v0 = BitConverter.ToSingle(snaps[k - 1][i], o), v = BitConverter.ToSingle(snaps[k][i], o);
                    if (!(v >= 0 && v < 0.04f && v0 > v + 0.03f && v0 < 1000)) continue;
                    bool rising = true; float pv = v;
                    for (int j = 1; j <= 4 && rising; j++) { float w = BitConverter.ToSingle(snaps[k + j][i], o); float d = w - pv; if (!(d > 0.01f && d < 0.025f)) rising = false; pv = w; }
                    if (rising) { found.Add(new KeyValuePair<int, string>(k, string.Format("{0}+{1:X} float {2:F4} -> {3:F4}, then {4:F4}", names[i], o, v0, v, pv))); break; }
                }
            }
        }
        found.Sort((x, y) => x.Key.CompareTo(y.Key));
        foreach (var kv in found) Console.WriteLine("frame {0,2}: {1}", kv.Key, kv.Value);
    }
}

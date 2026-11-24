using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Runtime.InteropServices;
// Scratch: watch PlayerGameData ([GameDataMan]+8) 0..0x1000 and print every 4-byte change, with pad
// presses, to find the arm style and current weapon slots. Offsets changing all the time are muted.
public static class EquipProbe {
    [StructLayout(LayoutKind.Sequential)] struct XState { public uint Packet; public ushort Buttons; public byte LT, RT; public short LX, LY, RX, RY; }
    [DllImport("xinput1_4.dll")] static extern int XInputGetState(int i, out XState s);
    static readonly string[] Buttons = { "up", "down", "left", "right", "start", "select", "L3", "R3", "L1", "R1", "", "", "A", "B", "X", "Y" };
    public static void Main(string[] a) {
        double secs = a.Length > 0 ? double.Parse(a[0]) : 120;
        var m = Mem.Attach();
        long gdm = m.Ptr(m.Rip(m.Scan("48 8B 05 ?? ?? ?? ?? 48 85 C0 74 05 48 8B 40 58 C3 C3"), 3, 7));
        long pgd = m.Ptr(gdm + 8);
        Console.WriteLine("PlayerGameData {0:X}", pgd);
        var prev = m.Read(pgd, 0x1000); var count = new Dictionary<int, int>();
        var clock = Stopwatch.StartNew(); ushort pb = 0; int pad = -1; XState xs;
        for (int i = 0; i < 4 && pad < 0; i++) if (XInputGetState(i, out xs) == 0) pad = i;
        while (clock.Elapsed.TotalSeconds < secs) {
            if (pad >= 0 && XInputGetState(pad, out xs) == 0) {
                ushort ch = (ushort)(xs.Buttons ^ pb);
                for (int bit = 0; bit < 16; bit++) if ((ch & (1 << bit)) != 0 && Buttons[bit] != "" && (xs.Buttons & (1 << bit)) != 0)
                    Console.WriteLine("{0,8:F2}s  press {1}", clock.Elapsed.TotalSeconds, Buttons[bit]);
                pb = xs.Buttons;
            }
            var b = m.Read(pgd, 0x1000);
            if (b != null) {
                for (int o = 0; o < 0x1000; o += 4) {
                    int v = BitConverter.ToInt32(b, o), p = BitConverter.ToInt32(prev, o);
                    if (v == p) continue;
                    int c; count.TryGetValue(o, out c); count[o] = ++c;
                    if (c <= 6) Console.WriteLine("{0,8:F2}s  +{1:X3}: {2} -> {3}{4}", clock.Elapsed.TotalSeconds, o, p, v, c == 6 ? "  (muted from now)" : "");
                }
                prev = b;
            }
            Thread.Sleep(10);
        }
    }
}

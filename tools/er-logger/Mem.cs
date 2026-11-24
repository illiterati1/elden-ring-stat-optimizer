// Read-only access to eldenring.exe memory.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class Mem {
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
    const int PROCESS_VM_READ = 0x10, PROCESS_QUERY_LIMITED = 0x1000;
    public IntPtr H; public long Base; public int Size;

    public static Mem Attach() {
        var ps = Process.GetProcessesByName("eldenring");
        if (ps.Length == 0) return null;
        var p = ps[0];
        var m = new Mem();
        m.H = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_LIMITED, false, p.Id);
        if (m.H == IntPtr.Zero) throw new Exception("OpenProcess failed");
        m.Base = p.MainModule.BaseAddress.ToInt64();
        m.Size = p.MainModule.ModuleMemorySize;
        return m;
    }
    public byte[] Read(long addr, int n) {
        var b = new byte[n]; IntPtr r;
        if (addr < 0x10000 || !ReadProcessMemory(H, new IntPtr(addr), b, new IntPtr(n), out r)) return null;
        return b;
    }
    public long Ptr(long addr) { var b = Read(addr, 8); return b == null ? 0 : BitConverter.ToInt64(b, 0); }
    public int I32(long addr) { var b = Read(addr, 4); return b == null ? int.MinValue : BitConverter.ToInt32(b, 0); }
    public float F32(long addr) { var b = Read(addr, 4); return b == null ? float.NaN : BitConverter.ToSingle(b, 0); }
    // follow CE-style pointer chain: [[[base]+o1]+o2]... last offset added without deref
    public long Chain(long baseAddr, params int[] offs) {
        long a = Ptr(baseAddr);
        for (int i = 0; i < offs.Length - 1; i++) { if (a == 0) return 0; a = Ptr(a + offs[i]); }
        return a == 0 ? 0 : a + offs[offs.Length - 1];
    }
    [StructLayout(LayoutKind.Sequential)] struct MBI { public long Base, AllocBase; public int AllocProtect, pad0; public long RegionSize; public int State, Protect, Type, pad1; }
    [DllImport("kernel32.dll")] static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr addr, out MBI mbi, IntPtr len);
    // AOB scan of the main module's committed, readable regions; '??' wildcards
    public long Scan(string pattern) {
        var parts = pattern.Split(' ');
        var pat = new int[parts.Length];
        for (int i = 0; i < parts.Length; i++) pat[i] = parts[i] == "??" ? -1 : Convert.ToInt32(parts[i], 16);
        long a = Base, end = Base + Size;
        while (a < end) {
            MBI mbi;
            if (VirtualQueryEx(H, new IntPtr(a), out mbi, new IntPtr(Marshal.SizeOf(typeof(MBI)))) == IntPtr.Zero) break;
            long rEnd = Math.Min(mbi.Base + mbi.RegionSize, end);
            bool readable = mbi.State == 0x1000 && (mbi.Protect & 0x100) == 0 && (mbi.Protect & 0xEE) != 0;
            if (readable) {
                var b = Read(a, (int)(rEnd - a));
                if (b != null) for (int i = 0; i + pat.Length <= b.Length; i++) {
                    int j = 0; while (j < pat.Length && (pat[j] < 0 || b[i + j] == pat[j])) j++;
                    if (j == pat.Length) return a + i;
                }
            }
            a = rEnd;
        }
        return 0;
    }
    // rip-relative target: instruction at a, disp32 at a+dispOff, instruction length len
    public long Rip(long a, int dispOff, int len) { return a + len + I32(a + dispOff); }
}

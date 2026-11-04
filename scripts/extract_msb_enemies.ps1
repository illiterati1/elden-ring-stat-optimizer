# Extract enemy placements (map, part name, NpcParam ID, CharaInitParam ID, position) from ELDEN
# RING .msb.dcx map files. The CharaInitParam ID sets level, attributes, and armor for human enemies.
# Positions are relative to the map tile, in meters.
#
# Base game maps are compressed with Oodle Kraken, which can only be decompressed with the game's
# own oo2core_6_win64.dll, so this runs in Windows PowerShell rather than Python.
#
# Usage (from PowerShell):
#   .\extract_msb_enemies.ps1 -GameDir "C:\...\ELDEN RING\Game" -OutFile "enemies.tsv"

param(
    [Parameter(Mandatory = $true)][string]$GameDir,
    [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = "Stop"

# DllImport needs a constant path, so the DLL is loaded by name after adding the game directory to
# the DLL search path
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text;

public static class MsbEnemies {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetDllDirectory(string path);

    [DllImport("oo2core_6_win64.dll")]
    static extern long OodleLZ_Decompress(byte[] compBuf, long compBufSize, byte[] rawBuf,
        long rawLen, int fuzzSafe, int checkCrc, int verbosity, IntPtr decBufBase, long decBufSize,
        IntPtr fpCallback, IntPtr callbackUserData, IntPtr decoderMemory, long decoderMemorySize,
        int threadPhase);

    public static void Init(string dllDir) {
        SetDllDirectory(dllDir);
    }

    static int ReadInt32BE(byte[] b, int o) {
        return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    }

    static byte[] Decompress(byte[] dcx) {
        if (Encoding.ASCII.GetString(dcx, 0, 4) != "DCX\0") throw new Exception("Not a DCX file");
        int rawSize = ReadInt32BE(dcx, 0x1C);
        int compSize = ReadInt32BE(dcx, 0x20);
        string format = Encoding.ASCII.GetString(dcx, 0x28, 4);
        byte[] comp = new byte[compSize];
        Array.Copy(dcx, 0x4C, comp, 0, compSize);
        byte[] raw = new byte[rawSize];

        if (format == "KRAK") {
            long n = OodleLZ_Decompress(comp, compSize, raw, rawSize, 1, 0, 0, IntPtr.Zero, 0,
                IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, 3);
            if (n != rawSize) throw new Exception("Oodle decompression failed");
        } else if (format == "DFLT") {
            // Skip the 2 byte zlib header
            using (var ms = new MemoryStream(comp, 2, compSize - 2))
            using (var ds = new DeflateStream(ms, CompressionMode.Decompress)) {
                int read = 0;
                while (read < rawSize) {
                    int r = ds.Read(raw, read, rawSize - read);
                    if (r == 0) break;
                    read += r;
                }
            }
        } else {
            throw new Exception("Unsupported DCX format " + format);
        }
        return raw;
    }

    static string ReadUtf16(byte[] b, long o) {
        long e = o;
        while (b[e] != 0 || b[e + 1] != 0) e += 2;
        return Encoding.Unicode.GetString(b, (int)o, (int)(e - o));
    }

    // Returns "partName\tnpcParamId\tcharaInitId\tx\ty\tz" for each enemy part (type 2) in the map
    public static List<string> Extract(string path) {
        byte[] data = Decompress(File.ReadAllBytes(path));
        var result = new List<string>();

        // Walk the param lists (MODEL, EVENT, POINT, ROUTE, LAYER, PARTS) to find the parts
        long off = 0x10;
        while (off != 0) {
            int count = BitConverter.ToInt32(data, (int)off + 4);
            string name = ReadUtf16(data, BitConverter.ToInt64(data, (int)off + 8));
            if (name == "PARTS_PARAM_ST") {
                for (int i = 0; i < count - 1; i++) {
                    long start = BitConverter.ToInt64(data, (int)off + 16 + 8 * i);
                    if (BitConverter.ToInt32(data, (int)start + 0x0C) != 2) continue;
                    string partName = ReadUtf16(data, start + BitConverter.ToInt64(data, (int)start));
                    long typeData = start + BitConverter.ToInt64(data, (int)start + 0x68);
                    int npcParamId = BitConverter.ToInt32(data, (int)typeData + 12);
                    int charaInitId = BitConverter.ToInt32(data, (int)typeData + 24);
                    var position = new string[3];
                    for (int k = 0; k < 3; k++) {
                        position[k] = BitConverter.ToSingle(data, (int)start + 0x20 + 4 * k)
                            .ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
                    }
                    result.Add(partName + "\t" + npcParamId + "\t" + charaInitId + "\t" + string.Join("\t", position));
                }
            }
            off = BitConverter.ToInt64(data, (int)off + 16 + 8 * (count - 1));
        }
        return result;
    }
}
"@

[MsbEnemies]::Init($GameDir)

$files = Get-ChildItem -Path (Join-Path $GameDir "map\mapstudio") -Filter "*.msb.dcx"
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("map`tpart`tnpcParamId`tcharaInitId`tx`ty`tz")
$failed = 0
foreach ($file in $files) {
    $map = $file.Name -replace "\.msb\.dcx$", ""
    try {
        foreach ($line in [MsbEnemies]::Extract($file.FullName)) {
            $lines.Add("$map`t$line")
        }
    } catch {
        $failed++
        Write-Warning "$($file.Name): $($_.Exception.Message)"
    }
}

[System.IO.File]::WriteAllLines($OutFile, $lines)
Write-Output "$($files.Count) maps, $($lines.Count - 1) enemy placements, $failed failed -> $OutFile"

"""
Extract files from Elden Ring's packed game archives (Data0-3.bdt, DLC.bdt) by path, e.g. the
player's animations, which aren't loose files in the game directory.

Usage:
  python3 -I scripts/extract_game_files.py <ELDEN RING Game dir> [--keys <UXM exe>] \
    [--witchy <WitchyBND.exe>] [path ...]

With no paths, extracts the player's animation archives (PLAYER_ANIMATIONS) into <Game>/chr. With
--witchy, unpacks each with WitchyBND (which decompresses their DCX_KRAK with the game's Oodle DLL)
into <Game>/chr/<name>-anibnd-dcx-wanibnd, where check_animations.py reads their .hkx files.

How it works:
  - Each archive's .bhd header lists its files by a hash of their path (path_hash), with where they
    are in the .bdt and the AES key for their encrypted ranges. The headers are RSA encrypted; DS
    Anim Studio leaves decrypted copies in <Game>/_DSAS_CACHE, which are used if they're there.
    Otherwise --keys decrypts them with the public keys in UXM Selective Unpack's exe (raw RSA, per
    key-sized block, without each block's first byte), trying each key until one gives "BHD5".
  - Paths are the game's, e.g. /chr/c0000_a0x.anibnd.dcx. UXM Selective Unpack's
    res/EldenRingDictionary.txt lists them all.
"""

import argparse
import os
import re
import struct
import subprocess
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.serialization import load_pem_public_key

ARCHIVES = {"data0": "Data0", "data1": "Data1", "data2": "Data2", "data3": "Data3", "dlc": "DLC"}
DSAS_CACHE = "_DSAS_CACHE"
# The player's animations (.hkx), by weapon type's animation file: c0000_a3x has a030-a039,
# c0000_dlc01/02 the DLC's (e.g. a058, the backhand blades'). c0000.anibnd.dcx has their .tae files.
PLAYER_ANIMATIONS = (
    [f"/chr/c0000_a00_{lod}.anibnd.dcx" for lod in ("hi", "md", "lo")]
    + [f"/chr/c0000_a{n}x.anibnd.dcx" for n in (0, 1, 2, 3, 4, 5, 6, 9)]
    + [f"/chr/c0000_dlc0{n}.anibnd.dcx" for n in (1, 2)]
)
ENTRY_SIZE = 0x28


def path_hash(path):
    """@returns a path's 64 bit hash, as Elden Ring's .bhd files list them"""
    value = 0
    for char in path.lower().replace("\\", "/"):
        value = (value * 0x85 + ord(char)) & 0xFFFFFFFFFFFFFFFF
    return value


def read_keys(uxm_exe):
    """@returns the RSA public keys (PEM) in UXM Selective Unpack's exe, which stores them as UTF-16"""
    text = open(uxm_exe, "rb").read().decode("utf-16-le", errors="ignore")
    return re.findall(r"-----BEGIN RSA PUBLIC KEY-----.*?-----END RSA PUBLIC KEY-----", text, re.S)


def decrypt_header(raw, keys):
    """@returns a .bhd header decrypted with whichever key gives a BHD5 header"""
    for pem in keys:
        numbers = load_pem_public_key(pem.encode()).public_numbers()
        size = (numbers.n.bit_length() + 7) // 8
        if len(raw) % size:
            continue
        block = lambda i: pow(int.from_bytes(raw[i:i + size], "big"), numbers.e, numbers.n).to_bytes(size, "big")[1:]
        if block(0)[:4] != b"BHD5":
            continue
        return b"".join(block(i) for i in range(0, len(raw), size))
    raise ValueError("No key decrypts the header")


class Archives:
    """The game's archives, their headers read as needed"""

    def __init__(self, game_dir, keys=None):
        self.game_dir = game_dir
        self.keys = keys
        self.headers = {}

    def get_header(self, name):
        """@returns (header data, {path hash: (padded size, size, offset, AES key offset)})"""
        if name not in self.headers:
            cached = os.path.join(self.game_dir, DSAS_CACHE, f"{name}.bhd")
            if os.path.exists(cached):
                data = open(cached, "rb").read()
            elif self.keys:
                data = decrypt_header(open(os.path.join(self.game_dir, f"{ARCHIVES[name]}.bhd"), "rb").read(), self.keys)
            else:
                sys.exit(f"No decrypted {name}.bhd in {DSAS_CACHE}: pass --keys <UXM Selective Unpack.exe>")
            if data[:4] != b"BHD5":
                raise ValueError(f"{name}.bhd isn't a BHD5 header")
            bucket_count, buckets_offset = struct.unpack_from("<ii", data, 0x10)
            entries = {}
            for bucket in range(bucket_count):
                count, offset = struct.unpack_from("<ii", data, buckets_offset + bucket * 8)
                for i in range(count):
                    hash_, padded, size, file_offset, _, aes = struct.unpack_from(
                        "<QiiqqQ", data, offset + i * ENTRY_SIZE
                    )
                    entries[hash_] = (padded, size, file_offset, aes)
            self.headers[name] = (data, entries)
        return self.headers[name]

    def read(self, path):
        """@returns a file's contents, decrypted, or None if no archive has it"""
        hash_ = path_hash(path)
        for name in ARCHIVES:
            header, entries = self.get_header(name)
            if hash_ not in entries:
                continue
            padded, size, offset, aes = entries[hash_]
            with open(os.path.join(self.game_dir, f"{ARCHIVES[name]}.bdt"), "rb") as file:
                file.seek(offset)
                data = bytearray(file.read(padded))
            if aes:
                key = header[aes:aes + 16]
                range_count = struct.unpack_from("<i", header, aes + 16)[0]
                for i in range(range_count):
                    start, end = struct.unpack_from("<qq", header, aes + 20 + i * 16)
                    if start == -1 or end <= start:
                        continue
                    decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
                    data[start:end] = decryptor.update(bytes(data[start:end])) + decryptor.finalize()
            # Sizes of 0 are unpadded files' (the padded size is the file's)
            return bytes(data[:size] if size else data)
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("game_dir")
    parser.add_argument("paths", nargs="*", default=PLAYER_ANIMATIONS)
    parser.add_argument("--keys", help="UXM Selective Unpack.exe, for the archives' RSA keys")
    parser.add_argument("--witchy", help="WitchyBND.exe, to unpack the extracted files")
    args = parser.parse_args()
    archives = Archives(args.game_dir, read_keys(args.keys) if args.keys else None)
    written = []
    for path in args.paths:
        data = archives.read(path)
        if data is None:
            print(f"{path}: not in any archive", file=sys.stderr)
            continue
        out = os.path.join(args.game_dir, *path.strip("/").split("/"))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "wb") as file:
            file.write(data)
        written.append(out)
        print(f"{path}: {len(data)} bytes")
    if args.witchy and written:
        # WitchyBND is a Windows program: give it Windows paths when running in WSL
        to_windows = lambda path: subprocess.check_output(["wslpath", "-w", path], text=True).strip()
        paths = [to_windows(path) for path in written] if args.witchy.startswith("/mnt/") else written
        subprocess.run([args.witchy, "-s", *paths], check=True)


if __name__ == "__main__":
    main()

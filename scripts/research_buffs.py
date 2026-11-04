import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_param import read_param
from extract_fmg import read_fmg
game, pdx, what = sys.argv[1:4]
def param(n, d=None):
    _, rows, _ = read_param(os.path.join(game, "regulation-bin", f"{n}.param"), os.path.join(pdx, "Defs", f"{d or n}.xml"), 11730034)
    return {r["id"]: r for r in rows}
sp = param("SpEffectParam", "SpEffect")
def names(fmg):
    out = {}
    msg = os.path.join(game, "msg", "engus")
    for folder in ["item-msgbnd-dcx", "item_dlc02-msgbnd-dcx"]:
        for suffix in ["", "_dlc01", "_dlc02"]:
            p = os.path.join(msg, folder, f"{fmg}{suffix}.fmg")
            if os.path.exists(p): out.update(read_fmg(p))
    return out
RATES = [f for f in next(iter(sp.values())) if any(x in f for x in ("AttackRate", "AttackPowerRate", "DmgCorrectRate")) and not f.startswith("def") and "stamina" not in f and "saAttack" not in f and "defObject" not in f]
FLAT = ["physicsAttackPower","magicAttackPower","fireAttackPower","thunderAttackPower","darkAttackPower"]
STATS = ["changeStrengthPoint","changeAgilityPoint","changeMagicPoint","changeFaithPoint","changeLuckPoint","addStrengthStatus","addDexterityStatus","addMagicStatus","addFaithStatus","addLuckStatus"]
def describe(eid, depth=0, seen=None):
    seen = seen if seen is not None else set()
    e = sp.get(eid)
    if not e or eid in seen or depth > 3: return []
    seen.add(eid)
    parts = []
    for f in RATES:
        if e[f] not in (1, 0) and abs(e[f] - 1) > 1e-6: parts.append(f"{f}={round(e[f],3)}")
    for f in FLAT + STATS:
        if f in e and e[f]: parts.append(f"{f}={e[f]}")
    conds = [f"sub{e[f]}" for f in ("magicSubCategoryChange1","magicSubCategoryChange2","magicSubCategoryChange3") if e.get(f)]
    if e.get("wepParamChange"): conds.append(f"wep{e['wepParamChange']}")
    if e.get("conditionHp", -1) not in (-1, 0, None): conds.append(f"hp<{e['conditionHp']}")
    if e.get("conditionHpRate", -1) not in (-1, 0, None): conds.append(f"hpRate{e['conditionHpRate']}")
    short = []
    for x in parts:
        k, v = x.split("=")
        k = k.replace("atkEnemyDmgCorrectRate_", "vsEnemy.").replace("atkPlayerDmgCorrectRate_", "vsPlayer.").replace("AttackPowerRate", "AP").replace("AttackRate", "Atk")
        short.append(f"{k}={v}")
    # collapse identical per-type values
    vals = {}
    for x in short:
        k, v = x.split("=")
        vals.setdefault((k.split(".")[0] if "." in k else k.rstrip("APtk").replace("physics","").replace("magic","").replace("fire","").replace("thunder","").replace("dark","") or k, v), []).append(k)
    out = [(eid, e.get("spCategory"), e.get("effectEndurance"), short if len(short) < 4 else [f"{k[0] or 'all'}={k[1]} x{len(v)}" for k, v in vals.items()], conds)] if parts else []
    for f in ("cycleOccurrenceSpEffectId", "replaceSpEffectId"):
        if e.get(f, -1) and e.get(f, -1) > 0: out += describe(e[f], depth + 1, seen)
    return out
if what == "talismans":
    acc = param("EquipParamAccessory"); n = names("AccessoryName")
    for i, r in sorted(acc.items()):
        if not n.get(i): continue
        found = []
        for f in ("refId", "residentSpEffectId1", "residentSpEffectId2", "residentSpEffectId3", "residentSpEffectId4"):
            if f in r and r[f] > 0: found += describe(r[f])
        if found: print(n[i], "|", "; ".join(f"{eid} {' '.join(p)} [{','.join(cd)}]" for eid, c, d, p, cd in found))

if what == "goods":
    goods = param("EquipParamGoods"); n = names("GoodsName")
    for i, r in sorted(goods.items()):
        if not n.get(i): continue
        found = []
        for f in ("refId_default", "refId_1"):
            if f in r and r[f] > 0: found += describe(r[f])
        if found: print(n[i], "|", "; ".join(f"{eid} dur{d} {' '.join(p)} [{','.join(cd)}]" for eid, c, d, p, cd in found))
if what in ("spells", "behaviors"):
    beh = param("BehaviorParam_PC", "BehaviorParam"); bul = param("Bullet", "BulletParam")
    def from_bullet(bid, depth=0):
        b = bul.get(bid); out = []
        if not b or depth > 4: return out
        for k in range(5):
            if b.get(f"spEffectId{k}", -1) > 0: out += describe(b[f"spEffectId{k}"])
        for f in ("HitBulletID", "intervalCreateBulletId"):
            if b.get(f, -1) > 0 and b[f] != bid: out += from_bullet(b[f], depth + 1)
        return out
    def from_behavior(bh):
        b = beh.get(bh)
        if not b: return []
        if b["refType"] == 2: return describe(b["refId"])
        if b["refType"] == 1: return from_bullet(b["refId"])
        return []
if what == "spells":
    mag = param("Magic", "MagicParam"); n = names("GoodsName")
    for i, r in sorted(mag.items()):
        if not n.get(i): continue
        found = []
        for k in range(1, 11):
            ref, cat = r.get(f"refId{k}", -1), r.get(f"refCategory{k}", 0)
            if ref and ref > 0:
                found += from_bullet(ref) if cat == 1 else describe(ref) if cat == 2 else []
        uniq = {}
        for f in found: uniq[f[0]] = f
        if uniq: print(n[i], "|", "; ".join(f"{eid} dur{d} cat{c} {' '.join(p)} [{','.join(cd)}]" for eid, c, d, p, cd in uniq.values()))
if what == "probe":
    mag = param("Magic", "MagicParam"); n = names("GoodsName"); beh = param("BehaviorParam_PC", "BehaviorParam"); bul = param("Bullet", "BulletParam")
    for i, r in mag.items():
        if n.get(i) in ("Golden Vow", "Flame, Grant Me Strength", "Bloodflame Blade", "Terra Magica"):
            refs = {k: v for k, v in r.items() if "ref" in k.lower() and v not in (-1, 0)}
            print(n[i], i, refs, {k: r[k] for k in list(r)[:8]})
            for v in refs.values():
                print("   ", v, "behavior" if v in beh else "", "bullet" if v in bul else "", "speffect" if v in sp else "")
if what == "runes":
    goods = param("EquipParamGoods"); n = names("GoodsName")
    for i, r in goods.items():
        if n.get(i) and "Great Rune" in n[i]:
            print(n[i], i, {k: v for k, v in r.items() if ("ref" in k.lower() or "speffect" in k.lower()) and v not in (-1, 0)})
    print("600:", describe(600), "1850:", describe(1850))
if what == "armor":
    prot = param("EquipParamProtector"); n = names("ProtectorName")
    print([k for k in next(iter(prot.values())) if "speffect" in k.lower() or "Equip" in k][:20])
    count = 0
    for i, r in sorted(prot.items()):
        if not n.get(i): continue
        found = []
        for f in ("residentSpEffectId", "residentSpEffectId2", "residentSpEffectId3"):
            if r.get(f, -1) > 0: found += describe(r[f])
        if found:
            count += 1
            if count < 40: print(n[i], "|", "; ".join(f"{eid} {' '.join(p)} [{','.join(cd)}]" for eid, c, d, p, cd in found))
    print(count, "armor pieces")

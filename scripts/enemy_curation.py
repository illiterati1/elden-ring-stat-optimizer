"""
Cleaning up the enemy picker's entries (see build_enemy_data.py), per the user's review of each
area: entries with identical stats are merged, entries sharing a name get an identifier, and edits
by hand (ENEMY_EDITS) delete, rename, move, or label entries.

Rules (from the user):
  - No HP or "#1" in names: entries that share a name in an area get a real identifier (a weapon,
    clothing, or a place), by hand where known, or else the nearest site of grace ("near ...")
  - Two entries that differ only in their name are merged: the simpler name if one is the other
    plus a parenthesized identifier ("Exile" and "Exile (Sword)"), or else both names combined
  - If an area has "Entity" and "Entity (Foo)" with different stats, "Entity" gets an identifier
    too
  - What can't be resolved is listed with where it is relative to the nearest grace
    (data/enemy-locations.md), for identifying by hand
"""

import math
import re
from collections import Counter

# Bosses are tagged "[Boss]" in names (the picker leaves it out)
BOSS_TAG = " [Boss]"

COMPASS = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
]


def base_name(name):
    """@returns a name without its boss tag"""
    return name.replace(BOSS_TAG, "")


def split_identifier(name):
    """@returns a name's main part and its parenthesized identifier (or None)"""
    match = re.fullmatch(r"(.*?) \(([^()]*)\)", base_name(name))
    return (match.group(1), match.group(2)) if match else (base_name(name), None)


def with_identifier(name, identifier):
    """@returns a name with an identifier added to its own (in one pair of parentheses)"""
    main, own = split_identifier(name)
    boss = BOSS_TAG if BOSS_TAG in name else ""
    combined = f"{own}, {identifier}" if own else identifier
    return f"{main}{boss} ({combined})"


def offset(location):
    """
    @param location a placement's (grace, east, up, north, compass) from build_enemy_data.py's
    locate()
    @returns where it is from its grace, e.g. "120 m NNW, 5 m up" (16-point compass directions in the
    open world, or x/z offsets on other maps' own axes)
    """
    _, east, up, north, compass = location
    distance = math.hypot(east, north)
    height = f", {abs(up):.0f} m {'up' if up > 0 else 'down'}" if abs(up) >= 5 else ""
    if compass:
        if distance < 5:
            return f"at the grace{height}"
        angle = math.degrees(math.atan2(east, north)) % 360
        return f"{distance:.0f} m {COMPASS[round(angle / 22.5) % 16]}{height}"
    return f"x {east:+.0f}, z {north:+.0f}{height}"


def describe(location):
    """@returns where a placement is, e.g. "120 m NNW of The First Step, 5 m up", see offset"""
    if location is None:
        return "no grace in its map"
    return f"{offset(location)} from {location[0]}"


def nearest_grace(placements):
    """@returns the grace most of an entry's placements are nearest to, or None"""
    graces = Counter(location[0] for _, location, _ in placements if location)
    return graces.most_common(1)[0][0] if graces else None


def stats_key(enemy):
    """@returns what makes two entries the same enemy, apart from their names"""
    return (
        tuple(enemy["defense"]),
        tuple(enemy["negation"]),
        enemy["hp"],
        tuple(enemy.get("types", [])),
        bool(enemy.get("friendly")),
        bool(enemy.get("boss")),
        bool(enemy.get("neutral")),
        tuple(enemy["ripostes"]),
        enemy.get("criticalDamageRate", 1),
        enemy.get("poiseDamageRate", 1),
        enemy.get("poiseNote"),
    )


def merged_name(names):
    """
    @returns one name for entries that differ only in their names: the simplest if the others are it
    plus an identifier, or else all of them combined
    """
    names = sorted(set(names), key=lambda name: (len(name), name))
    if len(names) == 1:
        return names[0]
    mains = {split_identifier(name)[0] for name in names}
    if len(mains) == 1:
        main = mains.pop()
        boss = any(BOSS_TAG in name for name in names)
        # The one without an identifier if there is one, or else the shared main name
        plain = next((name for name in names if split_identifier(name)[1] is None), None)
        return plain or (f"{main}{BOSS_TAG}" if boss else main)
    # (one boss tag for all of them)
    boss = BOSS_TAG if any(BOSS_TAG in name for name in names) else ""
    combined = " / ".join(dict.fromkeys(base_name(name) for name in names))
    if boss:
        main, identifier = split_identifier(combined)
        return f"{main}{boss}" + (f" ({identifier})" if identifier else "")
    return combined


def merge_identical(enemies, placements, merged_looks=()):
    """
    Merges an area's entries that differ only in their names, in place. Entries of the same name that
    look different (their model's parts shown) stay apart, and so does the rest of their group, but
    only if that name is ambiguous anyway (shared by entries with different stats): otherwise looks
    don't matter (the user's call: too many entries)
    """
    # Names shared by entries with different stats in the same section of the picker
    def section(enemy):
        return next((c for c in ["friendly", "boss", "neutral"] if enemy.get(c)), "enemy")

    stats_by_name = {}
    for enemy in enemies.values():
        stats_by_name.setdefault((section(enemy), base_name(enemy["name"])), set()).add(stats_key(enemy))
    # (except names whose looks are merged by hand)
    ambiguous = {
        name
        for name, stats in stats_by_name.items()
        if len(stats) > 1 and name[1] not in merged_looks
    }
    groups = {}
    for key, enemy in list(enemies.items()):
        # (entries split by hand stay apart)
        if enemy.get("separate"):
            continue
        groups.setdefault(stats_key(enemy), []).append(key)
    for keys in groups.values():
        looks = {}
        for key in keys:
            name = (section(enemies[key]), base_name(enemies[key]["name"]))
            if name in ambiguous:
                looks.setdefault(name, set()).add(enemies[key].get("appearance"))
        # (neutral wildlife is told apart by HP alone)
        neutral = enemies[keys[0]].get("neutral")
        if not neutral and any(len(appearances) > 1 for appearances in looks.values()):
            continue
        if len(keys) < 2:
            continue
        first = enemies[keys[0]]
        first["name"] = merged_name([enemies[key]["name"] for key in keys])
        for key in keys[1:]:
            other = enemies.pop(key)
            first["npcParamIds"] += [i for i in other["npcParamIds"] if i not in first["npcParamIds"]]
            first["parts"] = {**other.get("parts", {}), **first.get("parts", {})}
            placements[id(first)] += placements.pop(id(other), [])


def identify(area_name, enemies, placements, labels, unresolved):
    """
    Gives entries that share a name in an area an identifier, in place: a label by hand (labels, by
    area and NpcParam ID), or else "Type 1", "Type 2", etc. (by HP), until they're identified. Those
    are added to unresolved.
    """
    # Labels by hand apply wherever the NpcParam ID is
    for enemy in enemies.values():
        label = next(
            (labels[(area_name, i)] for i in enemy["npcParamIds"] if (area_name, i) in labels), None
        )
        if label is None:
            label = next(
                (
                    labels[(area_name, "chara", c)]
                    for c in enemy.get("charaInits", [])
                    if (area_name, "chara", c) in labels
                ),
                None,
            )
        # (an empty label keeps the plain name, e.g. "Silver Tear" beside "Silver Tear (Lightning)")
        if label is not None:
            if label:
                enemy["name"] = with_identifier(enemy["name"], label)
            enemy["labeled"] = True
    # Entries a label made the same (e.g. two outfits of one kind) are one
    same = {}
    for key, enemy in list(enemies.items()):
        if not enemy.get("labeled"):
            continue
        other_key = same.setdefault((enemy["name"], stats_key(enemy)), key)
        if other_key != key:
            other = enemies[other_key]
            other["npcParamIds"] += [i for i in enemy["npcParamIds"] if i not in other["npcParamIds"]]
            other["parts"] = {**enemy.get("parts", {}), **other.get("parts", {})}
            placements[id(other)] += placements.pop(id(enemy), [])
            del enemies[key]

    # The picker lists bosses, enemies, neutral, and friendly characters in their own sections, so a
    # name only clashes within one
    def category(enemy):
        return next((c for c in ["friendly", "boss", "neutral"] if enemy.get(c)), "enemy")

    def conflicts():
        by_name = {}
        for enemy in enemies.values():
            by_name.setdefault((category(enemy), base_name(enemy["name"])), []).append(enemy)
        clashing = [group for group in by_name.values() if len(group) > 1]
        # "Entity" beside "Entity (Foo)" (different stats, or they'd have been merged)
        # (not for neutral wildlife: its identifiers are enough, e.g. "Albinauric Crab" beside
        # "Albinauric Crab (Golden Tuffs)")
        for (section, name), group in by_name.items():
            if (
                section != "neutral"
                and split_identifier(name)[1] is None
                and not all(enemy.get("labeled") for enemy in group)
                and any(
                    other_section == section and split_identifier(other)[0] == name and other != name
                    for other_section, other in by_name
                )
            ):
                clashing.append(group)
        # Neutral wildlife sharing a name with part of a combined one ("Sheep", "Deer / Sheep")
        neutral = [(name, group) for (section, name), group in by_name.items() if section == "neutral"]
        for name, group in neutral:
            parts = set(name.split(" / "))
            if any(other != name and parts & set(other.split(" / ")) for other, _ in neutral):
                clashing.append(group)
        # (each group once, though several rules can find it)
        return list({tuple(id(enemy) for enemy in group): group for group in clashing}.values())

    for group in conflicts():
        for number, enemy in enumerate(
            sorted(group, key=lambda e: (e["hp"], e["npcParamIds"][0])), start=1
        ):
            # Neutral wildlife is just marked with its HP (the user's call)
            if category(enemy) == "neutral":
                enemy["name"] = with_identifier(enemy["name"], f"{enemy['hp']:,} HP")
                continue
            enemy["name"] = with_identifier(enemy["name"], f"Type {number}")
            unresolved.append((area_name, enemy))


def report(unresolved, placements):
    """
    @returns data/enemy-locations.md's text: each area's unresolved entries ("Type 1" etc.), then
    their placements clustered by the nearest grace, nearest first
    """
    lines = [
        "# Enemies to identify",
        "",
        "Entries that share a name in their area, numbered as types until they're identified. Each",
        "area lists its types, then where they're placed, by the nearest site of grace. Directions are",
        "16-point compass directions (+x east, +z north, on every map). Distances are horizontal.",
    ]
    by_area = {}
    for area_name, enemy in unresolved:
        by_area.setdefault(area_name, []).append(enemy)
    for area_name in sorted(by_area):
        # (in natural order: Type 2 before Type 10)
        enemies = sorted(
            by_area[area_name],
            key=lambda e: [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", e["name"])],
        )
        lines += ["", f"## {area_name}", ""]
        for enemy in enemies:
            ids = ", ".join(str(i) for i in enemy["npcParamIds"])
            ng_plus = f" (NG+ {enemy['ngPlusHp']})" if enemy.get("ngPlusHp") else ""
            # Each look it covers (its rows' model parts shown)
            looks = dict.fromkeys(tuple(parts) for parts in enemy.get("parts", {}).values())
            shown = (
                ", parts shown " + " | ".join(", ".join(str(p) for p in look) or "none" for look in looks)
                if any(looks)
                else ""
            )
            lines.append(f"- **{enemy['name']}**: {enemy['hp']} HP{ng_plus}, NpcParam {ids}{shown}")
        # Placements by grace (the same placement can be listed twice, in two versions of its map)
        clusters = {}
        for enemy in enemies:
            for _, location, _ in placements.get(id(enemy), []):
                grace = location[0] if location else None
                clusters.setdefault(grace, {})[(describe(location), enemy["name"])] = location
        for grace in sorted(clusters, key=lambda g: (g is None, g or "")):
            lines += ["", f"### {grace or 'No grace in its map'}", ""]
            entries = sorted(
                clusters[grace].items(),
                key=lambda item: math.hypot(item[1][1], item[1][3]) if item[1] else 0,
            )
            for (_, name), location in entries:
                lines.append(f"- {offset(location) if location else 'somewhere'}: {name}")
    return "\n".join(lines) + "\n"


def rename(name, new):
    """
    @param new a new main name (keeping the boss tag and identifier), or (pattern, replacement) for a
    regular expression on the whole name
    """
    if isinstance(new, tuple):
        return re.sub(new[0], new[1], name)
    _, identifier = split_identifier(name)
    boss = BOSS_TAG if BOSS_TAG in name else ""
    return f"{new}{boss}" + (f" ({identifier})" if identifier else "")


def matches(enemy, area_name, match, is_dlc):
    """
    @param match what an edit applies to: "area" (its area's name), "name" (with or without its boss
    tag), "name_re" (a regular expression), "hp", "ids" (any of these NpcParam IDs), "friendly", "dlc"
    """
    if "area" in match and area_name != match["area"]:
        return False
    if "name" in match and match["name"] not in (enemy["name"], base_name(enemy["name"])):
        return False
    if "name_re" in match and not re.search(match["name_re"], enemy["name"]):
        return False
    if "hp" in match and enemy["hp"] != match["hp"]:
        return False
    if "ids" in match and not set(match["ids"]) & set(enemy["npcParamIds"]):
        return False
    if "friendly" in match and bool(enemy.get("friendly")) != match["friendly"]:
        return False
    if "dlc" in match and is_dlc(enemy) != match["dlc"]:
        return False
    return True


def apply_edits(areas, placements, edits, is_dlc):
    """
    Applies edits by hand to areas' entries, in order, in place. Each is (action, match, ...):
      - ("delete", match)
      - ("rename", match, new name or (pattern, replacement), see rename)
      - ("set", match, fields): sets fields (e.g. {"boss": True}), removing those set to None
      - ("move", match, area name): moves it to another area
      - ("split", match, {NpcParam ID: name}): makes those IDs their own entries with those names
      - ("region", {"area": name}, region): moves an area to another region
    """
    for action, match, *args in edits:
        if action == "region":
            areas[match["area"]]["region"] = args[0]
            continue
        for area in list(areas.values()):
            for key, enemy in list(area["enemies"].items()):
                if not matches(enemy, area["name"], match, is_dlc):
                    continue
                if action == "delete":
                    del area["enemies"][key]
                elif action == "rename":
                    enemy["name"] = rename(enemy["name"], args[0])
                elif action == "set":
                    for field, value in args[0].items():
                        if value is None:
                            enemy.pop(field, None)
                        else:
                            enemy[field] = value
                elif action == "move" and area["name"] != args[0]:
                    del area["enemies"][key]
                    areas[args[0]]["enemies"][(key, "moved", area["name"])] = enemy
                elif action == "split":
                    for npc_param_id, name in args[0].items():
                        if npc_param_id not in enemy["npcParamIds"]:
                            continue
                        copy = {**enemy, "name": name, "npcParamIds": [npc_param_id], "separate": True}
                        enemy["separate"] = True
                        enemy["npcParamIds"] = [i for i in enemy["npcParamIds"] if i != npc_param_id]
                        area["enemies"][(key, "split", npc_param_id)] = copy
                        placements[id(copy)] = [p for p in placements[id(enemy)] if p[2] == npc_param_id]
                        placements[id(enemy)] = [p for p in placements[id(enemy)] if p[2] != npc_param_id]
                    if not enemy["npcParamIds"]:
                        del area["enemies"][key]


def where_is(areas, placements, queries):
    """@returns the report's section answering where entries are: (area, name, hp or None)"""
    lines = ["", "# Where is...", ""]
    for area_name, name, hp in queries:
        found = [
            (area["name"], enemy)
            for area in areas.values()
            for enemy in area["enemies"].values()
            if split_identifier(enemy["name"])[0] == split_identifier(name)[0]
            and (hp is None or enemy["hp"] == hp)
            and (area_name is None or area["name"] == area_name)
        ]
        lines.append(f"- **{name}**" + (f" ({hp} HP)" if hp else "") + f", {area_name or 'anywhere'}:")
        if not found:
            lines.append("  - not found")
        for where_area, enemy in found:
            ids = ", ".join(str(i) for i in enemy["npcParamIds"])
            friendly = ", friendly" if enemy.get("friendly") else ""
            lines.append(
                f"  - {enemy['name']} ({where_area}): {enemy['hp']} HP{friendly}, NpcParam {ids}"
            )
            for where in dict.fromkeys(
                describe(location) for _, location, _ in placements.get(id(enemy), [])
            ):
                lines.append(f"    - {where}")
    return "\n".join(lines) + "\n"

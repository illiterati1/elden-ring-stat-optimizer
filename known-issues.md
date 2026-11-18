# Known issues

- **Powerstanced Serpent Flails with Flare, O Serpent:** the jumping L1's damage is slightly higher
  than in game.
- **Powerstancing with Flare, O Serpent:** the left-hand weapon's explosions are counted for any
  powerstanced weapon, not only a second Serpent Flail.
- **Lifesteal Fist:** its damage is inaccurate.
- **Attacks that need extra movement:** time-scaled numbers are questionable for any attack that
  needs another action first, such as jumping, rolling, backstepping, running, or buffing.
- **Untimed attacks:** backstabs, ripostes, shields' mounted R2, bow and crossbow jump shots,
  Carian Retaliation, Lifesteal Fist, Spinning Chain's loop, and how often Feeble Lord's Frenzied
  Flame can be repeated haven't been timed yet.
- **Crouching attacks:** most weapons have no crouching attack animation of their own, so they're
  assumed to play their rolling attack (tested on several, e.g. the Dagger, Falx, Dark Moon
  Greatsword, and powerstanced Sword Lances). This is untested for the two handed crouching R1 of
  the Starscourge Greatsword, both Greatswords of Radahn, and the Ornamental Straight Sword, and
  the timing of the Broadsword's, Cane Sword's, and Stone-Sheathed Sword's.
- **Feint attacks:** the attacks that follow a cancelled charged R2 aren't included. The motion
  value spreadsheet has them for Thrusting Swords, Heavy Thrusting Swords, Curved Swords, Great
  Katanas, Perfume Bottles, Beast Claws, the Smithscript Cirque, Claws of Night, and the
  Smithscript Dagger.
- **Unverified timings:** many attack timings and stamina costs haven't been checked in game yet.
- **NG+ stats:** enemies' NG+ HP and defenses match the datamining spreadsheet's, but haven't been
  tested in game. HP after beating Radahn can be 1 off, as can a few enemies' NG+ HP (e.g.
  Omenkillers in Scadu Altus).
- **Human enemies' defenses:** NPC invaders and other human enemies (183 of them) have defenses 1–2
  higher than the datamining spreadsheet's, at every NG+ level. Which is right is untested.
- **Fia's Champion (Staff):** its HP is 833, but 1,216 in the datamining spreadsheet.
- **Enemy status resistance:** enemies' status resistances aren't included, so status buildup
  can't be compared against them.
- **Off by one:** some hits come out 1 lower than in game, mostly with stacked damage buffs or
  hits that mix damage types.
- **Damage breakdown:** the breakdown tooltip on a result can differ slightly from its total,
  since the total rounds each hit down and the breakdown rounds each damage type. Its attack
  power column is also confusing: it shows the weapon's attack power, while the damage column is
  after each hit's motion values and defenses, so the two often don't visibly relate (e.g. Kick,
  which ignores the weapon's attack power).
- **Powerstance off-hand weapon:** its own passive or fixed skill's buff isn't applied to its
  hits unless picked separately in Buffs.
- **Deadly Poison Spray:** its buildup's decay (5 a second) isn't counted.
- **Ice Lightning Sword:** the stomp's lightning is about 4% lower than in game.
- **Deflecting Hardtear:** not supported yet, so its attack power boost after a deflection
  can't be applied.
- **Buff uptime:** buffs are assumed to always be on. Only Black Flame Blade's and Flare, O
  Serpent's recast time is counted in damage per second. Black Flame Blade's cast speeds up with
  Dex from 10 to 70 (tested in game).

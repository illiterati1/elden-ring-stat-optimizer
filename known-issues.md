# Known issues

- **Powerstancing with Flare, O Serpent:** the left-hand weapon's explosions are counted for any
  powerstanced weapon, not only a second Serpent Flail.
- **Attacks that need extra movement:** time-scaled numbers are questionable for any attack that
  needs another action first, such as jumping, rolling, backstepping, running, or buffing.
- **Untimed attacks:** shields' mounted R2 and Carian Retaliation haven't been timed yet.
- **Feint attacks:** the attacks that follow a cancelled charged R2 aren't included. The motion
  value spreadsheet has them for Thrusting Swords, Heavy Thrusting Swords, Curved Swords, Great
  Katanas, Perfume Bottles, Beast Claws, the Smithscript Cirque, Claws of Night, and the
  Smithscript Dagger.
- **Unverified timings:** many attack timings and stamina costs haven't been checked in game yet.
- **Human enemies' defenses:** NPC invaders and other human enemies (183 of them) have defenses 1–2
  higher than the datamining spreadsheet's, at every NG+ level. Which is right is untested.
- **Fia's Champion (Staff):** its HP is 833, but 1,216 in the datamining spreadsheet.
- **Stance-broken enemies:** hits on a stance-broken enemy do 1.2× damage, which isn't included.
- **Unaware enemies:** hits on an enemy that hasn't noticed you do 1.2× damage, which isn't
  included.
- **Enemy status resistance:** enemies' status resistances aren't included, so status buildup
  can't be compared against them.
- **Off by one:** some hits come out 1 lower than in game, mostly with stacked damage buffs or
  hits that mix damage types.
- **Overlapping black flame and Destined Death:** when several hits' burns overlap (e.g. Black
  Flame Tornado fully charged), ticks landing together are assumed to line up, which can make
  them a little higher than in game (2% on a 7,813 HP Omenkiller). Burns from different steps of a
  chain (e.g. Black Flame Blade's R1s) aren't added up together, which can make them a little lower.
- **Damage breakdown:** the breakdown tooltip on a result can differ slightly from its total,
  since the total rounds each hit down and the breakdown rounds each damage type. Its attack
  power column is also confusing: it shows the weapon's attack power, while the damage column is
  after each hit's motion values and defenses, so the two often don't visibly relate (e.g. Kick,
  which ignores the weapon's attack power).
- **Powerstance off-hand weapon:** its own passive or fixed skill's buff isn't applied to its
  hits unless picked separately in Buffs.
- **Deadly Poison Spray:** its buildup's decay (5 a second) isn't counted.
- **Deflecting Hardtear:** not supported yet, so its attack power boost after a deflection
  can't be applied.
- **Buff uptime:** buffs are assumed to always be on. Only Black Flame Blade's and Flare, O
  Serpent's recast time is counted in damage per second. Black Flame Blade's cast speeds up with
  Dex from 10 to 70 (tested in game).
- **Save file live updates on Linux and Mac:** the hard link the Save File panel suggests is
  untested there. If the game under Proton or CrossOver saves by writing a new file rather than
  rewriting the old one in place (as it does on Windows), the link stops updating after the first
  save. A save on a Steam Deck SD card can't have live updates at all.

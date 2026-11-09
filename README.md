# COMMANDO FOREVER

A modern 2.5D top-down shooter reimagining of the classic vertical-scrolling jungle run, built entirely with **Three.js**, the **Web Audio API**, vanilla ES modules and Vite. Each deployment is an endless, seeded run through shuffled biome chapters with escalating threat. The interface is a Commodore 64-inspired blue-screen HUD with chunky pixel borders and Press Start 2P type. No external art or audio files are required — every mesh, texture, particle, sound effect and bar of music is generated at runtime.

![status](https://img.shields.io/badge/status-playable-c8f06c) ![engine](https://img.shields.io/badge/three.js-0.181-ffb454) ![build](https://img.shields.io/badge/vite-8.3-ffb454)


PLAY NOW **https://ne1.net/commando/**
---

## Quick start

Requirements: **Node.js 20.19+** and a modern WebGL2 browser.

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite provides hot reload; the game boots into the briefing screen and starts on click.

Production build and preview:

```bash
npm run build
npm run preview
```

The static output lives in `dist/`. Serve it from any static host. If your environment exposes a `site` command, point it at the Vite dev server (`npm run dev`) or the `dist/` output; the project is a standard Vite app.

### Deploying to a subdirectory

The build uses relative asset paths (`base: './'`), so it works from any nested web folder without a rewrite rule. Copy the **contents of `dist/`** — `index.html` plus the `assets/` folder — into the target folder. Do not deploy the project-root `index.html`: it references `/src/style.css` and `/src/main.js` and only works through the Vite dev server.

Other scripts:

| Command | Description |
| --- | --- |
| `npm run dev` / `npm start` | Vite dev server with live reload |
| `npm run build` | Production bundle |
| `npm run preview` | Serve the production bundle locally |

---

## Controls

### Keyboard + mouse

| Input | Action |
| --- | --- |
| `W A S D` / arrow keys | 360° movement |
| Mouse | Aim on the terrain plane |
| Hold `LMB` | Fire the equipped weapon |
| `1` / `2` / `3` | Switch to the carried light, assault or heavy/utility weapon |
| `RMB` / `G` | Throw a frag grenade at the cursor (hold RMB to keep throwing) |
| `V` / `F` | Close-quarters shove (stagger and knock back nearby enemies) |
| `E` | Enter a dungeon / use the exit portal |
| `X` | Cycle the three carried weapon slots |
| `Esc` / `P` | Pause / resume |
| `C` | Toggle the CRT post-process filter |
| `M` | Mute / unmute |
| `Enter` | Deploy / resume / redeploy |

### Gamepad (standard mapping)

| Input | Action |
| --- | --- |
| Left stick | Move |
| Right stick | Aim |
| Right trigger (`RT`) | Fire |
| Left trigger (`LT`) | Grenade |
| `B` / Circle | Close-quarters shove |
| `Y` / Triangle | Enter dungeon / use exit portal |
| D-pad | Select weapon category slot |
| Start | Pause |

Aim magnetism makes steep-perspective aiming forgiving on both mouse and stick, while the ground reticle remains honest about range.

### Touch (iPhone / iPad / Android)

On a touch device the game switches to a twin-stick layout: left pad moves, right pad aims and auto-fires while displaced, and the bottom-centre buttons handle **FRAG**, **SHOVE**, **USE / ENTER** and the weapon cycle. A dedicated pause button sits in the top-right corner. The HUD, overlays, camera resolution and weather density scale down automatically, and safe-area insets keep controls clear of notches and home indicators.

---

## The run

Every deployment is a seeded endless run through a shuffled sequence of biome chapters — **jungle**, **river delta**, **desert**, **ruined city**, **frozen pass**, **dense forest**, **blackwater swamp** and **open grassland**. The camera scrolls only forward; the screen bottom is the point of no return, and the only finish line is your best distance.

- Fight riflemen, heavy gunners, mortar teams, officers, biome specialists and armored command vehicles, all dressed for their local biome.
- Weapon slots are grouped into three carried categories: **light** (pistols, revolvers, SMGs), **assault** (rifles, laser and plasma weapons) and **heavy/utility** (machine guns, shotguns, launchers). Pick up a weapon in a category and it replaces the one you carry there; switch with `1`–`3`.
- Biome specialists change the rhythm of each leg: delta and swamp **sappers** rush in with satchel charges, desert and grassland **fanatics** press the assault, city and forest **marksmen** paint you with a laser before firing, and snow **hunters** pounce through the whiteout.
- Recover armory caches to find the **M1911**, **.357 Python**, **MP40**, **M1A1 Thompson**, **M16A1**, **AK-47**, **M14**, **M1918A2 BAR**, **M870**, **M60**, **M79**, **RPG-7**, **M2 Flamethrower**, **Toxin Mortar**, **Davy Crockett tactical nuke**, **LR-7 Lance laser rifle** and **M41A Pulse Rifle**, plus joke issue hardware like the **Toy Pop Gun**, **Rubber Band Rifle** and **Spud Gun**. Trucks and officers also drop replacement weapons.
- Dense fog banks roll through some biomes and random stretches of every chapter. Fog is now rendered as a distance-layered volumetric pass: the ground around the soldier stays readable while the far corridor dissolves into drifting haze. The HUD and audio beds shift when the fog closes in.
- Optional **dungeon entrances** are seeded onto the route — cave mouths, bunker hatches, sewer grates, foundry doors and armory vaults. Walk close and press `E` / **USE** to descend into a randomized underground zone with its own rooms, guards, chests, loot and exit portal. Six themes and five modifiers (cursed, treasure trove, blackout, elite guard and standard) change the risk and reward.
- Urban chapters now build tight destructible city blocks, alternating corner walls and street clutter. Buildings stop bullets, so you have to move around corners to get a shot. High-calibre rounds, rockets, grenade launchers, fuel barrels and demolition explosions can blow structures apart; destroyed blocks leave rubble and open new sightlines.
- New hardpoints: **RPG-7** rockets with a heavy blast and smoke trail, **M2 Flamethrower** continuous fire cones, **LR-7 Lance** hitscan laser beams, **M41A Pulse Rifle** glowing plasma bolts, **Toxin Mortar** volumetric organic poison clouds that billow, swirl and linger over an area, and the **Davy Crockett** tactical nuke — a screen-shaking, white-out blast that blinds you for several seconds after detonation.
- Obstacle variety is much wider: boulders, fallen logs, jersey barriers, pipe stacks, crater cover, wrecks, dumpsters, market crates and destructible walls are mixed into every chapter.
- Weapon caches are colour-coded by category and carry a floating name plate, so you can read the exact gun and walk past the ones you do not want.
- Build up your soldier along the route: armor caches raise maximum health and reduce incoming damage, while calibration kits permanently increase the damage of every equipped weapon. Command trucks can drop both as catch-up upgrades.
- Civilians — including women and children — wander the battlefield in bright civilian clothing and flee from gunfire and enemies. They can be shot, but every civilian killed costs one reinforcement and a chunk of score. They are never targeted by enemy fire.
- Weather shifts with the terrain: monsoon rain in the delta, dust storms in the desert, lightning storms in the city, snowfall in the frozen pass, murk in the swamp and open light in the grassland.
- Use sandbags, palm trunks, wrecks, concrete and bunkers as cover. Low cover reduces incoming damage if the shooter is on the exposed side; a **COVER** chip confirms protection.
- Hold position for a moment to **brace**: tighter spread, softer recoil, faster regeneration and quicker grenade recovery. The HUD shows **BRACED** when active.
- Break kill chains for score multipliers. `×2` starts after three rapid kills.
- Collect health and grenade crates dropped by officers and trucks.
- Threat tiers rise with distance: enemies get faster, spawn more often and field more specialists, heavies, mortars and armored vehicles. Your own movement speed and the camera scroll ramp up with distance too, while music intensity climbs as the run deepens. Best distance and score are saved between runs.

You have three lives, four grenades and one weapon in each carried category at deployment — an **M1911**, **M16A1** and **M60**. Health slowly regenerates after a lull in incoming fire. Barrels detonate, enemy mortar shells are telegraphed by red ground markers, and command trucks deploy reinforcements while you fight them.

---

## Feature tour

### Presentation

- Steep 60° perspective chase camera tuned to feel like a 2.5D vertical scroller, with the player held about three-quarters down the frame.
- Eight seamlessly blended biome palettes: procedural jungle, dense forest, river delta, blackwater swamp, desert sand, open grassland, cracked city concrete and wind-packed snow, each with its own normal map, fog, sun mood and road tint.
- Biome dressing: palms and dense undergrowth, forest logs, swamp dead trees and reeds, desert cacti and mesas, grassland flowers and hay bales, ruined city blocks and street lamps, snow pines, drifts and frozen river crossings.
- Weather system with rain squalls, snow, blowing dust and lightning — plus wet-weather audio beds, thunder, snow boot-print decals and biome entry briefings.
- Procedural PBR ground, road, sandbags, wood, metal and ice with normal maps.
- `PCFSoftShadowMap` key-light shadows, warm directional sun, cool camera-side fill, muzzle flash, explosion and lightning point lights.
- Bloom + ACES filmic tone mapping through an `EffectComposer`, plus a depth-texture volumetric fog pass that fades in from the player outward.
- Layered procedural dungeon art: tile seams, standing water, wall trim, ceiling beams, pillars, crates, rubble, braziers, glowing chests and animated descent/exit portals.
- Vertex-coloured, merged, low-draw-call soldiers with animated legs and two-bone IK arms that visibly grip each weapon.
- Instanced vegetation, rocks, reeds, bushes, cacti, pines, rubble, sandbags, crates and barricades.
- Rivers, frozen bridges, bunkers, tents, watchtowers, ruins and burning wrecks.
- Procedural particle system (one-draw-call point pools) for dust, sparks, fire, smoke, blood, debris, shockwaves and expanding blast blobs.
- Dynamic screen feedback: proximity-based camera trauma, damage flash, low-health pulse, lightning screen flash, vignette, film grain and hit markers.

### Combat

- Full vector movement with acceleration/friction, not 8-way snapping.
- Smooth 360° aim interpolation toward mouse or right stick.
- Twenty procedurally modelled weapons in three carried categories: **light** (M1911, .357 Python, MP40, M1A1 Thompson, Toy Pop Gun), **assault** (M16A1, AK-47, M14, M1918A2 BAR, Rubber Band Rifle, LR-7 Lance, M41A Pulse Rifle) and **heavy/utility** (M60, M870, M79, Spud Gun, RPG-7, M2 Flamethrower, Toxin Mortar, Davy Crockett).
- Weapon-specific fire rates, spread, tracers, muzzle flashes, screen shake and distinct synthesized reports for every gun.
- Energy weapons add a pooled additive laser-beam system, plasma burst impacts and emissive muzzle emitters; the flamethrower projects a dense, long-range 22 m flame jet with white-hot core blobs, rolling smoke, embers and a forward burn cone; the toxin mortar leaves a lingering damage-over-time cloud; the tactical nuke adds a mushroom-cloud particle event, extended shockwave rings, a hard trauma spike and a timed white-out blind overlay.
- Armory caches in the level and weapon drops from officers and command trucks replace the carried weapon in that category; switch with `1`–`3` or the gamepad D-pad.
- Progressive field upgrades: four armor tiers add max health and damage resistance, while three weapon calibration tiers boost every gun's damage. Both are shown in the HUD.
- Upgrades are visible on the model: armor tiers add chest, shoulder, thigh, pack and helmet plates, while calibration adds rails, grips, magazines, scopes, laser sights with long directional beams, drums and reinforced barrels.
- Each weapon has its own synthesized report — pistol crack, revolver boom, SMG chatter, M16 snap, AK hammer, M14 bark, BAR thump, M870 blast, low M79 launch, rocket launch roar, flamethrower whoosh, laser zap, plasma pulse, toxin hiss, nuclear launch boom and the multi-layer nuke detonation, plus toy pop, rubber-band twang and potato thump.
- Civilians, including women and children, wear bright shirts, skirts, shorts, sun hats and headscarves. They wander and flee, and their walk animation faces the direction they actually travel.
- Shooting a civilian kills them and immediately revokes one reinforcement; explosions and barrel chain reactions count too if the player caused them.
- Movement speed and camera scroll ramp up with distance, while music intensity grows as the run deepens.
- The HUD, briefing, radar and end screens use a Commodore 64-inspired blue-screen palette, chunky pixel borders and Press Start 2P labels.
- Toggleable CRT post-process filter with pronounced barrel curvature, animated scanlines, a rolling refresh band, aperture-grille mask, stronger chromatic fringing, phosphor grain, jitter, vignette and tube flicker. Toggle with `C` or the CRT button in the top-right corner; the preference is saved.
- Local fog-bank system: chapters carry seeded fog pockets with smooth entry/exit curves, and a separate drift layer of ground-hugging fog sprites rides the player position for a convincing white-out. The screen-space depth pass keeps the near bubble thinner and the far field denser.
- Randomized dungeon system with six themes, five modifiers, room-type variation (combat, ambush, treasure, shrine, entrance and exit), themed lighting, brazier smoke and auto-opening loot after each room is cleared.
- Touch-first presentation: twin-stick pads, queued action buttons, safe-area-aware HUD and overlay layout, reduced pixel ratio, lighter weather fields and mobile shadow budgeting.
- Destructible structures are first-class terrain objects with collider health, hit feedback, rubble masks, debris bursts, scorch decals and chain damage from nearby blasts. They are tagged per chapter, purged with the stream, and restored on a fresh run.
- A slower, spacious SID-style title theme plays on the briefing screen after the first click or keypress (browser audio unlock), then switches to the combat score on deployment.
- Frag grenades with ballistic arcs, bounce, fuses and falloff splash damage.
- Pooled projectile collision against targets, explosive barrels and tall obstacles.
- Screen-space aim assistance that corrects the shot vector when the cursor is near a soldier.
- Directional damage arcs point toward incoming fire, while edge chevrons flag off-screen mortar teams, armored vehicles and incoming shells.
- Holding still for a moment activates **brace**: tighter spread, reduced shake, faster health regeneration and a shorter grenade cooldown.
- Close-quarters shove on `V`/`F` or gamepad `B`: short range, brief invulnerability, stagger and knockback. It also gives you an answer to being crowded.
- Riflemen use pursuit, strafing, flanking and nearby cover spots; damage is reduced when they are on the protected side of low cover.
- Biome specialists: wetlands and swamp **Sappers** detonate at close range, desert and grassland **Fanatics** rush without cover, city and forest **Snipers** telegraph with a laser before a heavy shot, and snow **Hunters** pounce in fast flanking arcs.
- Armored command vehicles have biome variants: the river patrol boat, shielded APC, siege mortar carrier and snowcat mortar carrier trade speed, armor, turret bursts and mortar barrages.
- Component weak points: shoot a truck turret to disable it, rupture the rear fuel drum for a chain explosion, or hit a Heavy Gunner's ammo pack to cook it off.
- Bypassed soldiers disengage once they fall below the camera: they stop firing immediately and are culled just past the visible edge, so nobody shoots from off-screen.
- Battle tempo follows your movement. Wave spawners, mortar cadence, truck deployments and enemy attack cycles ease off when you stop or slow down, and the active infantry cap shrinks while you hold ground, then returns to full pressure as you push forward.
- Heavy gunners are armored, high-health variants that appear in the desert, city and frozen pass, capped at two alive at once.
- Mortar teams are stationary, two-man emplacements that lob telegraphed arc shells.
- Officers are faster, tougher, red-bereted elites.
- Command vehicles are armored boss threats with an independent turret, machine-gun bursts, infantry deployment, biome-tinted hulls and variant hardware.
- Weak-point hit markers flash amber so component damage reads differently from body shots.

### Audio

Dual-layer procedural audio engine built on the Web Audio API:

1. **Music:** an original SID-style battlefield score built from a library of seven short segments (march, assault, pursuit, urban front, brooding line, final push and the slower briefing theme). Three segment buses run at once and crossfade in real time; the director rotates new segments in every 10–20 seconds based on threat tier, nearby contacts, biome, boss presence and player health. Narrow pulse-wave lead and counter-melody, bass, fast chord arpeggios, quiet triangle drones, noise-channel percussion and a short slap delay are scheduled with a look-ahead clock. Tempo and layer mix respond to battle intensity, and the music bus runs hot enough to sit clearly against gunfire with only a small amount of reverb.
2. **Spatial SFX:** weapon-specific gunshots, ricochets, explosions, grenade pins/bounces, mortar launches and whistles, enemy death vocalizations and pickups all use positional `PannerNode`s. The listener follows the player, not the camera, so distant fire diminishes naturally.
3. **Weather beds:** looping rain hiss and filtered wind follow the active biome mix, with delayed thunder cracks under city lightning.

The graph includes master compression, a generated convolution reverb, stereo echo, ambience, mute persistence and volume persistence. Audio starts from a user gesture and recovers automatically after tab suspension or context resumption.

---

## Architecture

```text
commando/
├── index.html                     # Canvas, HUD, briefing/pause/end overlays
├── package.json
├── vite.config.js
├── public/                        # optional external assets (empty by default)
└── src/
    ├── main.js                    # Boot, Game orchestrator, director, dungeon flow, loop
    ├── style.css                  # HUD, overlay, responsive + touch visual system
    ├── config/
    │   ├── settings.js            # Tuning, endless chapter, camera and color constants
    │   ├── weapons.js             # Weapon stats, categories and starting loadout
    │   ├── biomes.js              # Biome dressing, weather, palettes, enemy styles
    │   ├── controls.js            # Keyboard + gamepad bindings
    │   ├── dungeons.js            # Dungeon themes, modifiers and synthetic biome palettes
    │   └── assets.js              # Optional external asset manifest
    ├── core/
    │   ├── Engine.js              # Renderer, scene, camera, post-processing
    │   ├── InputManager.js        # Keyboard, mouse, standard gamepad + touch vectors
    │   ├── TouchControls.js       # Twin-stick touch pads and action buttons
    │   ├── AudioManager.js        # Synth score, spatial SFX, weather beds, mixer
    │   └── AssetLoader.js         # GLTF/OBJ/texture loading + fallback policy
    ├── entities/
    │   ├── Player.js              # Movement, aim, category loadout, grenades, health/lives
    │   ├── Enemy.js               # Base AI, biome riflemen, heavies, officers, mortars, trucks
    │   ├── Civilian.js            # Protected non-combatants with flee/wander behaviour
    │   ├── WeaponModels.js        # Procedural weapon meshes and grips
    │   ├── Bullet.js              # Pooled tracers + segment/circle hit detection
    │   ├── Grenade.js             # Frag + mortar arcs, bounce/fuse/splash
    │   └── SoldierRig.js          # Merged soldier meshes, hand IK + animation
    ├── environment/
    │   ├── TerrainManager.js      # Biomes, props, cover, rivers, footprints, decals
    │   ├── DungeonSystem.js       # Entrances, randomized rooms, loot/exit flow
    │   └── DynamicLighting.js     # Sun shadows, fill lights, biome mood, flash pools
    ├── fx/
    │   ├── ParticleSystem.js      # GPU point pools, shockwaves, blast blobs
    │   ├── WeatherSystem.js       # Rain, snow, dust, lightning systems
    │   └── ScreenEffects.js       # Camera trauma, damage/lightning flash, hit markers
    ├── ui/
    │   └── UIManager.js           # HUD updates, weapon slots, banners, radar canvas
    └── utils/
        ├── math.js                # Damping, angles, RNG, geometric helpers
        └── textures.js            # Canvas2D noise/PBR/biome/footprint textures
```

### Level generation

`TerrainManager` streams coherent biome chapters from a per-run seed. Each chapter carries its own ground ribbon, road section, biome overlay, props, cover, barracks, barrels and colliders; chapters are built ahead of the camera and pruned behind it, so runs can continue indefinitely without a fixed level length. The biome order is shuffled each run, weapon/upgrade caches are scheduled by distance, and the enemy director escalates pressure with a threat tier. Snow footprints use a pooled instanced decal mesh, so the player and enemies leave tracks without unbounded draw calls. No page reload is required to restart; the run state is reset in place.

Optional dungeon entrances are seeded onto the surface route. `DungeonSystem` builds a small randomized layout far outside the endless corridor, swaps the terrain query arrays for its own collider set, hides the surface chapter layer, and restores the saved surface state on exit. Rooms are assembled from a theme palette with random combat, ambush, treasure and shrine variants; guards spawn on room entry and a themed chest or supply crate opens after the room is cleared. Death inside a dungeon respawns at its entrance, while the final room's portal returns you to the surface with a completion bonus. The surface's pickups, enemies and camera are frozen and restored around the excursion.

### Camera constraint

The camera anchor (`scroll`) only ever increases. The player may move around the visible frame, including slightly backward, but cannot drag the camera downfield. Crossing the upper threshold advances the scroll and therefore the level. This preserves the original Commando one-way pressure while allowing modern 360° combat.

### Game states

`boot → menu → playing ↔ paused → ended → playing / menu`

The game loop clamps delta time, pauses on tab visibility loss, suspends/resumes audio, and keeps the ended scene rendered for the result overlay.

---

## Optional external assets

The game is intentionally asset-free. If you want to bring in authored models or textures, add entries to `src/config/assets.js`:

```js
export const ASSET_MANIFEST = {
  models: [
    { name: 'player', url: '/assets/models/soldier.glb', type: 'gltf' },
  ],
  textures: [
    { name: 'ground', url: '/assets/textures/ground.jpg', repeat: [28, 300] },
  ],
  audio: [],
};
```

`AssetLoader` preloads them with a progress callback and caches them. Failures are logged and ignored; the procedural visuals remain fully playable. To consume a loaded model, retrieve it in `Game` via `this.assets.getModel('player')` — the current procedural soldier remains the default fallback.

---

## Tuning and production notes

Most balance lives in `src/config/settings.js` and `src/config/weapons.js`:

- `player.maxHealth`, `speed`, `visualScale`
- `player.braceDelay`, `braceSpreadMultiplier`, `braceRegenMultiplier`
- `player.meleeRange`, `meleeDamage`, `meleeShove`, `meleeStagger`, `meleeCooldown`
- `camera.fov`, `height`, `back`, `lookAhead`, `backwardLimit`
- `mission.width`, `startZ`
- `endless.chapterLength`, `chapterVariance`, `buildAheadDistance`, `keepBehindDistance`, `threatGraceDistance`, `threatTierDistance`, `speedRampPerMeter`, `speedRampMax`
- `difficulty.maxInfantry`, `idleMaxInfantry`, `maxSpecialInfantry`, `specialSpawnChance`, spawn intervals, reinforcement delay, truck interval/cap reduction, movement-paced `idleTempo` and `tempoSmoothing`
- `progression.maxArmorTier`, `armorHealthBonus`, `armorDamageReduction`, `maxDamageTier`, `damageBonusPerTier`, cache schedules and weapon-cache spacing
- `score` values
- Weapon fire rate, damage, spread, pellets, range, muzzle flash, audio profile and explosive projectile data

Biome dressing, fog, lighting mood, weather intensity, road/vehicle tints and enemy palettes live in `src/config/biomes.js`. Heavy-gunner spawn odds, specialist caps, civilian spawn cadence and vehicle variant selection are enforced in the director inside `src/main.js`. Truck turret and fuel weak-point health live on `OfficerTruck` in `src/entities/Enemy.js`.

The renderer caps device pixel ratio at `1.8` (desktop) / `1.5` (coarse pointer) and uses a 2048px shadow map. The particle pools have fixed capacities and are allocation-light during play. If you target lower-end hardware, reduce the shadow map size, bloom strength, or grass/soldier counts first.

The HUD uses system fonts only, so the package has no font-network dependency. Best score, best distance, mute state and volume persist in `localStorage` under keys defined in `settings.storageKeys`.

Audio can only begin after a user gesture. The **DEPLOY** button initializes and resumes the context; the first click also unlocks playback. If Web Audio is unavailable the game continues silently. Press `M` or use the audio pill to toggle at any time.

---

## Notes on this remake

This is a fan-made technical homage. It is not affiliated with or endorsed by the owners of the Commando name. It contains **no original Commando assets, sprites, or music data**. The models, textures, level art, sound effects and the SID-inspired score are all original, generated by this project's code as a tribute to the era and the vertical-shooter genre.

Third-party runtime dependencies: [Three.js](https://threejs.org/) (MIT) and [Vite](https://vite.dev/) (MIT).

---

## Troubleshooting

- **Black canvas / “renderer offline”** — enable hardware acceleration and WebGL2 in your browser; try Chrome or Safari. The error screen appears if renderer creation fails.
- **No sound** — browsers block audio until interaction. Click the deploy screen or press a key, check the audio pill is not muted, and verify the master volume on the pause screen.
- **Gamepad not detected** — press a button on the pad after the page loads; some browsers only expose gamepads after input.
- **Performance** — lower the browser window resolution or reduce pixel ratio/shadow map/grass counts in the source. The game is designed for 60 fps desktop-class WebGL2.

Enjoy the run. Keep the trigger down, use the ground, and see how deep you can push before the line breaks.

# COMMANDO // IRON TIDE

A modern 2.5D top-down shooter reimagining of the classic vertical-scrolling jungle run, built entirely with **Three.js**, the **Web Audio API**, vanilla ES modules and Vite. Each deployment is an endless, seeded run through shuffled biome chapters with escalating threat. The interface is a Commodore 64-inspired blue-screen HUD with chunky pixel borders and Press Start 2P type. No external art or audio files are required — every mesh, texture, particle, sound effect and bar of music is generated at runtime.

![status](https://img.shields.io/badge/status-playable-c8f06c) ![engine](https://img.shields.io/badge/three.js-0.181-ffb454) ![build](https://img.shields.io/badge/vite-8.3-ffb454)

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
| D-pad | Select weapon category slot |
| Start | Pause |

Aim magnetism makes steep-perspective aiming forgiving on both mouse and stick, while the ground reticle remains honest about range.

---

## The run

Every deployment is a seeded endless run through a shuffled sequence of biome chapters — **jungle**, **river delta**, **desert**, **ruined city**, **frozen pass**, **dense forest**, **blackwater swamp** and **open grassland**. The camera scrolls only forward; the screen bottom is the point of no return, and the only finish line is your best distance.

- Fight riflemen, heavy gunners, mortar teams, officers, biome specialists and armored command vehicles, all dressed for their local biome.
- Weapon slots are grouped into three carried categories: **light** (pistols, revolvers, SMGs), **assault** (rifles) and **heavy/utility** (machine guns, shotguns, launchers). Pick up a weapon in a category and it replaces the one you carry there; switch with `1`–`3`.
- Biome specialists change the rhythm of each leg: delta and swamp **sappers** rush in with satchel charges, desert and grassland **fanatics** press the assault, city and forest **marksmen** paint you with a laser before firing, and snow **hunters** pounce through the whiteout.
- Recover armory caches to find the **M1911**, **.357 Python**, **MP40**, **M1A1 Thompson**, **M16A1**, **AK-47**, **M14**, **M1918A2 BAR**, **M870**, **M60**, **M79**, plus joke issue hardware like the **Toy Pop Gun**, **Rubber Band Rifle** and **Spud Gun**. Trucks and officers also drop replacement weapons.
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
- Bloom + ACES filmic tone mapping through an `EffectComposer`.
- Vertex-coloured, merged, low-draw-call soldiers with animated legs and two-bone IK arms that visibly grip each weapon.
- Instanced vegetation, rocks, reeds, bushes, cacti, pines, rubble, sandbags, crates and barricades.
- Rivers, frozen bridges, bunkers, tents, watchtowers, ruins and burning wrecks.
- Procedural particle system (one-draw-call point pools) for dust, sparks, fire, smoke, blood, debris, shockwaves and expanding blast blobs.
- Dynamic screen feedback: proximity-based camera trauma, damage flash, low-health pulse, lightning screen flash, vignette, film grain and hit markers.

### Combat

- Full vector movement with acceleration/friction, not 8-way snapping.
- Smooth 360° aim interpolation toward mouse or right stick.
- Fourteen procedurally modelled weapons in three carried categories: **light** (M1911, .357 Python, MP40, M1A1 Thompson, Toy Pop Gun), **assault** (M16A1, AK-47, M14, M1918A2 BAR, Rubber Band Rifle) and **heavy/utility** (M60, M870, M79, Spud Gun).
- Weapon-specific fire rates, spread, tracers, muzzle flashes, screen shake and distinct synthesized reports for every gun.
- Armory caches in the level and weapon drops from officers and command trucks replace the carried weapon in that category; switch with `1`–`3` or the gamepad D-pad.
- Progressive field upgrades: four armor tiers add max health and damage resistance, while three weapon calibration tiers boost every gun's damage. Both are shown in the HUD.
- Upgrades are visible on the model: armor tiers add chest, shoulder, thigh, pack and helmet plates, while calibration adds rails, grips, magazines, scopes, laser sights with long directional beams, drums and reinforced barrels.
- Each weapon has its own synthesized report — pistol crack, revolver boom, SMG chatter, M16 snap, AK hammer, M14 bark, BAR thump, M870 blast, low M79 launch, toy pop, rubber-band twang and potato thump.
- Civilians, including women and children, wear bright shirts, skirts, shorts, sun hats and headscarves. They wander and flee, and their walk animation faces the direction they actually travel.
- Shooting a civilian kills them and immediately revokes one reinforcement; explosions and barrel chain reactions count too if the player caused them.
- Movement speed and camera scroll ramp up with distance, while music intensity grows as the run deepens.
- The HUD, briefing, radar and end screens use a Commodore 64-inspired blue-screen palette, chunky pixel borders and Press Start 2P labels.
- Toggleable CRT post-process filter with barrel curvature, scanlines, interlaced shimmer, aperture-grille mask, chromatic fringing, vignette and tube flicker. Toggle with `C` or the CRT button in the top-right corner; the preference is saved.
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

1. **Music:** an original three-voice SID-style battlefield score with a dedicated slower title theme. Narrow pulse-wave lead and bass, a fast chord arpeggio, quiet triangle drones, noise-channel percussion and a short slap delay are scheduled with a look-ahead clock. The music bus runs hot enough to sit clearly against gunfire, with only a small amount of reverb so the chip character stays forward. Combat density changes the active layers and mix.
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
    ├── main.js                    # Boot, Game orchestrator, director, loop
    ├── style.css                  # HUD, overlay, responsive visual system
    ├── config/
    │   ├── settings.js            # Tuning, endless chapter, camera and color constants
    │   ├── weapons.js             # Weapon stats, categories and starting loadout
    │   ├── biomes.js              # Biome dressing, weather, palettes, enemy styles
    │   ├── controls.js            # Keyboard + gamepad bindings
    │   └── assets.js              # Optional external asset manifest
    ├── core/
    │   ├── Engine.js              # Renderer, scene, camera, post-processing
    │   ├── InputManager.js        # Keyboard, mouse, standard gamepad polling
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

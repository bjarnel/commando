# COMMANDO // IRON TIDE

A modern 2.5D top-down shooter reimagining of the classic vertical-scrolling jungle run, built entirely with **Three.js**, the **Web Audio API**, vanilla ES modules and Vite. No external art or audio files are required — every mesh, texture, particle, sound effect and bar of music is generated at runtime.

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
| `1` / `2` / `3` / `4` | Switch to an acquired M60, M16A1, M870 or M14 |
| `RMB` / `G` | Throw a frag grenade at the cursor |
| `Esc` / `P` | Pause / resume |
| `M` | Mute / unmute |
| `Enter` | Deploy / resume / redeploy |

### Gamepad (standard mapping)

| Input | Action |
| --- | --- |
| Left stick | Move |
| Right stick | Aim |
| Right trigger (`RT`) | Fire |
| Left trigger (`LT`) | Grenade |
| D-pad | Select weapon slot |
| Start | Pause |

Aim magnetism makes steep-perspective aiming forgiving on both mouse and stick, while the ground reticle remains honest about range.

---

## The mission

Push **1,440 metres** through five linked biomes — **jungle**, **river delta**, **desert**, **ruined city** and **frozen pass**. The camera scrolls only forward; the screen bottom is the point of no return.

- Fight riflemen, heavy gunners, mortar teams, officers and armored command trucks, all dressed for their local biome.
- Recover armory caches to unlock the **M16A1**, **M870 trench shotgun** and **M14 marksman rifle**, then switch with `1`–`4`. Trucks and officers can also drop locked weapons.
- Weather shifts with the terrain: monsoon rain in the delta, dust storms in the desert, lightning storms in the city and snowfall in the frozen pass. Snow records boot prints from both sides.
- Use sandbags, palm trunks, wrecks, concrete and bunkers as cover. Low cover reduces incoming damage if the shooter is on the exposed side.
- Break kill chains for score multipliers. `×2` starts after three rapid kills.
- Collect health and grenade crates dropped by officers and trucks.
- Reach **LZ Delta** alive for a mission bonus and the victory screen.

You have three lives, four grenades and the belt-fed M60 at deployment. Health slowly regenerates after a lull in incoming fire. Barrels detonate, enemy mortar shells are telegraphed by red ground markers, and command trucks deploy reinforcements while you fight them.

---

## Feature tour

### Presentation

- Steep 60° perspective chase camera tuned to feel like a 2.5D vertical scroller, with the player held about three-quarters down the frame.
- Five seamlessly blended biome palettes: procedural jungle, desert sand, cracked city concrete and wind-packed snow, each with its own normal map, fog, sun mood and road tint.
- Biome dressing: palms and dense undergrowth, desert cacti and mesas, ruined city blocks and street lamps, snow pines, drifts and a frozen river crossing.
- Weather system with rain squalls, snow, blowing dust and lightning — plus wet-weather audio beds, thunder, snow boot-print decals and biome entry briefings.
- Procedural PBR ground, road, sandbags, wood, metal and ice with normal maps.
- `PCFSoftShadowMap` key-light shadows, warm directional sun, cool camera-side fill, muzzle flash, explosion and lightning point lights.
- Bloom + ACES filmic tone mapping through an `EffectComposer`.
- Vertex-coloured, merged, low-draw-call soldiers with animated legs and two-bone IK arms that visibly grip each weapon.
- Instanced vegetation, rocks, reeds, bushes, cacti, pines, rubble, sandbags, crates and barricades.
- Rivers, a frozen bridge, bunkers, tents, watchtowers, ruins, burning wrecks, extraction pad and green flares.
- Procedural particle system (one-draw-call point pools) for dust, sparks, fire, smoke, blood, debris, shockwaves and expanding blast blobs.
- Dynamic screen feedback: proximity-based camera trauma, damage flash, low-health pulse, lightning screen flash, vignette, film grain and hit markers.

### Combat

- Full vector movement with acceleration/friction, not 8-way snapping.
- Smooth 360° aim interpolation toward mouse or right stick.
- Four procedurally modelled weapons with distinct handling: belt-fed **M60**, accurate **M16A1**, seven-pellet **M870** trench gun and hard-hitting **M14** marksman rifle.
- Weapon-specific fire rates, spread, tracers, muzzle flashes, screen shake and synthesized gunshot profiles.
- Armory caches in the level and weapon drops from officers and command trucks; unlocked slots persist for the run and switch with `1`–`4` or the gamepad D-pad.
- Frag grenades with ballistic arcs, bounce, fuses and falloff splash damage.
- Pooled projectile collision against targets, explosive barrels and tall obstacles.
- Screen-space aim assistance that corrects the shot vector when the cursor is near a soldier.
- Riflemen use pursuit, strafing, flanking and nearby cover spots; damage is reduced when they are on the protected side of low cover.
- Heavy gunners are armored, high-health variants that appear in the desert, city and frozen pass, capped at two alive at once.
- Mortar teams are stationary, two-man emplacements that lob telegraphed arc shells.
- Officers are faster, tougher, red-bereted elites.
- Command trucks are armored boss threats with an independent turret, machine-gun bursts, infantry deployment and biome-tinted hulls.

### Audio

Dual-layer procedural audio engine built on the Web Audio API:

1. **Music:** an original SID-inspired electro-orchestral battlefield score. Pulse-wave lead, filter envelopes, detuned pad, 16th-note arpeggios, sequenced bass and synthesized drums are scheduled with a look-ahead clock. Combat density changes the active layers and mix.
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
    │   ├── settings.js            # Tuning, camera, colors, mission constants
    │   ├── weapons.js             # Weapon stats, unlock slots, cache positions
    │   ├── biomes.js              # Biome ranges, weather, palettes, enemy styles
    │   ├── controls.js            # Keyboard + gamepad bindings
    │   └── assets.js              # Optional external asset manifest
    ├── core/
    │   ├── Engine.js              # Renderer, scene, camera, post-processing
    │   ├── InputManager.js        # Keyboard, mouse, standard gamepad polling
    │   ├── AudioManager.js        # Synth score, spatial SFX, weather beds, mixer
    │   └── AssetLoader.js         # GLTF/OBJ/texture loading + fallback policy
    ├── entities/
    │   ├── Player.js              # Movement, aim, loadout, grenades, health/lives
    │   ├── Enemy.js               # Base AI, biome riflemen, heavies, officers, mortars, trucks
    │   ├── WeaponModels.js        # Procedural M60/M16A1/M870/M14 meshes and grips
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

`TerrainManager` builds one deterministic battlefield pass with a seeded PRNG. The route crosses five biomes, using feathered ground overlays for desert sand, city concrete and snow, a frozen second river crossing, biome-specific props, cover positions, spawn-adjacent barracks/camps, explosive barrels and a fixed extraction LZ. Streamed soldiers, weapon caches and trucks are managed by the director. Snow footprints use a pooled instanced decal mesh, so the player and enemies leave tracks without unbounded draw calls. No page reload is required to restart; the run state is reset in place.

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
- `camera.fov`, `height`, `back`, `lookAhead`, `backwardLimit`
- `mission.length`, `extractionZ`, `width`
- `difficulty.maxInfantry`, spawn intervals, truck milestones
- `score` values and mission bonus
- Weapon fire rate, damage, spread, pellets, range, muzzle flash, audio profile and cache positions

Biome boundaries, fog, lighting mood, weather intensity, road/vehicle tints and enemy palettes live in `src/config/biomes.js`. Heavy-gunner spawn odds and the two-alive cap are enforced in the director inside `src/main.js`.

The renderer caps device pixel ratio at `1.8` (desktop) / `1.5` (coarse pointer) and uses a 2048px shadow map. The particle pools have fixed capacities and are allocation-light during play. If you target lower-end hardware, reduce the shadow map size, bloom strength, or grass/soldier counts first.

The HUD uses system fonts only, so the package has no font-network dependency. Best score, mute state and volume persist in `localStorage` under keys defined in `settings.storageKeys`.

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

Enjoy the run. Keep the trigger down, use the ground, and get to LZ Delta.

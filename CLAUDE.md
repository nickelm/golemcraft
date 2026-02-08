# GolemCraft

A 3D voxel adventure game built with Three.js. Family project: Niklas (tech) + Viggo (creative direction).

**Targets:** 60 FPS desktop, 25+ FPS iPad 6th gen.

## Quick Start

```bash
npm install
npm run dev      # localhost:5173
npm run build    # Production build to dist/
```

Deployed to GitHub Pages.

---

## Core Philosophy

**Procedural first. All local generation. No global passes.**

Terrain generates from local noise queries only. No precomputed maps, no continental metadata, no multi-pass simulations. Every block's properties derive from its (x, z) coordinates and the world seed.

This constraint enables:
- Infinite worlds without boundary artifacts
- Instant chunk generation (no dependencies)
- Deterministic reproduction from seed alone
- Simple architecture (worker is stateless except caches)

**Continental generation** introduces a two-phase model: one-time metadata generation per continent (coastline, elevation envelope, climate orientation, zones, rivers, settlements, roads), followed by local chunk streaming that consumes this metadata. The metadata is small (~30–50 KB) and provides a polar coordinate frame `(r, θ)` that every chunk evaluates locally in O(1). The game world becomes a sequence of finite continents (each spanning 10 player levels) rather than a single infinite plane.

See design documents below for details.

---

## Design Documents

| Document | Location | Contents |
|----------|----------|----------|
| Continental Progression | `docs/continental-progression.md` | Continent sequence, starting continent choice (Verdania/Grausland/Petermark), radial objectives, progression banding, sailing transitions, climate templates, convergence at continent 1 |
| Radial Continental Structure | `docs/radial-continental-structure.md` | Spatial structure within a continent: climate geography, elevation envelope, zones, rivers, settlements, POIs, roads. Extends Continental Progression. |
| Verdania | `docs/verdania.md` | Starting continent template: zones, golden path, settlements, road network, naming palette |

### Key Design Decisions

These are settled decisions from the design documents. Claude Code should treat these as constraints:

- **One continent loaded at a time.** Sailing unloads current, generates next from seed. Return trips regenerate identically.
- **10 levels per continent.** Continent 0 = levels 1–10, continent 1 = 11–20, etc.
- **Starting continent is player choice.** Verdania (temperate), Grausland (cold/Nordic), Petermark (arid/Mediterranean). All are continent index 0 with different templates.
- **Convergence at continent 1.** All players with the same WorldSeed share continent 1 regardless of starting choice.
- **Two-stage coastline.** Coarse SDF for O(1) proximity detection. Detailed fbm noise (4–5 octaves) for actual coastline shape. SDF never defines geometry.
- **Polar coordinate frame.** Center point + start point provide `(r, θ)` that every chunk evaluates locally. This frame drives elevation envelope, climate geography, zones, progression, and placement.
- **Climate templates adjust inputs, not the biome system.** Templates apply temperature/humidity offsets and clamping before Whittaker lookup. Biome selection logic is unchanged.
- **Spatially-varying climate.** Wind angle and warm angle (seed-derived per continent) create geographic climate logic (windward/leeward, warm/cool sides). Composes with template offsets.
- **Zones are perturbed wedges from start point.** Zones constrain which biomes appear, carry atmosphere presets, and align with progression banding.
- **Elevation envelope separates base elevation from amplitude.** Two parameters per position: floor height and roughness. This enables plateaus (high floor, low amplitude), mountain ranges (medium floor, high amplitude), and coastal lowlands (low floor, low amplitude).
- **Progression scales with distance from starting point**, not from island center. Smooth lerp, no hard band boundaries.
- **Player state persists; world state does not.** Level, inventory, objective completion stored in save file. Terrain regenerated from seed.
- **Seed hierarchy:** `ContinentSeed(N) = hash(WorldSeed, N)` for N≥1. Continent 0 includes starting template in hash.

---

## Architecture

### Hybrid Terrain Rendering

Two mesh types per chunk, composited via z-buffer:

| Mesh | Purpose | When Used |
|------|---------|-----------|
| **Heightfield** | Smooth rolling terrain | Everywhere |
| **Voxels** | Sharp structures, caves | Landmarks only |

The heightfield renders the entire landscape. Voxels layer on top for temples, carved spaces, and future caves. This keeps triangle counts low while preserving voxel aesthetics where needed.

### Worker-Based Generation

```
Main Thread                          Web Worker
───────────────────────────────────────────────────────
ChunkLoader                          terrainworker.js
    │                                     │
    ├─► requestChunk(x, z) ──────────────►│
    │                                     │
    │                               generateChunkData()
    │                                     │
    │◄── chunkData + meshes ◄─────────────┤
    │    (via Transferables)              │
    ▼                                     
ChunkBlockCache ◄── block data            
TerrainDataProvider ◄── collision queries 
Scene ◄── meshes                          
```

**The worker is the single source of truth.** Main thread never regenerates terrain. Collision queries read from `ChunkBlockCache`, which stores worker-generated block data.

### Key Classes

| Class | File | Responsibility |
|-------|------|----------------|
| `WorkerTerrainProvider` | `terrainworker.js` | Height, biome, block type calculations |
| `ChunkLoader` | `chunkloader.js` | Priority queue, load/unload radius |
| `TerrainWorkerManager` | `terrainworkermanager.js` | Worker communication, mesh creation |
| `ChunkBlockCache` | `chunkblockcache.js` | Block data storage for collision |
| `TerrainDataProvider` | `terraindataprovider.js` | Unified API for terrain queries |
| `ChunkedTerrain` | `terrainchunks.js` | Mesh management, materials |

---

## Directory Structure

```
src/
├── workers/
│   ├── terrainworker.js      # ← ALL terrain generation happens here
│   ├── terrainworkermanager.js
│   ├── spawnpointgenerator.js
│   └── objectspawner.js
├── world/
│   ├── terrain/
│   │   ├── biomesystem.js    # Biome definitions (tints, textures, heights)
│   │   ├── chunkdatagenerator.js  # Pure mesh generation functions
│   │   ├── elevationenvelope.js  # Radial elevation modulation (pure functions)
│   │   ├── climategeography.js  # Spatially-varying climate modulation (pure functions)
│   │   ├── terrainchunks.js  # Three.js mesh management
│   │   └── worldgen.js       # Height constants
│   ├── landmarks/
│   │   └── workerlandmarksystem.js  # Temple generation
│   ├── chunkloader.js
│   ├── worldmanager.js
│   └── terraindataprovider.js
├── entities/                 # Hero, mobs
├── atmosphere/               # Day/night, lighting
├── controls/                 # Camera, input
├── shaders/                  # Terrain splatting shaders
└── debug/                    # Performance tools
```

---

## Terrain Generation

### Current System (February 2026)

**Whittaker diagram biome selection:**
- Temperature noise (freq 0.018) with smoothstep redistribution (`normalizeNoise()`)
- Humidity/precipitation noise (freq 0.012) with smoothstep redistribution
- Elevation noise (freq 0.015) with smoothstep redistribution
- **Climate geography** (continental mode): spatially-varying temperature and humidity modulation
  - Latitude effect: warm-to-cold gradient via dot product with seed-derived warm direction
  - Windward effect: wet-to-dry gradient via dot product with seed-derived wind direction (rain shadow)
  - Coastal moderation: temperature extremes damped near coast (maritime climate)
  - Elevation drying: reduced humidity above treeline
  - Template offsets and clamping (Verdania=temperate, Grausland=cold, Petermark=hot/arid)
  - Pure functions in `climategeography.js`: `generateClimateParams()`, `evaluateClimate()`
- 2D Whittaker lookup (temp × precip) with elevation cooling above tree line (0.55)
- Frozen <0.15, Cold 0.15-0.40, Temperate 0.40-0.72, Hot ≥0.72
- Sub-biome variation noise for natural patches

**Height generation:**
- **Elevation envelope** (continental mode): two-parameter radial modulation from island center
  - `baseElevation(r, θ)`: raises terrain floor based on distance + angle
  - `amplitudeScale(r, θ)`: multiplies noise amplitude, peaks respect envelope
  - Control points interpolated along radial axis, angular lobes + optional spine
  - Template-specific profiles (Verdania, Grausland, Petermark)
- Domain warping for organic shapes
- Octave noise (5 octaves, freq 0.03)
- Biome-specific base height + scale
- Peak bonus for mountain biomes
- Multi-factor river system: density noise filtering, biome/elevation blocking, variable-width channels, graduated valley carving with sloped banks
- Lake system with biome/elevation filtering and biome-specific thresholds

**16 Biomes:**

| Category | Biomes |
|----------|--------|
| Temperate | plains, meadow, autumn_forest, deciduous_forest, swamp |
| Hot/Arid | desert, red_desert, savanna, badlands |
| Tropical | jungle, beach |
| Cold | taiga, tundra, glacier |
| Mountain | mountains, alpine, highlands |
| Water | ocean |

### Texture System

8 base textures in WebGL2 texture arrays (no atlas):

| Index | Texture | Used By |
|-------|---------|---------|
| 0 | grass | Plains, meadow, savanna |
| 1 | forest_floor | Forests, jungle |
| 2 | dirt | Subsurface, paths |
| 3 | sand | Desert, beach |
| 4 | rock | Mountains, cliffs |
| 5 | snow | Tundra, peaks |
| 6 | ice | Glacier, frozen water |
| 7 | gravel | Riverbeds, paths |

Biomes differentiate via RGB tint multiplied in shader. 4-texture splatting blends per quad on desktop, 2-texture on mobile.

---

## Roadmap

The roadmap follows a dependency chain. Continental structure must exist before world content can be placed intelligently. Game systems can be built in parallel since they consume content without deciding placement.

### Dependency Graph

```
Tier 1: Terrain Polish (done)
    │
Tier 2: Continental Structure
    Continental Shape (done) ──→ Elevation Envelope (done) ──→ Climate Geography ──→ Zones
        │                                                                      │
        │                    ┌─────────────────────┬──────────────┬────────────┤
        │                    ▼                     ▼              ▼            ▼
Tier 3: World Content    Rivers              Landmarks/POIs  Settlements  Monster Camps
        │                    │                                    │
        │                    └──────────────► Roads ◄─────────────┘
        │
Tier 4: Game Systems (parallel — no placement dependencies)
        Character Progression, Quests, UI, Sound
        │
Tier 5: Sailing and Continent Sequence
        Radial Objectives ──→ Sailing Transition ──→ Multi-Continent Sequence
```

### Tier 1: Terrain Polish ✓ Complete

**1.1 — Cold Biome Overrepresentation** ✓
Fixed with smoothstep noise normalization (`normalizeNoise()`). Rebalanced Whittaker thresholds.

**1.2 — River System** ✓
Multi-factor `getRiverInfluence()` with density filtering, biome/elevation blocking, variable width, graduated valley carving. Rivers don't yet flow coherently downhill (requires continental rivers in Tier 2).

**1.3 — Heightfield–Voxel Stitching** ✓
Improved blending at voxel landmark boundaries.

**1.4 — Skybox Rendering** ✓
Gradient sky dome with horizon-to-zenith shader, depth-clamped, integrated with day/night cycle.

### Tier 2: Continental Structure

The continental pipeline, built in dependency order. Each step produces visible results and is testable independently. See `docs/radial-continental-structure.md` for full design.

**2.1 — Continental Shape** ✓ Done
- Coarse SDF for coastal proximity detection (O(1) lookup)
- Detailed fbm coastline function (4–5 octaves, evaluated only near coast)
- Beach → shallow → deep ocean terrain transition in terrain worker
- Impassable deep ocean boundary
- Deterministic starting point on coast
- Standalone terrain visualizer with continent index selector and coastline overlay

**2.2 — Elevation Envelope** ✓ Done
Radial elevation profile with independent base elevation and amplitude control. See `docs/radial-continental-structure.md` §Elevation Envelope.
- Pure functions in `elevationenvelope.js`: `generateEnvelopeParams()`, `evaluateEnvelope()`, `interpolateControlPoints()`, `computeAngularModulation()`
- Two-parameter system: `baseElevation` (raises floor) + `amplitudeScale` (multiplies noise)
- 5 seed-derived control points along radial axis with smoothstep interpolation
- 2–5 angular harmonic lobes to break rotational symmetry
- Optional directional spine (Gaussian peak in angular space) for mountain ridges
- Template-specific profiles: Verdania (gentle + southern spine), Grausland (rugged + multi-ridge), Petermark (flat + mesa sectors)
- Integrated in game worker (`computeInlandHeight`, `smoothBiomeTransitionContinuous`), visualizer (`terraincore.js`), and tile system
- Continental config extended with `template` field, passed through entire config chain

**2.3 — Climate Geography** ✓ Done
Spatially-varying temperature and humidity modulation using seed-derived wind and warm angles. See `docs/radial-continental-structure.md` §Climate Geography.
- Pure functions in `climategeography.js`: `generateClimateParams()`, `evaluateClimate()`
- Wind angle and warm angle generated from `hash(climateSeed, offset)` → [0, 2π]
- Latitude effect: warm-to-cold gradient via dot product with warm direction (strength 0.15–0.25)
- Windward effect: wet-to-dry gradient via dot product with wind direction / rain shadow (strength 0.1–0.2)
- Coastal moderation: temperature pulled toward template median near coast via smoothstep(0, 0.4, inlandness)
- Elevation drying: `smoothstep(0.4, 0.8, elevation) * -0.2` reduces humidity above treeline
- Template presets: Verdania (temperate [0.2,0.8]), Grausland (cold [0.0,0.5]), Petermark (hot [0.4,1.0])
- Seed-derived defaults for continent 1+ (no template)
- Integrated in game worker (`terrainworker.js`), visualizer (`terraincore.js`), and tile system
- Continental config extended with `climateSeed` field, passed through entire config chain

**2.4 — Zones**
Named regions generated as perturbed wedges from start point. See `docs/radial-continental-structure.md` §Zone System.
- Wedge partitioning from start point (5–8 zones for continent 0)
- Radial banding within wedges (inner/mid/outer splits)
- Zone templates defining: allowable biome subset, excluded biomes, atmosphere preset (sky tint, fog, ambient color), weather profile, mob density/types, landmark density
- Boundary perturbation via fbm noise (~50–100 blocks)
- Zone name display on entry (zone name + continent subtitle)
- Zone-specific atmospheric effects (short crossfade on zone change)
- Hand-authored zone assignments for Verdania/Grausland/Petermark; seed-based for continent 1+

**2.5 — Rivers**
Rivers flowing from highlands to coast using radial frame. See `docs/radial-continental-structure.md` §Rivers.
- Source placement at high-elevation points in inner continent
- Path tracing with outward bias + meander noise
- Tributaries joining major rivers at mid-radius
- Width scaling: mountain stream (1–2) → upland river (3–5) → lowland river (6–10) → estuary (10–20)
- Waterfall generation at significant elevation drops
- River polylines as zone boundary attractors
- Replaces current noise-isoline rivers with geographically coherent flow

**2.6 — Progression Banding**
- Distance-from-start calculation available to mob spawner
- Mob stat scaling by local progression level (health, damage, density, variety)
- Resource rarity scaling with distance
- Aligned with zone boundaries

### Tier 3: World Content

Features that populate the continental structure with things to find and do. All placement decisions use zones, population density, and the road network from Tier 2.

**3.1 — Landmarks and POIs**
Landmarks placed within zones, type and density constrained by zone template and progression level.
- Expand beyond Mayan temples: ruins, standing stones, caves, rock formations, shrines, ancient wells
- Each landmark type has biome affinity, zone template affinity, and spacing rules
- POI categories: objective sites, dungeon entrances, vista points, resource nodes, discoveries, wayshrines
- Vista points placed where elevation envelope first reveals the interior
- Named discoveries provide XP on first visit

**3.2 — Settlements**
Placed using population density model (zone template × distance-from-start × flatness × river proximity).
- Settlement types: city (1), town (2–4), village (4–8), hamlet (6–12), camp (8–15) per continent
- Settlement count scales with continent index
- Building templates: houses, market stalls, watchtowers, inns
- NPC population: vendors, quest givers, flight masters
- Starting settlement always at start point; center settlement near continent center

**3.3 — Roads**
Connect settlements and POIs. Pathfinding on continental metadata.
- Primary road: start → center → sailing point (A* on coarse grid, penalizing elevation change and water)
- Secondary roads: branch to zone hubs and objective sites
- Trails: perturbed straight lines to hamlets and dungeon entrances
- Road hierarchy: highway (5–6 blocks, cobblestone) → road (3–4, gravel) → trail (2, dirt) → path (1, faint)
- Road surface via texture splatting: road proximity biases blend weights toward gravel/dirt texture layer
- Bridges at road-river intersections (type scales with road hierarchy × river width)
- Signposts at forks with direction, distance, and danger level

**3.4 — Monster Camps**
Structured enemy encounters placed by zone template and progression.
- Camp templates: bandit camp, undead graveyard, spider nest, cultist outpost
- Difficulty scaling via progression banding
- Loot chests, camp boss mobs
- Visual identity: tents, totems, campfires
- Some camps are objective locations (Boss, Clear objective types in Tier 5)

### Tier 4: Game Systems

Core RPG mechanics. These consume content from Tier 3 but don't decide placement. Can be developed in parallel with Tiers 2–3.

**4.1 — Character Progression and Leveling**
- XP from combat, exploration, quests
- Level-up with stat increases
- Skill tree or ability unlocks
- Equipment slots and gear progression
- 10 levels per continent, mob scaling via distance-from-start
- Persist to local storage

**4.2 — Quest System**
- Quest types: kill, collect, explore, deliver, escort
- Quest givers in settlements
- Quest log UI
- Reward structure (XP, gold, gear)
- Zone-appropriate quest templates

**4.3 — Game UI**
- Health/mana/XP bars (polish existing)
- Inventory screen
- Character stats panel
- Settings dialog (render distance, controls)
- Mobile-friendly touch controls
- Wayfinding UI for continental objectives (compass markers, beacon pillars)

**4.4 — Sound**
- Ambient biome sounds (wind, birds, water, insects)
- Combat sounds (bow, hit, mob death)
- UI sounds (menu, pickup, level up)
- Music (exploration, combat, settlement)
- Web Audio API with spatial positioning

### Tier 5: Sailing and Continent Sequence

Continental transitions and the progression gate. Requires Tiers 2–3 content to be meaningful.

**5.1 — Radial Objectives**
- Objective placement at seeded angles, within specific zones
- Objective types: Boss, Activate (initial); Collect, Clear, Escort (later)
- Completion tracking in save file
- Wayfinding: compass markers + beacon pillars + map fog

**5.2 — Sailing Transition**
- Sailing point at coast opposite starting point
- Objective completion gate check
- Continent unload/load sequence with player state save/restore
- Sailing animation (10–20 sec) with background generation of next continent
- Convergence: all starting continents → shared continent 1

**5.3 — Full Continental Identity**
- Grausland and Petermark design documents (parallel to Verdania)
- Additional templates for continent 2+ (volcanic, tropical, archipelago)
- Climate drift across continent sequence
- Named continents via naming palette system

### Tier 6: Future Architecture

**6.1 — kosmos-engine Extraction**
Separate core simulation from GolemCraft-specific content:
- Reusable terrain generation library
- Template editor for continent design
- Headless operation for HCAI agent research

---

## Performance

### Targets

| Platform | Target FPS | Actual |
|----------|------------|--------|
| Desktop | 60 | 60 |
| iPad 6th gen | 25+ | 30-40 |
| iPhone | 25+ | 25-30 |

### Key Metrics

- Draw calls: 50-100 typical
- Triangles: 100-200k typical
- Chunk gen time: 5-15ms per chunk
- Load radius: 8 chunks
- Unload radius: 10 chunks

### Optimizations Applied

- Instanced mesh rendering for objects
- Heightfield instead of voxels for smooth terrain
- Surface-only water (no side faces)
- Texture arrays instead of atlas
- Web worker for all generation
- Priority queue by distance

---

## Debug Tools

| Key | Tool |
|-----|------|
| `P` | Performance monitor (FPS, draw calls, worker stats) |
| `C` | Collision debug overlay |
| `N` | Normal debug |
| `F3` | Landmark debug |
| `B` | Debug block column |

Performance monitor shows:
- FPS (current, average, minimum)
- Frame time and delta
- Draw calls, triangles, geometries
- Worker queue depth
- Chunk generation times

---

## Key Bindings (In-Game)

| Key | Action |
|-----|--------|
| WASD | Move |
| Space | Jump |
| Tab | Toggle world map |
| Escape | Save and return to menu |
| M | Mount/dismount |
| Shift+M | Toggle fog of war debug |
| Q | Switch weapon |
| G | Drop torch |
| T | Place TNT |

---

## Common Tasks

### Adding a New Biome

1. Add to `BIOMES` in `biomesystem.js`:
   ```javascript
   new_biome: {
       name: 'New Biome',
       terrain: { primary: 'grass', secondary: 'dirt', tint: [0.5, 0.8, 0.3] },
       baseHeightFraction: 0.15,
       heightScaleFraction: 0.1,
       objects: ['tree', 'rock'],
       mobs: ['zombie']
   }
   ```

2. Add selection logic in `terrainworker.js` `selectBiomeFromClimate()` or `getBiome()`

3. Test: walk around, verify transitions look natural

### Adding a New Block Type

1. Add texture to texture array (update `textureregistry.js`)
2. Add to `BLOCK_TYPE_IDS` in `chunkdatagenerator.js`
3. Add rendering logic if special (like water transparency)

### Modifying Terrain Generation

All terrain logic lives in `terrainworker.js`:
- `getBiome(x, z)` — biome selection
- `getContinuousHeight(x, z)` — height calculation
- `getBlockType(x, y, z)` — block at position
- `getRiverInfluence(x, z)` — river detection with graduated influence for valley carving
- `isRiver(x, z)`, `isLake(x, z)` — boolean water feature checks
- `evaluateClimate(x, z, temp, humidity, params, elevation)` — climate geography modulation (in `climategeography.js`)

Changes here affect all new chunks. Existing chunks regenerate when player returns.

**Continental changes to the worker:** The worker receives continental metadata and evaluates `(r, θ)` per block for elevation envelope, climate modulation, zone lookup, river proximity, and road proximity. These are local evaluations — no inter-chunk communication needed.

---

## Conventions

- **Lowercase filenames** (matches Three.js style)
- **Pure functions** in shared code (worker compatibility)
- **Deterministic** from seed (no Math.random() in terrain)
- **No sync terrain** on main thread
- **Update CLAUDE.md** after completing each task

---

## Known Issues

- Rivers don't flow coherently downhill (requires Tier 2.5 continental rivers)
- ~~Biome patchwork: desert appears next to tundra~~ (fixed by Tier 2.3 climate geography)
- ~~No plateaus or highlands with flat elevated terrain~~ (fixed by Tier 2.2 elevation envelope)
- Landmarks limited to Mayan temples (requires Tier 3.1 landmark expansion)

---

## Completed Milestones

- ✅ Infinite terrain loading/unloading with chunk priority queue
- ✅ Hybrid heightfield + voxel rendering (5-6x perf gain)
- ✅ WebGL2 texture arrays replacing atlas system
- ✅ Whittaker biome selection (16 biomes from temperature × humidity)
- ✅ Web worker terrain generation (single source of truth)
- ✅ Mob and item spawning relative to player position
- ✅ Day/night cycle with lighting
- ✅ Archery combat with arrow physics
- ✅ XP and basic progression
- ✅ Map visualizer tool for terrain debugging
- ✅ Multi-factor river system with density filtering, variable width, and graduated valley carving
- ✅ Continental progression design document
- ✅ Radial continental structure design document
- ✅ Continental shape system: coastline silhouette, coarse SDF, detailed fbm coast
- ✅ Standalone terrain visualizer with continent index selector, coastline overlay, start position centering
- ✅ Tile-based map system: TileCache + TileManager with Web Worker, progressive refinement
- ✅ In-game map overlay (Tab to toggle) with biome colors, hillshading, rivers, coastline
- ✅ Per-pixel coastline clipping in tile generator worker
- ✅ Progressive tile cache fix (evict lower refinement on higher arrival)
- ✅ Tile priority sort (coarse before fine, then by distance)
- ✅ Gradient sky dome with horizon-to-zenith shader, integrated with day/night cycle
- ✅ Map fog of war (visited cell tracking, dark overlay, persisted to save, Shift+M debug toggle)
- ✅ Smoothstep noise normalization fixing cold biome overrepresentation
- ✅ Heightfield–voxel stitching improvements
- ✅ Elevation envelope: radial height modulation with control points, angular lobes, directional spine, template presets (Verdania/Grausland/Petermark)
- ✅ Climate geography: spatially-varying temperature/humidity with latitude effect, windward/rain shadow, coastal moderation, elevation drying, template presets

---

## Project Context

**Family project:** Educational game for iPad deployment at schools. Viggo provides creative direction and UI feedback. Niklas handles implementation.

**Future goal:** Extract reusable "kosmos-engine" for other developers building block-world games or HCAI agents.

**Development workflow:**
- Claude.ai for planning and design discussions
- Claude Code for implementation
- This file updated after each completed task
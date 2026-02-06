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

**Future direction:** Continental generation will introduce a two-phase model—one-time global generation per continent with spatial indices, followed by local chunk streaming. The game world becomes a sequence of finite continents (each spanning 10 player levels) rather than a single infinite plane. See `docs/continental-progression.md` for the progression and continent sequence design, `World_Generation_Architecture.md` and `kosmos_gen_architecture.md` for generation pipeline details.

---

## Design Documents

| Document | Location | Contents |
|----------|----------|----------|
| Continental Progression | `docs/continental-progression.md` | Continent sequence, starting continent choice (Verdania/Grausland/Petermark), radial objectives, progression banding, sailing transitions, climate templates, convergence at continent 1 |
| Verdania | `docs/verdania.md` | Starting continent template: zones, golden path, settlements, road network, naming palette |

### Continental Progression — Key Decisions

These are settled design decisions from the continental progression document. Claude Code should treat these as constraints:

- **One continent loaded at a time.** Sailing unloads current, generates next from seed. Return trips regenerate identically.
- **10 levels per continent.** Continent 0 = levels 1–10, continent 1 = 11–20, etc.
- **Starting continent is player choice.** Verdania (temperate), Grausland (cold/Nordic), Petermark (arid/Mediterranean). All are continent index 0 with different templates.
- **Convergence at continent 1.** All players with the same WorldSeed share continent 1 regardless of starting choice. Template is neutral/mixed.
- **Two-stage coastline.** Coarse SDF for O(1) proximity detection only. Detailed fbm noise (4–5 octaves) for actual coastline shape. SDF never defines geometry.
- **Climate templates adjust inputs, not the biome system.** Templates apply temperature/humidity offsets and clamping before Whittaker lookup. Biome selection logic is unchanged.
- **Progression scales with distance from starting point**, not from island center. Smooth lerp, no hard band boundaries.
- **Terrain system unchanged inland.** Continental overlay only modulates near the coastline (beach/shallow/deep ocean transition). Existing biomes, heightmaps, and objects untouched.
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
- 2D Whittaker lookup (temp × precip) with elevation cooling above tree line (0.55)
- Frozen <0.15, Cold 0.15-0.40, Temperate 0.40-0.72, Hot ≥0.72
- Sub-biome variation noise for natural patches

**Height generation:**
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

**Future: Continental climate templates** will apply temperature/humidity offsets before biome selection to produce continent-specific biome distributions (e.g., Grausland shifts toward cold biomes). The biome selection logic itself does not change. See `docs/continental-progression.md` § Starting Continents and Climate.

### Texture System

8 base textures in WebGL2 texture arrays (no atlas UV math):

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

Biomes differentiate via RGB tint multiplied in shader.

---

## Roadmap

### Tier 1: Terrain Polish (Current Priority)

These fix visible issues in the current infinite terrain system.

**1.1 — Cold Biome Overrepresentation** ✓ Fixed
Fixed by adding smoothstep noise normalization (`normalizeNoise()` in terraincore.js) that counteracts the central-limit-theorem clustering of `octaveNoise2D` output. Also rebalanced Whittaker thresholds: cold/temperate boundary moved from 0.50→0.40, frozen zone narrowed to <0.15, and elevation cooling rate reduced from 0.45→0.30. Target distribution: ~40% temperate, ~25% hot, ~15% cold, ~15% mountain.

**1.2 — River System** ✓ Improved
Replaced binary noise-isoline rivers with multi-factor system using `getRiverInfluence()`:
- River density noise (freq 0.003, seed+44444) creates regions with/without rivers
- Biome filtering: blocked in desert, red_desert, badlands, glacier, ocean; reduced density in tundra, savanna; always allowed in swamp, jungle, taiga, rainforest
- Elevation filtering: no rivers above tree line (normalizedElevation > 0.55)
- Variable width via downstream noise (freq 0.002, seed+33333): 0.012–0.030 threshold range
- Graduated valley carving: bank zone at 2.5x river width with smoothstep falloff
- Lake improvements: threshold 0.60 (was 0.65), swamp 0.50, with elevation/biome filtering
- **Remaining:** Rivers still don't flow coherently downhill (requires continental generation for proper gradient descent rivers, see `World_Generation_Architecture.md`)

**1.3 — Heightfield–Voxel Stitching** ✓ Improved
Visible seams where voxel landmarks (temples) meet the heightfield terrain. Need blending or transition geometry at the boundary.

**1.4 — Skybox Rendering** ✓ Fixed
Replaced flat `scene.background` color with a gradient sky dome (`src/atmosphere/skydome.js`). Inverted sphere with custom shader draws horizon-to-zenith gradient using preset fog/sky colors. Depth-clamped to far plane to avoid clipping at any draw distance. Integrates with existing day/night cycle transitions. Sun/moon sprites retained as focal points.

### Tier 2: World Content

Features that populate the world with things to find and do.

**2.1 — Landmark System Expansion**
Currently only Mayan temples. Restore and expand:
- Mission caves (interior voxel spaces with objectives)
- Rocky outcroppings / rock formations
- Ruins, standing stones, ancient wells
- Each landmark type needs placement rules (biome affinity, spacing, elevation)

**2.2 — Settlements**
Clusters of structures: villages, camps, outposts. Need:
- Placement heuristics (flat ground, near water, road access)
- Building templates (houses, market stalls, watchtowers)
- NPC population (vendors, quest givers)
- See Verdania design doc for zone-based settlement design
- See `docs/continental-progression.md` § Settlements, Roads, and Infrastructure for how settlements integrate with the continental progression system (starting settlement, sector settlements, center settlement)

**2.3 — Roads with Textures**
Connect settlements with visible paths/roads:
- Road hierarchy: highway (5-6 blocks), road (3-4), trail (2), path (1)
- Terrain flattening along road path
- Textured surface (gravel/dirt texture, possibly a new cobblestone texture)
- Signposts at intersections
- Short term: local noise-based paths between nearby landmarks
- Long term: A* pathfinding from continental metadata
- See `docs/continental-progression.md` § Settlements, Roads, and Infrastructure for road hierarchy within the continental system (primary road: start → center → sail point; secondary: to sector objectives)

**2.4 — Monster Camps**
Structured enemy encounters beyond random mob spawning:
- Camp templates (bandit camp, undead graveyard, spider nest)
- Difficulty scaling with distance from spawn
- Loot chests, camp boss mobs
- Visual identity (tents, totems, campfires)
- Future: monster camps become objective locations in the continental system (Boss, Clear objective types)

### Tier 3: Game Systems

Core RPG mechanics that give the exploration purpose.

**3.1 — Character Progression and Leveling**
- XP from combat, exploration, quests
- Level-up with stat increases
- Skill tree or ability unlocks
- Equipment slots and gear progression
- Persist to local storage
- Future: 10 levels per continent, mob scaling via distance-from-start progression banding (see `docs/continental-progression.md` § Progression Banding)

**3.2 — Quest System**
- Quest types: kill, collect, explore, deliver, escort
- Quest givers in settlements
- Quest log UI
- Reward structure (XP, gold, gear)
- Zone-appropriate quest templates (see Verdania doc)
- Future: radial objectives per continent gate sailing to next continent (see `docs/continental-progression.md` § Radial Objectives)

**3.3 — Game UI and Minimap**
- Health/mana/XP bars (polish existing)
- Minimap showing terrain, landmarks, quest markers
- Inventory screen
- Character stats panel
- Settings dialog (render distance, controls)
- Mobile-friendly touch controls
- Future: wayfinding UI for continental objectives (compass markers, beacon pillars, sector exploration tracking)

**3.4 — Sound**
- Ambient biome sounds (wind, birds, water, insects)
- Combat sounds (bow, hit, mob death)
- UI sounds (menu, pickup, level up)
- Music (exploration, combat, settlement)
- Web Audio API with spatial positioning

### Tier 4: Continental Progression

Implementation of the continental system. See `docs/continental-progression.md` for full design.

**4.1 — Continental Shape**
- Coarse SDF for coastal proximity detection (O(1) lookup)
- Detailed fbm coastline function (4–5 octaves, evaluated only near coast)
- Beach → shallow → deep ocean terrain transition in terrain worker
- Impassable deep ocean boundary
- Deterministic starting point on coast

**4.2 — Climate Templates**
- Template data structure (climate offsets, excluded/favored biomes, elevation profile)
- Verdania template (extract from existing design)
- Grausland and Petermark template stubs (playable but minimal)
- Template selection at world creation UI
- Climate offset application in terrain worker before biome selection

**4.3 — Progression Banding**
- Distance-from-start calculation available to mob spawner
- Mob stat scaling by local progression level (health, damage, density, variety)
- Resource rarity scaling with distance

**4.4 — Radial Objectives**
- Objective placement at seeded angles around island
- Objective types: Boss, Activate (initial); Collect, Clear, Escort (later)
- Completion tracking in save file
- Wayfinding UI (compass markers toward uncompleted objectives)

**4.5 — Sailing Transition**
- Sailing point at coast opposite starting point
- Objective completion gate check
- Continent unload/load sequence with player state save/restore
- Sailing animation (10–20 sec) with background generation of next continent
- Convergence: all starting continents → shared continent 1

**4.6 — Settlements and Roads (Continental)**
- Settlement placement constrained to progression bands
- Road network: primary (start → center → sail), secondary (to objectives), trails
- Signpost system with direction, distance, and danger level

**4.7 — Full Continental Identity**
- Grausland and Petermark design documents (parallel to Verdania)
- Additional templates for continent 2+ (volcanic, tropical, archipelago)
- Climate drift across continent sequence (sinusoidal temperature/humidity variation)
- Named continents via naming palette system

### Tier 5: Future Architecture

Longer-term structural work.

**5.1 — Continental Generation Pipeline**
Full two-phase model from World Generation Architecture doc:
- Phase A: Continental genesis (erosion, hydrology, zone placement)
- Phase B: Chunk streaming from spatial indices
- Enables proper gradient-descent rivers, road pathfinding, zone boundaries
- Loading screen with progress (budget: 1–2 minutes per continent)

**5.2 — kosmos-engine Extraction**
Separate core simulation from GolemCraft-specific content:
- Reusable terrain generation library
- Template editor for continent design
- See `kosmos_gen_architecture.md` for architecture

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

Performance monitor shows:
- FPS (current, average, minimum)
- Frame time and delta
- Draw calls, triangles, geometries
- Worker queue depth
- Chunk generation times

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

Changes here affect all new chunks. Existing chunks regenerate when player returns.

**Future continental changes to the worker will be minimal:** coarse SDF lookup for coastal proximity, detailed fbm evaluation near coast, and climate template offsets applied before biome selection. See `docs/continental-progression.md` § Interaction with Existing Systems.

---

## Conventions

- **Lowercase filenames** (matches Three.js style)
- **Pure functions** in shared code (worker compatibility)
- **Deterministic** from seed (no Math.random() in terrain)
- **No sync terrain** on main thread
- **Update CLAUDE.md** after completing each task

---

## Known Issues

- Rivers don't flow coherently downhill (requires continental generation for gradient descent)
- ~~Cold biomes overrepresented~~ (fixed with smoothstep normalization)
- Visible seams at heightfield–voxel boundaries near landmarks
- Landmarks limited to Mayan temples

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
| P | Performance monitor |
| C | Collision debug |
| N | Normal debug |
| F3 | Landmark debug |
| B | Debug block column |

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
- ✅ Continental progression design document (docs/continental-progression.md)
- ✅ Continental shape system: coastline silhouette, coarse SDF, detailed fbm coast (`continentshape.js`)
- ✅ Standalone terrain visualizer with continent index selector, coastline overlay, start position centering
- ✅ Tile-based map system: TileCache + TileManager with Web Worker, progressive refinement (coarse-to-fine)
- ✅ In-game map overlay (Tab to toggle) with biome colors, hillshading, rivers, coastline
- ✅ Per-pixel coastline clipping in tile generator worker (ocean outside island boundary)
- ✅ Progressive tile cache fix (evict lower refinement levels when higher arrives)
- ✅ Tile priority sort (coarse tiles before fine, then by distance from center)
- ✅ Gradient sky dome with horizon-to-zenith shader, depth-clamped, integrated with day/night cycle
- ✅ Map fog of war (visited cell tracking, dark overlay on unexplored areas, persisted to save file, Shift+M debug toggle)

---

## Project Context

**Family project:** Educational game for iPad deployment at schools. Viggo provides creative direction and UI feedback. Niklas handles implementation.

**Future goal:** Extract reusable "kosmos-engine" for other developers building block-world games or HCAI agents.

**Development workflow:**
- Claude.ai for planning and design discussions
- Claude Code for implementation
- This file updated after each completed task
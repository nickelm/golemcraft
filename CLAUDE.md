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

### Current System (February 2025)

**Whittaker diagram biome selection:**
- Temperature noise (freq 0.018)
- Humidity/precipitation noise (freq 0.012)
- Elevation noise (freq 0.015)
- 2D Whittaker lookup (temp × precip) with elevation modifiers
- Sub-biome variation noise for natural patches

**Height generation:**
- Domain warping for organic shapes
- Octave noise (5 octaves, freq 0.03)
- Biome-specific base height + scale
- Peak bonus for mountain biomes
- River/lake carving via noise isolines

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

## Terrain Improvement Roadmap

### Phase 1: Documentation ✓
New CLAUDE.md (this file).

### Phase 2: Whittaker Biomes ✓
Replaced 3×3×3 matrix with Whittaker diagram (temperature × precipitation).
- 4-tier temperature bands (frozen/cold/temperate/hot)
- 5-tier precipitation bands for finer gradation
- Elevation cooling above tree line (0.55)
- High elevation overrides for mountains/alpine/glacier
- Sub-biome variation noise for meadow/autumn_forest patches

### Phase 3: Deep Oceans
Very low frequency continental noise (0.002) creates landmasses.
- `deep_ocean` biome where continental noise < 0.25
- Much deeper than regular ocean (WATER_LEVEL - 8)
- Requires boats or bridges to cross

### Phase 4: Basin Rivers
Rivers flow to destinations (lakes, ocean), not random squiggles.
- Basin detection via low-frequency noise
- Rivers form in drainage paths toward basins
- Width increases approaching destination
- No rivers dead-ending in plains

### Phase 5: Local Roads
Connect settlements with terrain-aware pathfinding.
- Settlement placement via density noise + flatness check
- A* pathfinding with slope cost
- Switchbacks emerge naturally on steep terrain
- Visual: flattened dirt/gravel texture

### Phase 6: Visual Polish
- Stratified erosion for badlands/canyons
- Ground patches (wildflowers, dirt spots)
- Sub-biome variants

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
- `isRiver(x, z)`, `isLake(x, z)` — water features

Changes here affect all new chunks. Existing chunks regenerate when player returns.

---

## Conventions

- **Lowercase filenames** (matches Three.js style)
- **Pure functions** in shared code (worker compatibility)
- **Deterministic** from seed (no Math.random() in terrain)
- **No sync terrain** on main thread
- **Update CLAUDE.md** after completing each task

---

## Known Limitations

- Rivers don't flow to destinations (noise isolines only)
- No roads or settlements yet
- Biome selection is matrix-based, not Whittaker
- No deep oceans separating landmasses
- Landmarks limited to Mayan temples

---

## Project Context

**Family project:** Educational game for iPad deployment at schools. Viggo provides creative direction and UI feedback. Niklas handles implementation.

**Future goal:** Extract reusable "kosmos-engine" for other developers building block-world games or HCAI agents.

**Development workflow:**
- Claude.ai for planning and design discussions
- Claude Code for implementation
- This file updated after each completed task
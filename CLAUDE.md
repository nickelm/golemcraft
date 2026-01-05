# GolemCraft

A 3D heightmap/voxel RPG adventure game built with Three.js, playable in first-person or third-person view (WoW-style). Targets 60 FPS on modern iPads.

## Quick Start

```bash
npm install
npm run dev      # Development server at localhost:5173
npm run build    # Production build to dist/
```

## Game Design

**Genre**: Single-player RPG with voxel aesthetics. "Theme park MMO for one"—procedurally generated worlds with diverse biomes, landmarks, and adventure-focused gameplay.

**Perspective**: First-person or third-person camera (toggle), inspired by World of Warcraft.

**Visual target**: Eye-level detail with voxel charm. PBR materials planned for future iterations.

## Architecture Overview

**Hybrid terrain system**: Smooth heightfield for natural terrain + voxel mesh for structures (temples, caves). Z-buffer handles occlusion—heightfield renders everywhere, voxels layer on top.

**Web worker terrain**: All chunk generation happens in `terrainworker.js`. The worker is the single source of truth for terrain data. Main thread receives ready-to-render geometry via Transferables.

**Key data flow**:
1. `ChunkLoader` requests chunks by priority (distance from player)
2. `TerrainWorkerManager` queues requests to worker
3. Worker generates heightmap, voxel mask, surface types, block data, meshes
4. `ChunkBlockCache` stores block data for collision queries
5. `TerrainDataProvider` routes all terrain queries to cache

## Directory Structure

```
src/
├── workers/           # Web workers (terrainworker.js is critical)
├── shaders/           # GLSL shaders
├── world/
│   ├── terrain/       # Terrain generation, chunks, biomes
│   └── landmarks/     # Procedural structures (temples)
├── entities/          # Hero, mobs, items
├── atmosphere/        # Day/night, lighting, weather
├── controls/          # Camera, input, touch
└── debug/             # Performance monitor, collision debug
```

## Critical Files

- `src/workers/terrainworker.js` - Terrain generation (runs in worker)
- `src/world/terrain/chunkdatagenerator.js` - Pure functions for mesh generation
- `src/world/terrain/biomesystem.js` - Biome definitions (source of truth for biome config)
- `src/world/terrain/terrainchunks.js` - Chunk mesh management
- `src/shaders/` - Custom GLSL shaders
- `src/game.js` - Main game loop and initialization

## Texture Atlas

720×720 pixels, 10×10 grid of 72×72 cells (64×64 tile + 4px gutter).

Block types defined in `terraingenerator.js`:
- grass [0,0], stone [1,0], snow [2,0], dirt [3,0], water [4,0], sand [5,0], ice [6,0], mayan_stone [7,0]

## Performance Targets

| Device | Target FPS |
|--------|------------|
| iPad (current gen) | 60 |
| iPhone 14 Pro | 60 |
| iPad 6th gen | 15–25 |

**Optimizations**:
- Chunk size: 16×16
- Load radius: 8 chunks, unload radius: 10 chunks
- Surface-only water rendering (no side faces)
- Voxels only for landmarks—smooth heightfield everywhere else

## Conventions

- Lowercase filenames (matches Three.js style)
- Pure functions in shared code (worker/main thread compatibility)
- Deterministic generation from world seed
- No sync terrain generation on main thread

## Testing

Test on multiple devices:
- Desktop (Chrome/Firefox)
- iPad current gen (Safari) — must hit 60 FPS
- iPad 6th gen (Safari) — 15–25 FPS acceptable
- iPhone 14 Pro (Safari) — must hit 60 FPS

Debug tools:
- `P` key: Performance monitor
- `C` key: Collision debug overlay

## Known Issues

See TODO file for current bugs and planned features.

## Common Tasks

**Adding a new block type**:
1. Add to `BLOCK_TYPES` in `terraingenerator.js`
2. Add texture to atlas at specified [col, row]
3. Add to `BLOCK_TYPE_IDS` in `chunkdatagenerator.js`

**Adding a new biome**:
1. Add to `BIOMES` in `biomesystem.js`
2. Update biome selection logic in `terrainworker.js`

**Adding a landmark**:
1. Create definition in `landmarkdefinitions.js`
2. Register in `WorkerLandmarkSystem`

**Adding a shader**:
1. Create `.glsl` or `.vert`/`.frag` files in `src/shaders/`
2. Import via Vite's raw loader or shader chunk system
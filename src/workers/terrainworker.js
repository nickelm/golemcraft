/**
 * TerrainWorker - Web Worker for background chunk generation
 *
 * SINGLE SOURCE OF TRUTH for all terrain data.
 *
 * ARCHITECTURE: Worker-Based Terrain Generation
 * =============================================
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                        MAIN THREAD                              │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  ChunkLoader ──────► TerrainWorkerManager                       │
 * │      │                      │                                   │
 * │      │                      │ postMessage()                     │
 * │      │                      ▼                                   │
 * │      │              ┌───────────────┐                           │
 * │      │              │  WEB WORKER   │ (this file)               │
 * │      │              │               │                           │
 * │      │              │ ► Heightmap   │                           │
 * │      │              │ ► Meshes      │                           │
 * │      │              │ ► Block data  │                           │
 * │      │              │ ► Spawn pts   │                           │
 * │      │              │ ► Landmarks   │                           │
 * │      │              │ ► Objects     │                           │
 * │      │              └───────┬───────┘                           │
 * │      │                      │ Transferables                     │
 * │      │                      ▼                                   │
 * │      │              TerrainWorkerManager                        │
 * │      │                      │                                   │
 * │      │    ┌─────────────────┼─────────────────┐                 │
 * │      │    ▼                 ▼                 ▼                 │
 * │  ChunkBlockCache    SpawnPointManager   LandmarkRegistry        │
 * │      │                      │                 │                 │
 * │      ▼                      ▼                 ▼                 │
 * │  TerrainDataProvider   MobSpawner      Collision queries        │
 * │                                                                 │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Data flow: Worker is SINGLE SOURCE OF TRUTH for terrain.
 * Main thread only READS from worker-generated data.
 *
 * IMPROVEMENTS in this version:
 * - Domain warping for more organic terrain shapes
 * - Micro-detail noise for surface variation
 */

import { generateChunkData, getTransferables, CHUNK_SIZE, WATER_LEVEL } from '../world/terrain/chunkdatagenerator.js';
import { BIOMES } from '../world/terrain/biomesystem.js';
import { WorkerLandmarkSystem } from '../world/landmarks/workerlandmarksystem.js';
import { generateSpawnPoints } from './spawnpointgenerator.js';
import { generateObjectInstances } from './objectspawner.js';

const DEBUG_CHUNK_DELAY_MS = 0;

// ============================================================================
// NOISE FUNCTIONS
// ============================================================================

function hash(x, z, seed = 12345) {
    let h = seed + x * 374761393 + z * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
}

function hash2(x, z, seed = 12345) {
    let h = (seed * 7919) + x * 668265263 + z * 374761393;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
}

function noise2D(x, z, hashFn = hash) {
    const X = Math.floor(x);
    const Z = Math.floor(z);
    const fx = x - X;
    const fz = z - Z;
    const u = fx * fx * (3.0 - 2.0 * fx);
    const v = fz * fz * (3.0 - 2.0 * fz);
    const a = hashFn(X, Z);
    const b = hashFn(X + 1, Z);
    const c = hashFn(X, Z + 1);
    const d = hashFn(X + 1, Z + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function octaveNoise2D(x, z, octaves = 4, baseFreq = 0.05, hashFn = hash) {
    let total = 0;
    let frequency = baseFreq;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
        total += noise2D(x * frequency, z * frequency, hashFn) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }

    return total / maxValue;
}

// ============================================================================
// WORKER TERRAIN PROVIDER
// ============================================================================

class WorkerTerrainProvider {
    constructor(seed) {
        this.seed = seed;
        this.heightCache = new Map();
        this.continuousHeightCache = new Map();
        this.biomeCache = new Map();
        this.destroyedBlocks = new Set();
        this.landmarkSystem = new WorkerLandmarkSystem(this, seed);
    }

    setDestroyedBlocks(blocks) {
        this.destroyedBlocks = new Set(blocks);
    }

    getBiome(x, z) {
        const key = `${x},${z}`;
        if (this.biomeCache.has(key)) {
            return this.biomeCache.get(key);
        }

        const biomeNoise = octaveNoise2D(x, z, 4, 0.05, hash);
        const tempNoise = octaveNoise2D(x, z, 4, 0.06, hash2);
        const humidityNoise = octaveNoise2D(x, z, 3, 0.04, (x, z) => hash(x, z, 77777));

        const remappedNoise = Math.max(0, Math.min(1, (biomeNoise - 0.08) / 0.37));
        const remappedTemp = Math.max(0, Math.min(1, (tempNoise - 0.08) / 0.37));
        const remappedHumidity = Math.max(0, Math.min(1, (humidityNoise - 0.08) / 0.37));

        let biome;
        if (remappedNoise < 0.15) {
            biome = 'ocean';
        } else if (remappedNoise < 0.35) {
            if (remappedHumidity > 0.65 && remappedTemp > 0.4) {
                biome = 'jungle';
            } else if (remappedTemp > 0.5) {
                biome = 'desert';
            } else {
                biome = 'plains';
            }
        } else if (remappedNoise < 0.70) {
            if (remappedHumidity > 0.7 && remappedTemp > 0.45) {
                biome = 'jungle';
            } else if (remappedTemp > 0.55) {
                biome = 'desert';
            } else if (remappedTemp < 0.35) {
                biome = 'snow';
            } else {
                biome = 'plains';
            }
        } else if (remappedNoise < 0.85) {
            biome = remappedTemp < 0.3 ? 'snow' : 'mountains';
        } else {
            biome = remappedTemp < 0.25 ? 'snow' : 'mountains';
        }

        this.biomeCache.set(key, biome);
        return biome;
    }

    /**
     * Get continuous height - IMPROVED with domain warping and micro-detail
     */
    getContinuousHeight(x, z) {
        const key = `${x},${z}`;
        if (this.continuousHeightCache.has(key)) {
            return this.continuousHeightCache.get(key);
        }

        const biome = this.getBiome(x, z);
        const biomeData = BIOMES[biome];
        
        // Domain warping for organic terrain shapes
        const warpStrength = 2.5;
        const warpX = octaveNoise2D(x + 500, z, 2, 0.015, hash) * warpStrength;
        const warpZ = octaveNoise2D(x, z + 500, 2, 0.015, hash) * warpStrength;
        
        // Main terrain with warped coordinates
        const heightNoise = octaveNoise2D(x + warpX, z + warpZ, 5, 0.03);
        
        // Micro-detail for surface variation
        const microDetail = octaveNoise2D(x, z, 2, 0.12, hash2) * 0.25;
        
        let height = biomeData.baseHeight + heightNoise * biomeData.heightScale + microDetail;

        if (biome === 'mountains') {
            const peakNoise = octaveNoise2D(x, z, 3, 0.06);
            if (peakNoise > 0.5) {
                height += (peakNoise - 0.5) * 30;
            }
        }
        
        if (biome === 'jungle') {
            const jungleHillNoise = octaveNoise2D(x, z, 4, 0.08);
            height += jungleHillNoise * 4;
        }
        
        if (biome !== 'ocean' && biome !== 'desert' && this.isRiver(x, z)) {
            height = Math.min(height, WATER_LEVEL - 1);
        }
        
        if ((biome === 'plains' || biome === 'snow') && this.isLake(x, z)) {
            height = Math.min(height, WATER_LEVEL - 2);
        }

        if (biome === 'ocean') {
            height = Math.min(height, WATER_LEVEL - 2);
        }

        height = this.smoothBiomeTransitionContinuous(x, z, height);
        
        const finalHeight = Math.max(1.0, height);
        this.continuousHeightCache.set(key, finalHeight);
        return finalHeight;
    }

    getHeight(x, z) {
        const key = `${x},${z}`;
        if (this.heightCache.has(key)) {
            return this.heightCache.get(key);
        }

        const continuousHeight = this.getContinuousHeight(x, z);
        const finalHeight = Math.floor(continuousHeight);
        
        this.heightCache.set(key, finalHeight);
        return finalHeight;
    }
    
    smoothBiomeTransitionContinuous(x, z, height) {
        const radius = 3;
        let totalHeight = height;
        let count = 1;

        for (let dx = -radius; dx <= radius; dx += radius) {
            for (let dz = -radius; dz <= radius; dz += radius) {
                if (dx === 0 && dz === 0) continue;

                const neighborBiome = this.getBiome(x + dx, z + dz);
                const neighborData = BIOMES[neighborBiome];
                const neighborNoise = octaveNoise2D(x + dx, z + dz, 5, 0.03);
                let neighborHeight = neighborData.baseHeight + neighborNoise * neighborData.heightScale;
                
                if (neighborBiome === 'mountains') {
                    const peakNoise = octaveNoise2D(x + dx, z + dz, 3, 0.06);
                    if (peakNoise > 0.5) {
                        neighborHeight += (peakNoise - 0.5) * 30;
                    }
                }
                
                if (neighborBiome === 'jungle') {
                    const jungleHillNoise = octaveNoise2D(x + dx, z + dz, 4, 0.08);
                    neighborHeight += jungleHillNoise * 4;
                }
                
                totalHeight += neighborHeight;
                count++;
            }
        }
        return totalHeight / count;
    }
    
    isRiver(x, z) {
        const riverNoise = octaveNoise2D(x, z, 2, 0.008, (x, z) => hash(x, z, 55555));
        return Math.abs(riverNoise - 0.5) < 0.02;
    }
    
    isLake(x, z) {
        const lakeNoise = octaveNoise2D(x, z, 2, 0.02, (x, z) => hash(x, z, 66666));
        return lakeNoise > 0.65;
    }

    /**
     * Determine if a cell should use voxel rendering/collision
     * Returns true ONLY for landmark areas (temples, structures, etc.)
     * 
     * Steep slopes are now handled by slope collision in the heightfield,
     * not by voxel rendering. This dramatically reduces triangle count.
     * 
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if cell should use voxels
     */
    shouldUseVoxels(x, z) {
        // Only use voxels for landmarks
        return this.landmarkSystem.isInsideLandmark(x, z);
    }

    getBlockType(x, y, z) {
        if (this.destroyedBlocks.has(`${x},${y},${z}`)) return null;

        const landmarkBlock = this.landmarkSystem.getLandmarkBlockType(x, y, z);
        if (landmarkBlock !== null) {
            // 'air' means forced air (carved space) - return null to create air
            if (landmarkBlock === 'air') return null;
            // Otherwise return the landmark block type
            return landmarkBlock;
        }

        const height = this.getHeight(x, z);
        const biome = this.getBiome(x, z);
        const biomeData = BIOMES[biome];

        if (y > height && y > WATER_LEVEL) return null;

        if (y > height && y <= WATER_LEVEL) {
            if (biome === 'snow' && y === WATER_LEVEL) return 'ice';
            if (y === WATER_LEVEL) return 'water';
            return 'water_full';
        }

        if (y === height) {
            if (height < WATER_LEVEL) return biomeData.underwater || 'sand';
            if (height <= WATER_LEVEL + 2 && biome !== 'desert' && biome !== 'snow') return 'sand';
            if (biome === 'mountains' && height > 22) return 'snow';
            return biomeData.surface;
        }

        if (y >= height - 3) {
            if (height <= WATER_LEVEL + 2 && biome !== 'snow') return 'sand';
            return biomeData.subsurface || 'dirt';
        }

        return 'stone';
    }
    
    getSurfaceBlockType(x, z) {
        const height = this.getHeight(x, z);
        const biome = this.getBiome(x, z);
        const biomeData = BIOMES[biome];

        if (height < WATER_LEVEL) return biomeData.underwater || 'sand';
        if (height <= WATER_LEVEL + 2 && biome !== 'desert' && biome !== 'snow') return 'sand';
        if (biome === 'mountains' && height > 22) return 'snow';
        return biomeData.surface;
    }

    /**
     * Get brightness override for air spaces in landmarks
     * @param {number} x - World X
     * @param {number} y - World Y
     * @param {number} z - World Z
     * @returns {number|null} Brightness (0.0-1.0) or null if no override
     */
    getBrightnessOverride(x, y, z) {
        return this.landmarkSystem.getLandmarkBrightnessOverride(x, y, z);
    }

    /**
     * Check if heightfield should be skipped at this position (for cave floors, etc.)
     * @param {number} x - World X
     * @param {number} z - World Z
     * @returns {boolean} True to skip heightfield rendering at this cell
     */
    shouldSkipHeightfield(x, z) {
        return this.landmarkSystem.shouldSkipHeightfield(x, z);
    }

    prepareLandmarksForChunk(chunkX, chunkZ) {
        this.landmarkSystem.ensureLandmarksForChunk(chunkX, chunkZ);
    }

    /**
     * Get heightfield modifications for landmarks affecting a chunk
     * @param {number} chunkX - Chunk X index
     * @param {number} chunkZ - Chunk Z index
     * @returns {Array} Array of modification specs
     */
    getHeightfieldModifications(chunkX, chunkZ) {
        return this.landmarkSystem.getHeightfieldModifications(chunkX, chunkZ);
    }
}

// ============================================================================
// CHUNK GENERATION
// ============================================================================

function doGenerateChunk(data) {
    if (data.destroyedBlocks) {
        terrainProvider.setDestroyedBlocks(data.destroyedBlocks);
    }

    terrainProvider.prepareLandmarksForChunk(data.chunkX, data.chunkZ);

    const startTime = performance.now();
    const chunkData = generateChunkData(terrainProvider, data.chunkX, data.chunkZ, useDithering);

    // Generate spawn points for this chunk
    // Create a hash wrapper that returns integers for the spawn point generator
    const hashFn = (x, z, seed) => {
        let h = (seed || 12345) + x * 374761393 + z * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        return (h ^ (h >> 16)) & 0x7fffffff;  // Return positive integer
    };

    chunkData.spawnPoints = generateSpawnPoints(
        terrainProvider,
        data.chunkX,
        data.chunkZ,
        terrainProvider.landmarkSystem,
        hashFn
    );

    // Generate static object instances (trees, rocks, cacti, etc.)
    // Pass the smoothed heightmap so objects sit on the actual rendered terrain
    chunkData.staticObjects = generateObjectInstances(
        terrainProvider,
        data.chunkX,
        data.chunkZ,
        terrainProvider.seed,
        WATER_LEVEL,
        chunkData.heightmap
    );

    // Get landmark metadata for this chunk (for main thread registry)
    chunkData.landmarkMetadata = terrainProvider.landmarkSystem.getLandmarkMetadataForChunk(
        data.chunkX,
        data.chunkZ
    );

    const genTime = performance.now() - startTime;

    const transferables = getTransferables(chunkData);

    self.postMessage({
        type: 'chunkGenerated',
        chunkX: data.chunkX,
        chunkZ: data.chunkZ,
        chunkData,
        genTime
    }, transferables);
}

// ============================================================================
// WORKER MESSAGE HANDLING
// ============================================================================

let terrainProvider = null;
let useDithering = false;

self.onmessage = function(e) {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            terrainProvider = new WorkerTerrainProvider(data.seed);
            // Set dithering mode based on texture blending tier
            useDithering = (data.textureBlending === 'low');
            if (DEBUG_CHUNK_DELAY_MS > 0) {
                console.warn(`[WORKER] DEBUG MODE: ${DEBUG_CHUNK_DELAY_MS}ms delay per chunk`);
            }
            console.log(`[WORKER] Initialized with textureBlending=${data.textureBlending}, useDithering=${useDithering}`);
            self.postMessage({ type: 'ready' });
            break;

        case 'generateChunk':
            if (!terrainProvider) {
                self.postMessage({ 
                    type: 'error', 
                    error: 'Terrain not initialized',
                    chunkX: data.chunkX,
                    chunkZ: data.chunkZ
                });
                return;
            }

            if (DEBUG_CHUNK_DELAY_MS > 0) {
                setTimeout(() => doGenerateChunk(data), DEBUG_CHUNK_DELAY_MS);
            } else {
                doGenerateChunk(data);
            }
            break;

        case 'updateDestroyedBlocks':
            if (terrainProvider) {
                terrainProvider.setDestroyedBlocks(data.blocks);
            }
            break;

        default:
            console.warn('TerrainWorker: Unknown message type:', type);
    }
};
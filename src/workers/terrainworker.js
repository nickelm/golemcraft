/**
 * TerrainWorker - Web Worker for background chunk generation
 * 
 * This worker is the SINGLE SOURCE OF TRUTH for all terrain data.
 * It generates:
 * - Terrain heightmap (continuous floats) and blocks
 * - Landmark structures (temples, ruins, etc.)
 * - Surface mesh (smooth heightmap triangulation)
 * - Voxel mesh (for caves, structures, cliffs)
 * - Block data for collision in voxel regions
 * 
 * The main thread receives and caches data but does NOT generate terrain.
 * 
 * SMOOTH TERRAIN ARCHITECTURE:
 * - getContinuousHeight() returns float heights for smooth terrain
 * - getHeight() returns integer heights for voxel regions
 * - voxelMask indicates which XZ cells use voxel collision vs heightmap
 */

import { generateChunkData, getTransferables, CHUNK_SIZE, WATER_LEVEL } from '../world/terrain/chunkdatagenerator.js';
import { BIOMES } from '../world/terrain/biomesystem.js';
import { WorkerLandmarkSystem } from '../world/landmarks/workerlandmarksystem.js';

// ============================================================================
// DEBUG: Set to 0 for production, 200+ for testing chunk cancellation
// ============================================================================
const DEBUG_CHUNK_DELAY_MS = 0;  // Set to 200 for testing, 0 for production

// ============================================================================
// NOISE FUNCTIONS (pure math, no dependencies)
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
        this.heightCache = new Map();           // Integer heights (for voxels)
        this.continuousHeightCache = new Map(); // Float heights (for smooth terrain)
        this.biomeCache = new Map();
        this.destroyedBlocks = new Set();
        
        // Landmark system - generates landmarks internally
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
     * Get continuous (float) height at position - for smooth terrain
     * This is the TRUE height before discretization
     * 
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {number} Continuous height value (float)
     */
    getContinuousHeight(x, z) {
        const key = `${x},${z}`;
        if (this.continuousHeightCache.has(key)) {
            return this.continuousHeightCache.get(key);
        }

        const biome = this.getBiome(x, z);
        const biomeData = BIOMES[biome];
        const heightNoise = octaveNoise2D(x, z, 5, 0.03);
        let height = biomeData.baseHeight + heightNoise * biomeData.heightScale;

        // Add mountain peaks in mountain biome
        if (biome === 'mountains') {
            const peakNoise = octaveNoise2D(x, z, 3, 0.06);
            if (peakNoise > 0.5) {
                height += (peakNoise - 0.5) * 30;
            }
        }
        
        // Jungle has more varied terrain with hills
        if (biome === 'jungle') {
            const jungleHillNoise = octaveNoise2D(x, z, 4, 0.08);
            height += jungleHillNoise * 4;
        }
        
        // Carve rivers
        if (biome !== 'ocean' && biome !== 'desert' && this.isRiver(x, z)) {
            height = Math.min(height, WATER_LEVEL - 1);
        }
        
        // Carve lakes
        if ((biome === 'plains' || biome === 'snow') && this.isLake(x, z)) {
            height = Math.min(height, WATER_LEVEL - 2);
        }

        if (biome === 'ocean') {
            height = Math.min(height, WATER_LEVEL - 2);
        }

        // Apply biome transition smoothing
        height = this.smoothBiomeTransitionContinuous(x, z, height);
        
        // Clamp to valid range but keep as float
        const finalHeight = Math.max(1.0, height);
        this.continuousHeightCache.set(key, finalHeight);
        return finalHeight;
    }

    /**
     * Get integer height at position - for voxel regions
     * This is the discretized height for block placement
     * 
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {number} Integer height value
     */
    getHeight(x, z) {
        const key = `${x},${z}`;
        if (this.heightCache.has(key)) {
            return this.heightCache.get(key);
        }

        // Get continuous height and floor it
        const continuousHeight = this.getContinuousHeight(x, z);
        const finalHeight = Math.floor(continuousHeight);
        
        this.heightCache.set(key, finalHeight);
        return finalHeight;
    }
    
    /**
     * Smooth biome transition for continuous heights
     * Returns float values, not integers
     */
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
                
                // Apply same modifications as main height calculation
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
    
    // River detection
    isRiver(x, z) {
        const riverNoise = octaveNoise2D(x, z, 2, 0.008, (x, z) => hash(x, z, 55555));
        return Math.abs(riverNoise - 0.5) < 0.02;
    }
    
    // Lake detection
    isLake(x, z) {
        const lakeNoise = octaveNoise2D(x, z, 2, 0.02, (x, z) => hash(x, z, 66666));
        return lakeNoise > 0.65;
    }

    /**
     * Determine if a cell should use voxel rendering/collision
     * Returns true if the cell has features that require voxel representation
     * 
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if cell should use voxels
     */
    shouldUseVoxels(x, z) {
        // Check if there's a landmark at this position
        if (this.landmarkSystem.isInsideLandmark(x, z)) {
            return true;
        }
        
        // Check for steep slopes (potential cliffs)
        const height = this.getContinuousHeight(x, z);
        const heightN = this.getContinuousHeight(x, z - 1);
        const heightS = this.getContinuousHeight(x, z + 1);
        const heightE = this.getContinuousHeight(x + 1, z);
        const heightW = this.getContinuousHeight(x - 1, z);
        
        const maxSlope = Math.max(
            Math.abs(height - heightN),
            Math.abs(height - heightS),
            Math.abs(height - heightE),
            Math.abs(height - heightW)
        );
        
        // If slope is greater than 2 blocks, use voxels (cliff face)
        if (maxSlope > 2.0) {
            return true;
        }
        
        // Check for craggy mountain peaks
        const biome = this.getBiome(x, z);
        if (biome === 'mountains' && height > 25) {
            // High mountain areas use voxels for craggy appearance
            return true;
        }
        
        // TODO: Add cave entrance detection here
        // if (hasCaveEntrance(x, z)) return true;
        
        return false;
    }


    getBlockType(x, y, z) {
        // Check destroyed blocks
        if (this.destroyedBlocks.has(`${x},${y},${z}`)) return null;

        // Check landmark blocks FIRST (pyramids, ruins, etc.)
        const landmarkBlock = this.landmarkSystem.getLandmarkBlockType(x, y, z);
        if (landmarkBlock) {
            return landmarkBlock;
        }

        const height = this.getHeight(x, z);
        const biome = this.getBiome(x, z);
        const biomeData = BIOMES[biome];

        // Air above terrain and water
        if (y > height && y > WATER_LEVEL) return null;

        // Water blocks
        if (y > height && y <= WATER_LEVEL) {
            if (biome === 'snow' && y === WATER_LEVEL) return 'ice';
            if (y === WATER_LEVEL) return 'water';
            return 'water_full';
        }

        // Surface block
        if (y === height) {
            if (height < WATER_LEVEL) return biomeData.underwater || 'sand';
            if (height <= WATER_LEVEL + 2 && biome !== 'desert' && biome !== 'snow') return 'sand';
            if (biome === 'mountains' && height > 22) return 'snow';
            return biomeData.surface;
        }

        // Subsurface
        if (y >= height - 3) {
            if (height <= WATER_LEVEL + 2 && biome !== 'snow') return 'sand';
            return biomeData.subsurface || 'dirt';
        }

        // Deep underground
        return 'stone';
    }
    
    /**
     * Get surface block type at position (for texture blending)
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {string} Surface block type
     */
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
     * Ensure landmarks are generated for a chunk before mesh generation
     */
    prepareLandmarksForChunk(chunkX, chunkZ) {
        this.landmarkSystem.ensureLandmarksForChunk(chunkX, chunkZ);
    }
}

// ============================================================================
// CHUNK GENERATION FUNCTION
// ============================================================================

function doGenerateChunk(data) {
    // Update destroyed blocks if provided
    if (data.destroyedBlocks) {
        terrainProvider.setDestroyedBlocks(data.destroyedBlocks);
    }

    // Ensure landmarks are generated for this chunk
    terrainProvider.prepareLandmarksForChunk(data.chunkX, data.chunkZ);

    const startTime = performance.now();
    
    // Generate mesh and block data (now includes heightmap and voxelMask)
    const chunkData = generateChunkData(terrainProvider, data.chunkX, data.chunkZ);
    
    const genTime = performance.now() - startTime;

    // Get transferable buffers for zero-copy transfer
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
// WORKER STATE AND MESSAGE HANDLING
// ============================================================================

let terrainProvider = null;

self.onmessage = function(e) {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            terrainProvider = new WorkerTerrainProvider(data.seed);
            if (DEBUG_CHUNK_DELAY_MS > 0) {
                console.warn(`[WORKER] DEBUG MODE: ${DEBUG_CHUNK_DELAY_MS}ms delay per chunk`);
            }
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

            // DEBUG: Artificial delay for testing chunk cancellation
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
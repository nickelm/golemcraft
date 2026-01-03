/**
 * TerrainWorker - Web Worker for background chunk generation
 * 
 * This worker imports the SAME chunk generation code as the main thread.
 * It only handles:
 * - Receiving chunk requests
 * - Calling the shared generateChunkData function
 * - Sending results back with transferable arrays
 * 
 * The terrain logic (noise, biomes, blocks) must be provided by the main thread
 * OR duplicated here. We duplicate the TerrainGenerator logic since it's pure math.
 */

import { generateChunkData, getTransferables, CHUNK_SIZE, WATER_LEVEL } from '../world/terrain/chunkdatagenerator.js';

// ============================================================================
// TERRAIN GENERATOR (duplicated - pure math, no dependencies)
// ============================================================================

// Noise functions
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

// Biome definitions
const BIOMES = {
    ocean: { baseHeight: 3, heightScale: 2, surface: 'sand', subsurface: 'sand', underwater: 'sand' },
    plains: { baseHeight: 8, heightScale: 4, surface: 'grass', subsurface: 'dirt', underwater: 'sand' },
    desert: { baseHeight: 7, heightScale: 4, surface: 'sand', subsurface: 'sand', underwater: 'sand' },
    snow: { baseHeight: 9, heightScale: 5, surface: 'snow', subsurface: 'dirt', underwater: 'sand' },
    mountains: { baseHeight: 18, heightScale: 20, surface: 'stone', subsurface: 'stone', underwater: 'sand' },
    jungle: { baseHeight: 10, heightScale: 8, surface: 'grass', subsurface: 'dirt', underwater: 'sand' }
};

/**
 * Worker-side terrain provider
 * Implements getHeight() and getBlockType() matching main thread's TerrainGenerator
 */
class WorkerTerrainProvider {
    constructor(seed) {
        this.seed = seed;
        this.destroyedBlocks = new Set();
        this.landmarkBlocks = new Map();
    }

    setDestroyedBlocks(blocks) {
        this.destroyedBlocks = new Set(blocks);
    }

    setLandmarkBlocks(blocks) {
        this.landmarkBlocks = new Map(blocks);
    }

    getBiome(x, z) {
        const biomeNoise = octaveNoise2D(x, z, 4, 0.05, hash);
        const tempNoise = octaveNoise2D(x, z, 4, 0.06, hash2);
        const humidityNoise = octaveNoise2D(x, z, 3, 0.04, (x, z) => hash(x, z, 77777));

        const remappedNoise = Math.max(0, Math.min(1, (biomeNoise - 0.08) / 0.37));
        const remappedTemp = Math.max(0, Math.min(1, (tempNoise - 0.08) / 0.37));
        const remappedHumidity = Math.max(0, Math.min(1, (humidityNoise - 0.08) / 0.37));

        if (remappedNoise < 0.15) return 'ocean';
        if (remappedNoise < 0.35) {
            if (remappedHumidity > 0.65 && remappedTemp > 0.4) return 'jungle';
            if (remappedTemp > 0.5) return 'desert';
            return 'plains';
        }
        if (remappedNoise < 0.70) {
            if (remappedHumidity > 0.7 && remappedTemp > 0.45) return 'jungle';
            if (remappedTemp > 0.55) return 'desert';
            if (remappedTemp < 0.35) return 'snow';
            return 'plains';
        }
        if (remappedNoise < 0.85) return remappedTemp < 0.3 ? 'snow' : 'mountains';
        return 'mountains';
    }

    isRiver(x, z) {
        const riverNoise = octaveNoise2D(x, z, 3, 0.02, hash2);
        return Math.abs(riverNoise - 0.5) < 0.03;
    }

    isLake(x, z) {
        const lakeNoise = octaveNoise2D(x, z, 2, 0.04, hash2);
        return lakeNoise < 0.2;
    }

    getHeight(x, z) {
        const biome = this.getBiome(x, z);
        const biomeData = BIOMES[biome];
        const terrainNoise = octaveNoise2D(x, z, 5, 0.03);
        let height = biomeData.baseHeight + terrainNoise * biomeData.heightScale;

        if (biome === 'mountains') {
            const peakNoise = octaveNoise2D(x, z, 3, 0.06);
            if (peakNoise > 0.5) height += (peakNoise - 0.5) * 30;
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

        height = this.smoothBiomeTransition(x, z, height);
        return Math.floor(Math.max(1, height));
    }

    smoothBiomeTransition(x, z, height) {
        const radius = 3;
        let totalHeight = height;
        let count = 1;
        for (let dx = -radius; dx <= radius; dx += radius) {
            for (let dz = -radius; dz <= radius; dz += radius) {
                if (dx === 0 && dz === 0) continue;
                const neighborBiome = this.getBiome(x + dx, z + dz);
                const neighborData = BIOMES[neighborBiome];
                const neighborNoise = octaveNoise2D(x + dx, z + dz, 5, 0.03);
                const neighborHeight = neighborData.baseHeight + neighborNoise * neighborData.heightScale;
                totalHeight += neighborHeight;
                count++;
            }
        }
        return totalHeight / count;
    }

    getBlockType(x, y, z) {
        // Check destroyed blocks
        if (this.destroyedBlocks.has(`${x},${y},${z}`)) return null;

        // Check landmark blocks
        const landmarkKey = `${x},${y},${z}`;
        if (this.landmarkBlocks.has(landmarkKey)) {
            return this.landmarkBlocks.get(landmarkKey);
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

            // Update state if provided
            if (data.destroyedBlocks) {
                terrainProvider.setDestroyedBlocks(data.destroyedBlocks);
            }
            if (data.landmarkBlocks) {
                terrainProvider.setLandmarkBlocks(data.landmarkBlocks);
            }

            const startTime = performance.now();
            
            // Use the SHARED generation function
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
            break;

        case 'updateDestroyedBlocks':
            if (terrainProvider) {
                terrainProvider.setDestroyedBlocks(data.blocks);
            }
            break;

        case 'updateLandmarkBlocks':
            if (terrainProvider) {
                terrainProvider.setLandmarkBlocks(data.blocks);
            }
            break;

        default:
            console.warn('TerrainWorker: Unknown message type:', type);
    }
};
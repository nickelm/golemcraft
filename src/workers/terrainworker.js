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
import {
    BIOMES,
    getSurfaceTexture,
    getSubsurfaceTexture,
    getUnderwaterTexture
} from '../world/terrain/biomesystem.js';
import { HEIGHT_CONFIG } from '../world/terrain/worldgen.js';
import { WorkerLandmarkSystem } from '../world/landmarks/workerlandmarksystem.js';
import { generateSpawnPoints } from './spawnpointgenerator.js';
import { generateObjectInstances } from './objectspawner.js';

const DEBUG_CHUNK_DELAY_MS = 0;

// ============================================================================
// BIOME HEIGHT HELPERS
// ============================================================================

/**
 * Get base height for a biome, using fractions with backward compatibility
 * @param {Object} biomeData - Biome configuration object
 * @returns {number} Base height in blocks
 */
function getBiomeBaseHeight(biomeData) {
    return biomeData.baseHeightFraction !== undefined
        ? biomeData.baseHeightFraction * HEIGHT_CONFIG.maxHeight
        : biomeData.baseHeight;
}

/**
 * Get height scale for a biome, using fractions with backward compatibility
 * @param {Object} biomeData - Biome configuration object
 * @returns {number} Height scale in blocks
 */
function getBiomeHeightScale(biomeData) {
    return biomeData.heightScaleFraction !== undefined
        ? biomeData.heightScaleFraction * HEIGHT_CONFIG.maxHeight
        : biomeData.heightScale;
}

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
// CONTINENTAL NOISE (Phase 3: Deep Oceans)
// ============================================================================

/**
 * Continental noise configuration
 * Very low frequency creates continent-scale land/ocean distribution
 */
const CONTINENTAL_CONFIG = {
    frequency: 0.002,        // Very low freq = ~500 block wavelength
    octaves: 2,              // Smooth continental shapes
    threshold_deep: 0.22,    // Below = deep_ocean (bottomless abyss)
    threshold_land: 0.38,    // Above = land biomes; between = coastal ocean
};

/**
 * Sample continental noise at world position
 * Returns [0, 1] value indicating how "continental" (land-like) the position is
 * Low values = deep ocean, mid values = coastal ocean, high values = land
 *
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {number} Continentalness value [0, 1]
 */
function getContinentalNoise(x, z) {
    // Domain warping for organic coastlines
    const warpStrength = 40;
    const warpX = octaveNoise2D(x + 1000, z, 2, 0.003, hash) * warpStrength;
    const warpZ = octaveNoise2D(x, z + 1000, 2, 0.003, hash) * warpStrength;

    const raw = octaveNoise2D(
        x + warpX,
        z + warpZ,
        CONTINENTAL_CONFIG.octaves,
        CONTINENTAL_CONFIG.frequency,
        (x, z) => hash(x, z, 99999)  // Unique seed for continental noise
    );

    // Normalize from typical noise range [0.08, 0.45] to [0, 1]
    return Math.max(0, Math.min(1, (raw - 0.08) / 0.37));
}

// ============================================================================
// CLIMATE-BASED BIOME SELECTION (16-biome system)
// ============================================================================

// Biomes that receive dramatic peak height variation
const PEAK_BIOMES = ['mountains', 'glacier', 'alpine', 'badlands', 'highlands'];

/**
 * Select biome using Whittaker diagram approach
 * Uses continuous temperature and precipitation values with elevation modifiers
 *
 * Temperature × Precipitation as primary 2D axes (like a real Whittaker diagram)
 * Elevation modifies effective temperature (mountains are colder) and provides overrides
 *
 * @param {number} temp - Raw temperature [0, 1]
 * @param {number} precip - Precipitation/humidity [0, 1]
 * @param {number} elevation - Terrain elevation [0, 1]
 * @returns {string} Biome name
 */
function selectBiomeFromWhittaker(temp, precip, elevation) {
    // Apply elevation cooling (one-directional, above tree line only)
    const TREE_LINE = 0.55;
    const COOLING_RATE = 0.45;

    let effectiveTemp = temp;
    if (elevation > TREE_LINE) {
        effectiveTemp = temp - (elevation - TREE_LINE) * COOLING_RATE;
    }
    effectiveTemp = Math.max(0, effectiveTemp);

    // High elevation overrides (above 0.75)
    if (elevation > 0.75) {
        if (effectiveTemp < 0.20) return 'glacier';
        if (effectiveTemp < 0.50) return 'alpine';
        return 'mountains';
    }

    // Mid-high elevation (0.60-0.75)
    if (elevation > 0.60) {
        if (effectiveTemp < 0.25) return 'glacier';
        if (effectiveTemp < 0.55) return 'alpine';
        if (precip < 0.35) return 'highlands';
        return 'mountains';
    }

    // FROZEN ZONE (effectiveTemp < 0.20)
    if (effectiveTemp < 0.20) {
        if (precip < 0.35) return 'tundra';
        return 'glacier';
    }

    // COLD ZONE (0.20-0.50) - widened for more contiguous snow/taiga regions
    if (effectiveTemp < 0.50) {
        if (precip < 0.30) return 'tundra';
        if (precip < 0.65) return 'snow';  // Wider range for snow
        return 'taiga';
    }

    // TEMPERATE ZONE (0.50-0.72)
    if (effectiveTemp < 0.72) {
        if (precip < 0.28) return 'meadow';
        if (precip < 0.50) return 'plains';
        if (precip < 0.68) return 'deciduous_forest';
        if (precip < 0.82) return 'autumn_forest';
        return 'swamp';
    }

    // HOT ZONE (>= 0.70)
    if (precip < 0.20) return 'desert';
    if (precip < 0.35) return 'red_desert';
    if (precip < 0.50) return 'savanna';
    if (precip < 0.70) return 'jungle';
    return elevation < 0.25 ? 'rainforest' : 'jungle';
}

/**
 * Apply sub-biome variation for natural patchiness within larger biomes
 * Uses high-frequency noise to create patches of variant biomes
 *
 * @param {string} baseBiome - Primary biome from Whittaker lookup
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {string} Final biome (possibly a variant)
 */
function applySubBiomeVariation(baseBiome, x, z) {
    const variationNoise = octaveNoise2D(x, z, 2, 0.08, (x, z) => hash(x, z, 88888));

    const SUB_BIOMES = {
        'plains': { threshold: 0.7, variant: 'meadow' },
        'deciduous_forest': { threshold: 0.75, variant: 'autumn_forest' },
        'desert': { threshold: 0.8, variant: 'red_desert' },
        'jungle': { threshold: 0.85, variant: 'rainforest' }
    };

    const subBiome = SUB_BIOMES[baseBiome];
    if (subBiome && variationNoise > subBiome.threshold) {
        return subBiome.variant;
    }
    return baseBiome;
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

        // Ephemeral heightfield holes from explosions
        // Map of "chunkX,chunkZ" -> Set of "lx,lz" strings
        this.heightfieldHoles = new Map();
    }

    setDestroyedBlocks(blocks) {
        this.destroyedBlocks = new Set(blocks);
    }

    /**
     * Set heightfield holes from main thread
     * @param {Object} holesData - Object with chunkKey -> array of "lx,lz" strings
     */
    setHeightfieldHoles(holesData) {
        this.heightfieldHoles.clear();
        for (const [chunkKey, holes] of Object.entries(holesData)) {
            this.heightfieldHoles.set(chunkKey, new Set(holes));
        }
    }

    getBiome(x, z) {
        const key = `${x},${z}`;
        if (this.biomeCache.has(key)) {
            return this.biomeCache.get(key);
        }

        // Continental noise determines ocean vs land at large scale
        const continentalness = getContinentalNoise(x, z);

        // Deep ocean: bottomless abyss separating continents
        if (continentalness < CONTINENTAL_CONFIG.threshold_deep) {
            this.biomeCache.set(key, 'deep_ocean');
            return 'deep_ocean';
        }

        // Coastal ocean: transition zone with sandy floor
        if (continentalness < CONTINENTAL_CONFIG.threshold_land) {
            this.biomeCache.set(key, 'ocean');
            return 'ocean';
        }

        // Land biomes: use Whittaker climate-based selection
        const elevationNoise = octaveNoise2D(x, z, 4, 0.015, hash);
        const tempNoise = octaveNoise2D(x, z, 4, 0.018, hash2);
        const humidityNoise = octaveNoise2D(x, z, 3, 0.012, (x, z) => hash(x, z, 77777));

        // Normalize to [0, 1]
        const elevation = Math.max(0, Math.min(1, (elevationNoise - 0.08) / 0.37));
        const temp = Math.max(0, Math.min(1, (tempNoise - 0.08) / 0.37));
        const humidity = Math.max(0, Math.min(1, (humidityNoise - 0.08) / 0.37));

        // Whittaker-based selection using continuous values
        let biome = selectBiomeFromWhittaker(temp, humidity, elevation);

        // Apply sub-biome variation for natural patchiness
        biome = applySubBiomeVariation(biome, x, z);

        // Note: Beach detection happens in getBlockType() via isNearOcean(),
        // not here, to avoid infinite recursion (isNearOcean calls getBiome)

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

        // Deep ocean: bottomless abyss (very low floor)
        // Returns height just above bedrock - player sinks endlessly
        if (biome === 'deep_ocean') {
            const deepOceanFloor = 0.5;
            this.continuousHeightCache.set(key, deepOceanFloor);
            return deepOceanFloor;
        }

        // Domain warping for organic terrain shapes
        const warpStrength = 2.5;
        const warpX = octaveNoise2D(x + 500, z, 2, 0.015, hash) * warpStrength;
        const warpZ = octaveNoise2D(x, z + 500, 2, 0.015, hash) * warpStrength;
        
        // Main terrain with warped coordinates
        const heightNoise = octaveNoise2D(x + warpX, z + warpZ, 5, 0.03);
        
        // Micro-detail for surface variation
        const microDetail = octaveNoise2D(x, z, 2, 0.12, hash2) * 0.25;
        
        let height = getBiomeBaseHeight(biomeData) + heightNoise * getBiomeHeightScale(biomeData) + microDetail;
        let debugLog = null;

        // Apply peak variation to all high-elevation biomes (mountains, glacier, alpine, badlands, highlands)
        if (PEAK_BIOMES.includes(biome)) {
            const peakNoise = octaveNoise2D(x, z, 3, 0.04);  // 0.06 → 0.04 (larger, less frequent peaks)

            // Use FULL range of peak noise (0-1) for dramatic height variation
            // Increased multiplier to push peaks to 50-60 range
            const peakBonus = peakNoise * 50;  // Max +50 blocks when peakNoise=1.0 (total max: 18+20+0.25+50=88.25 - EXCEEDS 64!)
            height += peakBonus;

            // DEBUG: Track significant peaks
            if (peakBonus > 25) {
                debugLog = {
                    x, z, biome,
                    baseHeight: getBiomeBaseHeight(biomeData),
                    heightNoise: heightNoise.toFixed(3),
                    heightScale: getBiomeHeightScale(biomeData),
                    microDetail: microDetail.toFixed(3),
                    peakNoise: peakNoise.toFixed(3),
                    peakBonus: peakBonus.toFixed(2),
                    heightBeforeWater: height.toFixed(2)
                };
            }
        }

        if (biome === 'jungle') {
            const jungleHillNoise = octaveNoise2D(x, z, 4, 0.08);
            height += jungleHillNoise * 4;
        }

        if (biome !== 'ocean' && biome !== 'deep_ocean' && biome !== 'desert' && this.isRiver(x, z)) {
            height = Math.min(height, WATER_LEVEL - 1);
        }

        if ((biome === 'plains' || biome === 'snow') && this.isLake(x, z)) {
            height = Math.min(height, WATER_LEVEL - 2);
        }

        if (biome === 'ocean') {
            height = Math.min(height, WATER_LEVEL - 2);
        }

        if (debugLog) {
            debugLog.heightAfterWater = height.toFixed(2);
        }

        height = this.smoothBiomeTransitionContinuous(x, z, height);

        if (debugLog) {
            debugLog.heightAfterSmoothing = height.toFixed(2);
        }

        // Clamp to safe maximum (leave 1 block margin below 64)
        const finalHeight = Math.max(1.0, Math.min(63.0, height));

        if (debugLog) {
            debugLog.finalHeight = finalHeight.toFixed(2);
            if (height > 63.0) {
                debugLog.CLAMPED = `${height.toFixed(2)} → 63.0`;
            }
            console.log('[MOUNTAIN PEAK DEBUG]', JSON.stringify(debugLog, null, 2));
        }

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

    /**
     * Check if a biome is any type of ocean
     * @param {string} biome - Biome name
     * @returns {boolean} True if ocean or deep_ocean
     */
    isOceanBiome(biome) {
        return biome === 'ocean' || biome === 'deep_ocean';
    }

    /**
     * Check if position is within 5 blocks of ocean horizontally
     * Samples in square pattern for efficiency
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if within beach distance of ocean
     */
    isNearOcean(x, z) {
        const BEACH_RADIUS = 5;
        const SAMPLE_STEP = 2;  // Sample every 2 blocks for efficiency

        // Quick check: if this cell is any ocean type, it's not a beach
        if (this.isOceanBiome(this.getBiome(x, z))) return false;

        // Sample in expanding squares
        for (let r = SAMPLE_STEP; r <= BEACH_RADIUS; r += SAMPLE_STEP) {
            // Check cardinal directions
            if (this.isOceanBiome(this.getBiome(x + r, z))) return true;
            if (this.isOceanBiome(this.getBiome(x - r, z))) return true;
            if (this.isOceanBiome(this.getBiome(x, z + r))) return true;
            if (this.isOceanBiome(this.getBiome(x, z - r))) return true;

            // Check diagonals
            if (this.isOceanBiome(this.getBiome(x + r, z + r))) return true;
            if (this.isOceanBiome(this.getBiome(x - r, z + r))) return true;
            if (this.isOceanBiome(this.getBiome(x + r, z - r))) return true;
            if (this.isOceanBiome(this.getBiome(x - r, z - r))) return true;
        }

        return false;
    }

    /**
     * Determine if snow cap should render at this height/biome
     * Uses biome-dependent thresholds for realistic snow distribution
     * @param {string} biome - Biome name
     * @param {number} height - Height at position
     * @returns {boolean} True if snow should render
     */
    shouldShowSnowCap(biome, height) {
        // Biomes that already use snow/ice texture don't need snow caps
        const snowBasedBiomes = ['snow', 'tundra', 'glacier'];
        if (snowBasedBiomes.includes(biome)) return false;

        // High-elevation and cold biomes show snow above biome-specific thresholds
        const snowCapBiomes = {
            'mountains': 22,           // Original threshold
            'alpine': 20,              // Lower threshold (always snowy)
            'highlands': 24,           // Higher threshold (partial snow)
            'taiga': 18,               // Lower threshold (snowy peaks)
            'deciduous_forest': 25     // Very high threshold (rare snow)
        };

        const threshold = snowCapBiomes[biome];
        return threshold !== undefined && height > threshold;
    }

    smoothBiomeTransitionContinuous(x, z, height) {
        const currentBiome = this.getBiome(x, z);
        const radius = 3;

        // Check if neighbors are same biome
        let sameBiome = true;
        for (let dx = -radius; dx <= radius; dx += radius) {
            for (let dz = -radius; dz <= radius; dz += radius) {
                if (dx === 0 && dz === 0) continue;
                if (this.getBiome(x + dx, z + dz) !== currentBiome) {
                    sameBiome = false;
                    break;
                }
            }
            if (!sameBiome) break;
        }

        // If all neighbors are same biome, skip smoothing to preserve peaks
        if (sameBiome) {
            return height;
        }

        // Only smooth at biome boundaries, using weighted blend
        let totalHeight = height * 4;  // Give current height more weight
        let count = 4;

        for (let dx = -radius; dx <= radius; dx += radius) {
            for (let dz = -radius; dz <= radius; dz += radius) {
                if (dx === 0 && dz === 0) continue;

                const neighborBiome = this.getBiome(x + dx, z + dz);
                const neighborData = BIOMES[neighborBiome];
                const neighborNoise = octaveNoise2D(x + dx, z + dz, 5, 0.03);
                let neighborHeight = getBiomeBaseHeight(neighborData) + neighborNoise * getBiomeHeightScale(neighborData);

                // Apply peak variation to neighbors in high-elevation biomes
                if (PEAK_BIOMES.includes(neighborBiome)) {
                    const peakNoise = octaveNoise2D(x + dx, z + dz, 3, 0.04);  // Match updated params
                    const peakBonus = peakNoise * 50;                            // Match updated params
                    neighborHeight += peakBonus;
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
        // Bedrock layer at y=0 is always indestructible
        if (y === 0) return 'bedrock';

        // Destroyed blocks return null (air) - but bedrock cannot be destroyed
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
            // Beach override: Replace surface with beach sand near ocean
            if (biome !== 'ocean' && height >= WATER_LEVEL && height <= WATER_LEVEL + 3) {
                if (this.isNearOcean(x, z)) {
                    return 'sand';  // Beach sand texture
                }
            }

            if (height < WATER_LEVEL) return getUnderwaterTexture(biome);
            if (height <= WATER_LEVEL + 2 && biome !== 'desert' && biome !== 'snow' && biome !== 'beach') return 'sand';

            // Snow cap logic with biome-dependent thresholds
            if (this.shouldShowSnowCap(biome, height)) return 'snow';

            return getSurfaceTexture(biome);
        }

        if (y >= height - 3) {
            if (height <= WATER_LEVEL + 2 && biome !== 'snow' && biome !== 'tundra') return 'sand';
            return getSubsurfaceTexture(biome);
        }

        return 'stone';
    }
    
    getSurfaceBlockType(x, z) {
        const height = this.getHeight(x, z);
        const biome = this.getBiome(x, z);

        // Beach override: Replace surface with beach sand near ocean
        if (biome !== 'ocean' && height >= WATER_LEVEL && height <= WATER_LEVEL + 3) {
            if (this.isNearOcean(x, z)) {
                return 'sand';  // Beach sand texture
            }
        }

        if (height < WATER_LEVEL) return getUnderwaterTexture(biome);
        if (height <= WATER_LEVEL + 2 && biome !== 'desert' && biome !== 'snow' && biome !== 'beach') return 'sand';

        // Snow cap logic with biome-dependent thresholds
        if (this.shouldShowSnowCap(biome, height)) return 'snow';

        return getSurfaceTexture(biome);
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
     * Check if heightfield should be skipped at this position (for cave floors, explosions, etc.)
     * @param {number} x - World X
     * @param {number} z - World Z
     * @returns {boolean} True to skip heightfield rendering at this cell
     */
    shouldSkipHeightfield(x, z) {
        // Check landmark-based holes first
        if (this.landmarkSystem.shouldSkipHeightfield(x, z)) {
            return true;
        }

        // Check explosion-created heightfield holes
        const CHUNK_SIZE = 16;
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        const chunkKey = `${chunkX},${chunkZ}`;

        const holes = this.heightfieldHoles.get(chunkKey);
        if (holes) {
            const localX = x - chunkX * CHUNK_SIZE;
            const localZ = z - chunkZ * CHUNK_SIZE;
            if (holes.has(`${localX},${localZ}`)) {
                return true;
            }
        }

        return false;
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

        case 'updateHeightfieldHoles':
            if (terrainProvider) {
                terrainProvider.setHeightfieldHoles(data.holes);
            }
            break;

        default:
            console.warn('TerrainWorker: Unknown message type:', type);
    }
};
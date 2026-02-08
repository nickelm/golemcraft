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
import {
    hash,
    hash2,
    octaveNoise2D,
    normalizeNoise,
    CONTINENTAL_CONFIG,
    getContinentalNoise,
    PEAK_BIOMES,
    selectBiomeFromWhittaker,
    applySubBiomeVariation
} from '../world/terrain/terraincore.js';
import { ContinentState, COAST_ZONES } from '../world/terrain/continentstate.js';
import { smoothstep, lerp } from '../world/terrain/continentshape.js';
import { evaluateEnvelope } from '../world/terrain/elevationenvelope.js';
import { evaluateClimate } from '../world/terrain/climategeography.js';
import { WorkerLandmarkSystem } from '../world/landmarks/workerlandmarksystem.js';
import { generateSpawnPoints } from './spawnpointgenerator.js';
import { generateObjectInstances } from './objectspawner.js';

// Height configuration - matches terraincore.js
const HEIGHT_CONFIG = {
    maxHeight: 63
};

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
// NOISE FUNCTIONS - Imported from terraincore.js
// ============================================================================

// hash, hash2, octaveNoise2D are imported from terraincore.js

// ============================================================================
// CONTINENTAL NOISE - Imported from terraincore.js
// ============================================================================

// CONTINENTAL_CONFIG and getContinentalNoise are imported from terraincore.js

// ============================================================================
// CLIMATE-BASED BIOME SELECTION - Imported from terraincore.js
// ============================================================================

// PEAK_BIOMES, selectBiomeFromWhittaker, applySubBiomeVariation are imported from terraincore.js

// ============================================================================
// WORKER TERRAIN PROVIDER
// ============================================================================

class WorkerTerrainProvider {
    constructor(seed, continentConfig = null) {
        this.seed = seed;
        this.heightCache = new Map();
        this.continuousHeightCache = new Map();
        this.biomeCache = new Map();
        this.riverInfluenceCache = new Map();
        this.destroyedBlocks = new Set();
        this.landmarkSystem = new WorkerLandmarkSystem(this, seed);

        // Ephemeral heightfield holes from explosions
        // Map of "chunkX,chunkZ" -> Set of "lx,lz" strings
        this.heightfieldHoles = new Map();

        // Continental state (null = infinite terrain mode)
        this.continentState = null;
        if (continentConfig?.enabled) {
            this.continentState = new ContinentState(
                seed,
                continentConfig.baseRadius || 2000,
                continentConfig.template || 'default'
            );
        }
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

    /**
     * Check if position has raw river channel (without biome filtering).
     * Used for integrating rivers with continental coastline.
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if river channel exists here
     */
    hasRawRiverChannel(x, z) {
        // River channel noise (meandering isoline at 0.5)
        const riverNoiseRaw = octaveNoise2D(x, z, 3, 0.008, (nx, nz) => hash(nx, nz, this.seed + 55555));
        const riverNoise = normalizeNoise(riverNoiseRaw);
        const distFromCenter = Math.abs(riverNoise - 0.5);

        // Downstream width variation
        const downstreamNoise = normalizeNoise(octaveNoise2D(x, z, 2, 0.002, (nx, nz) => hash(nx, nz, this.seed + 33333)));
        const baseWidth = 0.015 + downstreamNoise * 0.025;

        return distFromCenter < baseWidth;
    }

    /**
     * Check if position has raw lake (without biome filtering).
     * Used for integrating lakes with continental coastline.
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if lake exists here
     */
    hasRawLake(x, z) {
        const elevationNoise = octaveNoise2D(x, z, 4, 0.015, (nx, nz) => hash(nx, nz, this.seed));
        const elevation = normalizeNoise(elevationNoise);
        if (elevation > 0.55) return false;

        const lakeNoiseRaw = octaveNoise2D(x, z, 2, 0.02, (nx, nz) => hash(nx, nz, this.seed + 66666));
        const lakeNoise = normalizeNoise(lakeNoiseRaw);

        return lakeNoise > 0.75;
    }

    /**
     * Check if position has raw ocean from low-frequency continental noise.
     * Used for integrating inland bays with continental coastline.
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if continental noise indicates ocean here
     */
    hasRawOcean(x, z) {
        const continentalness = getContinentalNoise(x, z, this.seed);
        return continentalness < CONTINENTAL_CONFIG.threshold_land;
    }

    getBiome(x, z) {
        const key = `${x},${z}`;
        if (this.biomeCache.has(key)) {
            return this.biomeCache.get(key);
        }

        // CONTINENTAL MODE: Check bounded island coastline first
        if (this.continentState) {
            const coastInfo = this.continentState.getCoastInfo(x, z);

            if (coastInfo.zone === COAST_ZONES.DEEP_OCEAN) {
                this.biomeCache.set(key, 'deep_ocean');
                return 'deep_ocean';
            }

            // For SHALLOW and BEACH zones, integrate existing water features
            // This creates natural bays, river mouths, and lake connections
            if (coastInfo.zone === COAST_ZONES.SHALLOW || coastInfo.zone === COAST_ZONES.BEACH) {
                // Check if low-frequency ocean noise says this should be water
                if (this.hasRawOcean(x, z)) {
                    this.biomeCache.set(key, 'ocean');
                    return 'ocean';
                }

                // Check if a river flows through here (river mouth)
                if (this.hasRawRiverChannel(x, z)) {
                    this.biomeCache.set(key, 'ocean');
                    return 'ocean';
                }

                // Check if a lake exists here (lake connecting to sea)
                if (this.hasRawLake(x, z)) {
                    this.biomeCache.set(key, 'ocean');
                    return 'ocean';
                }
            }

            if (coastInfo.zone === COAST_ZONES.SHALLOW) {
                this.biomeCache.set(key, 'ocean');
                return 'ocean';
            }
            if (coastInfo.zone === COAST_ZONES.BEACH) {
                // Check if this should be a cliff coast (rock) instead of sandy beach
                // Use elevation noise to detect high terrain without causing recursion
                const elevationNoise = octaveNoise2D(x, z, 4, 0.015, (nx, nz) => hash(nx, nz, this.seed));
                const elevation = normalizeNoise(elevationNoise);
                // High elevation (>0.5) indicates mountainous terrain = cliff coast
                if (elevation > 0.5) {
                    // Cliff coast: use rock texture, not sand
                    this.biomeCache.set(key, 'mountains');  // Mountains biome uses rock texture
                    return 'mountains';
                }
                this.biomeCache.set(key, 'beach');
                return 'beach';
            }

            // COASTAL_TAPER zone: also integrate existing water features inland
            if (coastInfo.zone === COAST_ZONES.COASTAL_TAPER) {
                // Check if low-frequency ocean noise says this should be water (inland bay)
                if (this.hasRawOcean(x, z)) {
                    this.biomeCache.set(key, 'ocean');
                    return 'ocean';
                }
            }

            // DEEP_INLAND zone: check for low-frequency inland seas
            // These large-scale ocean features from continental noise create organic
            // inland bays and seas that break up the landmass naturally
            if (coastInfo.zone === COAST_ZONES.DEEP_INLAND) {
                if (this.hasRawOcean(x, z)) {
                    this.biomeCache.set(key, 'ocean');
                    return 'ocean';
                }
            }
            // COASTAL_TAPER and DEEP_INLAND continue to normal biome selection below
        }

        // INFINITE MODE: Continental noise determines ocean vs land at large scale
        if (!this.continentState) {
            const continentalness = getContinentalNoise(x, z, this.seed);

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
        }

        // Land biomes: use Whittaker climate-based selection
        const elevationNoise = octaveNoise2D(x, z, 4, 0.015, (nx, nz) => hash(nx, nz, this.seed));
        const tempNoise = octaveNoise2D(x, z, 4, 0.018, (nx, nz) => hash2(nx, nz, this.seed));
        const humidityNoise = octaveNoise2D(x, z, 3, 0.012, (nx, nz) => hash(nx, nz, this.seed + 77777));

        // Normalize to [0, 1] with smoothstep redistribution
        const elevation = normalizeNoise(elevationNoise);
        let temp = normalizeNoise(tempNoise);
        let humidity = normalizeNoise(humidityNoise);

        // Apply climate geography modulation (continental mode only)
        const tempFloor = this.continentState?.climateParams ? this.continentState.climateParams.tempRange[0] : 0;
        if (this.continentState?.climateParams) {
            const climate = evaluateClimate(x, z, temp, humidity, this.continentState.climateParams, elevation);
            temp = climate.temperature;
            humidity = climate.humidity;
        }

        // Whittaker-based selection (tempFloor prevents elevation cooling below template minimum)
        let biome = selectBiomeFromWhittaker(temp, humidity, elevation, tempFloor);

        // Apply sub-biome variation for natural patchiness
        biome = applySubBiomeVariation(biome, x, z, this.seed);

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

        // CONTINENTAL MODE: Apply coastal height transitions
        if (this.continentState) {
            const coastInfo = this.continentState.getCoastInfo(x, z);

            // Deep ocean: bottomless abyss
            if (coastInfo.zone === COAST_ZONES.DEEP_OCEAN) {
                const deepOceanFloor = 0.5;
                this.continuousHeightCache.set(key, deepOceanFloor);
                return deepOceanFloor;
            }

            // Check for integrated water features (raw ocean, river, lake)
            // These should use water-level heights regardless of coastal zone
            const hasIntegratedWater = this.hasRawOcean(x, z) ||
                                       this.hasRawRiverChannel(x, z) ||
                                       this.hasRawLake(x, z);

            // Get inland height to check for cliffs
            const inlandHeight = this.computeInlandHeight(x, z);

            // Check if this is a cliff coast (mountains/highlands meeting ocean)
            // Cliffs occur when inland terrain is significantly above sea level
            const isCliffCoast = inlandHeight > WATER_LEVEL + 12;

            // Shallow water: visible floor, wading depth (2-4 blocks below water)
            if (coastInfo.zone === COAST_ZONES.SHALLOW) {
                // If integrated water feature, use standard shallow water depth
                if (hasIntegratedWater) {
                    const shallowFloor = WATER_LEVEL - 3;
                    this.continuousHeightCache.set(key, shallowFloor);
                    return shallowFloor;
                }

                if (isCliffCoast) {
                    // Cliff coast: steep underwater drop-off
                    const shallowProgress = (coastInfo.signedDist + 30) / 30;  // 0 at -30, 1 at 0
                    // Steeper underwater cliff - blend from deep to cliff base
                    const cliffBase = Math.min(inlandHeight - 8, WATER_LEVEL - 1);
                    const shallowFloor = lerp(WATER_LEVEL - 6, cliffBase, shallowProgress);
                    this.continuousHeightCache.set(key, shallowFloor);
                    return shallowFloor;
                }
                // Normal beach: gentle shallow water
                // signedDist is -30 to 0 in this zone
                // At -30: floor at WATER_LEVEL - 4
                // At 0: floor at WATER_LEVEL - 2
                const shallowProgress = (coastInfo.signedDist + 30) / 30;  // 0 at -30, 1 at 0
                const shallowFloor = WATER_LEVEL - 4 + shallowProgress * 2;
                this.continuousHeightCache.set(key, shallowFloor);
                return shallowFloor;
            }

            // Beach zone: gentle slope from water to inland, blending with normal terrain
            if (coastInfo.zone === COAST_ZONES.BEACH) {
                // If integrated water feature, use water-level height (river/lake connecting to ocean)
                if (hasIntegratedWater) {
                    const waterFloor = WATER_LEVEL - 2;
                    this.continuousHeightCache.set(key, waterFloor);
                    return waterFloor;
                }

                if (isCliffCoast) {
                    // Cliff coast: steep rise from water to inland terrain
                    // Use a much faster blend to create the cliff effect
                    const cliffProgress = coastInfo.signedDist / 50;  // 0 at water, 1 at 50 blocks inland
                    // Quick transition: cliff starts at water level, reaches inland height fast
                    const cliffBlend = smoothstep(0, 1, cliffProgress * 2);  // 2x faster blend
                    const cliffHeight = lerp(WATER_LEVEL + 1, inlandHeight, Math.min(1, cliffBlend));
                    this.continuousHeightCache.set(key, Math.max(1.0, Math.min(63.0, cliffHeight)));
                    return this.continuousHeightCache.get(key);
                }

                // Normal beach: gentle slope with local variation
                // signedDist is 0 to 50 in this zone
                const beachProgress = coastInfo.signedDist / 50;  // 0 at water, 1 at 50 blocks inland

                // Add micro-detail for undulating beach surface
                const beachNoise = octaveNoise2D(x, z, 2, 0.08, (nx, nz) => hash(nx, nz, this.seed + 77777));
                const beachVariation = (beachNoise - 0.5) * 1.5;  // -0.75 to +0.75 blocks variation

                // Beach height: WATER_LEVEL at edge, rising gently, with variation
                const beachHeight = WATER_LEVEL + beachProgress * 4 + beachVariation * beachProgress;

                // Blend: at signedDist=0, 100% beach; at signedDist=50, 100% inland
                const blend = smoothstep(0, 1, beachProgress);
                const finalHeight = lerp(beachHeight, inlandHeight, blend);

                this.continuousHeightCache.set(key, Math.max(1.0, Math.min(63.0, finalHeight)));
                return this.continuousHeightCache.get(key);
            }

            // Coastal taper: blend normal terrain toward sea level
            if (coastInfo.zone === COAST_ZONES.COASTAL_TAPER) {
                // If integrated water feature (inland bay from low-freq ocean), use water height
                if (this.hasRawOcean(x, z)) {
                    const waterFloor = WATER_LEVEL - 2;
                    this.continuousHeightCache.set(key, waterFloor);
                    return waterFloor;
                }

                // signedDist is 50 to 100 in this zone
                const taperProgress = (100 - coastInfo.signedDist) / 50;  // 0 at 100, 1 at 50

                // Pull 20% toward sea level at the coast edge
                const seaLevelTarget = WATER_LEVEL + 4;
                const taperStrength = taperProgress * 0.2;
                const finalHeight = lerp(inlandHeight, seaLevelTarget, taperStrength);

                this.continuousHeightCache.set(key, Math.max(1.0, Math.min(63.0, finalHeight)));
                return this.continuousHeightCache.get(key);
            }

            // DEEP_INLAND: fall through to normal computation
        }

        // Normal inland terrain computation
        return this.computeInlandHeight(x, z);
    }

    /**
     * Compute inland terrain height (extracted from original getContinuousHeight)
     */
    computeInlandHeight(x, z) {
        const key = `${x},${z}`;

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
        const warpX = octaveNoise2D(x + 500, z, 2, 0.015, (nx, nz) => hash(nx, nz, this.seed)) * warpStrength;
        const warpZ = octaveNoise2D(x, z + 500, 2, 0.015, (nx, nz) => hash(nx, nz, this.seed)) * warpStrength;

        // Main terrain with warped coordinates
        const heightNoise = octaveNoise2D(x + warpX, z + warpZ, 5, 0.03, (nx, nz) => hash(nx, nz, this.seed));

        // Micro-detail for surface variation
        const microDetail = octaveNoise2D(x, z, 2, 0.12, (nx, nz) => hash2(nx, nz, this.seed)) * 0.25;

        let height = getBiomeBaseHeight(biomeData) + heightNoise * getBiomeHeightScale(biomeData) + microDetail;
        let debugLog = null;

        // Apply elevation envelope (continental mode only)
        let envelopeAmpScale = 1.0;
        if (this.continentState?.envelopeParams) {
            const envelope = evaluateEnvelope(x, z, this.continentState.envelopeParams);
            const biomeBase = getBiomeBaseHeight(biomeData);
            const noiseComponent = height - biomeBase;
            height = envelope.baseElevation + biomeBase * envelope.amplitudeScale
                     + noiseComponent * envelope.amplitudeScale;
            envelopeAmpScale = envelope.amplitudeScale;
        }

        // Apply peak variation to all high-elevation biomes (mountains, glacier, alpine, badlands, highlands)
        if (PEAK_BIOMES.includes(biome)) {
            const peakNoise = octaveNoise2D(x, z, 3, 0.04, (nx, nz) => hash(nx, nz, this.seed));  // 0.06 → 0.04 (larger, less frequent peaks)

            // Use FULL range of peak noise (0-1) for dramatic height variation
            // Scaled by envelope amplitude so peaks respect continental structure
            const peakBonus = peakNoise * 50 * envelopeAmpScale;
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
                    envelopeAmpScale: envelopeAmpScale.toFixed(3),
                    heightBeforeWater: height.toFixed(2)
                };
            }
        }

        if (biome === 'jungle') {
            const jungleHillNoise = octaveNoise2D(x, z, 4, 0.08, (nx, nz) => hash(nx, nz, this.seed));
            height += jungleHillNoise * 4 * envelopeAmpScale;
        }

        // River valley carving (graduated with sloped banks, proportional depth)
        if (biome !== 'ocean' && biome !== 'deep_ocean') {
            const riverInfo = this.getRiverInfluence(x, z);
            if (riverInfo && riverInfo.influence > 0) {
                // Carve depth proportional to height: 20% of height, min 3, max 8 blocks
                const carveDepth = Math.min(Math.max(3, height * 0.2), 8);
                const riverBed = Math.max(WATER_LEVEL - 1, height - carveDepth);
                if (height > riverBed) {
                    const t = riverInfo.influence;
                    const smooth = t * t * (3 - 2 * t);  // smoothstep for natural bank profile
                    height = height - (height - riverBed) * smooth;
                }
            }
        }

        // Lake carving (isLake handles its own biome/elevation filtering)
        if (this.isLake(x, z)) {
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

                const nx = x + dx;
                const nz = z + dz;
                const neighborBiome = this.getBiome(nx, nz);
                const neighborData = BIOMES[neighborBiome];
                const neighborNoise = octaveNoise2D(nx, nz, 5, 0.03, (nnx, nnz) => hash(nnx, nnz, this.seed));
                let neighborHeight = getBiomeBaseHeight(neighborData) + neighborNoise * getBiomeHeightScale(neighborData);

                // Apply elevation envelope to neighbor heights
                let nEnvAmpScale = 1.0;
                if (this.continentState?.envelopeParams) {
                    const nEnv = evaluateEnvelope(nx, nz, this.continentState.envelopeParams);
                    const nBiomeBase = getBiomeBaseHeight(neighborData);
                    const nNoiseComp = neighborHeight - nBiomeBase;
                    neighborHeight = nEnv.baseElevation + nBiomeBase * nEnv.amplitudeScale
                                     + nNoiseComp * nEnv.amplitudeScale;
                    nEnvAmpScale = nEnv.amplitudeScale;
                }

                // Apply peak variation to neighbors in high-elevation biomes
                if (PEAK_BIOMES.includes(neighborBiome)) {
                    const peakNoise = octaveNoise2D(nx, nz, 3, 0.04, (nnx, nnz) => hash(nnx, nnz, this.seed));
                    const peakBonus = peakNoise * 50 * nEnvAmpScale;
                    neighborHeight += peakBonus;
                }

                if (neighborBiome === 'jungle') {
                    const jungleHillNoise = octaveNoise2D(nx, nz, 4, 0.08, (nnx, nnz) => hash(nnx, nnz, this.seed));
                    neighborHeight += jungleHillNoise * 4 * nEnvAmpScale;
                }

                totalHeight += neighborHeight;
                count++;
            }
        }
        return totalHeight / count;
    }
    
    /**
     * Get river influence at a position for graduated valley carving.
     * Returns null if no river influence, otherwise { isRiver, influence }.
     * influence = 1.0 at river center, smoothly falls to 0.0 at bank edge.
     *
     * Multi-factor filtering:
     * - Biome blocking (no rivers in desert, badlands, glacier, ocean)
     * - Elevation filtering (no rivers above tree line)
     * - River density noise (creates regions with/without rivers)
     * - Variable width via downstream noise
     * - Bank zone at 2.5x river width for graduated valley carving
     *
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {{ isRiver: boolean, influence: number } | null}
     */
    getRiverInfluence(x, z) {
        const key = `${x},${z}`;
        if (this.riverInfluenceCache.has(key)) return this.riverInfluenceCache.get(key);

        const biome = this.getBiome(x, z);

        // Blocked biomes: no rivers at all
        if (biome === 'ocean' || biome === 'deep_ocean' ||
            biome === 'desert' || biome === 'red_desert' ||
            biome === 'badlands' || biome === 'glacier') {
            this.riverInfluenceCache.set(key, null);
            return null;
        }

        // Elevation filter: allow mountain streams up to 0.70, block above
        const elevationNoise = octaveNoise2D(x, z, 4, 0.015, (nx, nz) => hash(nx, nz, this.seed));
        const elevation = normalizeNoise(elevationNoise);
        if (elevation > 0.70) {
            this.riverInfluenceCache.set(key, null);
            return null;
        }

        // River density noise: creates regions with vs without rivers
        // MUST normalize — raw octaveNoise2D clusters around [0.1-0.45]
        const wetBiomes = ['swamp', 'jungle', 'taiga', 'rainforest'];
        const isWet = wetBiomes.includes(biome);

        if (!isWet) {
            const riverDensityNoise = normalizeNoise(octaveNoise2D(x, z, 2, 0.003, (nx, nz) => hash(nx, nz, this.seed + 44444)));
            const reducedDensityBiomes = ['tundra', 'savanna', 'mountains', 'alpine', 'highlands'];
            const densityThreshold = reducedDensityBiomes.includes(biome) ? 0.55 : 0.45;
            if (riverDensityNoise < densityThreshold) {
                this.riverInfluenceCache.set(key, null);
                return null;
            }
        }

        // River channel noise (meandering isoline at 0.5)
        // MUST normalize — raw octaveNoise2D clusters around [0.1-0.45], rarely reaching 0.5
        const riverNoiseRaw = octaveNoise2D(x, z, 3, 0.008, (nx, nz) => hash(nx, nz, this.seed + 55555));
        const riverNoise = normalizeNoise(riverNoiseRaw);
        const distFromCenter = Math.abs(riverNoise - 0.5);

        // Downstream width variation (normalized for proper 0-1 distribution)
        const downstreamNoise = normalizeNoise(octaveNoise2D(x, z, 2, 0.002, (nx, nz) => hash(nx, nz, this.seed + 33333)));
        const baseWidth = 0.015 + downstreamNoise * 0.025;  // Range: 0.015 to 0.040

        // Mountain streams get narrower above tree line
        let elevationWidthFactor = 1.0;
        if (elevation > 0.55) {
            elevationWidthFactor = 1.0 - (elevation - 0.55) / 0.15;  // 1.0 at 0.55, 0.0 at 0.70
        }
        const riverWidth = baseWidth * (0.5 + 0.5 * elevationWidthFactor);  // 50-100% of base width

        // Bank zone extends to 3x river width for valley carving
        const bankWidth = riverWidth * 3.0;
        if (distFromCenter > bankWidth) {
            this.riverInfluenceCache.set(key, null);
            return null;
        }

        const isRiverChannel = distFromCenter < riverWidth;

        // Compute influence: 1.0 at center/channel, smoothstep falloff in bank zone
        let influence;
        if (isRiverChannel) {
            influence = 1.0;
        } else {
            const bankDist = (distFromCenter - riverWidth) / (bankWidth - riverWidth);
            const t = 1.0 - bankDist;  // 1.0 at river edge, 0.0 at bank edge
            influence = t * t * (3 - 2 * t);  // smoothstep
        }

        const result = { isRiver: isRiverChannel, influence };
        this.riverInfluenceCache.set(key, result);
        return result;
    }

    /**
     * Check if position is part of a river (boolean wrapper)
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if this cell is river
     */
    isRiver(x, z) {
        const info = this.getRiverInfluence(x, z);
        return info !== null && info.isRiver;
    }

    /**
     * Check if position is a lake
     * Filtered by biome and elevation - no lakes on mountains or in oceans
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean}
     */
    isLake(x, z) {
        const biome = this.getBiome(x, z);

        // No lakes in ocean or on high mountains
        if (biome === 'ocean' || biome === 'deep_ocean') return false;

        const elevationNoise = octaveNoise2D(x, z, 4, 0.015, (nx, nz) => hash(nx, nz, this.seed));
        const elevation = normalizeNoise(elevationNoise);
        if (elevation > 0.55) return false;

        // MUST normalize — raw octaveNoise2D clusters around [0.1-0.45], never reaching 0.50+
        const lakeNoiseRaw = octaveNoise2D(x, z, 2, 0.02, (nx, nz) => hash(nx, nz, this.seed + 66666));
        const lakeNoise = normalizeNoise(lakeNoiseRaw);

        // Swamp: more frequent lakes (~35% of swamp area)
        if (biome === 'swamp') return lakeNoise > 0.65;

        // Default: ~25% of qualifying areas
        return lakeNoise > 0.75;
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

        if (y > height && y > WATER_LEVEL) {
            // Elevated river water: rivers above sea level have local water surface
            if (height > WATER_LEVEL && this.isRiver(x, z) && y <= height + 2) {
                return y === height + 2 ? 'water' : 'water_full';
            }
            return null;
        }

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
            // Extract continental config if provided
            const continentConfig = data.continent || null;
            terrainProvider = new WorkerTerrainProvider(data.seed, continentConfig);

            // Set dithering mode based on texture blending tier
            useDithering = (data.textureBlending === 'low');
            if (DEBUG_CHUNK_DELAY_MS > 0) {
                console.warn(`[WORKER] DEBUG MODE: ${DEBUG_CHUNK_DELAY_MS}ms delay per chunk`);
            }
            console.log(`[WORKER] Initialized with textureBlending=${data.textureBlending}, useDithering=${useDithering}, continent=${continentConfig?.enabled ? 'enabled' : 'disabled'}`);

            // DIAGNOSTIC: Sample biome distribution (remove after verification)
            {
                const SAMPLE_SIZE = 2000;
                const SAMPLE_RANGE = 5000;
                const counts = {};
                const categories = { frozen: 0, cold: 0, temperate: 0, hot: 0, mountain: 0, ocean: 0 };
                const categoryMap = {
                    tundra: 'cold', glacier: 'frozen', snow: 'cold', taiga: 'cold',
                    plains: 'temperate', meadow: 'temperate', deciduous_forest: 'temperate',
                    autumn_forest: 'temperate', swamp: 'temperate',
                    desert: 'hot', red_desert: 'hot', savanna: 'hot',
                    jungle: 'hot', rainforest: 'hot', badlands: 'hot',
                    mountains: 'mountain', alpine: 'mountain', highlands: 'mountain',
                    volcanic: 'mountain',
                    ocean: 'ocean', deep_ocean: 'ocean', shallow_ocean: 'ocean', beach: 'ocean'
                };
                let tempMin = 1, tempMax = 0, tempSum = 0;
                for (let i = 0; i < SAMPLE_SIZE; i++) {
                    const sx = Math.floor((hash(i, 0, data.seed + 111) - 0.5) * 2 * SAMPLE_RANGE);
                    const sz = Math.floor((hash(0, i, data.seed + 222) - 0.5) * 2 * SAMPLE_RANGE);
                    const biome = terrainProvider.getBiome(sx, sz);
                    counts[biome] = (counts[biome] || 0) + 1;
                    categories[categoryMap[biome] || 'ocean'] += 1;
                    // Sample temperature for distribution check
                    const tNoise = octaveNoise2D(sx, sz, 4, 0.018, (nx, nz) => hash2(nx, nz, data.seed));
                    const tNorm = normalizeNoise(tNoise);
                    if (tNorm < tempMin) tempMin = tNorm;
                    if (tNorm > tempMax) tempMax = tNorm;
                    tempSum += tNorm;
                }
                console.log(`[BIOME DISTRIBUTION] ${SAMPLE_SIZE} samples across ${SAMPLE_RANGE * 2} blocks:`);
                console.log(`[BIOME DISTRIBUTION] Temperature: min=${tempMin.toFixed(3)}, max=${tempMax.toFixed(3)}, avg=${(tempSum / SAMPLE_SIZE).toFixed(3)}`);
                console.log(`[BIOME DISTRIBUTION] Categories: ${Object.entries(categories).map(([k, v]) => `${k}: ${(v / SAMPLE_SIZE * 100).toFixed(1)}%`).join(', ')}`);
                console.log(`[BIOME DISTRIBUTION] Biomes: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${(v / SAMPLE_SIZE * 100).toFixed(1)}%`).join(', ')}`);
                terrainProvider.biomeCache.clear();
            }

            // Build ready response with optional startPosition for continental mode
            const readyResponse = { type: 'ready' };
            if (terrainProvider.continentState) {
                readyResponse.startPosition = terrainProvider.continentState.startPosition;
                console.log(`[WORKER] Continental mode: start position at (${readyResponse.startPosition.x.toFixed(0)}, ${readyResponse.startPosition.z.toFixed(0)})`);
            }
            self.postMessage(readyResponse);
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
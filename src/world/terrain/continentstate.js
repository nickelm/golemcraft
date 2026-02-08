/**
 * ContinentState - Worker-side continental terrain state
 *
 * Holds cached SDF and provides query methods for terrain generation.
 * Created once at worker init, used for all subsequent terrain queries.
 */

import {
    generateCoarseSDF,
    queryCoarseSDF,
    getDetailedCoastDistance,
    getCoastZone,
    computeStartPosition,
    CONTINENT_SHAPE_CONFIG,
    COAST_ZONES
} from './continentshape.js';
import { hash } from './terraincore.js';
import { generateEnvelopeParams, evaluateEnvelope } from './elevationenvelope.js';
import { generateClimateParams } from './climategeography.js';

// Re-export COAST_ZONES for convenience
export { COAST_ZONES };

/**
 * Continental terrain state for the worker.
 * Manages SDF generation and coastline queries.
 */
export class ContinentState {
    /**
     * Create continental state from seed.
     * Generates coarse SDF on construction (~50ms).
     *
     * @param {number} seed - World seed
     * @param {number} baseRadius - Island radius in blocks (default 2000 = ~4km diameter)
     * @param {string} template - Continent template ('verdania', 'grausland', 'petermark', 'default')
     */
    constructor(seed, baseRadius = 2000, template = 'default') {
        this.seed = seed;
        this.baseRadius = baseRadius;
        this.template = template;
        this.enabled = true;

        // Derive sub-seeds for different noise layers
        // Using hash to get deterministic integer seeds
        this.shapeSeed = Math.floor(hash(0, 0, seed + 111111) * 0x7FFFFFFF);
        this.coastSeed = Math.floor(hash(0, 0, seed + 222222) * 0x7FFFFFFF);
        this.startSeed = Math.floor(hash(0, 0, seed + 333333) * 0x7FFFFFFF);
        this.envelopeSeed = Math.floor(hash(0, 0, seed + 444444) * 0x7FFFFFFF);
        this.climateSeed = Math.floor(hash(0, 0, seed + 555555) * 0x7FFFFFFF);

        // SDF configuration
        this.sdfResolution = CONTINENT_SHAPE_CONFIG.sdfResolution;
        this.sdfCellSize = CONTINENT_SHAPE_CONFIG.sdfCellSize;

        // Generate coarse SDF (this is the expensive operation)
        console.log(`[ContinentState] Generating coarse SDF (${this.sdfResolution}x${this.sdfResolution})...`);
        const sdfStart = performance.now();
        this.coarseSDF = generateCoarseSDF(
            this.shapeSeed,
            this.baseRadius,
            this.sdfResolution,
            this.sdfCellSize
        );
        console.log(`[ContinentState] SDF generated in ${(performance.now() - sdfStart).toFixed(1)}ms`);

        // Compute starting position
        this.startPosition = computeStartPosition(
            this.startSeed,
            this.shapeSeed,
            this.baseRadius
        );
        console.log(`[ContinentState] Start position: (${this.startPosition.x.toFixed(0)}, ${this.startPosition.z.toFixed(0)}) at angle ${(this.startPosition.angle * 180 / Math.PI).toFixed(0)}deg`);

        // Generate elevation envelope params
        this.envelopeParams = generateEnvelopeParams(
            this.envelopeSeed,
            this.baseRadius,
            template,
            this.startPosition.angle
        );
        console.log(`[ContinentState] Elevation envelope generated (template=${template}, ${this.envelopeParams.controlPoints.length} control points, ${this.envelopeParams.angularLobes.length} lobes, spine=${this.envelopeParams.spineStrength > 0 ? 'yes' : 'no'})`);

        // Generate climate geography params
        this.climateParams = generateClimateParams(
            this.climateSeed,
            this.baseRadius,
            template
        );
        console.log(`[ContinentState] Climate geography generated (template=${template}, windAngle=${(this.climateParams.windAngle * 180 / Math.PI).toFixed(0)}deg, warmAngle=${(this.climateParams.warmAngle * 180 / Math.PI).toFixed(0)}deg)`);

        // Cache for detailed coast queries (LRU-style)
        this.detailCache = new Map();
        this.detailCacheMaxSize = 10000;
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }

    /**
     * Query coarse SDF for fast proximity check.
     * Returns approximate signed distance to coast.
     *
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Approximate signed distance (positive = inland)
     */
    queryCoarseProximity(worldX, worldZ) {
        return queryCoarseSDF(
            this.coarseSDF,
            this.sdfResolution,
            this.sdfCellSize,
            worldX,
            worldZ
        );
    }

    /**
     * Get full coastline info at a position.
     * Uses coarse SDF for early-out, computes detailed fbm when near coast.
     *
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {{ zone: string, signedDist: number }} Coast info
     */
    getCoastInfo(worldX, worldZ) {
        if (!this.enabled) {
            return { zone: COAST_ZONES.DEEP_INLAND, signedDist: 1000 };
        }

        // Coarse check first (O(1) lookup)
        const coarseDist = this.queryCoarseProximity(worldX, worldZ);

        // If far from coast (coarse SDF > 120), skip detailed evaluation
        // The 120 threshold accounts for fbm amplitude (~15 blocks)
        if (coarseDist > 120) {
            return { zone: COAST_ZONES.DEEP_INLAND, signedDist: coarseDist };
        }

        // If deep in ocean (coarse SDF < -50), skip detailed evaluation
        if (coarseDist < -50) {
            return { zone: COAST_ZONES.DEEP_OCEAN, signedDist: coarseDist };
        }

        // Near coast: compute detailed distance
        // Check cache first
        const cacheKey = `${Math.floor(worldX)},${Math.floor(worldZ)}`;
        if (this.detailCache.has(cacheKey)) {
            this.cacheHits++;
            return this.detailCache.get(cacheKey);
        }

        this.cacheMisses++;

        // Compute detailed coast distance with fbm
        const detailedDist = getDetailedCoastDistance(
            worldX, worldZ,
            this.coastSeed,
            this.shapeSeed,
            this.baseRadius
        );

        const zone = getCoastZone(detailedDist);
        const result = { zone, signedDist: detailedDist };

        // Cache result (with simple LRU eviction)
        if (this.detailCache.size >= this.detailCacheMaxSize) {
            // Clear oldest half of cache
            const keys = Array.from(this.detailCache.keys());
            const deleteCount = Math.floor(keys.length / 2);
            for (let i = 0; i < deleteCount; i++) {
                this.detailCache.delete(keys[i]);
            }
        }
        this.detailCache.set(cacheKey, result);

        return result;
    }

    /**
     * Check if a position is on land (not in ocean zones).
     *
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {boolean} True if on land
     */
    isLand(worldX, worldZ) {
        const { zone } = this.getCoastInfo(worldX, worldZ);
        return zone !== COAST_ZONES.SHALLOW && zone !== COAST_ZONES.DEEP_OCEAN;
    }

    /**
     * Check if a position is in ocean (shallow or deep).
     *
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {boolean} True if in ocean
     */
    isOcean(worldX, worldZ) {
        const { zone } = this.getCoastInfo(worldX, worldZ);
        return zone === COAST_ZONES.SHALLOW || zone === COAST_ZONES.DEEP_OCEAN;
    }

    /**
     * Clear detail cache (for memory management).
     * Called when unloading distant chunks.
     */
    clearCaches() {
        this.detailCache.clear();
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }

    /**
     * Get cache statistics for debugging.
     *
     * @returns {{ size: number, hits: number, misses: number, hitRate: number }}
     */
    getCacheStats() {
        const total = this.cacheHits + this.cacheMisses;
        return {
            size: this.detailCache.size,
            hits: this.cacheHits,
            misses: this.cacheMisses,
            hitRate: total > 0 ? this.cacheHits / total : 0
        };
    }

    /**
     * Get island bounds for debugging/visualization.
     *
     * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number }}
     */
    getBounds() {
        const margin = 100;  // Extra space beyond island
        const maxRadius = this.baseRadius * (1 + CONTINENT_SHAPE_CONFIG.silhouetteAmplitude) + margin;
        return {
            minX: -maxRadius,
            maxX: maxRadius,
            minZ: -maxRadius,
            maxZ: maxRadius
        };
    }
}

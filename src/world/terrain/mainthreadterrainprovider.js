/**
 * MainThreadTerrainProvider - Adapts ChunkBlockCache to the terrainProvider interface
 *
 * Used for main thread mesh rebuilding (e.g., explosion craters) without worker round-trip.
 * Wraps the cached terrain data to provide the same interface that mesh generators expect.
 *
 * Unlike the worker's terrain provider which generates data procedurally, this provider
 * reads from already-generated data stored in ChunkBlockCache.
 */

import { CHUNK_SIZE, MAX_HEIGHT } from '../chunkblockcache.js';

export class MainThreadTerrainProvider {
    /**
     * @param {ChunkBlockCache} blockCache - The terrain data cache
     */
    constructor(blockCache) {
        this.blockCache = blockCache;
    }

    /**
     * Get biome at world coordinates
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {string} Biome name (defaults to 'plains' if not found)
     */
    getBiome(x, z) {
        return this.blockCache.getBiome(x, z) || 'plains';
    }

    /**
     * Get continuous (interpolated) height at world coordinates
     * Used for normal calculations across chunk boundaries
     * @param {number} x - World X coordinate (can be fractional)
     * @param {number} z - World Z coordinate (can be fractional)
     * @returns {number} Interpolated height
     */
    getContinuousHeight(x, z) {
        const chunk = this.blockCache.getChunkAt(x, z);
        if (!chunk) return 0;

        const localX = x - chunk.worldMinX;
        const localZ = z - chunk.worldMinZ;
        return chunk.getInterpolatedHeight(localX, localZ);
    }

    /**
     * Get discrete terrain height at world coordinates
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {number} Ground height
     */
    getHeight(x, z) {
        return this.blockCache.getGroundHeight(x, z);
    }

    /**
     * Get block type at world coordinates
     * @param {number} x - World X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - World Z coordinate
     * @returns {string|null} Block type name, or null for air
     */
    getBlockType(x, y, z) {
        return this.blockCache.getBlockType(x, y, z);
    }

    /**
     * Check if position uses voxel collision (vs heightmap)
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if voxel collision mode
     */
    shouldUseVoxels(x, z) {
        return this.blockCache.usesVoxelCollision(x, z);
    }

    /**
     * Check if heightfield should have a hole at this position
     * Used for explosion craters where terrain surface is removed
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if heightfield should be skipped (hole)
     */
    shouldSkipHeightfield(x, z) {
        return this.blockCache.hasHeightfieldHole(x, z);
    }

    /**
     * Get surface block type at world coordinates
     * Used for texture splatting calculations
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {string} Surface block type name
     */
    getSurfaceBlockType(x, z) {
        const chunk = this.blockCache.getChunkAt(x, z);
        if (!chunk || !chunk.surfaceTypes) return 'grass';

        const localX = Math.floor(x) - chunk.worldMinX;
        const localZ = Math.floor(z) - chunk.worldMinZ;

        if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) {
            return 'grass';
        }

        const index = localZ * CHUNK_SIZE + localX;
        const typeId = chunk.surfaceTypes[index];

        // Map type IDs to names (matches BLOCK_TYPE_NAMES in chunkblockcache.js)
        const SURFACE_TYPE_NAMES = {
            0: 'air', 1: 'grass', 2: 'dirt', 3: 'stone', 4: 'snow', 5: 'sand',
            6: 'water', 7: 'water_full', 8: 'ice', 9: 'mayan_stone'
        };
        return SURFACE_TYPE_NAMES[typeId] || 'grass';
    }

    /**
     * Get brightness override for interior lighting
     * For main thread rebuilds, we return 1.0 (full brightness) since
     * we don't have landmark interior data available
     * @param {number} x - World X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - World Z coordinate
     * @returns {number} Brightness value (always 1.0 for main thread)
     */
    getBrightnessOverride(x, y, z) {
        return 1.0;
    }

    /**
     * Get heightfield modifications for a chunk
     * For main thread rebuilds, return empty array since modifications
     * are already applied in the cached heightmap
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {Array} Empty array (modifications already applied)
     */
    getHeightfieldModifications(chunkX, chunkZ) {
        return [];
    }
}

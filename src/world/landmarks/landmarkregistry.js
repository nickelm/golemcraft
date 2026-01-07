/**
 * LandmarkRegistry - Read-only cache of landmark metadata received from worker
 *
 * This is a PURE DATA STORE. No terrain generation, no landmark placement logic.
 * All data comes from the worker via chunk generation.
 *
 * Provides:
 * - getLandmarksForChunk(chunkX, chunkZ)
 * - isInsideLandmark(x, z) - for debug visualization
 * - isInsideChamber(x, y, z) - for debug visualization
 * - getAllLandmarks() - for debug overlay
 */

const CHUNK_SIZE = 16;

export class LandmarkRegistry {
    constructor() {
        // Map of "chunkX,chunkZ" -> array of landmark IDs
        this.chunkLandmarks = new Map();

        // Deduplication: Map of landmarkId -> landmark metadata
        this.landmarks = new Map();

        // Reverse index: Map of landmarkId -> Set of chunk keys (for refcounting)
        this.landmarkChunks = new Map();
    }

    /**
     * Add landmark metadata for a chunk (called when chunk is loaded)
     * @param {number} chunkX - Chunk X index
     * @param {number} chunkZ - Chunk Z index
     * @param {Array} landmarkMetadata - Array of landmark metadata objects from worker
     */
    addChunkLandmarks(chunkX, chunkZ, landmarkMetadata) {
        if (!landmarkMetadata || landmarkMetadata.length === 0) {
            return;
        }

        const chunkKey = `${chunkX},${chunkZ}`;
        const landmarkIds = [];

        for (const lm of landmarkMetadata) {
            // Store/update the landmark (deduplication via ID)
            if (!this.landmarks.has(lm.id)) {
                this.landmarks.set(lm.id, lm);
                this.landmarkChunks.set(lm.id, new Set());
            }

            // Track which chunks reference this landmark
            this.landmarkChunks.get(lm.id).add(chunkKey);
            landmarkIds.push(lm.id);
        }

        this.chunkLandmarks.set(chunkKey, landmarkIds);
    }

    /**
     * Remove landmark references for a chunk (called when chunk is unloaded)
     * @param {number} chunkX - Chunk X index
     * @param {number} chunkZ - Chunk Z index
     */
    removeChunkLandmarks(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        const landmarkIds = this.chunkLandmarks.get(chunkKey);

        if (!landmarkIds) return;

        for (const id of landmarkIds) {
            const chunks = this.landmarkChunks.get(id);
            if (chunks) {
                chunks.delete(chunkKey);
                // Remove landmark if no chunks reference it anymore
                if (chunks.size === 0) {
                    this.landmarks.delete(id);
                    this.landmarkChunks.delete(id);
                }
            }
        }

        this.chunkLandmarks.delete(chunkKey);
    }

    /**
     * Get landmarks affecting a specific chunk
     * @param {number} chunkX - Chunk X index
     * @param {number} chunkZ - Chunk Z index
     * @returns {Array} Array of landmark metadata objects
     */
    getLandmarksForChunk(chunkX, chunkZ) {
        const chunkKey = `${chunkX},${chunkZ}`;
        const landmarkIds = this.chunkLandmarks.get(chunkKey);

        if (!landmarkIds) return [];

        return landmarkIds.map(id => this.landmarks.get(id)).filter(Boolean);
    }

    /**
     * Check if position is inside any landmark's bounds
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if inside a landmark
     */
    isInsideLandmark(x, z) {
        for (const landmark of this.landmarks.values()) {
            const bounds = landmark.voxelBounds || landmark.bounds;
            if (x >= bounds.minX && x <= bounds.maxX &&
                z >= bounds.minZ && z <= bounds.maxZ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if position is inside any chamber
     * @param {number} x - World X coordinate
     * @param {number} y - World Y coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if inside a chamber
     */
    isInsideChamber(x, y, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);

        for (const landmark of this.getLandmarksForChunk(chunkX, chunkZ)) {
            if (!landmark.chambers) continue;

            for (const chamber of landmark.chambers) {
                if (x >= chamber.minX && x < chamber.maxX &&
                    y >= chamber.minY && y < chamber.maxY &&
                    z >= chamber.minZ && z < chamber.maxZ) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get landmark at position (for debug overlay)
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {Object|null} Landmark metadata or null
     */
    getLandmarkAt(x, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);

        for (const landmark of this.getLandmarksForChunk(chunkX, chunkZ)) {
            const bounds = landmark.bounds;
            if (x >= bounds.minX && x <= bounds.maxX &&
                z >= bounds.minZ && z <= bounds.maxZ) {
                return landmark;
            }
        }
        return null;
    }

    /**
     * Get all landmarks (for debug overlay)
     * @returns {Array} Array of all landmark metadata objects
     */
    getAllLandmarks() {
        return Array.from(this.landmarks.values());
    }

    /**
     * Get landmarks within radius of position
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @param {number} radius - Search radius in world units
     * @returns {Array} Array of nearby landmark metadata objects
     */
    getLandmarksNear(x, z, radius) {
        const results = [];
        const seen = new Set();

        const minChunkX = Math.floor((x - radius) / CHUNK_SIZE);
        const maxChunkX = Math.floor((x + radius) / CHUNK_SIZE);
        const minChunkZ = Math.floor((z - radius) / CHUNK_SIZE);
        const maxChunkZ = Math.floor((z + radius) / CHUNK_SIZE);

        for (let cx = minChunkX; cx <= maxChunkX; cx++) {
            for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
                for (const landmark of this.getLandmarksForChunk(cx, cz)) {
                    if (!seen.has(landmark.id)) {
                        seen.add(landmark.id);
                        results.push(landmark);
                    }
                }
            }
        }

        return results;
    }

    /**
     * Clear all data
     */
    clear() {
        this.chunkLandmarks.clear();
        this.landmarks.clear();
        this.landmarkChunks.clear();
    }

    /**
     * Get statistics for debugging
     * @returns {Object} Registry statistics
     */
    getStats() {
        return {
            totalLandmarks: this.landmarks.size,
            totalChunksTracked: this.chunkLandmarks.size
        };
    }
}

/**
 * SpawnPointManager - Main thread registry for spawn points
 *
 * Manages spawn points received from the terrain worker:
 * - Stores spawn points by chunk
 * - Tracks active entities per spawn point
 * - Manages per-spawn cooldown timers
 * - Provides spatial queries for MobSpawner
 */

export class SpawnPointManager {
    constructor() {
        // Spawn points indexed by chunk key "chunkX,chunkZ"
        this.chunkSpawnPoints = new Map();

        // Track active entities per spawn point ID
        // Map<spawnPointId, Set<entityId>>
        this.activeEntities = new Map();

        // Cooldown timers per spawn point ID
        // Map<spawnPointId, remainingTimeInSeconds>
        this.cooldowns = new Map();

        // All spawn points indexed by ID for quick lookup
        this.spawnPointsById = new Map();

        // Stats for debugging
        this.stats = {
            totalSpawnPoints: 0,
            activeSpawnPoints: 0,
            onCooldown: 0
        };
    }

    /**
     * Add spawn points for a chunk (called when chunk is generated)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {Array} spawnPoints - Array of spawn point objects from worker
     */
    addChunkSpawnPoints(chunkX, chunkZ, spawnPoints) {
        if (!spawnPoints || spawnPoints.length === 0) return;

        const key = `${chunkX},${chunkZ}`;

        // Remove any existing spawn points for this chunk
        this.removeChunkSpawnPoints(chunkX, chunkZ);

        // Store spawn points
        this.chunkSpawnPoints.set(key, spawnPoints);

        // Index by ID for quick lookup
        for (const sp of spawnPoints) {
            this.spawnPointsById.set(sp.id, sp);
            // Initialize active entity set
            this.activeEntities.set(sp.id, new Set());
        }

        this.stats.totalSpawnPoints += spawnPoints.length;
    }

    /**
     * Remove spawn points for a chunk (called when chunk is unloaded)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     */
    removeChunkSpawnPoints(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const spawnPoints = this.chunkSpawnPoints.get(key);

        if (!spawnPoints) return;

        // Clean up associated data
        for (const sp of spawnPoints) {
            this.spawnPointsById.delete(sp.id);
            this.activeEntities.delete(sp.id);
            this.cooldowns.delete(sp.id);
        }

        this.stats.totalSpawnPoints -= spawnPoints.length;
        this.chunkSpawnPoints.delete(key);
    }

    /**
     * Get spawn points near a position
     * @param {Object} position - Position with x, y, z properties
     * @param {number} radius - Search radius
     * @returns {Array} Spawn points within radius
     */
    getSpawnPointsNear(position, radius) {
        const result = [];
        const radiusSq = radius * radius;

        // Check all loaded spawn points
        for (const spawnPoints of this.chunkSpawnPoints.values()) {
            for (const sp of spawnPoints) {
                const dx = sp.x - position.x;
                const dz = sp.z - position.z;
                const distSq = dx * dx + dz * dz;

                if (distSq <= radiusSq) {
                    // Add distance for filtering/sorting
                    result.push({
                        ...sp,
                        distanceSq: distSq,
                        distance: Math.sqrt(distSq)
                    });
                }
            }
        }

        return result;
    }

    /**
     * Get spawn points in a specific chunk
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {Array} Spawn points in chunk
     */
    getSpawnPointsInChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        return this.chunkSpawnPoints.get(key) || [];
    }

    /**
     * Get a spawn point by ID
     * @param {string} spawnPointId - Spawn point ID
     * @returns {Object|null} Spawn point or null
     */
    getSpawnPointById(spawnPointId) {
        return this.spawnPointsById.get(spawnPointId) || null;
    }

    /**
     * Mark an entity as active at a spawn point
     * @param {string} spawnPointId - Spawn point ID
     * @param {string|number} entityId - Entity ID
     */
    markSpawnActive(spawnPointId, entityId) {
        const entities = this.activeEntities.get(spawnPointId);
        if (entities) {
            entities.add(entityId);
        }
    }

    /**
     * Mark an entity as inactive at a spawn point
     * @param {string} spawnPointId - Spawn point ID
     * @param {string|number} entityId - Entity ID (optional, removes all if not provided)
     */
    markSpawnInactive(spawnPointId, entityId = null) {
        const entities = this.activeEntities.get(spawnPointId);
        if (entities) {
            if (entityId !== null) {
                entities.delete(entityId);
            } else {
                entities.clear();
            }
        }
    }

    /**
     * Check if a spawn point can spawn (not on cooldown and under max count)
     * @param {string} spawnPointId - Spawn point ID
     * @returns {boolean} True if spawn is allowed
     */
    canSpawnAt(spawnPointId) {
        const sp = this.spawnPointsById.get(spawnPointId);
        if (!sp) return false;

        // Check cooldown
        if (this.cooldowns.has(spawnPointId)) {
            return false;
        }

        // Check max count
        const activeCount = this.getActiveCount(spawnPointId);
        return activeCount < sp.maxCount;
    }

    /**
     * Get the number of active entities at a spawn point
     * @param {string} spawnPointId - Spawn point ID
     * @returns {number} Active entity count
     */
    getActiveCount(spawnPointId) {
        const entities = this.activeEntities.get(spawnPointId);
        return entities ? entities.size : 0;
    }

    /**
     * Start cooldown timer for a spawn point
     * @param {string} spawnPointId - Spawn point ID
     */
    startCooldown(spawnPointId) {
        const sp = this.spawnPointsById.get(spawnPointId);
        if (sp) {
            this.cooldowns.set(spawnPointId, sp.respawnTime);
        }
    }

    /**
     * Update cooldown timers (call once per frame)
     * @param {number} deltaTime - Time since last update in seconds
     */
    update(deltaTime) {
        // Update cooldowns
        for (const [spawnPointId, remaining] of this.cooldowns.entries()) {
            const newRemaining = remaining - deltaTime;
            if (newRemaining <= 0) {
                this.cooldowns.delete(spawnPointId);
            } else {
                this.cooldowns.set(spawnPointId, newRemaining);
            }
        }

        // Update stats
        this.stats.onCooldown = this.cooldowns.size;
        this.stats.activeSpawnPoints = 0;
        for (const entities of this.activeEntities.values()) {
            if (entities.size > 0) {
                this.stats.activeSpawnPoints++;
            }
        }
    }

    /**
     * Get debugging stats
     * @returns {Object} Stats object
     */
    getStats() {
        return {
            ...this.stats,
            chunksWithSpawnPoints: this.chunkSpawnPoints.size
        };
    }

    /**
     * Clear all spawn points (e.g., on world reset)
     */
    clear() {
        this.chunkSpawnPoints.clear();
        this.spawnPointsById.clear();
        this.activeEntities.clear();
        this.cooldowns.clear();
        this.stats = {
            totalSpawnPoints: 0,
            activeSpawnPoints: 0,
            onCooldown: 0
        };
    }
}

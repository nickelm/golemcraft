/**
 * WorldManager - High-level coordinator for all world systems
 * 
 * Architecture:
 * - Web worker generates ALL terrain data (mesh + block data)
 * - Main thread receives and stores block data in ChunkBlockCache
 * - Collision queries the cache - NO terrain regeneration on main thread
 * - Worker is the SINGLE SOURCE OF TRUTH
 * 
 * Manages:
 * - Chunk loading/unloading with worker
 * - Object placement (trees, rocks)
 * - Landmark generation (temples, ruins) - TODO: move to worker
 * - Block modifications (craters, destruction)
 * - World persistence
 */

import * as THREE from 'three';
import { TerrainGenerator, WATER_LEVEL } from './terrain/terraingenerator.js';
import { ChunkedTerrain } from './terrain/terrainchunks.js';
import { ObjectGenerator } from './objects/objectgenerator.js';
import { ChunkLoader } from './chunkloader.js';
import { LandmarkSystem } from './landmarks/landmarksystem.js';
import { TerrainDataProvider } from './terraindataprovider.js';

// Re-export WATER_LEVEL for API compatibility
export { WATER_LEVEL };

export class WorldManager {
    constructor(scene, terrainTexture, seed, worldId, isMobile = false) {
        this.scene = scene;
        this.seed = seed;
        this.worldId = worldId;
        this.isMobile = isMobile;
        this.initialized = false;

        console.log(`Creating world: seed=${seed}, id=${worldId}`);

        // Create terrain generator (still needed for object placement until moved to worker)
        // TODO: Remove once object spawning moves to worker
        this.terrain = new TerrainGenerator(seed);

        // Create landmark system (procedural POIs like temples)
        // TODO: Move to worker
        this.landmarkSystem = new LandmarkSystem(this.terrain, seed);

        // Connect landmark system to terrain generator
        this.terrain.setLandmarkSystem(this.landmarkSystem);

        // Create chunked terrain renderer
        this.chunkedTerrain = new ChunkedTerrain(this.scene, this.terrain, terrainTexture);

        // Create object generator (with landmark system for exclusion zones)
        this.objectGenerator = new ObjectGenerator(this.terrain, seed, this.landmarkSystem);

        // Create chunk loader (no initial sync load)
        this.chunkLoader = new ChunkLoader(
            worldId,
            this.chunkedTerrain,
            this.objectGenerator,
            null
        );

        // Terrain data provider will be created after worker is initialized
        // This is what collision and game logic should use
        this.terrainDataProvider = null;

        // Stats
        this.updateCount = 0;
    }

    /**
     * Initialize the world (async)
     * Call this before starting the game loop
     * @param {Object} playerPosition - Initial player position {x, y, z}
     * @param {Function} onProgress - Callback for progress updates (loaded, total)
     * @returns {Promise} Resolves when initial chunks are ready
     */
    async init(playerPosition, onProgress = null) {
        console.log('Initializing world...');
        const startTime = performance.now();

        // Initialize worker
        await this.chunkLoader.initWorker(this.seed);

        // Create terrain data provider that routes to worker's block cache
        this.terrainDataProvider = new TerrainDataProvider(this.chunkLoader.workerManager);

        // Request chunks around player position
        const chunksNeeded = this.chunkLoader.requestChunksAround(playerPosition);
        console.log(`Queued ${chunksNeeded} chunks for initial load`);

        // Wait for minimum safe terrain
        await this.waitForSafeTerrain(playerPosition, onProgress);

        const initTime = performance.now() - startTime;
        console.log(`World initialized in ${initTime.toFixed(0)}ms`);
        console.log(`Chunks loaded: ${this.chunkLoader.chunksWithMeshes.size}`);

        this.initialized = true;
        return true;
    }

    /**
     * Wait until minimum safe terrain exists around player
     * @param {Object} position - Player position
     * @param {Function} onProgress - Progress callback
     */
    async waitForSafeTerrain(position, onProgress) {
        const minSafeChunks = (this.chunkLoader.minSafeDistance * 2 + 1) ** 2;
        
        return new Promise((resolve) => {
            const checkReady = () => {
                const loaded = this.chunkLoader.chunksWithMeshes.size;
                const pending = this.chunkLoader.getPendingCount();
                const total = loaded + pending;

                if (onProgress) {
                    onProgress(loaded, Math.max(total, minSafeChunks));
                }

                if (this.chunkLoader.hasSafeTerrainAround(position)) {
                    resolve();
                } else {
                    requestAnimationFrame(checkReady);
                }
            };
            checkReady();
        });
    }

    /**
     * Update world systems
     * @returns {boolean} True if game should pause for loading
     */
    update(playerPosition) {
        if (!this.initialized) return true;

        this.updateCount++;

        // Update chunk loading every frame when loading, every 10 frames otherwise
        const updateFrequency = this.chunkLoader.isLoading ? 1 : 10;
        
        let needsLoading = false;
        if (this.updateCount % updateFrequency === 0) {
            needsLoading = this.chunkLoader.update(playerPosition);
        }

        // Update object visibility every 5 frames
        if (this.updateCount % 5 === 0 && this.objectGenerator) {
            this.objectGenerator.updateObjectVisibility(playerPosition);
        }

        return needsLoading;
    }

    /**
     * Get terrain height at position
     * Uses the worker's block cache data
     */
    getHeight(x, z) {
        if (this.terrainDataProvider) {
            return this.terrainDataProvider.getHeight(Math.floor(x), Math.floor(z));
        }
        // Fallback to old terrain generator if not initialized
        return this.terrain.getHeight(x, z);
    }

    /**
     * Get interpolated height at any position
     */
    getInterpolatedHeight(x, z) {
        if (this.terrainDataProvider) {
            return this.terrainDataProvider.getInterpolatedHeight(x, z);
        }
        return this.terrain.getInterpolatedHeight(x, z);
    }

    /**
     * Get biome at position
     * TODO: Move biome data to worker and cache
     */
    getBiome(x, z) {
        return this.terrain.getBiome(x, z);
    }

    /**
     * Get block type at position
     * Uses the worker's block cache - SINGLE SOURCE OF TRUTH
     */
    getBlockType(x, y, z) {
        if (this.terrainDataProvider) {
            return this.terrainDataProvider.getBlockType(
                Math.floor(x), 
                Math.floor(y), 
                Math.floor(z)
            );
        }
        // Fallback - should not happen in normal operation
        return this.terrain.getBlockType(x, y, z);
    }

    /**
     * Destroy a block
     * TODO: Need to notify worker and update block cache
     */
    destroyBlock(x, y, z) {
        this.terrain.destroyBlock(x, y, z);
        this.chunkLoader.markBlockDestroyed(x, y, z);
        this.chunkedTerrain.regenerateChunkAt(x, z);
    }

    /**
     * Create explosion crater
     */
    createExplosionCrater(position, radius) {
        const intRadius = Math.ceil(radius);
        const px = Math.floor(position.x);
        const py = Math.floor(position.y);
        const pz = Math.floor(position.z);

        for (let dx = -intRadius; dx <= intRadius; dx++) {
            for (let dy = -intRadius; dy <= intRadius; dy++) {
                for (let dz = -intRadius; dz <= intRadius; dz++) {
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist <= radius) {
                        const bx = px + dx;
                        const by = py + dy;
                        const bz = pz + dz;
                        if (by > 0) {
                            this.terrain.destroyBlock(bx, by, bz);
                        }
                    }
                }
            }
        }

        this.chunkedTerrain.regenerateChunksInRadius(px, pz, intRadius + 1);
        this.chunkLoader.saveModifiedChunks();
    }

    /**
     * Get water level
     */
    getWaterLevel() {
        return WATER_LEVEL;
    }

    /**
     * Check if position is underwater
     */
    isUnderwater(x, y, z) {
        return y <= WATER_LEVEL && this.getHeight(x, z) < WATER_LEVEL;
    }

    /**
     * Get worker stats for performance monitor
     */
    getWorkerStats() {
        return this.chunkLoader.getWorkerStats();
    }

    /**
     * Check if currently loading
     */
    isLoading() {
        return this.chunkLoader.isLoading;
    }

    /**
     * Set loading state change callback
     */
    setLoadingCallback(callback) {
        this.chunkLoader.onLoadingStateChange = callback;
    }

    /**
     * Set mob spawner
     */
    setMobSpawner(mobSpawner) {
        this.chunkLoader.mobSpawner = mobSpawner;
    }

    /**
     * Get loaded chunks
     */
    getLoadedChunks() {
        return this.chunkLoader.loadedChunks;
    }

    /**
     * Clean up resources
     */
    dispose() {
        this.chunkLoader.dispose();
        if (this.chunkedTerrain.dispose) {
            this.chunkedTerrain.dispose();
        }
    }
}
import * as THREE from 'three';
import { TerrainGenerator, WATER_LEVEL } from './terrain/terraingenerator.js';
import { ChunkedTerrain } from './terrain/terrainchunks.js';
import { ObjectGenerator } from './objects/objectgenerator.js';
import { ChunkLoader } from './chunkloader.js';
import { LandmarkSystem } from './landmarks/landmarksystem.js';

// Re-export WATER_LEVEL for API compatibility
export { WATER_LEVEL };

/**
 * WorldManager - High-level coordinator for all world systems
 * 
 * All chunk generation happens via web worker:
 * - No synchronous initial load (no more 7 second freezes)
 * - Shows loading screen while chunks generate
 * - Pauses game if player catches up to terrain
 * 
 * Manages:
 * - Terrain generation (height, biomes)
 * - Chunk loading/unloading with worker
 * - Object placement (trees, rocks)
 * - Landmark generation (temples, ruins)
 * - Block modifications (craters, destruction)
 * - World persistence
 */
export class WorldManager {
    constructor(scene, terrainTexture, seed, worldId, isMobile = false) {
        this.scene = scene;
        this.seed = seed;
        this.worldId = worldId;
        this.isMobile = isMobile;
        this.initialized = false;

        console.log(`Creating world: seed=${seed}, id=${worldId}`);

        // Create terrain generator
        this.terrain = new TerrainGenerator(seed);

        // Create landmark system (procedural POIs like temples)
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
     */
    getHeight(x, z) {
        return this.terrain.getHeight(x, z);
    }

    /**
     * Get interpolated height at any position
     */
    getInterpolatedHeight(x, z) {
        return this.terrain.getInterpolatedHeight(x, z);
    }

    /**
     * Get biome at position
     */
    getBiome(x, z) {
        return this.terrain.getBiome(x, z);
    }

    /**
     * Get block type at position
     */
    getBlockType(x, y, z) {
        return this.terrain.getBlockType(x, y, z);
    }

    /**
     * Destroy a block
     */
    destroyBlock(x, y, z) {
        this.terrain.destroyBlock(x, y, z);
        this.chunkLoader.markBlockDestroyed(x, y, z);
    }

    /**
     * Create explosion crater
     */
    createExplosionCrater(position, radius) {
        const centerX = Math.floor(position.x);
        const centerY = Math.floor(position.y);
        const centerZ = Math.floor(position.z);

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist <= radius) {
                        const x = centerX + dx;
                        const y = centerY + dy;
                        const z = centerZ + dz;

                        if (y > 0) {
                            this.destroyBlock(x, y, z);
                        }
                    }
                }
            }
        }

        this.chunkedTerrain.regenerateChunksInRadius(centerX, centerZ, radius + 2);
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
        return y <= WATER_LEVEL && this.terrain.getHeight(x, z) < WATER_LEVEL;
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
     * Clean up
     */
    dispose() {
        this.chunkLoader.dispose();
        if (this.chunkedTerrain.dispose) {
            this.chunkedTerrain.dispose();
        }
    }
}
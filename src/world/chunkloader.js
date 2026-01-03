import { CHUNK_SIZE } from './terrain/terrainchunks.js';
import { TerrainWorkerManager } from '../workers/terrainworkermanager.js';

/**
 * ChunkLoader - Manages dynamic chunk loading via web worker
 * 
 * All chunk generation happens in the worker. No synchronous fallback.
 * 
 * Features:
 * - Priority queue based on distance from player
 * - Loading state detection (shows overlay when player too close to unloaded chunks)
 * - Automatic chunk unloading beyond draw distance
 * - Block modification persistence
 */
export class ChunkLoader {
    constructor(worldId, chunkedTerrain, objectGenerator, mobSpawner) {
        this.worldId = worldId;
        this.chunkedTerrain = chunkedTerrain;
        this.objectGenerator = objectGenerator;
        this.mobSpawner = mobSpawner;

        // Chunk tracking
        this.loadedChunks = new Set();      // Chunks queued or loaded
        this.chunksWithMeshes = new Set();  // Chunks that have meshes
        this.modifiedChunks = new Map();    // Modified block positions

        // Load radius (in chunks)
        this.loadRadius = 8;
        this.unloadRadius = 10;
        
        // Loading state detection
        this.minSafeDistance = 2;  // Minimum chunks of loaded terrain needed around player
        this.isLoading = false;    // True when waiting for critical chunks
        this.onLoadingStateChange = null;  // Callback for loading state changes

        // Worker manager
        this.workerManager = null;
        this.workerReady = false;

        // Load modified chunks from localStorage
        this.loadModifiedChunks();

        // Stats
        this.chunksLoaded = 0;
        this.chunksUnloaded = 0;
    }

    /**
     * Initialize the terrain worker
     * @param {number} seed - World seed
     * @returns {Promise} Resolves when worker is ready
     */
    async initWorker(seed) {
        this.workerManager = new TerrainWorkerManager(
            this.chunkedTerrain.scene,
            this.chunkedTerrain.opaqueMaterial,
            this.chunkedTerrain.waterMaterial,
            (chunkX, chunkZ, meshes) => this.onChunkReady(chunkX, chunkZ, meshes)
        );

        await this.workerManager.init(seed);
        this.workerReady = true;
        console.log('ChunkLoader: Worker ready');
    }

    /**
     * Callback when worker finishes generating a chunk
     */
    onChunkReady(chunkX, chunkZ, meshes) {
        const key = `${chunkX},${chunkZ}`;

        // Check if chunk was unloaded while generating
        if (!this.loadedChunks.has(key)) {
            if (meshes.opaqueMesh) meshes.opaqueMesh.geometry.dispose();
            if (meshes.waterMesh) meshes.waterMesh.geometry.dispose();
            return;
        }

        // Check if mesh already exists
        if (this.chunksWithMeshes.has(key)) {
            if (meshes.opaqueMesh) meshes.opaqueMesh.geometry.dispose();
            if (meshes.waterMesh) meshes.waterMesh.geometry.dispose();
            return;
        }

        // Add meshes to scene
        if (meshes.opaqueMesh) {
            this.chunkedTerrain.scene.add(meshes.opaqueMesh);
        }
        if (meshes.waterMesh) {
            this.chunkedTerrain.scene.add(meshes.waterMesh);
        }

        // Store in chunk map
        this.chunkedTerrain.chunks.set(key, {
            opaqueMesh: meshes.opaqueMesh,
            waterMesh: meshes.waterMesh
        });

        this.chunksWithMeshes.add(key);

        // Generate objects for this chunk
        if (this.objectGenerator) {
            this.objectGenerator.generateForChunk(
                this.chunkedTerrain.scene,
                chunkX,
                chunkZ,
                6, // WATER_LEVEL
                this.loadedChunks
            );
        }

        this.chunksLoaded++;
    }

    /**
     * Request chunks around a position
     * Used for initial load or teleportation
     * @param {Object} position - {x, z} world position
     * @returns {number} Number of chunks queued
     */
    requestChunksAround(position) {
        if (!this.workerReady) return 0;

        const playerChunkX = Math.floor(position.x / CHUNK_SIZE);
        const playerChunkZ = Math.floor(position.z / CHUNK_SIZE);
        
        let queued = 0;

        for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
            for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
                const chunkX = playerChunkX + dx;
                const chunkZ = playerChunkZ + dz;
                const key = `${chunkX},${chunkZ}`;

                // Skip if already loaded or queued
                if (this.chunksWithMeshes.has(key)) continue;
                if (this.loadedChunks.has(key)) continue;

                // Calculate priority
                const centerX = chunkX * CHUNK_SIZE + CHUNK_SIZE / 2;
                const centerZ = chunkZ * CHUNK_SIZE + CHUNK_SIZE / 2;
                const distX = centerX - position.x;
                const distZ = centerZ - position.z;
                const priority = distX * distX + distZ * distZ;

                // Mark as loading and queue
                this.loadedChunks.add(key);
                
                const context = {
                    destroyedBlocks: Array.from(this.chunkedTerrain.terrain.destroyedBlocks || [])
                };
                this.workerManager.requestChunk(chunkX, chunkZ, priority, context);
                queued++;
            }
        }

        return queued;
    }

    /**
     * Get the number of chunks needed around player
     */
    getRequiredChunkCount() {
        const diameter = this.loadRadius * 2 + 1;
        return diameter * diameter;
    }

    /**
     * Get number of loaded chunks with meshes
     */
    getLoadedChunkCount() {
        return this.chunksWithMeshes.size;
    }

    /**
     * Check if minimum safe terrain exists around player
     * @param {Object} position - Player position
     * @returns {boolean} True if safe to continue
     */
    hasSafeTerrainAround(position) {
        const playerChunkX = Math.floor(position.x / CHUNK_SIZE);
        const playerChunkZ = Math.floor(position.z / CHUNK_SIZE);

        // Check chunks in minimum safe radius
        for (let dx = -this.minSafeDistance; dx <= this.minSafeDistance; dx++) {
            for (let dz = -this.minSafeDistance; dz <= this.minSafeDistance; dz++) {
                const key = `${playerChunkX + dx},${playerChunkZ + dz}`;
                if (!this.chunksWithMeshes.has(key)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Update chunk loading based on player position
     * @param {Object} playerPosition - Current player position
     * @returns {boolean} True if game should pause for loading
     */
    update(playerPosition) {
        if (!this.workerReady) return true; // Pause if worker not ready

        const playerChunkX = Math.floor(playerPosition.x / CHUNK_SIZE);
        const playerChunkZ = Math.floor(playerPosition.z / CHUNK_SIZE);

        // Update worker priorities and cancel distant chunks
        this.workerManager.updatePriorities(playerPosition.x, playerPosition.z, this.unloadRadius);

        // Queue chunks that need loading
        for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
            for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
                const chunkX = playerChunkX + dx;
                const chunkZ = playerChunkZ + dz;
                const key = `${chunkX},${chunkZ}`;

                // Skip if already has mesh or is loading
                if (this.chunksWithMeshes.has(key)) continue;
                if (this.loadedChunks.has(key)) continue;

                // Calculate priority
                const centerX = chunkX * CHUNK_SIZE + CHUNK_SIZE / 2;
                const centerZ = chunkZ * CHUNK_SIZE + CHUNK_SIZE / 2;
                const distX = centerX - playerPosition.x;
                const distZ = centerZ - playerPosition.z;
                const priority = distX * distX + distZ * distZ;

                // Mark as loading and queue
                this.loadedChunks.add(key);
                
                const context = {
                    destroyedBlocks: Array.from(this.chunkedTerrain.terrain.destroyedBlocks || [])
                };
                this.workerManager.requestChunk(chunkX, chunkZ, priority, context);
            }
        }

        // Unload distant chunks
        const toUnload = [];
        this.loadedChunks.forEach(key => {
            const [x, z] = key.split(',').map(Number);
            const dx = Math.abs(x - playerChunkX);
            const dz = Math.abs(z - playerChunkZ);

            if (dx > this.unloadRadius || dz > this.unloadRadius) {
                toUnload.push({ x, z, key });
            }
        });

        toUnload.forEach(({ x, z, key }) => {
            this.unloadChunk(x, z, key);
        });

        // Check if we need to pause for loading
        const needsLoading = !this.hasSafeTerrainAround(playerPosition);
        
        if (needsLoading !== this.isLoading) {
            this.isLoading = needsLoading;
            if (this.onLoadingStateChange) {
                this.onLoadingStateChange(needsLoading);
            }
        }

        return needsLoading;
    }

    /**
     * Unload a chunk
     */
    unloadChunk(chunkX, chunkZ, key) {
        // Cancel pending worker request
        if (this.workerManager) {
            this.workerManager.cancelRequest(chunkX, chunkZ);
        }

        const chunkData = this.chunkedTerrain.chunks.get(key);

        if (chunkData) {
            if (chunkData.opaqueMesh) {
                chunkData.opaqueMesh.geometry.dispose();
                this.chunkedTerrain.scene.remove(chunkData.opaqueMesh);
            }
            if (chunkData.waterMesh) {
                chunkData.waterMesh.geometry.dispose();
                this.chunkedTerrain.scene.remove(chunkData.waterMesh);
            }
            this.chunkedTerrain.chunks.delete(key);
        }

        if (this.objectGenerator) {
            this.objectGenerator.unloadChunk(chunkX, chunkZ);
        }

        this.loadedChunks.delete(key);
        this.chunksWithMeshes.delete(key);
        this.chunksUnloaded++;
    }

    /**
     * Get pending chunk count
     */
    getPendingCount() {
        if (!this.workerManager) return 0;
        const stats = this.workerManager.getStats();
        return stats.pendingCount + stats.processingCount;
    }

    /**
     * Get worker stats for performance monitor
     */
    getWorkerStats() {
        if (this.workerReady && this.workerManager) {
            return {
                ...this.workerManager.getStats(),
                workerEnabled: true,
                isLoading: this.isLoading
            };
        }
        return {
            pendingCount: 0,
            processingCount: 0,
            totalGenerated: this.chunksLoaded,
            totalCancelled: 0,
            avgGenTime: 'N/A',
            workerEnabled: false,
            isLoading: this.isLoading
        };
    }

    /**
     * Mark a block as destroyed
     */
    markBlockDestroyed(x, y, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        const key = `${chunkX},${chunkZ}`;

        if (!this.modifiedChunks.has(key)) {
            this.modifiedChunks.set(key, new Set());
        }
        this.modifiedChunks.get(key).add(`${x},${y},${z}`);
    }

    /**
     * Save modified chunks to localStorage
     */
    saveModifiedChunks() {
        const data = {};
        this.modifiedChunks.forEach((blocks, chunkKey) => {
            data[chunkKey] = Array.from(blocks);
        });

        try {
            localStorage.setItem(`${this.worldId}_chunks`, JSON.stringify(data));
        } catch (e) {
            console.error('Failed to save modified chunks:', e);
        }
    }

    /**
     * Load modified chunks from localStorage
     */
    loadModifiedChunks() {
        try {
            const data = localStorage.getItem(`${this.worldId}_chunks`);
            if (!data) return;

            const parsed = JSON.parse(data);
            Object.entries(parsed).forEach(([chunkKey, blocks]) => {
                this.modifiedChunks.set(chunkKey, new Set(blocks));
            });
        } catch (e) {
            console.error('Failed to load modified chunks:', e);
        }
    }

    /**
     * Set draw distance
     */
    setDrawDistance(chunks) {
        this.loadRadius = chunks;
        this.unloadRadius = chunks + 2;
    }

    /**
     * Get stats
     */
    getStats() {
        return {
            loaded: this.loadedChunks.size,
            withMeshes: this.chunksWithMeshes.size,
            modified: this.modifiedChunks.size,
            totalLoaded: this.chunksLoaded,
            totalUnloaded: this.chunksUnloaded,
            isLoading: this.isLoading
        };
    }

    /**
     * Clean up
     */
    dispose() {
        if (this.workerManager) {
            this.workerManager.dispose();
            this.workerManager = null;
        }
        this.loadedChunks.clear();
        this.chunksWithMeshes.clear();
    }
}
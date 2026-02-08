import { CHUNK_SIZE } from './terrain/terrainchunks.js';
import { TerrainWorkerManager } from '../workers/terrainworkermanager.js';

// Chunk loading radii for different draw distances
// Calculated to provide terrain coverage near fog distance while maintaining performance
// unload = load + 2 for hysteresis to prevent thrashing
const DRAW_DISTANCE_RADII = {
    far: { load: 14, unload: 16 },      // ~224 units (fog.far = 300)
    medium: { load: 9, unload: 11 },    // ~144 units (fog.far = 150)
    near: { load: 7, unload: 9 }        // ~112 units (fog.far = 100)
};

/**
 * ChunkLoader - Manages dynamic chunk loading via web worker
 * 
 * All chunk generation happens in the worker. No synchronous fallback.
 * 
 * SMOOTH TERRAIN ARCHITECTURE:
 * - Receives both surfaceMesh (smooth terrain) and opaqueMesh (voxels)
 * - Stores both meshes per chunk
 * - surfaceMesh: rolling hills, plains, smooth landscape
 * - opaqueMesh: caves, structures, cliffs, craggy peaks
 * 
 * Features:
 * - Priority queue based on distance from player
 * - Loading state detection (shows overlay when player too close to unloaded chunks)
 * - Hysteresis: pause early, but wait for buffer before unpausing
 * - Automatic chunk unloading beyond draw distance
 * - Block modification persistence
 */
export class ChunkLoader {
    constructor(worldId, chunkedTerrain, objectGenerator, mobSpawner, drawDistance = 'medium') {
        this.worldId = worldId;
        this.chunkedTerrain = chunkedTerrain;
        this.objectGenerator = objectGenerator;
        this.mobSpawner = mobSpawner;
        this.drawDistance = drawDistance;

        // Chunk tracking
        this.loadedChunks = new Set();      // Chunks queued or loaded
        this.chunksWithMeshes = new Set();  // Chunks that have meshes
        this.modifiedChunks = new Map();    // Modified block positions

        // Load radius based on draw distance setting
        const radii = DRAW_DISTANCE_RADII[drawDistance] || DRAW_DISTANCE_RADII.medium;
        this.loadRadius = radii.load;
        this.unloadRadius = radii.unload;

        console.log(`ChunkLoader: drawDistance=${drawDistance}, loadRadius=${this.loadRadius}, unloadRadius=${this.unloadRadius}`);
        
        // Loading state detection with hysteresis
        this.minSafeDistance = 2;      // Pause if missing chunks within this radius (5x5 = 25)
        this.resumeBufferDistance = 4; // Don't unpause until this radius is loaded (9x9 = 81)
        this.isLoading = false;        // True when waiting for critical chunks
        this.onLoadingStateChange = null;  // Callback for loading state changes

        // Worker manager
        this.workerManager = null;
        this.workerReady = false;

        // Reference to destroyed blocks (set by WorldManager)
        this.destroyedBlocksRef = null;

        // Load modified chunks from localStorage
        this.loadModifiedChunks();

        // Stats
        this.chunksLoaded = 0;
        this.chunksUnloaded = 0;
    }

    /**
     * Initialize the terrain worker
     * @param {number} seed - World seed
     * @param {string} textureBlending - 'high' | 'medium' | 'low' (controls dithering mode in worker)
     * @param {Object} continentConfig - Continental mode config { enabled: boolean, baseRadius: number }
     * @returns {Promise} Resolves when worker is ready
     */
    async initWorker(seed, textureBlending = 'high', continentConfig = null) {
        this.workerManager = new TerrainWorkerManager(
            this.chunkedTerrain.scene,
            this.chunkedTerrain.opaqueMaterial,
            this.chunkedTerrain.waterMaterial,
            (chunkX, chunkZ, meshes, staticObjects) => this.onChunkReady(chunkX, chunkZ, meshes, staticObjects),
            this.chunkedTerrain.surfaceMaterial
        );

        await this.workerManager.init(seed, textureBlending, continentConfig);
        this.workerReady = true;
        console.log(`ChunkLoader: Worker ready (textureBlending=${textureBlending}, continent=${continentConfig?.enabled ? 'enabled' : 'disabled'})`);
    }

    /**
     * Callback when worker finishes generating a chunk
     * Now handles surfaceMesh (smooth terrain) + opaqueMesh (voxels) + waterMesh
     * @param {number} chunkX - Chunk X index
     * @param {number} chunkZ - Chunk Z index
     * @param {Object} meshes - Three.js meshes (surfaceMesh, opaqueMesh, waterMesh)
     * @param {Object} staticObjects - Worker-generated object positions (Float32Arrays)
     */
    onChunkReady(chunkX, chunkZ, meshes, staticObjects) {
        const key = `${chunkX},${chunkZ}`;

        // Check if chunk was unloaded while generating
        if (!this.loadedChunks.has(key)) {
            if (meshes.surfaceMesh) meshes.surfaceMesh.geometry.dispose();
            if (meshes.opaqueMesh) meshes.opaqueMesh.geometry.dispose();
            if (meshes.waterMesh) meshes.waterMesh.geometry.dispose();
            return;
        }

        // Check if mesh already exists
        if (this.chunksWithMeshes.has(key)) {
            if (meshes.surfaceMesh) meshes.surfaceMesh.geometry.dispose();
            if (meshes.opaqueMesh) meshes.opaqueMesh.geometry.dispose();
            if (meshes.waterMesh) meshes.waterMesh.geometry.dispose();
            return;
        }

        // Add meshes to scene
        if (meshes.surfaceMesh) {
            this.chunkedTerrain.scene.add(meshes.surfaceMesh);
        }
        if (meshes.opaqueMesh) {
            this.chunkedTerrain.scene.add(meshes.opaqueMesh);
        }
        if (meshes.waterMesh) {
            this.chunkedTerrain.scene.add(meshes.waterMesh);
        }

        // Store in chunk map (now with surfaceMesh)
        this.chunkedTerrain.chunks.set(key, {
            surfaceMesh: meshes.surfaceMesh,
            opaqueMesh: meshes.opaqueMesh,
            waterMesh: meshes.waterMesh
        });

        this.chunksWithMeshes.add(key);

        // Create object meshes from worker-computed positions
        if (this.objectGenerator && staticObjects) {
            this.objectGenerator.createMeshesFromWorkerData(
                this.chunkedTerrain.scene,
                chunkX,
                chunkZ,
                staticObjects
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
                    destroyedBlocks: Array.from(this.destroyedBlocksRef || [])
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
     * Used to determine if we need to PAUSE (missing critical chunks)
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
     * Check if buffer terrain exists around player
     * Used to determine if we can UNPAUSE (enough chunks loaded)
     * @param {Object} position - Player position
     * @returns {boolean} True if buffer is full
     */
    hasBufferTerrainAround(position) {
        const playerChunkX = Math.floor(position.x / CHUNK_SIZE);
        const playerChunkZ = Math.floor(position.z / CHUNK_SIZE);

        // Check chunks in buffer radius
        for (let dx = -this.resumeBufferDistance; dx <= this.resumeBufferDistance; dx++) {
            for (let dz = -this.resumeBufferDistance; dz <= this.resumeBufferDistance; dz++) {
                const key = `${playerChunkX + dx},${playerChunkZ + dz}`;
                if (!this.chunksWithMeshes.has(key)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Calculate recommended fog distance based on nearest unloaded chunk
     * Returns the distance to the closest chunk edge that doesn't have a mesh yet
     * @param {Object} playerPosition - Player position {x, y, z}
     * @returns {number} Recommended fog far distance in world units
     */
    getRecommendedFogDistance(playerPosition) {
        if (!playerPosition) {
            return (this.loadRadius - 2) * CHUNK_SIZE;
        }

        const playerChunkX = Math.floor(playerPosition.x / CHUNK_SIZE);
        const playerChunkZ = Math.floor(playerPosition.z / CHUNK_SIZE);

        // Find the nearest unloaded chunk within load radius
        let minDistance = Infinity;

        for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
            for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
                const chunkX = playerChunkX + dx;
                const chunkZ = playerChunkZ + dz;
                const key = `${chunkX},${chunkZ}`;

                // Skip chunks that already have meshes
                if (this.chunksWithMeshes.has(key)) {
                    continue;
                }

                // Calculate distance from player to the nearest edge of this chunk
                const chunkWorldX = chunkX * CHUNK_SIZE;
                const chunkWorldZ = chunkZ * CHUNK_SIZE;

                // Find closest point on chunk to player
                const closestX = Math.max(chunkWorldX, Math.min(playerPosition.x, chunkWorldX + CHUNK_SIZE));
                const closestZ = Math.max(chunkWorldZ, Math.min(playerPosition.z, chunkWorldZ + CHUNK_SIZE));

                const distX = playerPosition.x - closestX;
                const distZ = playerPosition.z - closestZ;
                const distance = Math.sqrt(distX * distX + distZ * distZ);

                if (distance < minDistance) {
                    minDistance = distance;
                }
            }
        }

        // If all chunks are loaded, use a comfortable distance
        if (minDistance === Infinity) {
            minDistance = (this.loadRadius - 1) * CHUNK_SIZE;
        }

        // Subtract a small buffer so fog hides the chunk edge
        const fogDistance = Math.max(16, minDistance - 8);

        return fogDistance;
    }

    /**
     * Update loading state based on terrain coverage
     * @param {boolean} needsLoading - True if critical terrain is missing
     */
    updateLoadingState(needsLoading) {
        if (needsLoading !== this.isLoading) {
            this.isLoading = needsLoading;
            if (this.onLoadingStateChange) {
                this.onLoadingStateChange(needsLoading);
            }
        }
    }

    /**
     * Main update loop - call every frame
     * @param {Object} playerPosition - Player {x, z} position
     * @returns {boolean} True if game should pause for loading
     */
    update(playerPosition) {
        if (!this.workerReady) return false;

        const playerChunkX = Math.floor(playerPosition.x / CHUNK_SIZE);
        const playerChunkZ = Math.floor(playerPosition.z / CHUNK_SIZE);

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
                    destroyedBlocks: Array.from(this.destroyedBlocksRef || [])
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

        // Hysteresis for loading state:
        // - PAUSE if missing any safe chunks (tight radius)
        // - UNPAUSE only when buffer is full (larger radius)
        let needsLoading;
        if (this.isLoading) {
            // Currently paused - wait for full buffer before resuming
            needsLoading = !this.hasBufferTerrainAround(playerPosition);
        } else {
            // Currently running - pause if missing safe chunks
            needsLoading = !this.hasSafeTerrainAround(playerPosition);
        }

        this.updateLoadingState(needsLoading);
        return needsLoading;
    }

    /**
     * Unload a chunk and its resources
     * Now handles surfaceMesh + opaqueMesh + waterMesh
     */
    unloadChunk(chunkX, chunkZ, key) {
        // Cancel pending request
        if (this.workerManager) {
            this.workerManager.cancelRequest(chunkX, chunkZ);
        }

        // Remove from tracking
        this.loadedChunks.delete(key);
        this.chunksWithMeshes.delete(key);

        // Remove meshes from scene
        const chunk = this.chunkedTerrain.chunks.get(key);
        if (chunk) {
            if (chunk.surfaceMesh) {
                chunk.surfaceMesh.geometry.dispose();
                this.chunkedTerrain.scene.remove(chunk.surfaceMesh);
            }
            if (chunk.opaqueMesh) {
                chunk.opaqueMesh.geometry.dispose();
                this.chunkedTerrain.scene.remove(chunk.opaqueMesh);
            }
            if (chunk.waterMesh) {
                chunk.waterMesh.geometry.dispose();
                this.chunkedTerrain.scene.remove(chunk.waterMesh);
            }
            this.chunkedTerrain.chunks.delete(key);
        }

        // Remove objects
        if (this.objectGenerator) {
            this.objectGenerator.unloadChunk(chunkX, chunkZ);
        }

        // Remove block cache data and landmark registry data
        if (this.workerManager) {
            this.workerManager.unloadChunk(chunkX, chunkZ);
        }

        // Remove spawn points for this chunk
        if (this.workerManager && this.workerManager.spawnPointManager) {
            this.workerManager.spawnPointManager.removeChunkSpawnPoints(chunkX, chunkZ);
        }

        this.chunksUnloaded++;
    }

    /**
     * Load modified chunks from localStorage
     */
    loadModifiedChunks() {
        try {
            const saved = localStorage.getItem(`golemcraft_${this.worldId}_modified`);
            if (saved) {
                this.modifiedChunks = new Map(JSON.parse(saved));
            }
        } catch (e) {
            console.warn('Failed to load modified chunks:', e);
        }
    }

    /**
     * Save modified chunks to localStorage
     */
    saveModifiedChunks() {
        try {
            localStorage.setItem(
                `golemcraft_${this.worldId}_modified`,
                JSON.stringify(Array.from(this.modifiedChunks.entries()))
            );
        } catch (e) {
            console.warn('Failed to save modified chunks:', e);
        }
    }

    /**
     * Set reference to destroyed blocks set (from WorldManager)
     * @param {Set} destroyedBlocks - The destroyed blocks set
     */
    setDestroyedBlocksRef(destroyedBlocks) {
        this.destroyedBlocksRef = destroyedBlocks;
    }

    /**
     * Get worker manager for external queries
     */
    getWorkerManager() {
        return this.workerManager;
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
     * Dispose all resources
     */
    dispose() {
        if (this.workerManager) {
            this.workerManager.dispose();
        }
        this.loadedChunks.clear();
        this.chunksWithMeshes.clear();
    }
}
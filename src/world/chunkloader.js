import * as THREE from 'three';
import { CHUNK_SIZE } from './terrain/terrainchunks.js';

/**
 * ChunkLoader - Manages dynamic loading and unloading of terrain chunks
 * 
 * Responsibilities:
 * - Load chunks when player approaches
 * - Unload chunks beyond draw distance
 * - Track chunk state (loaded, modified, persistent)
 * - Persist modified chunks to localStorage
 * - Coordinate with ChunkedTerrain for mesh generation
 */
export class ChunkLoader {
    constructor(worldId, chunkedTerrain, objectGenerator, mobSpawner) {
        this.worldId = worldId;
        this.chunkedTerrain = chunkedTerrain;
        this.objectGenerator = objectGenerator;
        this.mobSpawner = mobSpawner;
        
        // Chunk tracking
        this.loadedChunks = new Set();      // Set of "x,z" keys
        this.modifiedChunks = new Map();    // Map of "x,z" -> Set of modified blocks
        
        // Load radius (in chunks)
        this.loadRadius = 8;   // Load 8 chunks in each direction (256 blocks)
        this.unloadRadius = 10; // Unload chunks 10+ away (320 blocks)
        
        // Job queue for gradual chunk loading (prevents freezes)
        this.pendingChunks = [];
        this.chunksPerFrame = 2; // Generate 2 chunks per frame (adjustable for performance)
        
        // Load modified chunks from localStorage
        this.loadModifiedChunks();
        
        // Stats
        this.chunksLoaded = 0;
        this.chunksUnloaded = 0;
    }
    
    /**
     * Update chunk loading based on player position
     * @param {THREE.Vector3} playerPosition - Current player position
     */
    update(playerPosition) {
        const playerChunkX = Math.floor(playerPosition.x / CHUNK_SIZE);
        const playerChunkZ = Math.floor(playerPosition.z / CHUNK_SIZE);
        
        // Queue chunks for loading (don't generate immediately to avoid freezes)
        for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
            for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
                const chunkX = playerChunkX + dx;
                const chunkZ = playerChunkZ + dz;
                const key = `${chunkX},${chunkZ}`;
                
                if (!this.loadedChunks.has(key) && !this.isPending(key)) {
                    // Calculate priority (closer chunks = higher priority)
                    const priority = dx * dx + dz * dz;
                    this.pendingChunks.push({ chunkX, chunkZ, key, priority });
                }
            }
        }
        
        // Sort by priority (closest chunks first)
        this.pendingChunks.sort((a, b) => a.priority - b.priority);
        
        // Process a few chunks this frame (amortized loading)
        const chunksToProcess = Math.min(this.chunksPerFrame, this.pendingChunks.length);
        for (let i = 0; i < chunksToProcess; i++) {
            const chunk = this.pendingChunks.shift();
            this.loadChunk(chunk.chunkX, chunk.chunkZ);
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
    }
    
    /**
     * Check if a chunk is already pending in the queue
     * @param {string} key - Chunk key "x,z"
     * @returns {boolean} True if chunk is pending
     */
    isPending(key) {
        return this.pendingChunks.some(c => c.key === key);
    }
    
    /**
     * Load a chunk (generate mesh and objects, add to scene)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     */
    loadChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        
        // Generate terrain chunk mesh
        this.chunkedTerrain.generateChunk(chunkX, chunkZ);
        
        // Generate objects for this chunk
        if (this.objectGenerator) {
            this.objectGenerator.generateForChunk(
                this.chunkedTerrain.scene,
                chunkX,
                chunkZ,
                6 // WATER_LEVEL constant
            );
        }
        
        // Mark as loaded
        this.loadedChunks.add(key);
        this.chunksLoaded++;
    }
    
    /**
     * Unload a chunk (remove from scene and free memory)
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {string} key - Chunk key (optimization to avoid recomputing)
     */
    unloadChunk(chunkX, chunkZ, key) {
        const chunkData = this.chunkedTerrain.chunks.get(key);
        
        if (chunkData) {
            // Remove meshes from scene
            if (chunkData.opaqueMesh) {
                chunkData.opaqueMesh.geometry.dispose();
                this.chunkedTerrain.scene.remove(chunkData.opaqueMesh);
            }
            if (chunkData.waterMesh) {
                chunkData.waterMesh.geometry.dispose();
                this.chunkedTerrain.scene.remove(chunkData.waterMesh);
            }
            
            // Remove from chunk map
            this.chunkedTerrain.chunks.delete(key);
        }
        
        // Remove from loaded set
        this.loadedChunks.delete(key);
        this.chunksUnloaded++;
    }
    
    /**
     * Mark a block as destroyed (for persistence)
     * @param {number} x - World X coordinate
     * @param {number} y - World Y coordinate
     * @param {number} z - World Z coordinate
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
            console.log(`Saved ${this.modifiedChunks.size} modified chunks`);
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
            
            console.log(`Loaded ${this.modifiedChunks.size} modified chunks`);
        } catch (e) {
            console.error('Failed to load modified chunks:', e);
        }
    }
    
    /**
     * Check if a block has been destroyed
     * @param {number} x - World X coordinate
     * @param {number} y - World Y coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if block was destroyed
     */
    isBlockDestroyed(x, y, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        const key = `${chunkX},${chunkZ}`;
        
        const blocks = this.modifiedChunks.get(key);
        return blocks ? blocks.has(`${x},${y},${z}`) : false;
    }
    
    /**
     * Set draw distance (in chunks)
     * @param {number} chunks - Number of chunks to load in each direction
     */
    setDrawDistance(chunks) {
        this.loadRadius = chunks;
        this.unloadRadius = chunks + 2; // Always unload a bit beyond load radius
    }
    
    /**
     * Get chunk loading stats
     * @returns {Object} Stats object with counts
     */
    getStats() {
        return {
            loaded: this.loadedChunks.size,
            modified: this.modifiedChunks.size,
            totalLoaded: this.chunksLoaded,
            totalUnloaded: this.chunksUnloaded
        };
    }
    
    /**
     * Clear all loaded chunks (for cleanup)
     */
    clearAll() {
        this.loadedChunks.forEach(key => {
            const [x, z] = key.split(',').map(Number);
            this.unloadChunk(x, z, key);
        });
        
        this.loadedChunks.clear();
    }
}
/**
 * WorkerLandmarkSystem - Procedural landmark generation for web worker
 * 
 * This is a pure-function version of LandmarkSystem that can run in the worker.
 * No DOM, no Three.js - just deterministic landmark generation.
 * 
 * Features:
 * - Deterministic landmark placement from world seed
 * - Spatial hashing for efficient chunk queries
 * - Block type overrides for landmark materials
 * - Chamber/hollow volume tracking
 */

import { LANDMARK_TYPES, getLandmarkTypesForBiome, generateLandmarkStructure } from './landmarkdefinitions.js';

// Grid cell size for landmark placement
const LANDMARK_GRID_SIZE = 128;
const CHUNK_SIZE = 16;

export class WorkerLandmarkSystem {
    constructor(terrainProvider, seed) {
        this.terrainProvider = terrainProvider;
        this.seed = seed;
        
        // Cache of generated landmarks: Map<"gridX,gridZ" -> landmark data>
        this.landmarkCache = new Map();
        
        // Spatial hash: Map<"chunkX,chunkZ" -> array of landmarks affecting this chunk>
        this.chunkLandmarkIndex = new Map();
    }
    
    /**
     * Hash function for deterministic landmark placement
     */
    hash(x, z, salt = 0) {
        let h = this.seed + salt + x * 374761393 + z * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
    }
    
    /**
     * Get minimum terrain height across a footprint
     */
    getMinHeightInFootprint(centerX, centerZ, halfSize) {
        let minHeight = Infinity;
        
        const sampleOffsets = [
            [-halfSize, -halfSize], [halfSize, -halfSize],
            [-halfSize, halfSize], [halfSize, halfSize],
            [0, -halfSize], [0, halfSize],
            [-halfSize, 0], [halfSize, 0],
            [0, 0]
        ];
        
        for (const [dx, dz] of sampleOffsets) {
            const h = this.terrainProvider.getHeight(centerX + dx, centerZ + dz);
            if (h < minHeight) {
                minHeight = h;
            }
        }
        
        return minHeight;
    }
    
    /**
     * Get or generate landmark for a grid cell
     */
    getLandmarkInCell(gridX, gridZ) {
        const key = `${gridX},${gridZ}`;
        
        if (this.landmarkCache.has(key)) {
            return this.landmarkCache.get(key);
        }
        
        // Deterministic check: should this cell have a landmark?
        const roll = this.hash(gridX, gridZ, 12345);
        
        // Get world position for this grid cell
        const worldX = gridX * LANDMARK_GRID_SIZE + Math.floor(LANDMARK_GRID_SIZE / 2);
        const worldZ = gridZ * LANDMARK_GRID_SIZE + Math.floor(LANDMARK_GRID_SIZE / 2);
        
        // Check biome
        const biome = this.terrainProvider.getBiome(worldX, worldZ);
        const validTypes = getLandmarkTypesForBiome(biome);
        
        if (validTypes.length === 0) {
            this.landmarkCache.set(key, null);
            return null;
        }
        
        // Check if this cell should have a landmark
        const typeIndex = Math.floor(this.hash(gridX, gridZ, 54321) * validTypes.length);
        const typeName = validTypes[typeIndex];
        const typeConfig = LANDMARK_TYPES[typeName];
        
        if (roll > typeConfig.rarity) {
            this.landmarkCache.set(key, null);
            return null;
        }
        
        // Check terrain height constraints
        const halfBase = Math.floor(typeConfig.baseSize / 2);
        const baseY = this.getMinHeightInFootprint(worldX, worldZ, halfBase);
        
        if (baseY < typeConfig.minHeight || baseY > typeConfig.maxHeight) {
            this.landmarkCache.set(key, null);
            return null;
        }
        
        // Determine entrance direction
        const directions = ['+X', '-X', '+Z', '-Z'];
        const dirIndex = Math.abs((worldX * 3 + worldZ * 7 + this.seed) % 4);
        const entranceDirection = directions[dirIndex];
        
        console.log(`[LANDMARK] Generating ${typeName} at (${worldX}, ${baseY}, ${worldZ}), grid (${gridX}, ${gridZ}), biome: ${biome}`);
        
        // Generate the landmark
        const landmark = generateLandmarkStructure(
            typeName,
            typeConfig,
            worldX,
            baseY,
            worldZ,
            this.hash.bind(this),
            gridX,
            gridZ,
            entranceDirection
        );
        
        if (landmark) {
            console.log(`[LANDMARK] Generated with ${landmark.blocks.size} blocks, bounds: ${JSON.stringify(landmark.bounds)}`);
        }
        
        this.landmarkCache.set(key, landmark);
        
        if (landmark) {
            this.indexLandmarkByChunks(landmark);
        }
        
        return landmark;
    }
    
    /**
     * Index a landmark by the chunks it affects
     */
    indexLandmarkByChunks(landmark) {
        const minChunkX = Math.floor(landmark.bounds.minX / CHUNK_SIZE);
        const maxChunkX = Math.floor(landmark.bounds.maxX / CHUNK_SIZE);
        const minChunkZ = Math.floor(landmark.bounds.minZ / CHUNK_SIZE);
        const maxChunkZ = Math.floor(landmark.bounds.maxZ / CHUNK_SIZE);
        
        for (let cx = minChunkX; cx <= maxChunkX; cx++) {
            for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
                const chunkKey = `${cx},${cz}`;
                
                if (!this.chunkLandmarkIndex.has(chunkKey)) {
                    this.chunkLandmarkIndex.set(chunkKey, []);
                }
                
                this.chunkLandmarkIndex.get(chunkKey).push(landmark);
            }
        }
    }
    
    /**
     * Ensure landmarks are generated for grid cells affecting a chunk
     */
    ensureLandmarksForChunk(chunkX, chunkZ) {
        const worldMinX = chunkX * CHUNK_SIZE;
        const worldMaxX = worldMinX + CHUNK_SIZE;
        const worldMinZ = chunkZ * CHUNK_SIZE;
        const worldMaxZ = worldMinZ + CHUNK_SIZE;
        
        // Expand search to account for landmark size
        const maxLandmarkRadius = 20;
        const searchMinX = worldMinX - maxLandmarkRadius;
        const searchMaxX = worldMaxX + maxLandmarkRadius;
        const searchMinZ = worldMinZ - maxLandmarkRadius;
        const searchMaxZ = worldMaxZ + maxLandmarkRadius;
        
        const minGridX = Math.floor(searchMinX / LANDMARK_GRID_SIZE);
        const maxGridX = Math.floor(searchMaxX / LANDMARK_GRID_SIZE);
        const minGridZ = Math.floor(searchMinZ / LANDMARK_GRID_SIZE);
        const maxGridZ = Math.floor(searchMaxZ / LANDMARK_GRID_SIZE);
        
        for (let gx = minGridX; gx <= maxGridX; gx++) {
            for (let gz = minGridZ; gz <= maxGridZ; gz++) {
                this.getLandmarkInCell(gx, gz);
            }
        }
    }
    
    /**
     * Get landmarks affecting a chunk
     */
    getLandmarksForChunk(chunkX, chunkZ) {
        this.ensureLandmarksForChunk(chunkX, chunkZ);
        return this.chunkLandmarkIndex.get(`${chunkX},${chunkZ}`) || [];
    }
    
    /**
     * Check if position is inside a chamber (hollow volume)
     */
    isInsideChamber(x, y, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        
        const landmarks = this.getLandmarksForChunk(chunkX, chunkZ);
        
        for (const landmark of landmarks) {
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
     * Get landmark block type at position
     */
    getLandmarkBlockType(x, y, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        
        const landmarks = this.getLandmarksForChunk(chunkX, chunkZ);
        
        for (const landmark of landmarks) {
            const key = `${x},${y},${z}`;
            if (landmark.blocks && landmark.blocks.has(key)) {
                return landmark.blocks.get(key);
            }
        }
        
        return null;
    }
    
    /**
     * Check if position is inside any landmark's exclusion zone
     */
    isInsideLandmark(x, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        
        const landmarks = this.getLandmarksForChunk(chunkX, chunkZ);
        
        for (const landmark of landmarks) {
            if (x >= landmark.bounds.minX && x <= landmark.bounds.maxX &&
                z >= landmark.bounds.minZ && z <= landmark.bounds.maxZ) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Clear cache
     */
    clearCache() {
        this.landmarkCache.clear();
        this.chunkLandmarkIndex.clear();
    }
}
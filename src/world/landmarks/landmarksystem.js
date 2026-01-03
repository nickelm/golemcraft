/**
 * LandmarkSystem - Procedural placement of world Points of Interest
 * 
 * Handles:
 * - Deterministic landmark placement from world seed
 * - Spatial hashing for efficient chunk queries
 * - Volume exclusions for hollow structures (chambers, caves)
 * - Block type overrides for landmark materials
 * 
 * Landmarks are generated procedurally and do not require persistence—
 * the same seed always produces the same landmarks.
 */

import { LANDMARK_TYPES, generateLandmarkStructure } from './landmarkdefinitions.js';

// Grid cell size for landmark placement (landmarks are spaced on this grid)
// Smaller = more frequent landmarks
const LANDMARK_GRID_SIZE = 128;  // Was 256 - doubled density

// Chunk size must match terrainchunks.js
const CHUNK_SIZE = 16;

export class LandmarkSystem {
    constructor(terrain, seed) {
        this.terrain = terrain;
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
     * This ensures the landmark base extends down to meet the lowest ground point
     * 
     * @param {number} centerX - Center X position
     * @param {number} centerZ - Center Z position
     * @param {number} halfSize - Half the footprint size
     * @returns {number} Minimum terrain height within the footprint
     */
    getMinHeightInFootprint(centerX, centerZ, halfSize) {
        let minHeight = Infinity;
        
        // Sample corners and edges of the footprint
        // Don't need every block - corners and midpoints catch most slopes
        const sampleOffsets = [
            // Corners
            [-halfSize, -halfSize],
            [halfSize, -halfSize],
            [-halfSize, halfSize],
            [halfSize, halfSize],
            // Edge midpoints
            [0, -halfSize],
            [0, halfSize],
            [-halfSize, 0],
            [halfSize, 0],
            // Center
            [0, 0]
        ];
        
        for (const [dx, dz] of sampleOffsets) {
            const h = this.terrain.getHeight(centerX + dx, centerZ + dz);
            if (h < minHeight) {
                minHeight = h;
            }
        }
        
        return minHeight;
    }
    
    /**
     * Get or generate landmark for a grid cell
     * @param {number} gridX - Grid cell X
     * @param {number} gridZ - Grid cell Z
     * @returns {Object|null} Landmark data or null if no landmark in this cell
     */
    getLandmarkInCell(gridX, gridZ) {
        const key = `${gridX},${gridZ}`;
        
        if (this.landmarkCache.has(key)) {
            return this.landmarkCache.get(key);
        }
        
        // Deterministic check: should this cell have a landmark?
        const spawnChance = this.hash(gridX, gridZ, 12345);
        
        // ~50% of grid cells have landmarks (temporarily high for testing)
        if (spawnChance > 0.50) {
            this.landmarkCache.set(key, null);
            return null;
        }
        
        // Determine position within cell (with margins to avoid edge placement)
        const margin = 32;
        const cellWorldX = gridX * LANDMARK_GRID_SIZE;
        const cellWorldZ = gridZ * LANDMARK_GRID_SIZE;
        
        const offsetX = margin + this.hash(gridX, gridZ, 11111) * (LANDMARK_GRID_SIZE - 2 * margin);
        const offsetZ = margin + this.hash(gridX, gridZ, 22222) * (LANDMARK_GRID_SIZE - 2 * margin);
        
        const worldX = Math.floor(cellWorldX + offsetX);
        const worldZ = Math.floor(cellWorldZ + offsetZ);
        
        // Check biome at this position
        const biome = this.terrain.getBiome(worldX, worldZ);
        
        // Find valid landmark types for this biome
        const validTypes = Object.entries(LANDMARK_TYPES)
            .filter(([_, config]) => config.biomes.includes(biome));
        
        if (validTypes.length === 0) {
            this.landmarkCache.set(key, null);
            return null;
        }
        
        // Select landmark type based on hash
        const typeIndex = Math.floor(this.hash(gridX, gridZ, 33333) * validTypes.length);
        const [typeName, typeConfig] = validTypes[typeIndex];
        
        // Calculate footprint half-size from config
        const halfSize = Math.floor(typeConfig.baseSize / 2);
        
        // Get MINIMUM terrain height across entire footprint
        // This ensures the base extends down to meet the lowest ground point
        const baseY = this.getMinHeightInFootprint(worldX, worldZ, halfSize);
        
        // Don't place landmarks underwater or too high
        if (baseY < 8 || baseY > 35) {
            this.landmarkCache.set(key, null);
            return null;
        }
        
        // Determine entrance direction (random cardinal)
        // Use a simple but effective approach: combine world coordinates
        const directions = ['+X', '-X', '+Z', '-Z'];
        const dirIndex = Math.abs((worldX * 3 + worldZ * 7 + this.seed) % 4);
        const entranceDirection = directions[dirIndex];
        
        // Generate the landmark structure
        const landmark = generateLandmarkStructure(
            typeName,
            typeConfig,
            worldX,
            baseY,
            worldZ,
            this.hash.bind(this),
            gridX,
            gridZ,
            entranceDirection  // Pass entrance direction to generator
        );
        
        this.landmarkCache.set(key, landmark);
        
        // Index this landmark by affected chunks
        if (landmark) {
            this.indexLandmarkByChunks(landmark);
        }
        
        return landmark;
    }
    
    /**
     * Index a landmark by the chunks it affects (for spatial queries)
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
     * Call this before querying landmark blocks for a chunk
     */
    ensureLandmarksForChunk(chunkX, chunkZ) {
        // Calculate which grid cells could affect this chunk
        const worldMinX = chunkX * CHUNK_SIZE;
        const worldMaxX = worldMinX + CHUNK_SIZE;
        const worldMinZ = chunkZ * CHUNK_SIZE;
        const worldMaxZ = worldMinZ + CHUNK_SIZE;
        
        // Check grid cells that could contain landmarks affecting this chunk
        // Need to check neighboring cells because landmarks can extend beyond their cell
        const checkRadius = 1;
        
        const minGridX = Math.floor(worldMinX / LANDMARK_GRID_SIZE) - checkRadius;
        const maxGridX = Math.floor(worldMaxX / LANDMARK_GRID_SIZE) + checkRadius;
        const minGridZ = Math.floor(worldMinZ / LANDMARK_GRID_SIZE) - checkRadius;
        const maxGridZ = Math.floor(worldMaxZ / LANDMARK_GRID_SIZE) + checkRadius;
        
        for (let gx = minGridX; gx <= maxGridX; gx++) {
            for (let gz = minGridZ; gz <= maxGridZ; gz++) {
                // This will generate and cache the landmark if not already done
                this.getLandmarkInCell(gx, gz);
            }
        }
    }
    
    /**
     * Get landmarks affecting a specific chunk
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {Array} Array of landmarks affecting this chunk
     */
    getLandmarksForChunk(chunkX, chunkZ) {
        // Ensure landmarks are generated for nearby grid cells
        this.ensureLandmarksForChunk(chunkX, chunkZ);
        
        const chunkKey = `${chunkX},${chunkZ}`;
        return this.chunkLandmarkIndex.get(chunkKey) || [];
    }
    
    /**
     * Check if a position is inside any landmark's hollow volume (chamber)
     * @param {number} x - World X
     * @param {number} y - World Y
     * @param {number} z - World Z
     * @returns {boolean} True if inside a hollow volume
     */
    isInsideChamber(x, y, z) {
        // Get chunk for this position
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
     * Get landmark block type at position (overrides terrain)
     * @param {number} x - World X
     * @param {number} y - World Y
     * @param {number} z - World Z
     * @returns {string|null} Block type or null if no landmark block here
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
     * Check if a position is inside any landmark's exclusion zone
     * Used to prevent trees/rocks from spawning inside landmarks
     * @param {number} x - World X
     * @param {number} z - World Z
     * @returns {boolean} True if inside a landmark exclusion zone
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
     * Get all landmarks (for debugging/visualization)
     * @returns {Array} Array of all generated landmarks
     */
    getAllLandmarks() {
        return Array.from(this.landmarkCache.values()).filter(l => l !== null);
    }
    
    /**
     * Clear cache (for world regeneration)
     */
    clearCache() {
        this.landmarkCache.clear();
        this.chunkLandmarkIndex.clear();
    }
}
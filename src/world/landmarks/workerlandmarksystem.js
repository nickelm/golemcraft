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
     * Check if terrain is suitable for a flat-footed landmark (huts, cabins, etc.)
     * @param {number} worldX - Center X position
     * @param {number} worldZ - Center Z position
     * @param {number} halfSize - Half of footprint size
     * @param {number} maxHeightVariance - Maximum height difference allowed
     * @param {number} maxSlopeMagnitude - Maximum slope gradient allowed
     * @returns {{ suitable: boolean, baseY: number, gradient: { dx: number, dz: number, magnitude: number } }}
     */
    checkTerrainSuitability(worldX, worldZ, halfSize, maxHeightVariance, maxSlopeMagnitude) {
        // Sample heights at footprint corners and edges
        const sampleOffsets = [
            [-halfSize, -halfSize], [halfSize, -halfSize],
            [-halfSize, halfSize], [halfSize, halfSize],
            [0, -halfSize], [0, halfSize],
            [-halfSize, 0], [halfSize, 0],
            [0, 0]
        ];

        let minHeight = Infinity;
        let maxHeight = -Infinity;

        for (const [dx, dz] of sampleOffsets) {
            const h = this.terrainProvider.getHeight(worldX + dx, worldZ + dz);
            minHeight = Math.min(minHeight, h);
            maxHeight = Math.max(maxHeight, h);
        }

        // Check height variance
        const heightVariance = maxHeight - minHeight;
        if (heightVariance > maxHeightVariance) {
            return { suitable: false, baseY: 0, gradient: null };
        }

        // Calculate gradient at center using central differences
        const hLeft = this.terrainProvider.getHeight(worldX - 1, worldZ);
        const hRight = this.terrainProvider.getHeight(worldX + 1, worldZ);
        const hBack = this.terrainProvider.getHeight(worldX, worldZ - 1);
        const hFront = this.terrainProvider.getHeight(worldX, worldZ + 1);

        const gradX = (hRight - hLeft) / 2;
        const gradZ = (hFront - hBack) / 2;
        const magnitude = Math.sqrt(gradX * gradX + gradZ * gradZ);

        // Check slope magnitude
        if (magnitude > maxSlopeMagnitude) {
            return { suitable: false, baseY: 0, gradient: null };
        }

        // Use minimum height for base (ensures structure doesn't float)
        const baseY = Math.floor(minHeight);

        // Descent direction (normalized) - door should face downhill
        const gradient = magnitude > 0.001 ? {
            dx: -gradX / magnitude,
            dz: -gradZ / magnitude,
            magnitude
        } : { dx: 0, dz: 1, magnitude: 0 };  // Default to +Z if flat

        return { suitable: true, baseY, gradient };
    }

    /**
     * Get or generate landmark for a grid cell
     */
    getLandmarkInCell(gridX, gridZ) {
        const key = `${gridX},${gridZ}`;
        
        if (this.landmarkCache.has(key)) {
            return this.landmarkCache.get(key);
        }

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

        // Filter to types that pass their individual rarity checks
        // Each type gets its own roll so they're evaluated independently
        const passingTypes = validTypes.filter((typeName, index) => {
            const typeConfig = LANDMARK_TYPES[typeName];
            const typeRoll = this.hash(gridX, gridZ, 54321 + index * 1000);
            return typeRoll <= typeConfig.rarity;
        });

        if (passingTypes.length === 0) {
            this.landmarkCache.set(key, null);
            return null;
        }

        // Randomly select from types that passed their rarity checks
        const typeIndex = Math.floor(this.hash(gridX, gridZ, 98765) * passingTypes.length);
        const typeName = passingTypes[typeIndex];
        const typeConfig = LANDMARK_TYPES[typeName];

        // Debug logging for rocky outcrop selection
        if (passingTypes.includes('rockyOutcrop')) {
            console.log(`[LANDMARK] Grid (${gridX},${gridZ}): biome=${biome}, passing=${passingTypes.join(',')}, selected=${typeName}`);
        }
        
        // Special handling for cave landmarks (require cliff face)
        if (typeConfig.minSlope !== undefined) {
            // Search multiple positions in grid cell for suitable cliff
            const searchOffsets = [
                [0, 0], [-20, 0], [20, 0], [0, -20], [0, 20],
                [-15, -15], [15, -15], [-15, 15], [15, 15]
            ];

            let bestCliff = null;
            let bestPosition = null;

            for (const [dx, dz] of searchOffsets) {
                const sx = worldX + dx;
                const sz = worldZ + dz;
                const cliff = this.findCliffFace(sx, sz, typeConfig.sampleRadius || 8, typeConfig.minSlope);
                if (cliff && (!bestCliff || cliff.slope > bestCliff.slope)) {
                    bestCliff = cliff;
                    bestPosition = [sx, sz];
                }
            }

            if (!bestCliff) {
                // No suitable cliff found
                this.landmarkCache.set(key, null);
                return null;
            }

            // Use cliff position
            const cliffX = bestPosition[0];
            const cliffZ = bestPosition[1];
            const cliffBaseY = this.terrainProvider.getHeight(cliffX, cliffZ);

            // Check height constraints
            if (cliffBaseY < typeConfig.minHeight || cliffBaseY > typeConfig.maxHeight) {
                this.landmarkCache.set(key, null);
                return null;
            }

            // Generate the cave with cliff direction
            const landmark = generateLandmarkStructure(
                typeName,
                typeConfig,
                cliffX,
                cliffBaseY,
                cliffZ,
                this.hash.bind(this),
                gridX,
                gridZ,
                bestCliff  // Pass cliff direction instead of entrance direction string
            );

            this.landmarkCache.set(key, landmark);

            if (landmark) {
                this.indexLandmarkByChunks(landmark);
            }

            return landmark;
        }

        // Flat-terrain landmarks (huts, cabins) - require terrain suitability check
        if (typeConfig.maxHeightVariance !== undefined) {
            const halfBase = Math.floor(typeConfig.baseSize / 2);
            const maxVariance = typeConfig.maxHeightVariance;
            const maxSlope = typeConfig.maxSlopeMagnitude || 0.5;

            // Check terrain suitability at grid cell center
            let suitability = this.checkTerrainSuitability(
                worldX, worldZ, halfBase, maxVariance, maxSlope
            );

            // Track final position (may be offset from grid center)
            let flatX = worldX;
            let flatZ = worldZ;

            // If center position unsuitable, try offset positions within grid cell
            if (!suitability.suitable) {
                const offsets = [[-16, 0], [16, 0], [0, -16], [0, 16], [-16, -16], [16, -16], [-16, 16], [16, 16]];
                let foundPosition = false;

                for (const [ox, oz] of offsets) {
                    const testX = worldX + ox;
                    const testZ = worldZ + oz;

                    // Check biome at offset position
                    const testBiome = this.terrainProvider.getBiome(testX, testZ);
                    if (testBiome !== biome) continue;

                    const testSuit = this.checkTerrainSuitability(
                        testX, testZ, halfBase, maxVariance, maxSlope
                    );

                    if (testSuit.suitable) {
                        suitability = testSuit;
                        flatX = testX;
                        flatZ = testZ;
                        foundPosition = true;
                        break;
                    }
                }

                if (!foundPosition) {
                    // No suitable flat terrain found
                    this.landmarkCache.set(key, null);
                    return null;
                }
            }

            const baseY = suitability.baseY;

            // Check height constraints
            if (baseY < typeConfig.minHeight || baseY > typeConfig.maxHeight) {
                this.landmarkCache.set(key, null);
                return null;
            }

            // Determine entrance direction from gradient (door faces downslope)
            const { dx, dz } = suitability.gradient;
            let entranceDirection;
            if (Math.abs(dx) > Math.abs(dz)) {
                entranceDirection = dx > 0 ? '+X' : '-X';
            } else {
                entranceDirection = dz > 0 ? '+Z' : '-Z';
            }

            // Generate the landmark
            const landmark = generateLandmarkStructure(
                typeName,
                typeConfig,
                flatX,
                baseY,
                flatZ,
                this.hash.bind(this),
                gridX,
                gridZ,
                entranceDirection
            );

            this.landmarkCache.set(key, landmark);

            if (landmark) {
                this.indexLandmarkByChunks(landmark);
            }

            return landmark;
        }

        // Standard landmark handling (temples, etc.)
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

        this.landmarkCache.set(key, landmark);

        if (landmark) {
            this.indexLandmarkByChunks(landmark);
            // Debug logging for rocky outcrops
            if (landmark.type === 'rockyOutcrop') {
                console.log(`[INDEXED] rockyOutcrop at (${landmark.centerX}, ${landmark.baseY}, ${landmark.centerZ}), blocks.size=${landmark.blocks?.size || 0}`);
            }
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
        const landmarks = this.chunkLandmarkIndex.get(`${chunkX},${chunkZ}`) || [];

        // Debug: Log when rocky outcrop is retrieved
        const rockyOutcrops = landmarks.filter(l => l.type === 'rockyOutcrop');
        if (rockyOutcrops.length > 0) {
            console.log(`[GET LANDMARKS] Chunk (${chunkX},${chunkZ}): found ${rockyOutcrops.length} rockyOutcrop(s), blocks=${rockyOutcrops[0].blocks?.size || 0}`);
        }

        return landmarks;
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
     * Returns block type string, 'air' for carved/forced air, or null if not in landmark
     */
    getLandmarkBlockType(x, y, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);

        const landmarks = this.getLandmarksForChunk(chunkX, chunkZ);
        const key = `${x},${y},${z}`;

        for (const landmark of landmarks) {
            // Debug logging for rocky outcrops
            if (landmark.type === 'rockyOutcrop') {
                const hasBlock = landmark.blocks && landmark.blocks.has(key);
                if (hasBlock) {
                    console.log(`[BLOCK FOUND] rockyOutcrop at ${key}: ${landmark.blocks.get(key)}`);
                }
            }

            // Check for solid blocks first
            if (landmark.blocks && landmark.blocks.has(key)) {
                return landmark.blocks.get(key);
            }

            // Check for carved air (positions with brightness overrides are forced air)
            if (landmark.brightnessOverrides && landmark.brightnessOverrides.has(key)) {
                return 'air';  // Special value indicating forced air
            }
        }

        return null;
    }

    /**
     * Get brightness override at position (for air spaces in landmarks)
     * @param {number} x - World X
     * @param {number} y - World Y
     * @param {number} z - World Z
     * @returns {number|null} Brightness value (0.0-1.0) or null if no override
     */
    getLandmarkBrightnessOverride(x, y, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);

        const landmarks = this.getLandmarksForChunk(chunkX, chunkZ);

        for (const landmark of landmarks) {
            const key = `${x},${y},${z}`;
            if (landmark.brightnessOverrides && landmark.brightnessOverrides.has(key)) {
                return landmark.brightnessOverrides.get(key);
            }
        }

        return null;
    }

    /**
     * Check if position is inside any landmark's voxel rendering zone
     * Uses voxelBounds if available (for caves), otherwise uses full bounds
     */
    isInsideLandmark(x, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);

        const landmarks = this.getLandmarksForChunk(chunkX, chunkZ);

        for (const landmark of landmarks) {
            // Use voxelBounds if available (caves only render entrance as voxels)
            const checkBounds = landmark.voxelBounds || landmark.bounds;
            if (x >= checkBounds.minX && x <= checkBounds.maxX &&
                z >= checkBounds.minZ && z <= checkBounds.maxZ) {
                // Debug: Log when rocky outcrop is detected
                if (landmark.type === 'rockyOutcrop') {
                    console.log(`[IS INSIDE LANDMARK] rockyOutcrop at (${x},${z}) - bounds (${checkBounds.minX},${checkBounds.minZ}) to (${checkBounds.maxX},${checkBounds.maxZ})`);
                }
                return true;
            }
        }

        return false;
    }

    /**
     * Check if heightfield should be skipped at this position
     * Returns true if any landmark has a heightfield hole at this position
     * @param {number} x - World X
     * @param {number} z - World Z
     * @returns {boolean} True if heightfield should be skipped
     */
    shouldSkipHeightfield(x, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        const landmarks = this.getLandmarksForChunk(chunkX, chunkZ);

        for (const landmark of landmarks) {
            if (!landmark.heightfieldHoles) continue;

            // Check if position is in the holes set
            const holeKey = `${x},${z}`;
            if (landmark.heightfieldHoles.has(holeKey)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get all heightfield holes for landmarks affecting a chunk
     * Returns array of {lx, lz} objects in chunk-local coordinates
     * @param {number} chunkX - Chunk X index
     * @param {number} chunkZ - Chunk Z index
     * @returns {Array<{lx: number, lz: number}>} Array of hole positions
     */
    getHeightfieldHolesForChunk(chunkX, chunkZ) {
        const holes = [];
        const landmarks = this.getLandmarksForChunk(chunkX, chunkZ);
        const worldMinX = chunkX * CHUNK_SIZE;
        const worldMinZ = chunkZ * CHUNK_SIZE;

        for (const landmark of landmarks) {
            if (!landmark.heightfieldHoles) continue;

            for (const holeKey of landmark.heightfieldHoles) {
                const [wx, wz] = holeKey.split(',').map(Number);
                const lx = wx - worldMinX;
                const lz = wz - worldMinZ;

                // Only include holes within this chunk
                if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
                    holes.push({ lx, lz });
                }
            }
        }

        return holes;
    }

    /**
     * Check if position is inside any landmark's clearing zone
     * Used to suppress object spawning (trees, rocks, etc.) near landmarks
     * @param {number} x - World X
     * @param {number} z - World Z
     * @returns {boolean} True if objects should not spawn here
     */
    isInClearing(x, z) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkZ = Math.floor(z / CHUNK_SIZE);
        const landmarks = this.getLandmarksForChunk(chunkX, chunkZ);

        for (const landmark of landmarks) {
            // Use clearingBounds if available, else use regular bounds with padding
            const bounds = landmark.clearingBounds || landmark.bounds;
            const padding = landmark.clearingPadding ?? 2;

            if (x >= bounds.minX - padding && x <= bounds.maxX + padding &&
                z >= bounds.minZ - padding && z <= bounds.maxZ + padding) {
                return true;
            }
        }
        return false;
    }

    /**
     * Find cliff face direction at a position
     * Returns direction vector pointing downslope, or null if not steep enough
     * @param {number} x - World X
     * @param {number} z - World Z
     * @param {number} sampleRadius - Distance to check (default 8)
     * @param {number} minSlope - Minimum slope threshold (default 0.5 = 4 blocks over 8)
     * @returns {{ dx: number, dz: number, slope: number, baseHeight: number }|null}
     */
    findCliffFace(x, z, sampleRadius = 8, minSlope = 0.5) {
        const centerH = this.terrainProvider.getHeight(x, z);

        // Sample in cardinal directions
        const directions = [
            { dx: 1, dz: 0 },
            { dx: -1, dz: 0 },
            { dx: 0, dz: 1 },
            { dx: 0, dz: -1 }
        ];

        let bestDirection = null;
        let maxSlope = minSlope;

        for (const dir of directions) {
            const sampleX = x + dir.dx * sampleRadius;
            const sampleZ = z + dir.dz * sampleRadius;
            const sampleH = this.terrainProvider.getHeight(sampleX, sampleZ);

            // Positive slope means terrain drops in that direction
            const heightDiff = centerH - sampleH;
            const slope = heightDiff / sampleRadius;

            if (slope >= maxSlope) {
                maxSlope = slope;
                bestDirection = {
                    dx: dir.dx,
                    dz: dir.dz,
                    slope: slope,
                    baseHeight: sampleH
                };
            }
        }

        return bestDirection;
    }

    /**
     * Compute AABB from oriented bounds
     * Used to convert rotated rectangles to axis-aligned boxes for spatial indexing
     * @param {{ centerX: number, centerZ: number, baseY: number, width: number, depth: number, height: number, rotation: number }} ob
     * @returns {{ minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number }}
     */
    computeAABBFromOrientedBounds(ob) {
        // Compute AABB that contains the rotated rectangle
        const cos = Math.abs(Math.cos(ob.rotation));
        const sin = Math.abs(Math.sin(ob.rotation));
        const halfW = ob.width / 2;
        const halfD = ob.depth / 2;

        // Rotated AABB dimensions
        const aabbHalfW = halfW * cos + halfD * sin;
        const aabbHalfD = halfW * sin + halfD * cos;

        return {
            minX: Math.floor(ob.centerX - aabbHalfW),
            maxX: Math.ceil(ob.centerX + aabbHalfW),
            minY: ob.baseY,
            maxY: ob.baseY + ob.height,
            minZ: Math.floor(ob.centerZ - aabbHalfD),
            maxZ: Math.ceil(ob.centerZ + aabbHalfD)
        };
    }

    /**
     * Get all heightfield modifications for landmarks affecting a chunk
     * @param {number} chunkX - Chunk X index
     * @param {number} chunkZ - Chunk Z index
     * @returns {Array} Array of modification specs
     */
    getHeightfieldModifications(chunkX, chunkZ) {
        const modifications = [];
        const landmarks = this.getLandmarksForChunk(chunkX, chunkZ);

        for (const landmark of landmarks) {
            if (landmark.heightfieldModifications) {
                modifications.push(...landmark.heightfieldModifications);
            }
        }

        return modifications;
    }

    /**
     * Get serializable landmark metadata for transfer to main thread
     * Returns plain objects (no Maps) suitable for postMessage transfer
     * @param {number} chunkX - Chunk X index
     * @param {number} chunkZ - Chunk Z index
     * @returns {Array} Array of landmark metadata objects
     */
    getLandmarkMetadataForChunk(chunkX, chunkZ) {
        const landmarks = this.getLandmarksForChunk(chunkX, chunkZ);

        return landmarks.map(landmark => {
            const metadata = {
                type: landmark.type,
                // Unique ID for deduplication on main thread
                id: `${landmark.bounds.minX},${landmark.bounds.minZ}`,
                bounds: {
                    minX: landmark.bounds.minX,
                    maxX: landmark.bounds.maxX,
                    minY: landmark.bounds.minY,
                    maxY: landmark.bounds.maxY,
                    minZ: landmark.bounds.minZ,
                    maxZ: landmark.bounds.maxZ
                },
                voxelBounds: landmark.voxelBounds ? {
                    minX: landmark.voxelBounds.minX,
                    maxX: landmark.voxelBounds.maxX,
                    minY: landmark.voxelBounds.minY,
                    maxY: landmark.voxelBounds.maxY,
                    minZ: landmark.voxelBounds.minZ,
                    maxZ: landmark.voxelBounds.maxZ
                } : null,
                clearingBounds: landmark.clearingBounds ? {
                    minX: landmark.clearingBounds.minX,
                    maxX: landmark.clearingBounds.maxX,
                    minY: landmark.clearingBounds.minY,
                    maxY: landmark.clearingBounds.maxY,
                    minZ: landmark.clearingBounds.minZ,
                    maxZ: landmark.clearingBounds.maxZ
                } : null,
                chambers: landmark.chambers ? landmark.chambers.map(c => ({
                    minX: c.minX,
                    maxX: c.maxX,
                    minY: c.minY,
                    maxY: c.maxY,
                    minZ: c.minZ,
                    maxZ: c.maxZ
                })) : null,
                clearingPadding: landmark.clearingPadding ?? 2
            };

            // Include rocky outcrop specific data for debug visualization
            if (landmark.type === 'rockyOutcrop' && landmark.metadata) {
                metadata.sizeClass = landmark.metadata.sizeClass;
                metadata.spheres = landmark.metadata.spheres;
                metadata.holeCount = landmark.metadata.holeCount;
            }

            return metadata;
        });
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.landmarkCache.clear();
        this.chunkLandmarkIndex.clear();
    }
}
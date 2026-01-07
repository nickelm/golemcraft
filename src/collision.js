/**
 * Collision Detection Module for GolemCraft
 * 
 * HYBRID COLLISION SYSTEM:
 * - Heightfield collision for smooth terrain regions (voxelMask = 0)
 * - Voxel collision for structures, caves, cliffs (voxelMask = 1)
 * 
 * Uses voxel-aabb-sweep library for voxel collision.
 * Uses bilinear heightmap interpolation for smooth terrain.
 */

import sweep from './utils/physics/voxel-aabb-sweep.js';

// ============================================================================
// HEIGHTFIELD COLLISION PROVIDER
// ============================================================================

const CHUNK_SIZE = 16;
const HEIGHTMAP_SIZE = CHUNK_SIZE + 1;

/**
 * HeightfieldCollisionProvider
 * 
 * Queries ChunkBlockCache for heightmap data and provides
 * interpolated height lookups for smooth collision.
 */
class HeightfieldCollisionProvider {
    constructor(chunkBlockCache) {
        this.cache = chunkBlockCache;
    }
    
    getChunkCoords(worldX, worldZ) {
        const chunkX = Math.floor(worldX / CHUNK_SIZE);
        const chunkZ = Math.floor(worldZ / CHUNK_SIZE);
        return {
            chunkX,
            chunkZ,
            localX: worldX - chunkX * CHUNK_SIZE,
            localZ: worldZ - chunkZ * CHUNK_SIZE
        };
    }
    
    /**
     * Check if a single point is on heightfield terrain (vs voxel)
     */
    isHeightfieldAt(worldX, worldZ) {
        const { chunkX, chunkZ, localX, localZ } = this.getChunkCoords(worldX, worldZ);
        const key = `${chunkX},${chunkZ}`;
        
        // Use the chunks Map directly
        const chunkData = this.cache.chunks.get(key);
        if (!chunkData || !chunkData.voxelMask) {
            return true;  // Default to heightfield if no data
        }
        
        const ix = Math.floor(localX);
        const iz = Math.floor(localZ);
        const clampedX = Math.max(0, Math.min(CHUNK_SIZE - 1, ix));
        const clampedZ = Math.max(0, Math.min(CHUNK_SIZE - 1, iz));
        
        return chunkData.voxelMask[clampedZ * CHUNK_SIZE + clampedX] === 0;
    }
    
    /**
     * Check if entity should use heightfield collision
     * Checks all four AABB corners - if ANY corner is on voxel terrain,
     * use voxel collision for the whole entity to prevent penetration.
     */
    shouldUseHeightfield(worldX, worldZ, aabb = null) {
        // If no AABB provided, just check the center point
        if (!aabb) {
            return this.isHeightfieldAt(worldX, worldZ);
        }
        
        const hw = aabb.halfWidth;
        const hd = aabb.halfDepth;
        
        // All four corners must be on heightfield terrain
        return this.isHeightfieldAt(worldX - hw, worldZ - hd) &&
               this.isHeightfieldAt(worldX + hw, worldZ - hd) &&
               this.isHeightfieldAt(worldX - hw, worldZ + hd) &&
               this.isHeightfieldAt(worldX + hw, worldZ + hd);
    }
    
    /**
     * Get bilinearly interpolated height at world position
     */
    getInterpolatedHeight(worldX, worldZ) {
        const { chunkX, chunkZ, localX, localZ } = this.getChunkCoords(worldX, worldZ);
        const key = `${chunkX},${chunkZ}`;
        
        // Use the chunks Map directly
        const chunkData = this.cache.chunks.get(key);
        if (!chunkData || !chunkData.heightmap) {
            return null;
        }
        
        return this.bilinearSample(chunkData.heightmap, localX, localZ);
    }
    
    bilinearSample(heightmap, localX, localZ) {
        const x = Math.max(0, Math.min(CHUNK_SIZE - 0.001, localX));
        const z = Math.max(0, Math.min(CHUNK_SIZE - 0.001, localZ));
        
        const x0 = Math.floor(x);
        const z0 = Math.floor(z);
        const x1 = Math.min(x0 + 1, HEIGHTMAP_SIZE - 1);
        const z1 = Math.min(z0 + 1, HEIGHTMAP_SIZE - 1);
        
        const fx = x - x0;
        const fz = z - z0;
        
        const h00 = heightmap[z0 * HEIGHTMAP_SIZE + x0];
        const h10 = heightmap[z0 * HEIGHTMAP_SIZE + x1];
        const h01 = heightmap[z1 * HEIGHTMAP_SIZE + x0];
        const h11 = heightmap[z1 * HEIGHTMAP_SIZE + x1];
        
        const h0 = h00 * (1 - fx) + h10 * fx;
        const h1 = h01 * (1 - fx) + h11 * fx;
        
        return h0 * (1 - fz) + h1 * fz;
    }
    
    /**
     * Calculate terrain slope at a position
     * Returns the steepness (rise/run) in the direction of movement
     * @param {number} worldX - Current X position
     * @param {number} worldZ - Current Z position
     * @param {number} dirX - Movement direction X (normalized or unnormalized)
     * @param {number} dirZ - Movement direction Z
     * @returns {number} Slope value (positive = uphill, negative = downhill)
     */
    getSlopeInDirection(worldX, worldZ, dirX, dirZ) {
        // Normalize direction
        const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (len < 0.001) return 0;
        
        const dx = dirX / len;
        const dz = dirZ / len;
        
        // Sample height at current position and slightly ahead
        const sampleDist = 0.5;  // Half a block ahead
        const h0 = this.getInterpolatedHeight(worldX, worldZ);
        const h1 = this.getInterpolatedHeight(worldX + dx * sampleDist, worldZ + dz * sampleDist);
        
        if (h0 === null || h1 === null) return 0;
        
        // Return slope (rise over run)
        return (h1 - h0) / sampleDist;
    }
    
    /**
     * Check if slope is too steep to walk up
     * @param {number} slope - Slope value from getSlopeInDirection
     * @returns {boolean} True if slope blocks walking
     */
    isSlopeTooSteep(slope) {
        // Threshold: slope > 1.5 means more than 1.5 blocks rise per 1 block horizontal
        // This is roughly a 56 degree angle
        return slope > 1.5;
    }
}

// ============================================================================
// HEIGHTFIELD COLLISION PROVIDER INSTANCE
// ============================================================================

let heightfieldProvider = null;

/**
 * Initialize heightfield collision with the chunk block cache
 * Call this after TerrainWorkerManager is ready
 */
export function initHeightfieldCollision(chunkBlockCache) {
    heightfieldProvider = new HeightfieldCollisionProvider(chunkBlockCache);
    console.log('Heightfield collision initialized');
}

/**
 * Get the heightfield provider (for external queries like spawning)
 */
export function getHeightfieldProvider() {
    return heightfieldProvider;
}

// ============================================================================
// AABB CLASS
// ============================================================================

/**
 * AABB (Axis-Aligned Bounding Box) for collision
 * 
 * The box is defined by base (min corner) and max corner.
 * Position refers to the center-bottom (feet) of the entity.
 */
export class AABB {
    constructor(width, height, depth, groundOffset = 0) {
        this.width = width;
        this.height = height;
        this.depth = depth;
        this.groundOffset = groundOffset;
        
        this.halfWidth = width / 2;
        this.halfDepth = depth / 2;
        
        this.base = [0, 0, 0];
        this.max = [0, 0, 0];
    }
    
    setPosition(x, y, z) {
        this.base[0] = x - this.halfWidth;
        this.base[1] = y;
        this.base[2] = z - this.halfDepth;
        
        this.max[0] = x + this.halfWidth;
        this.max[1] = y + this.height;
        this.max[2] = z + this.halfDepth;
    }
    
    getPosition() {
        return {
            x: (this.base[0] + this.max[0]) / 2,
            y: this.base[1],
            z: (this.base[2] + this.max[2]) / 2
        };
    }
    
    translate(vec) {
        this.base[0] += vec[0];
        this.base[1] += vec[1];
        this.base[2] += vec[2];
        this.max[0] += vec[0];
        this.max[1] += vec[1];
        this.max[2] += vec[2];
    }
}

// ============================================================================
// VOXEL COLLISION HELPERS
// ============================================================================

function isVoxelSolid(terrain, x, y, z) {
    const blockType = terrain.getBlockType(x, y, z);
    if (blockType === null) return false;
    if (blockType === 'water' || blockType === 'water_full') return false;
    return true;
}

// ============================================================================
// MAIN COLLISION RESOLUTION
// ============================================================================

/**
 * Perform collision and update entity state
 * 
 * Uses hybrid system:
 * - Heightfield collision for smooth terrain (voxelMask = 0)
 * - Voxel collision for structures/caves (voxelMask = 1)
 */
export function resolveEntityCollision(entity, terrain, deltaTime) {
    // Ensure entity has AABB
    if (!entity.aabb) {
        entity.aabb = createEntityAABB(entity);
    }
    
    const aabb = entity.aabb;
    
    // =========================================================================
    // TRY HEIGHTFIELD COLLISION FIRST
    // Check all AABB corners - if any is on voxel terrain, use voxel collision
    // =========================================================================
    if (heightfieldProvider && heightfieldProvider.shouldUseHeightfield(entity.position.x, entity.position.z, aabb)) {
        return resolveHeightfieldCollision(entity, terrain, deltaTime);
    }
    
    // =========================================================================
    // VOXEL COLLISION
    // =========================================================================
    return resolveVoxelCollision(entity, terrain, deltaTime);
}

/**
 * Resolve collision using voxel-based sweep
 */
function resolveVoxelCollision(entity, terrain, deltaTime) {
    const aabb = entity.aabb;
    
    // Apply gravity
    if (!entity.onGround) {
        entity.velocity.y += entity.gravity * deltaTime;
    }
    
    // Set AABB position from entity
    aabb.setPosition(
        entity.position.x,
        entity.position.y,
        entity.position.z
    );
    
    // Movement vector for this frame
    const moveVec = [
        entity.velocity.x * deltaTime,
        entity.velocity.y * deltaTime,
        entity.velocity.z * deltaTime
    ];
    
    // Track collision state
    const collisions = { x: false, y: false, z: false };
    let grounded = false;
    
    // Create voxel test function
    const getVoxel = (x, y, z) => isVoxelSolid(terrain, x, y, z);
    
    // Collision callback
    const onCollision = (dist, axis, dir, vec) => {
        vec[axis] = 0;
        
        if (axis === 0) collisions.x = true;
        if (axis === 1) {
            collisions.y = true;
            if (dir === -1) grounded = true;
        }
        if (axis === 2) collisions.z = true;
        
        return false;
    };
    
    // Perform the sweep
    sweep(getVoxel, aabb, moveVec, onCollision);
    
    // Update entity position from AABB
    const newPos = aabb.getPosition();
    entity.position.x = newPos.x;
    entity.position.y = newPos.y;
    entity.position.z = newPos.z;
    
    // Zero velocity on collision axes
    if (collisions.x) entity.velocity.x = 0;
    if (collisions.y) entity.velocity.y = 0;
    if (collisions.z) entity.velocity.z = 0;
    
    // Ground probe if not grounded via collision
    if (!grounded) {
        const probeY = Math.floor(aabb.base[1] - 0.01);
        const minX = Math.floor(aabb.base[0]);
        const maxX = Math.floor(aabb.max[0]);
        const minZ = Math.floor(aabb.base[2]);
        const maxZ = Math.floor(aabb.max[2]);
        
        outer: for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                if (getVoxel(x, probeY, z)) {
                    grounded = true;
                    break outer;
                }
            }
        }
    }
    
    entity.onGround = grounded;
    
    // Horizontal damping
    entity.velocity.x *= 0.9;
    entity.velocity.z *= 0.9;
    
    // Update mesh position with groundOffset
    entity.mesh.position.copy(entity.position);
    entity.mesh.position.y += aabb.groundOffset || 0;
    
    return { collisions, grounded };
}

/**
 * Resolve collision against smooth heightfield terrain
 * Includes slope blocking - steep slopes block walking but allow jumping
 */
function resolveHeightfieldCollision(entity, terrain, deltaTime) {
    const aabb = entity.aabb;
    
    // Apply gravity
    if (!entity.onGround) {
        entity.velocity.y += entity.gravity * deltaTime;
    }
    
    // Calculate intended horizontal movement
    const moveX = entity.velocity.x * deltaTime;
    const moveZ = entity.velocity.z * deltaTime;
    
    // Check slope in movement direction BEFORE moving
    let blockedBySlope = false;
    if (entity.onGround && (Math.abs(moveX) > 0.001 || Math.abs(moveZ) > 0.001)) {
        const slope = heightfieldProvider.getSlopeInDirection(
            entity.position.x, entity.position.z,
            entity.velocity.x, entity.velocity.z
        );
        
        // Block uphill movement on steep slopes (but allow downhill)
        if (heightfieldProvider.isSlopeTooSteep(slope)) {
            blockedBySlope = true;
        }
    }
    
    // Apply horizontal velocity (unless blocked by slope)
    if (!blockedBySlope) {
        entity.position.x += moveX;
        entity.position.z += moveZ;
    } else {
        // Blocked by slope - zero horizontal velocity
        entity.velocity.x = 0;
        entity.velocity.z = 0;
    }
    
    // Check if we moved into voxel region (check all AABB corners)
    if (!heightfieldProvider.shouldUseHeightfield(entity.position.x, entity.position.z, aabb)) {
        // Moved into voxel region - revert horizontal movement
        entity.position.x -= moveX;
        entity.position.z -= moveZ;
        // Use voxel collision directly (no recursion)
        return resolveVoxelCollision(entity, terrain, deltaTime);
    }
    
    // Apply vertical velocity
    entity.position.y += entity.velocity.y * deltaTime;
    
    // Get terrain height at new position
    const terrainY = heightfieldProvider.getInterpolatedHeight(entity.position.x, entity.position.z);
    
    if (terrainY === null) {
        // No data - mark as airborne
        entity.onGround = false;
        entity.velocity.x *= 0.9;
        entity.velocity.z *= 0.9;
        if (entity.mesh) {
            entity.mesh.position.copy(entity.position);
            entity.mesh.position.y += aabb.groundOffset || 0;
        }
        return { collisions: { x: blockedBySlope, y: false, z: blockedBySlope }, grounded: false };
    }
    
    // Ground collision
    let grounded = false;
    if (entity.position.y < terrainY) {
        entity.position.y = terrainY;
        if (entity.velocity.y < 0) {
            entity.velocity.y = 0;
        }
        grounded = true;
    } else {
        // Ground detection with small margin
        grounded = (entity.position.y <= terrainY + 0.1) && (entity.velocity.y <= 0);
    }
    
    entity.onGround = grounded;
    
    // Horizontal damping
    entity.velocity.x *= 0.9;
    entity.velocity.z *= 0.9;
    
    // Update mesh position
    if (entity.mesh) {
        entity.mesh.position.copy(entity.position);
        entity.mesh.position.y += aabb.groundOffset || 0;
    }
    
    return { 
        collisions: { x: blockedBySlope, y: grounded, z: blockedBySlope }, 
        grounded 
    };
}

// ============================================================================
// AABB FACTORY FUNCTIONS
// ============================================================================

export function createEntityAABB(entity) {
    return new AABB(entity.size, entity.size * 1.5, entity.size, 0);
}

export function createHeroAABB() {
    return new AABB(0.5, 1.0, 0.5, 0);
}

export function createHeroOnFootAABB() {
    // Narrower and taller AABB for hero on foot (0.4 × 1.8 × 0.4)
    return new AABB(0.4, 1.8, 0.4, 0);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get ground height at position (for spawning, teleporting, etc.)
 * Uses heightfield when available, falls back to voxel terrain
 */
export function getGroundHeight(worldX, worldZ, terrain) {
    if (heightfieldProvider && heightfieldProvider.shouldUseHeightfield(worldX, worldZ)) {
        const h = heightfieldProvider.getInterpolatedHeight(worldX, worldZ);
        if (h !== null) return h;
    }
    
    // Fall back to terrain provider
    return terrain.getHeight(Math.floor(worldX), Math.floor(worldZ));
}
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
     * Check if position should use heightfield collision (vs voxel)
     */
    shouldUseHeightfield(worldX, worldZ) {
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
    // =========================================================================
    if (heightfieldProvider && heightfieldProvider.shouldUseHeightfield(entity.position.x, entity.position.z)) {
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
 */
function resolveHeightfieldCollision(entity, terrain, deltaTime) {
    const aabb = entity.aabb;
    
    // Apply gravity
    if (!entity.onGround) {
        entity.velocity.y += entity.gravity * deltaTime;
    }
    
    // Apply horizontal velocity
    entity.position.x += entity.velocity.x * deltaTime;
    entity.position.z += entity.velocity.z * deltaTime;
    
    // Check if we moved into voxel region
    if (!heightfieldProvider.shouldUseHeightfield(entity.position.x, entity.position.z)) {
        // Moved into voxel region - revert horizontal movement
        entity.position.x -= entity.velocity.x * deltaTime;
        entity.position.z -= entity.velocity.z * deltaTime;
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
        return { collisions: { x: false, y: false, z: false }, grounded: false };
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
        collisions: { x: false, y: grounded, z: false }, 
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
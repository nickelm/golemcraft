/**
 * Collision Detection Module for GolemCraft
 * 
 * Uses voxel-aabb-sweep library for accurate swept AABB collision.
 * This module provides a clean interface for entity collision with voxel terrain.
 */

import sweep from './utils/physics/voxel-aabb-sweep.js';

/**
 * AABB (Axis-Aligned Bounding Box) for collision
 * 
 * The box is defined by base (min corner) and max corner.
 * Position refers to the center-bottom (feet) of the entity.
 * 
 * groundOffset: vertical adjustment between collision position and mesh position.
 * This accounts for the difference between where collision stops and where
 * the mesh origin (typically at feet) should be rendered.
 */
export class AABB {
    constructor(width, height, depth, groundOffset = 0) {
        this.width = width;
        this.height = height;
        this.depth = depth;
        this.groundOffset = groundOffset;
        
        // Half extents for centering
        this.halfWidth = width / 2;
        this.halfDepth = depth / 2;
        
        // These get updated each frame based on entity position
        this.base = [0, 0, 0];
        this.max = [0, 0, 0];
    }
    
    /**
     * Update box bounds based on entity position (feet position)
     */
    setPosition(x, y, z) {
        this.base[0] = x - this.halfWidth;
        this.base[1] = y;
        this.base[2] = z - this.halfDepth;
        
        this.max[0] = x + this.halfWidth;
        this.max[1] = y + this.height;
        this.max[2] = z + this.halfDepth;
    }
    
    /**
     * Get center-bottom position from current bounds
     */
    getPosition() {
        return {
            x: (this.base[0] + this.max[0]) / 2,
            y: this.base[1],
            z: (this.base[2] + this.max[2]) / 2
        };
    }
    
    /**
     * Translate the box (called by sweep library)
     */
    translate(vec) {
        this.base[0] += vec[0];
        this.base[1] += vec[1];
        this.base[2] += vec[2];
        this.max[0] += vec[0];
        this.max[1] += vec[1];
        this.max[2] += vec[2];
    }
}

/**
 * Check if a voxel is solid (blocks movement)
 */
function isVoxelSolid(terrain, x, y, z) {
    const blockType = terrain.getBlockType(x, y, z);
    if (blockType === null) return false;
    if (blockType === 'water' || blockType === 'water_full') return false;
    // Ice is solid - you walk on it
    return true;
}

/**
 * Perform swept collision and update entity state
 * 
 * @param {Entity} entity - Entity with position, velocity, aabb
 * @param {Object} terrain - Terrain with getBlockType method
 * @param {number} deltaTime - Frame time in seconds
 * @returns {Object} Collision result with grounded state
 */
export function resolveEntityCollision(entity, terrain, deltaTime) {
    // Apply gravity
    if (!entity.onGround) {
        entity.velocity.y += entity.gravity * deltaTime;
    }
    
    // Ensure entity has AABB
    if (!entity.aabb) {
        entity.aabb = createEntityAABB(entity);
    }
    
    const aabb = entity.aabb;
    
    // Set AABB position from entity
    // Offset by 0.5 to align with voxel grid (blocks are rendered at integer centers)
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
    
    // Collision callback - called when AABB hits a voxel
    const onCollision = (dist, axis, dir, vec) => {
        // Zero out the remaining movement on collision axis
        vec[axis] = 0;
        
        // Track which axis collided
        if (axis === 0) collisions.x = true;
        if (axis === 1) {
            collisions.y = true;
            // Grounded if we hit something while moving down (dir = -1)
            if (dir === -1) grounded = true;
        }
        if (axis === 2) collisions.z = true;
        
        // Return false to continue sweep along remaining axes
        return false;
    };
    
    // Perform the sweep
    sweep(getVoxel, aabb, moveVec, onCollision);
    
    // Update entity position from AABB (remove the 0.5 offset)
    const newPos = aabb.getPosition();
    entity.position.x = newPos.x;
    entity.position.y = newPos.y;
    entity.position.z = newPos.z;
    
    // Zero velocity on collision axes
    if (collisions.x) entity.velocity.x = 0;
    if (collisions.y) entity.velocity.y = 0;
    if (collisions.z) entity.velocity.z = 0;
    
    // Ground probe: if not grounded via collision, check if standing on solid ground
    // This handles the case where entity is at rest on the ground
    if (!grounded) {
        // Check voxels directly below the AABB
        const probeY = Math.floor(aabb.base[1] - 0.01);
        const minX = Math.floor(aabb.base[0]);
        const maxX = Math.floor(aabb.max[0]);
        const minZ = Math.floor(aabb.base[2]);
        const maxZ = Math.floor(aabb.max[2]);
        
        // Check all voxels under the AABB footprint
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
 * Create AABB for a standard entity based on its size
 */
export function createEntityAABB(entity) {
    // Standard entity mesh is BoxGeometry(size, size * 1.5, size)
    return new AABB(entity.size, entity.size * 1.5, entity.size, 0);
}

/**
 * Create AABB for the hero on mount
 * 
 * Since AABBs don't rotate, we need a box large enough to contain
 * the horse+rider at any orientation. The horse body is ~0.6 Ã— 1.4,
 * so the diagonal is âˆš(0.6Â² + 1.4Â²) â‰ˆ 1.52. We use a square footprint.
 * 
 * Dimensions:
 * - Width/Depth: 1.5 (square, fits any rotation)
 * - Height: 2.5 (hooves to rider head)
 */
export function createHeroAABB() {
    // Normal mode: full-sized hero AABB
    return new AABB(1.4, 2.5, 1.4, 0.2);
}

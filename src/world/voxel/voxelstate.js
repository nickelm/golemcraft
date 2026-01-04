/**
 * VoxelState - Semantic states for voxels during structure generation
 * 
 * These states determine how a voxel in a VoxelVolume blends with
 * the underlying terrain when placed in the world.
 * 
 * Used only during generation in the worker — never sent to main thread.
 */

export const VoxelState = {
    // Defer to underlying terrain (default/unset)
    TERRAIN: 0,
    
    // Always air, regardless of terrain (chambers, tunnels, doorways)
    AIR_FORCED: 1,
    
    // Always this block type (walls, floors, solid structure)
    SOLID: 2,
    
    // This block only if at or above terrain surface (foundations, stairs)
    // Below terrain surface, defers to terrain
    SOLID_ABOVE_TERRAIN: 3,
    
    // This block only if below terrain surface (buried foundations)
    // Above terrain surface, becomes air
    SOLID_BELOW_TERRAIN: 4
};

/**
 * Check if a state represents solid matter (for collision purposes during generation)
 */
export function isSolidState(state) {
    return state === VoxelState.SOLID || 
           state === VoxelState.SOLID_ABOVE_TERRAIN ||
           state === VoxelState.SOLID_BELOW_TERRAIN;
}

/**
 * Check if a state forces air
 */
export function isAirState(state) {
    return state === VoxelState.AIR_FORCED;
}
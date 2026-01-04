/**
 * VoxelVolume - A working volume for constructing voxel structures
 * 
 * Provides a canvas for building structures using semantic voxel states,
 * then blending the result into the world. This separates the construction
 * logic from terrain interaction.
 * 
 * Usage:
 *   const volume = new VoxelVolume();
 *   fillBox(volume, 0, 0, 0, 10, 5, 10, 'stone', VoxelState.SOLID);
 *   carveBox(volume, 2, 1, 2, 8, 4, 8);  // Creates AIR_FORCED
 *   volume.blendIntoWorld(worldBlocks, originX, originY, originZ, terrainProvider);
 * 
 * Used only during generation in the worker — the volume itself is never
 * sent to the main thread, only the final blocks Map.
 */

import { VoxelState, isSolidState, isAirState } from './voxelstate.js';

export class VoxelVolume {
    constructor() {
        // Map of "x,y,z" -> { blockType, state }
        this.voxels = new Map();
        
        // Track bounds for optimization
        this.minX = Infinity;
        this.minY = Infinity;
        this.minZ = Infinity;
        this.maxX = -Infinity;
        this.maxY = -Infinity;
        this.maxZ = -Infinity;
    }
    
    /**
     * Set a voxel with block type and semantic state
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - Z coordinate
     * @param {string} blockType - Block type name
     * @param {number} state - VoxelState value
     */
    set(x, y, z, blockType, state = VoxelState.SOLID) {
        const key = `${x},${y},${z}`;
        this.voxels.set(key, { blockType, state });
        
        // Update bounds
        this.minX = Math.min(this.minX, x);
        this.minY = Math.min(this.minY, y);
        this.minZ = Math.min(this.minZ, z);
        this.maxX = Math.max(this.maxX, x);
        this.maxY = Math.max(this.maxY, y);
        this.maxZ = Math.max(this.maxZ, z);
    }
    
    /**
     * Carve a voxel (mark as forced air)
     * This will always result in air, regardless of terrain
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - Z coordinate
     */
    carve(x, y, z) {
        const key = `${x},${y},${z}`;
        this.voxels.set(key, { blockType: null, state: VoxelState.AIR_FORCED });
        
        // Update bounds
        this.minX = Math.min(this.minX, x);
        this.minY = Math.min(this.minY, y);
        this.minZ = Math.min(this.minZ, z);
        this.maxX = Math.max(this.maxX, x);
        this.maxY = Math.max(this.maxY, y);
        this.maxZ = Math.max(this.maxZ, z);
    }
    
    /**
     * Get voxel data at position
     * @returns {{ blockType: string|null, state: number }|undefined}
     */
    get(x, y, z) {
        return this.voxels.get(`${x},${y},${z}`);
    }
    
    /**
     * Check if position has a voxel set
     */
    has(x, y, z) {
        return this.voxels.has(`${x},${y},${z}`);
    }
    
    /**
     * Delete a voxel (revert to TERRAIN state)
     */
    delete(x, y, z) {
        this.voxels.delete(`${x},${y},${z}`);
    }
    
    /**
     * Clear all voxels
     */
    clear() {
        this.voxels.clear();
        this.minX = Infinity;
        this.minY = Infinity;
        this.minZ = Infinity;
        this.maxX = -Infinity;
        this.maxY = -Infinity;
        this.maxZ = -Infinity;
    }
    
    /**
     * Get the number of voxels
     */
    get size() {
        return this.voxels.size;
    }
    
    /**
     * Get bounding box
     * @returns {{ minX, minY, minZ, maxX, maxY, maxZ }}
     */
    getBounds() {
        return {
            minX: this.minX,
            minY: this.minY,
            minZ: this.minZ,
            maxX: this.maxX,
            maxY: this.maxY,
            maxZ: this.maxZ
        };
    }
    
    /**
     * Blend this volume into a world blocks Map
     * 
     * Applies semantic states to determine final block placement:
     * - AIR_FORCED: Always deletes block (creates air)
     * - SOLID: Always places block
     * - SOLID_ABOVE_TERRAIN: Places block only if y >= terrain height
     * - SOLID_BELOW_TERRAIN: Places block only if y < terrain height
     * - TERRAIN: No change (defers to existing terrain)
     * 
     * @param {Map} worldBlocks - Target blocks Map (modified in place)
     * @param {number} originX - World X origin for this volume
     * @param {number} originY - World Y origin for this volume
     * @param {number} originZ - World Z origin for this volume
     * @param {Object} terrainProvider - Object with getHeight(x, z) method (optional)
     */
    blendIntoWorld(worldBlocks, originX = 0, originY = 0, originZ = 0, terrainProvider = null) {
        for (const [key, voxel] of this.voxels) {
            const [lx, ly, lz] = key.split(',').map(Number);
            const wx = originX + lx;
            const wy = originY + ly;
            const wz = originZ + lz;
            const worldKey = `${wx},${wy},${wz}`;
            
            switch (voxel.state) {
                case VoxelState.AIR_FORCED:
                    // Always create air
                    worldBlocks.delete(worldKey);
                    break;
                    
                case VoxelState.SOLID:
                    // Always place block
                    worldBlocks.set(worldKey, voxel.blockType);
                    break;
                    
                case VoxelState.SOLID_ABOVE_TERRAIN:
                    // Only place if at or above terrain
                    if (terrainProvider) {
                        const terrainHeight = terrainProvider.getHeight(wx, wz);
                        if (wy >= terrainHeight) {
                            worldBlocks.set(worldKey, voxel.blockType);
                        }
                    } else {
                        // No terrain provider, treat as solid
                        worldBlocks.set(worldKey, voxel.blockType);
                    }
                    break;
                    
                case VoxelState.SOLID_BELOW_TERRAIN:
                    // Only place if below terrain
                    if (terrainProvider) {
                        const terrainHeight = terrainProvider.getHeight(wx, wz);
                        if (wy < terrainHeight) {
                            worldBlocks.set(worldKey, voxel.blockType);
                        }
                    }
                    // If no terrain provider, don't place anything
                    break;
                    
                case VoxelState.TERRAIN:
                default:
                    // Do nothing - defer to existing terrain
                    break;
            }
        }
    }
    
    /**
     * Blend this volume into a world blocks Map at origin (0,0,0)
     * Convenience method when no offset is needed
     */
    blendIntoWorldAtOrigin(worldBlocks, terrainProvider = null) {
        this.blendIntoWorld(worldBlocks, 0, 0, 0, terrainProvider);
    }
    
    /**
     * Convert volume directly to a blocks Map (ignoring blend semantics)
     * Only includes solid voxels, useful for simple structures
     * @returns {Map} Blocks map with "x,y,z" -> blockType
     */
    toBlocksMap() {
        const blocks = new Map();
        
        for (const [key, voxel] of this.voxels) {
            if (isSolidState(voxel.state) && voxel.blockType) {
                blocks.set(key, voxel.blockType);
            }
        }
        
        return blocks;
    }
    
    /**
     * Create a translated copy of this volume
     * @param {number} dx - X offset
     * @param {number} dy - Y offset
     * @param {number} dz - Z offset
     * @returns {VoxelVolume} New translated volume
     */
    translate(dx, dy, dz) {
        const translated = new VoxelVolume();
        
        for (const [key, voxel] of this.voxels) {
            const [x, y, z] = key.split(',').map(Number);
            translated.voxels.set(`${x + dx},${y + dy},${z + dz}`, { ...voxel });
        }
        
        translated.minX = this.minX + dx;
        translated.minY = this.minY + dy;
        translated.minZ = this.minZ + dz;
        translated.maxX = this.maxX + dx;
        translated.maxY = this.maxY + dy;
        translated.maxZ = this.maxZ + dz;
        
        return translated;
    }
    
    /**
     * Create a rotated copy of this volume (90° increments around Y axis)
     * @param {number} quarterTurns - Number of 90° clockwise rotations (0-3)
     * @returns {VoxelVolume} New rotated volume
     */
    rotateY(quarterTurns) {
        const rotated = new VoxelVolume();
        const turns = ((quarterTurns % 4) + 4) % 4;  // Normalize to 0-3
        
        for (const [key, voxel] of this.voxels) {
            const [x, y, z] = key.split(',').map(Number);
            let rx, rz;
            
            switch (turns) {
                case 0:
                    rx = x;
                    rz = z;
                    break;
                case 1:  // 90° clockwise
                    rx = -z;
                    rz = x;
                    break;
                case 2:  // 180°
                    rx = -x;
                    rz = -z;
                    break;
                case 3:  // 270° clockwise (90° counter-clockwise)
                    rx = z;
                    rz = -x;
                    break;
            }
            
            rotated.set(rx, y, rz, voxel.blockType, voxel.state);
        }
        
        return rotated;
    }
    
    /**
     * Create a mirrored copy of this volume
     * @param {boolean} mirrorX - Mirror across YZ plane
     * @param {boolean} mirrorY - Mirror across XZ plane
     * @param {boolean} mirrorZ - Mirror across XY plane
     * @returns {VoxelVolume} New mirrored volume
     */
    mirror(mirrorX = false, mirrorY = false, mirrorZ = false) {
        const mirrored = new VoxelVolume();
        
        for (const [key, voxel] of this.voxels) {
            const [x, y, z] = key.split(',').map(Number);
            const mx = mirrorX ? -x : x;
            const my = mirrorY ? -y : y;
            const mz = mirrorZ ? -z : z;
            
            mirrored.set(mx, my, mz, voxel.blockType, voxel.state);
        }
        
        return mirrored;
    }
    
    /**
     * Merge another volume into this one
     * Later voxels overwrite earlier ones at the same position
     * @param {VoxelVolume} other - Volume to merge in
     * @param {number} offsetX - X offset for other volume
     * @param {number} offsetY - Y offset for other volume
     * @param {number} offsetZ - Z offset for other volume
     */
    merge(other, offsetX = 0, offsetY = 0, offsetZ = 0) {
        for (const [key, voxel] of other.voxels) {
            const [x, y, z] = key.split(',').map(Number);
            this.set(x + offsetX, y + offsetY, z + offsetZ, voxel.blockType, voxel.state);
        }
    }
    
    /**
     * Iterate over all voxels
     * @yields {[number, number, number, string, number]} [x, y, z, blockType, state]
     */
    *[Symbol.iterator]() {
        for (const [key, voxel] of this.voxels) {
            const [x, y, z] = key.split(',').map(Number);
            yield [x, y, z, voxel.blockType, voxel.state];
        }
    }
}

/**
 * Create a VoxelVolume from an existing blocks Map
 * All blocks are set with SOLID state
 * @param {Map} blocks - Blocks map with "x,y,z" -> blockType
 * @returns {VoxelVolume}
 */
export function volumeFromBlocks(blocks) {
    const volume = new VoxelVolume();
    
    for (const [key, blockType] of blocks) {
        const [x, y, z] = key.split(',').map(Number);
        volume.set(x, y, z, blockType, VoxelState.SOLID);
    }
    
    return volume;
}
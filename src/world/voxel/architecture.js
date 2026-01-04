/**
 * Architecture - High-level building primitives for voxel structures
 * 
 * Built on top of voxelshapes.js, these functions create common
 * architectural elements like stairs, pillars, roofs, and arches.
 * 
 * All functions operate on a VoxelVolume or blocks Map.
 * Coordinates are in local space - translate when blending into world.
 */

import { VoxelState } from './voxelstate.js';
import { fillBox, fillCylinder, line } from './voxelshapes.js';

// ============================================================================
// STAIRS
// ============================================================================

/**
 * Direction vectors for stair orientation
 */
const STAIR_DIRECTIONS = {
    '+X': { dx: 1, dz: 0 },
    '-X': { dx: -1, dz: 0 },
    '+Z': { dx: 0, dz: 1 },
    '-Z': { dx: 0, dz: -1 }
};

/**
 * Create a straight staircase
 * 
 * @param {VoxelVolume|Map} target - Volume or blocks Map to modify
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position (first step)
 * @param {number} startZ - Starting Z position
 * @param {string} direction - Direction stairs go: '+X', '-X', '+Z', '-Z'
 * @param {number} steps - Number of steps
 * @param {number} width - Width of stairs (perpendicular to direction)
 * @param {string} blockType - Block type for stairs
 * @param {Object} options - Additional options
 * @param {number} options.rise - Height change per step (default 1, negative for descending)
 * @param {number} options.run - Horizontal distance per step (default 1)
 * @param {boolean} options.fill - Fill underneath stairs (default true)
 * @param {number} options.thickness - Step thickness (default 1)
 * @param {number} options.state - VoxelState (default SOLID)
 */
export function stairs(target, startX, startY, startZ, direction, steps, width, blockType, options = {}) {
    const {
        rise = 1,
        run = 1,
        fill = true,
        thickness = 1,
        state = VoxelState.SOLID
    } = options;
    
    const dir = STAIR_DIRECTIONS[direction];
    if (!dir) {
        console.error(`Invalid stair direction: ${direction}`);
        return;
    }
    
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    const halfWidth = Math.floor(width / 2);
    
    // Calculate the lowest Y level for fill (handles both ascending and descending)
    const endY = startY + (steps - 1) * rise;
    const baseY = Math.min(startY, endY);
    
    for (let step = 0; step < steps; step++) {
        const stepY = startY + step * rise;
        const stepDist = step * run;
        
        // Calculate step position
        const stepX = startX + dir.dx * stepDist;
        const stepZ = startZ + dir.dz * stepDist;
        
        // Place step blocks across width
        for (let w = -halfWidth; w <= halfWidth; w++) {
            const x = dir.dx !== 0 ? stepX : stepX + w;
            const z = dir.dz !== 0 ? stepZ : stepZ + w;
            
            // Step surface (may be multiple blocks thick)
            for (let t = 0; t < thickness; t++) {
                if (isVolume) {
                    target.set(x, stepY + t, z, blockType, state);
                } else {
                    target.set(`${x},${stepY + t},${z}`, blockType);
                }
            }
            
            // Fill underneath down to the lowest point of the staircase
            if (fill) {
                for (let fillY = baseY; fillY < stepY; fillY++) {
                    if (isVolume) {
                        target.set(x, fillY, z, blockType, state);
                    } else {
                        target.set(`${x},${fillY},${z}`, blockType);
                    }
                }
            }
        }
    }
}

/**
 * Create a spiral staircase around a central column
 * 
 * @param {number} centerX - Center X of spiral
 * @param {number} baseY - Base Y position
 * @param {number} centerZ - Center Z of spiral
 * @param {number} height - Total height
 * @param {number} radius - Outer radius of stairs
 * @param {string} blockType - Block type for stairs
 * @param {Object} options - Additional options
 * @param {number} options.columnRadius - Central column radius (default 1)
 * @param {string} options.columnBlockType - Column block type (default same as stairs)
 * @param {boolean} options.clockwise - Spiral direction (default true)
 * @param {number} options.stepsPerRotation - Steps for full 360° (default 16)
 */
export function spiralStairs(target, centerX, baseY, centerZ, height, radius, blockType, options = {}) {
    const {
        columnRadius = 1,
        columnBlockType = blockType,
        clockwise = true,
        stepsPerRotation = 16,
        state = VoxelState.SOLID
    } = options;
    
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    
    // Central column
    fillCylinder(target, centerX, baseY, centerZ, columnRadius, height, columnBlockType, state);
    
    // Spiral steps
    const totalSteps = height;
    const anglePerStep = (2 * Math.PI) / stepsPerRotation * (clockwise ? 1 : -1);
    
    for (let step = 0; step < totalSteps; step++) {
        const angle = step * anglePerStep;
        const y = baseY + step;
        
        // Create wedge-shaped step
        for (let r = columnRadius + 1; r <= radius; r++) {
            // Each step spans a portion of the arc
            for (let a = -0.3; a <= 0.3; a += 0.15) {
                const x = Math.round(centerX + Math.cos(angle + a) * r);
                const z = Math.round(centerZ + Math.sin(angle + a) * r);
                
                if (isVolume) {
                    target.set(x, y, z, blockType, state);
                } else {
                    target.set(`${x},${y},${z}`, blockType);
                }
            }
        }
    }
}

// ============================================================================
// PILLARS AND COLUMNS
// ============================================================================

/**
 * Create a pillar/column
 * 
 * @param {number} x - Center X
 * @param {number} baseY - Base Y position
 * @param {number} z - Center Z
 * @param {number} height - Pillar height
 * @param {string} blockType - Block type
 * @param {Object} options - Additional options
 * @param {number} options.radius - Pillar radius (default 0 for single block)
 * @param {boolean} options.base - Add decorative base (default false)
 * @param {boolean} options.capital - Add decorative capital (default false)
 * @param {number} options.baseHeight - Base height (default 1)
 * @param {number} options.capitalHeight - Capital height (default 1)
 */
export function pillar(target, x, baseY, z, height, blockType, options = {}) {
    const {
        radius = 0,
        base = false,
        capital = false,
        baseHeight = 1,
        capitalHeight = 1,
        state = VoxelState.SOLID
    } = options;
    
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    
    // Main shaft
    if (radius === 0) {
        // Single-block pillar
        for (let y = baseY; y < baseY + height; y++) {
            if (isVolume) {
                target.set(x, y, z, blockType, state);
            } else {
                target.set(`${x},${y},${z}`, blockType);
            }
        }
    } else {
        // Cylindrical pillar
        fillCylinder(target, x, baseY, z, radius, height, blockType, state);
    }
    
    // Decorative base (wider than shaft)
    if (base) {
        const baseRadius = radius + 1;
        if (baseRadius <= 1) {
            // Cross-shaped base for thin pillars
            for (let y = baseY; y < baseY + baseHeight; y++) {
                for (let d = -1; d <= 1; d++) {
                    if (isVolume) {
                        target.set(x + d, y, z, blockType, state);
                        target.set(x, y, z + d, blockType, state);
                    } else {
                        target.set(`${x + d},${y},${z}`, blockType);
                        target.set(`${x},${y},${z + d}`, blockType);
                    }
                }
            }
        } else {
            fillCylinder(target, x, baseY, z, baseRadius, baseHeight, blockType, state);
        }
    }
    
    // Decorative capital (wider than shaft)
    if (capital) {
        const capitalRadius = radius + 1;
        const capitalY = baseY + height - capitalHeight;
        
        if (capitalRadius <= 1) {
            // Cross-shaped capital for thin pillars
            for (let y = capitalY; y < capitalY + capitalHeight; y++) {
                for (let d = -1; d <= 1; d++) {
                    if (isVolume) {
                        target.set(x + d, y, z, blockType, state);
                        target.set(x, y, z + d, blockType, state);
                    } else {
                        target.set(`${x + d},${y},${z}`, blockType);
                        target.set(`${x},${y},${z + d}`, blockType);
                    }
                }
            }
        } else {
            fillCylinder(target, x, capitalY, z, capitalRadius, capitalHeight, blockType, state);
        }
    }
}

/**
 * Create a row of pillars (colonnade)
 * 
 * @param {number} startX - Starting X
 * @param {number} baseY - Base Y
 * @param {number} startZ - Starting Z
 * @param {number} count - Number of pillars
 * @param {number} spacing - Distance between pillar centers
 * @param {string} axis - Axis along which pillars are placed: 'X' or 'Z'
 * @param {number} height - Pillar height
 * @param {string} blockType - Block type
 * @param {Object} options - Pillar options (passed to pillar())
 * @param {boolean} options.lintel - Add connecting lintel on top (default false)
 * @param {number} options.lintelHeight - Lintel thickness (default 1)
 */
export function colonnade(target, startX, baseY, startZ, count, spacing, axis, height, blockType, options = {}) {
    const {
        lintel = false,
        lintelHeight = 1,
        ...pillarOptions
    } = options;
    
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    const state = pillarOptions.state || VoxelState.SOLID;
    
    // Place pillars
    for (let i = 0; i < count; i++) {
        const x = axis === 'X' ? startX + i * spacing : startX;
        const z = axis === 'Z' ? startZ + i * spacing : startZ;
        
        pillar(target, x, baseY, z, height, blockType, pillarOptions);
    }
    
    // Add lintel connecting tops
    if (lintel && count > 1) {
        const lintelY = baseY + height;
        const endX = axis === 'X' ? startX + (count - 1) * spacing : startX;
        const endZ = axis === 'Z' ? startZ + (count - 1) * spacing : startZ;
        
        // Simple beam lintel
        for (let y = lintelY; y < lintelY + lintelHeight; y++) {
            if (axis === 'X') {
                for (let x = startX; x <= endX; x++) {
                    if (isVolume) {
                        target.set(x, y, startZ, blockType, state);
                    } else {
                        target.set(`${x},${y},${startZ}`, blockType);
                    }
                }
            } else {
                for (let z = startZ; z <= endZ; z++) {
                    if (isVolume) {
                        target.set(startX, y, z, blockType, state);
                    } else {
                        target.set(`${startX},${y},${z}`, blockType);
                    }
                }
            }
        }
    }
}

// ============================================================================
// ARCHES AND DOORWAYS
// ============================================================================

/**
 * Create an arch (semicircular opening with frame)
 * 
 * @param {number} centerX - Center X of arch
 * @param {number} baseY - Base Y (floor level)
 * @param {number} centerZ - Center Z of arch
 * @param {number} width - Opening width
 * @param {number} height - Height to top of arch
 * @param {number} depth - Arch thickness (into wall)
 * @param {string} direction - Direction arch faces: '+X', '-X', '+Z', '-Z'
 * @param {string} blockType - Block type for arch frame
 * @param {Object} options - Additional options
 * @param {boolean} options.carve - Also carve the opening (default true)
 */
export function arch(target, centerX, baseY, centerZ, width, height, depth, direction, blockType, options = {}) {
    const {
        carve = true,
        state = VoxelState.SOLID
    } = options;
    
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    const halfWidth = Math.floor(width / 2);
    const halfDepth = Math.floor(depth / 2);
    
    const dir = STAIR_DIRECTIONS[direction];
    if (!dir) return;
    
    // Arch faces along X (opening in Z direction) or along Z (opening in X direction)
    const alongX = dir.dz !== 0;
    
    // Straight sides up to spring point
    const springHeight = height - halfWidth;  // Where curve begins
    
    for (let y = baseY; y < baseY + springHeight; y++) {
        for (let d = -halfDepth; d <= halfDepth; d++) {
            // Left pillar
            const lx = alongX ? centerX - halfWidth - 1 : centerX + d;
            const lz = alongX ? centerZ + d : centerZ - halfWidth - 1;
            
            // Right pillar
            const rx = alongX ? centerX + halfWidth + 1 : centerX + d;
            const rz = alongX ? centerZ + d : centerZ + halfWidth + 1;
            
            if (isVolume) {
                target.set(lx, y, lz, blockType, state);
                target.set(rx, y, rz, blockType, state);
            } else {
                target.set(`${lx},${y},${lz}`, blockType);
                target.set(`${rx},${y},${rz}`, blockType);
            }
        }
    }
    
    // Curved top (semicircle)
    const radius = halfWidth + 1;
    for (let angle = 0; angle <= Math.PI; angle += 0.15) {
        const dx = Math.round(Math.cos(angle) * radius);
        const dy = Math.round(Math.sin(angle) * radius);
        
        for (let d = -halfDepth; d <= halfDepth; d++) {
            const x = alongX ? centerX + dx : centerX + d;
            const y = baseY + springHeight - 1 + dy;
            const z = alongX ? centerZ + d : centerZ + dx;
            
            if (isVolume) {
                target.set(x, y, z, blockType, state);
            } else {
                target.set(`${x},${y},${z}`, blockType);
            }
        }
    }
    
    // Carve opening
    if (carve) {
        for (let y = baseY; y < baseY + height; y++) {
            const maxW = y < baseY + springHeight ? halfWidth : 
                Math.floor(Math.sqrt(radius * radius - Math.pow(y - baseY - springHeight + 1, 2)));
            
            for (let w = -maxW; w <= maxW; w++) {
                for (let d = -halfDepth; d <= halfDepth; d++) {
                    const x = alongX ? centerX + w : centerX + d;
                    const z = alongX ? centerZ + d : centerZ + w;
                    
                    if (isVolume) {
                        target.carve(x, y, z);
                    } else {
                        target.delete(`${x},${y},${z}`);
                    }
                }
            }
        }
    }
}

/**
 * Create a simple rectangular doorway
 * 
 * @param {number} centerX - Center X
 * @param {number} baseY - Base Y (floor level)
 * @param {number} centerZ - Center Z
 * @param {number} width - Opening width
 * @param {number} height - Opening height
 * @param {number} depth - Wall thickness
 * @param {string} direction - Direction doorway faces
 * @param {Object} options - Additional options
 * @param {string} options.frameBlockType - Block type for frame (null for no frame)
 * @param {boolean} options.carve - Carve the opening (default true)
 */
export function doorway(target, centerX, baseY, centerZ, width, height, depth, direction, options = {}) {
    const {
        frameBlockType = null,
        carve = true,
        state = VoxelState.SOLID
    } = options;
    
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    const halfWidth = Math.floor(width / 2);
    const halfDepth = Math.floor(depth / 2);
    
    const dir = STAIR_DIRECTIONS[direction];
    if (!dir) return;
    
    const alongX = dir.dz !== 0;
    
    // Frame
    if (frameBlockType) {
        for (let y = baseY; y < baseY + height + 1; y++) {
            for (let d = -halfDepth; d <= halfDepth; d++) {
                // Only sides and top, not the opening
                const isTop = y === baseY + height;
                const isLeftSide = true;
                const isRightSide = true;
                
                // Left frame
                const lx = alongX ? centerX - halfWidth - 1 : centerX + d;
                const lz = alongX ? centerZ + d : centerZ - halfWidth - 1;
                
                // Right frame
                const rx = alongX ? centerX + halfWidth + 1 : centerX + d;
                const rz = alongX ? centerZ + d : centerZ + halfWidth + 1;
                
                if (isVolume) {
                    target.set(lx, y, lz, frameBlockType, state);
                    target.set(rx, y, rz, frameBlockType, state);
                } else {
                    target.set(`${lx},${y},${lz}`, frameBlockType);
                    target.set(`${rx},${y},${rz}`, frameBlockType);
                }
                
                // Top lintel
                if (isTop) {
                    for (let w = -halfWidth; w <= halfWidth; w++) {
                        const tx = alongX ? centerX + w : centerX + d;
                        const tz = alongX ? centerZ + d : centerZ + w;
                        
                        if (isVolume) {
                            target.set(tx, y, tz, frameBlockType, state);
                        } else {
                            target.set(`${tx},${y},${tz}`, frameBlockType);
                        }
                    }
                }
            }
        }
    }
    
    // Carve opening
    if (carve) {
        for (let y = baseY; y < baseY + height; y++) {
            for (let w = -halfWidth; w <= halfWidth; w++) {
                for (let d = -halfDepth; d <= halfDepth; d++) {
                    const x = alongX ? centerX + w : centerX + d;
                    const z = alongX ? centerZ + d : centerZ + w;
                    
                    if (isVolume) {
                        target.carve(x, y, z);
                    } else {
                        target.delete(`${x},${y},${z}`);
                    }
                }
            }
        }
    }
}

// ============================================================================
// ROOFS
// ============================================================================

/**
 * Create a pitched (gabled) roof
 * 
 * @param {number} minX - Minimum X
 * @param {number} baseY - Base Y (where roof starts)
 * @param {number} minZ - Minimum Z
 * @param {number} maxX - Maximum X (exclusive)
 * @param {number} maxZ - Maximum Z (exclusive)
 * @param {number} peakHeight - Height at peak above baseY
 * @param {string} axis - Ridge axis: 'X' (ridge runs along X) or 'Z'
 * @param {string} blockType - Block type for roof
 */
export function pitchedRoof(target, minX, baseY, minZ, maxX, maxZ, peakHeight, axis, blockType, options = {}) {
    const { state = VoxelState.SOLID } = options;
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    
    const widthX = maxX - minX;
    const widthZ = maxZ - minZ;
    
    if (axis === 'X') {
        // Ridge runs along X, slopes down in Z direction
        const halfZ = widthZ / 2;
        const centerZ = minZ + halfZ;
        
        for (let x = minX; x < maxX; x++) {
            for (let z = minZ; z < maxZ; z++) {
                const distFromCenter = Math.abs(z - centerZ + 0.5);
                const heightAtZ = Math.round(peakHeight * (1 - distFromCenter / halfZ));
                
                if (heightAtZ > 0) {
                    const y = baseY + heightAtZ - 1;
                    if (isVolume) {
                        target.set(x, y, z, blockType, state);
                    } else {
                        target.set(`${x},${y},${z}`, blockType);
                    }
                }
            }
        }
    } else {
        // Ridge runs along Z, slopes down in X direction
        const halfX = widthX / 2;
        const centerX = minX + halfX;
        
        for (let x = minX; x < maxX; x++) {
            for (let z = minZ; z < maxZ; z++) {
                const distFromCenter = Math.abs(x - centerX + 0.5);
                const heightAtX = Math.round(peakHeight * (1 - distFromCenter / halfX));
                
                if (heightAtX > 0) {
                    const y = baseY + heightAtX - 1;
                    if (isVolume) {
                        target.set(x, y, z, blockType, state);
                    } else {
                        target.set(`${x},${y},${z}`, blockType);
                    }
                }
            }
        }
    }
}

/**
 * Create a flat roof with optional parapet
 * 
 * @param {number} minX - Minimum X
 * @param {number} y - Y level
 * @param {number} minZ - Minimum Z
 * @param {number} maxX - Maximum X (exclusive)
 * @param {number} maxZ - Maximum Z (exclusive)
 * @param {string} blockType - Block type for roof
 * @param {Object} options - Additional options
 * @param {number} options.parapet - Parapet height (0 for none)
 * @param {string} options.parapetBlockType - Block type for parapet
 */
export function flatRoof(target, minX, y, minZ, maxX, maxZ, blockType, options = {}) {
    const {
        parapet = 0,
        parapetBlockType = blockType,
        state = VoxelState.SOLID
    } = options;
    
    // Flat surface
    fillBox(target, minX, y, minZ, maxX, y + 1, maxZ, blockType, state);
    
    // Parapet walls
    if (parapet > 0) {
        const isVolume = typeof target.set === 'function' && target.set.length >= 4;
        
        for (let py = y + 1; py < y + 1 + parapet; py++) {
            // Four edges
            for (let x = minX; x < maxX; x++) {
                if (isVolume) {
                    target.set(x, py, minZ, parapetBlockType, state);
                    target.set(x, py, maxZ - 1, parapetBlockType, state);
                } else {
                    target.set(`${x},${py},${minZ}`, parapetBlockType);
                    target.set(`${x},${py},${maxZ - 1}`, parapetBlockType);
                }
            }
            for (let z = minZ; z < maxZ; z++) {
                if (isVolume) {
                    target.set(minX, py, z, parapetBlockType, state);
                    target.set(maxX - 1, py, z, parapetBlockType, state);
                } else {
                    target.set(`${minX},${py},${z}`, parapetBlockType);
                    target.set(`${maxX - 1},${py},${z}`, parapetBlockType);
                }
            }
        }
    }
}

// ============================================================================
// WALLS AND BATTLEMENTS
// ============================================================================

/**
 * Create a crenellated battlement (castle wall top)
 * 
 * @param {number} minX - Minimum X
 * @param {number} baseY - Base Y
 * @param {number} minZ - Minimum Z
 * @param {number} maxX - Maximum X (exclusive)
 * @param {number} maxZ - Maximum Z (exclusive)
 * @param {number} height - Total battlement height
 * @param {string} blockType - Block type
 * @param {Object} options - Additional options
 * @param {number} options.merlonWidth - Width of solid parts (default 2)
 * @param {number} options.crenelWidth - Width of gaps (default 1)
 * @param {number} options.crenelHeight - Height of gaps from top (default half height)
 */
export function battlement(target, minX, baseY, minZ, maxX, maxZ, height, blockType, options = {}) {
    const {
        merlonWidth = 2,
        crenelWidth = 1,
        crenelHeight = Math.floor(height / 2),
        state = VoxelState.SOLID
    } = options;
    
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    const pattern = merlonWidth + crenelWidth;
    
    // Determine if this is a single-block-wide wall or area
    const isWallX = (maxZ - minZ) === 1;
    const isWallZ = (maxX - minX) === 1;
    
    for (let x = minX; x < maxX; x++) {
        for (let z = minZ; z < maxZ; z++) {
            // Determine if this position is a crenel (gap) or merlon (solid)
            let isCrenel = false;
            
            if (isWallX) {
                // Wall along X axis
                const pos = (x - minX) % pattern;
                isCrenel = pos >= merlonWidth;
            } else if (isWallZ) {
                // Wall along Z axis
                const pos = (z - minZ) % pattern;
                isCrenel = pos >= merlonWidth;
            } else {
                // Perimeter of an area - crenels on edges only
                const onEdge = x === minX || x === maxX - 1 || z === minZ || z === maxZ - 1;
                if (onEdge) {
                    const edgePos = (x === minX || x === maxX - 1) ? 
                        (z - minZ) % pattern : (x - minX) % pattern;
                    isCrenel = edgePos >= merlonWidth;
                }
            }
            
            const topY = isCrenel ? baseY + height - crenelHeight : baseY + height;
            
            for (let y = baseY; y < topY; y++) {
                if (isVolume) {
                    target.set(x, y, z, blockType, state);
                } else {
                    target.set(`${x},${y},${z}`, blockType);
                }
            }
        }
    }
}

/**
 * Create a wall segment with optional window openings
 * 
 * @param {number} startX - Start X
 * @param {number} baseY - Base Y
 * @param {number} startZ - Start Z
 * @param {number} length - Wall length
 * @param {number} height - Wall height
 * @param {number} thickness - Wall thickness
 * @param {string} axis - Wall axis: 'X' or 'Z'
 * @param {string} blockType - Block type
 * @param {Object} options - Additional options
 * @param {Array} options.windows - Array of {position, width, height, sillHeight}
 */
export function wall(target, startX, baseY, startZ, length, height, thickness, axis, blockType, options = {}) {
    const {
        windows = [],
        state = VoxelState.SOLID
    } = options;
    
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    
    // Build solid wall
    if (axis === 'X') {
        fillBox(target, startX, baseY, startZ, startX + length, baseY + height, startZ + thickness, blockType, state);
    } else {
        fillBox(target, startX, baseY, startZ, startX + thickness, baseY + height, startZ + length, blockType, state);
    }
    
    // Carve windows
    for (const win of windows) {
        const { position, width, height: winHeight, sillHeight = 2 } = win;
        const halfWidth = Math.floor(width / 2);
        
        for (let y = baseY + sillHeight; y < baseY + sillHeight + winHeight; y++) {
            for (let w = -halfWidth; w <= halfWidth; w++) {
                for (let t = 0; t < thickness; t++) {
                    let x, z;
                    if (axis === 'X') {
                        x = startX + position + w;
                        z = startZ + t;
                    } else {
                        x = startX + t;
                        z = startZ + position + w;
                    }
                    
                    if (isVolume) {
                        target.carve(x, y, z);
                    } else {
                        target.delete(`${x},${y},${z}`);
                    }
                }
            }
        }
    }
}
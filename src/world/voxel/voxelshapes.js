/**
 * VoxelShapes - Primitive shape generation for voxel structures
 * 
 * Pure functions that operate on a VoxelVolume or directly on a blocks Map.
 * No external dependencies — safe for use in web workers.
 * 
 * All coordinates are integers. Shapes are inclusive of min bounds,
 * exclusive of max bounds (like array slicing) unless noted otherwise.
 */

import { VoxelState } from './voxelstate.js';

// ============================================================================
// BOX OPERATIONS
// ============================================================================

/**
 * Fill a solid box
 * @param {VoxelVolume|Map} target - Volume or blocks Map to modify
 * @param {number} minX - Minimum X (inclusive)
 * @param {number} minY - Minimum Y (inclusive)
 * @param {number} minZ - Minimum Z (inclusive)
 * @param {number} maxX - Maximum X (exclusive)
 * @param {number} maxY - Maximum Y (exclusive)
 * @param {number} maxZ - Maximum Z (exclusive)
 * @param {string} blockType - Block type to place
 * @param {number} state - VoxelState (only used if target is VoxelVolume)
 */
export function fillBox(target, minX, minY, minZ, maxX, maxY, maxZ, blockType, state = VoxelState.SOLID) {
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    
    for (let y = minY; y < maxY; y++) {
        for (let x = minX; x < maxX; x++) {
            for (let z = minZ; z < maxZ; z++) {
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
 * Fill a hollow box (shell/stroke)
 * @param {number} thickness - Wall thickness (default 1)
 */
export function strokeBox(target, minX, minY, minZ, maxX, maxY, maxZ, blockType, thickness = 1, state = VoxelState.SOLID) {
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    
    for (let y = minY; y < maxY; y++) {
        for (let x = minX; x < maxX; x++) {
            for (let z = minZ; z < maxZ; z++) {
                // Check if on any face within thickness
                const onXFace = x < minX + thickness || x >= maxX - thickness;
                const onYFace = y < minY + thickness || y >= maxY - thickness;
                const onZFace = z < minZ + thickness || z >= maxZ - thickness;
                
                if (onXFace || onYFace || onZFace) {
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
 * Carve (delete) a box region
 * @param {VoxelVolume|Map} target - Volume or blocks Map to modify
 * @param {number} minX - Minimum X (inclusive)
 * @param {number} minY - Minimum Y (inclusive)
 * @param {number} minZ - Minimum Z (inclusive)
 * @param {number} maxX - Maximum X (exclusive)
 * @param {number} maxY - Maximum Y (exclusive)
 * @param {number} maxZ - Maximum Z (exclusive)
 * @param {number|null} brightness - Optional brightness for the carved air space (0.0-1.0)
 */
export function carveBox(target, minX, minY, minZ, maxX, maxY, maxZ, brightness = null) {
    const isVolume = typeof target.carve === 'function';

    for (let y = minY; y < maxY; y++) {
        for (let x = minX; x < maxX; x++) {
            for (let z = minZ; z < maxZ; z++) {
                if (isVolume) {
                    target.carve(x, y, z, brightness);
                } else {
                    target.delete(`${x},${y},${z}`);
                }
            }
        }
    }
}

/**
 * Carve a box region with graduated brightness along an axis
 * Useful for tunnels that transition from light to dark
 * @param {VoxelVolume} target - Volume to modify (must be VoxelVolume, not Map)
 * @param {number} minX - Minimum X (inclusive)
 * @param {number} minY - Minimum Y (inclusive)
 * @param {number} minZ - Minimum Z (inclusive)
 * @param {number} maxX - Maximum X (exclusive)
 * @param {number} maxY - Maximum Y (exclusive)
 * @param {number} maxZ - Maximum Z (exclusive)
 * @param {string} gradientAxis - Axis for gradient: 'x', 'y', or 'z'
 * @param {number} startBrightness - Brightness at min edge of axis (0.0-1.0)
 * @param {number} endBrightness - Brightness at max edge of axis (0.0-1.0)
 */
export function carveBoxGradient(target, minX, minY, minZ, maxX, maxY, maxZ, gradientAxis, startBrightness, endBrightness) {
    const isVolume = typeof target.carve === 'function';
    if (!isVolume) return;  // Only works with VoxelVolume

    for (let y = minY; y < maxY; y++) {
        for (let x = minX; x < maxX; x++) {
            for (let z = minZ; z < maxZ; z++) {
                // Calculate gradient progress along axis (0.0 to 1.0)
                let t;
                const axisLength = {
                    x: maxX - minX,
                    y: maxY - minY,
                    z: maxZ - minZ
                }[gradientAxis] || 1;

                switch (gradientAxis) {
                    case 'x': t = axisLength > 1 ? (x - minX) / (axisLength - 1) : 0; break;
                    case 'y': t = axisLength > 1 ? (y - minY) / (axisLength - 1) : 0; break;
                    case 'z': t = axisLength > 1 ? (z - minZ) / (axisLength - 1) : 0; break;
                    default: t = 0;
                }

                const brightness = startBrightness + t * (endBrightness - startBrightness);
                target.carve(x, y, z, brightness);
            }
        }
    }
}

// ============================================================================
// SPHERE OPERATIONS
// ============================================================================

/**
 * Fill a solid sphere
 * @param {number} centerX - Center X
 * @param {number} centerY - Center Y
 * @param {number} centerZ - Center Z
 * @param {number} radius - Radius (inclusive)
 */
export function fillSphere(target, centerX, centerY, centerZ, radius, blockType, state = VoxelState.SOLID) {
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    const r2 = radius * radius;
    
    for (let y = centerY - radius; y <= centerY + radius; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            for (let z = centerZ - radius; z <= centerZ + radius; z++) {
                const dx = x - centerX;
                const dy = y - centerY;
                const dz = z - centerZ;
                
                if (dx * dx + dy * dy + dz * dz <= r2) {
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
 * Fill a hollow sphere (shell)
 * @param {number} thickness - Shell thickness (default 1)
 */
export function strokeSphere(target, centerX, centerY, centerZ, radius, blockType, thickness = 1, state = VoxelState.SOLID) {
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    const outerR2 = radius * radius;
    const innerR2 = (radius - thickness) * (radius - thickness);
    
    for (let y = centerY - radius; y <= centerY + radius; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            for (let z = centerZ - radius; z <= centerZ + radius; z++) {
                const dx = x - centerX;
                const dy = y - centerY;
                const dz = z - centerZ;
                const d2 = dx * dx + dy * dy + dz * dz;
                
                if (d2 <= outerR2 && d2 > innerR2) {
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
 * Carve a spherical region
 * @param {VoxelVolume|Map} target - Volume or blocks Map to modify
 * @param {number} centerX - Center X
 * @param {number} centerY - Center Y
 * @param {number} centerZ - Center Z
 * @param {number} radius - Radius (inclusive)
 * @param {number|null} brightness - Optional brightness for the carved air space (0.0-1.0)
 */
export function carveSphere(target, centerX, centerY, centerZ, radius, brightness = null) {
    const isVolume = typeof target.carve === 'function';
    const r2 = radius * radius;

    for (let y = centerY - radius; y <= centerY + radius; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            for (let z = centerZ - radius; z <= centerZ + radius; z++) {
                const dx = x - centerX;
                const dy = y - centerY;
                const dz = z - centerZ;

                if (dx * dx + dy * dy + dz * dz <= r2) {
                    if (isVolume) {
                        target.carve(x, y, z, brightness);
                    } else {
                        target.delete(`${x},${y},${z}`);
                    }
                }
            }
        }
    }
}

/**
 * Carve a spherical region with radial brightness gradient
 * Useful for cave chambers where the center is darker than the edges
 * @param {VoxelVolume} target - Volume to modify (must be VoxelVolume, not Map)
 * @param {number} centerX - Center X
 * @param {number} centerY - Center Y
 * @param {number} centerZ - Center Z
 * @param {number} radius - Radius (inclusive)
 * @param {number} centerBrightness - Brightness at sphere center (0.0-1.0)
 * @param {number} edgeBrightness - Brightness at sphere edge (0.0-1.0)
 */
export function carveSphereRadialBrightness(target, centerX, centerY, centerZ, radius, centerBrightness, edgeBrightness) {
    const isVolume = typeof target.carve === 'function';
    if (!isVolume) return;  // Only works with VoxelVolume

    const r2 = radius * radius;

    for (let y = centerY - radius; y <= centerY + radius; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            for (let z = centerZ - radius; z <= centerZ + radius; z++) {
                const dx = x - centerX;
                const dy = y - centerY;
                const dz = z - centerZ;
                const d2 = dx * dx + dy * dy + dz * dz;

                if (d2 <= r2) {
                    // Radial interpolation: center to edge
                    const t = Math.sqrt(d2) / radius;
                    const brightness = centerBrightness + t * (edgeBrightness - centerBrightness);
                    target.carve(x, y, z, brightness);
                }
            }
        }
    }
}

// ============================================================================
// CYLINDER OPERATIONS
// ============================================================================

/**
 * Fill a solid vertical cylinder
 * @param {number} centerX - Center X
 * @param {number} baseY - Base Y (inclusive)
 * @param {number} centerZ - Center Z
 * @param {number} radius - Radius
 * @param {number} height - Height (baseY to baseY + height - 1)
 */
export function fillCylinder(target, centerX, baseY, centerZ, radius, height, blockType, state = VoxelState.SOLID) {
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    const r2 = radius * radius;
    
    for (let y = baseY; y < baseY + height; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            for (let z = centerZ - radius; z <= centerZ + radius; z++) {
                const dx = x - centerX;
                const dz = z - centerZ;
                
                if (dx * dx + dz * dz <= r2) {
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
 * Fill a hollow vertical cylinder (tube)
 * @param {number} thickness - Wall thickness
 */
export function strokeCylinder(target, centerX, baseY, centerZ, radius, height, blockType, thickness = 1, state = VoxelState.SOLID) {
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    const outerR2 = radius * radius;
    const innerR2 = (radius - thickness) * (radius - thickness);
    
    for (let y = baseY; y < baseY + height; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            for (let z = centerZ - radius; z <= centerZ + radius; z++) {
                const dx = x - centerX;
                const dz = z - centerZ;
                const d2 = dx * dx + dz * dz;
                
                if (d2 <= outerR2 && d2 > innerR2) {
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
 * Carve a cylindrical region
 */
export function carveCylinder(target, centerX, baseY, centerZ, radius, height) {
    const isVolume = typeof target.carve === 'function';
    const r2 = radius * radius;
    
    for (let y = baseY; y < baseY + height; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            for (let z = centerZ - radius; z <= centerZ + radius; z++) {
                const dx = x - centerX;
                const dz = z - centerZ;
                
                if (dx * dx + dz * dz <= r2) {
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
// DOME OPERATIONS (half-sphere)
// ============================================================================

/**
 * Fill a solid dome (upper half of sphere)
 * @param {number} centerX - Center X
 * @param {number} baseY - Base Y (flat bottom of dome)
 * @param {number} centerZ - Center Z
 * @param {number} radius - Radius
 */
export function fillDome(target, centerX, baseY, centerZ, radius, blockType, state = VoxelState.SOLID) {
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    const r2 = radius * radius;
    
    for (let y = baseY; y <= baseY + radius; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            for (let z = centerZ - radius; z <= centerZ + radius; z++) {
                const dx = x - centerX;
                const dy = y - baseY;
                const dz = z - centerZ;
                
                if (dx * dx + dy * dy + dz * dz <= r2) {
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
 * Fill a hollow dome (shell)
 */
export function strokeDome(target, centerX, baseY, centerZ, radius, blockType, thickness = 1, state = VoxelState.SOLID) {
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    const outerR2 = radius * radius;
    const innerR2 = (radius - thickness) * (radius - thickness);
    
    for (let y = baseY; y <= baseY + radius; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
            for (let z = centerZ - radius; z <= centerZ + radius; z++) {
                const dx = x - centerX;
                const dy = y - baseY;
                const dz = z - centerZ;
                const d2 = dx * dx + dy * dy + dz * dz;
                
                if (d2 <= outerR2 && d2 > innerR2) {
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

// ============================================================================
// LINE OPERATIONS
// ============================================================================

/**
 * Draw a 3D line using Bresenham's algorithm
 * @param {number} x1, y1, z1 - Start point
 * @param {number} x2, y2, z2 - End point
 */
export function line(target, x1, y1, z1, x2, y2, z2, blockType, state = VoxelState.SOLID) {
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const dz = Math.abs(z2 - z1);
    
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    const sz = z1 < z2 ? 1 : -1;
    
    const dm = Math.max(dx, dy, dz);
    let x = x1, y = y1, z = z1;
    
    let ex = dm / 2, ey = dm / 2, ez = dm / 2;
    
    for (let i = 0; i <= dm; i++) {
        if (isVolume) {
            target.set(x, y, z, blockType, state);
        } else {
            target.set(`${x},${y},${z}`, blockType);
        }
        
        ex -= dx;
        if (ex < 0) { ex += dm; x += sx; }
        
        ey -= dy;
        if (ey < 0) { ey += dm; y += sy; }
        
        ez -= dz;
        if (ez < 0) { ez += dm; z += sz; }
    }
}

/**
 * Draw a thick line (line with radius)
 */
export function thickLine(target, x1, y1, z1, x2, y2, z2, radius, blockType, state = VoxelState.SOLID) {
    const isVolume = typeof target.set === 'function' && target.set.length >= 4;
    
    // Get all points along the line
    const points = [];
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const dz = Math.abs(z2 - z1);
    
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    const sz = z1 < z2 ? 1 : -1;
    
    const dm = Math.max(dx, dy, dz);
    let x = x1, y = y1, z = z1;
    let ex = dm / 2, ey = dm / 2, ez = dm / 2;
    
    for (let i = 0; i <= dm; i++) {
        points.push({ x, y, z });
        
        ex -= dx;
        if (ex < 0) { ex += dm; x += sx; }
        
        ey -= dy;
        if (ey < 0) { ey += dm; y += sy; }
        
        ez -= dz;
        if (ez < 0) { ez += dm; z += sz; }
    }
    
    // Place sphere at each point
    const r2 = radius * radius;
    const placed = new Set();
    
    for (const p of points) {
        for (let py = p.y - radius; py <= p.y + radius; py++) {
            for (let px = p.x - radius; px <= p.x + radius; px++) {
                for (let pz = p.z - radius; pz <= p.z + radius; pz++) {
                    const ddx = px - p.x;
                    const ddy = py - p.y;
                    const ddz = pz - p.z;
                    
                    if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) {
                        const key = `${px},${py},${pz}`;
                        if (!placed.has(key)) {
                            placed.add(key);
                            if (isVolume) {
                                target.set(px, py, pz, blockType, state);
                            } else {
                                target.set(key, blockType);
                            }
                        }
                    }
                }
            }
        }
    }
}

// ============================================================================
// PLANE OPERATIONS
// ============================================================================

/**
 * Fill a horizontal plane (floor/ceiling)
 */
export function fillPlaneXZ(target, minX, y, minZ, maxX, maxZ, blockType, state = VoxelState.SOLID) {
    fillBox(target, minX, y, minZ, maxX, y + 1, maxZ, blockType, state);
}

/**
 * Fill a vertical plane along X axis (wall facing Z)
 */
export function fillPlaneXY(target, minX, minY, z, maxX, maxY, blockType, state = VoxelState.SOLID) {
    fillBox(target, minX, minY, z, maxX, maxY, z + 1, blockType, state);
}

/**
 * Fill a vertical plane along Z axis (wall facing X)
 */
export function fillPlaneZY(target, x, minY, minZ, maxY, maxZ, blockType, state = VoxelState.SOLID) {
    fillBox(target, x, minY, minZ, x + 1, maxY, maxZ, blockType, state);
}
/**
 * HeightfieldModifier - Pure functions for modifying heightmap data
 * Used to create flat pads for landmarks with smooth blending to surrounding terrain.
 *
 * All functions operate on heightmap arrays and are designed to work in the web worker.
 * Modifications are applied per-chunk, with deterministic results across chunk boundaries.
 */

const CHUNK_SIZE = 16;
const HEIGHTMAP_SIZE = CHUNK_SIZE + 1; // 17x17 vertices for 16x16 cells

/**
 * Smooth interpolation curve: 3t² - 2t³
 * Maps [0,1] to [0,1] with smooth start and end (zero derivatives at endpoints)
 * @param {number} t - Input value in range [0, 1]
 * @returns {number} Smoothly interpolated value in range [0, 1]
 */
export function smoothstep(t) {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
}

/**
 * Convert world coordinates to heightmap index within a chunk
 * @param {number} worldX - World X coordinate
 * @param {number} worldZ - World Z coordinate
 * @param {number} chunkX - Chunk X index
 * @param {number} chunkZ - Chunk Z index
 * @returns {{localX: number, localZ: number, index: number, inBounds: boolean}}
 */
function worldToHeightmapIndex(worldX, worldZ, chunkX, chunkZ) {
    const chunkWorldX = chunkX * CHUNK_SIZE;
    const chunkWorldZ = chunkZ * CHUNK_SIZE;

    const localX = worldX - chunkWorldX;
    const localZ = worldZ - chunkWorldZ;

    const inBounds = localX >= 0 && localX < HEIGHTMAP_SIZE &&
                     localZ >= 0 && localZ < HEIGHTMAP_SIZE;

    const index = localZ * HEIGHTMAP_SIZE + localX;

    return { localX, localZ, index, inBounds };
}

/**
 * Flatten a rectangular region to a constant height
 * @param {Float32Array} heightmap - The heightmap array to modify
 * @param {number} chunkX - Chunk X index
 * @param {number} chunkZ - Chunk Z index
 * @param {number} centerX - World X center of region
 * @param {number} centerZ - World Z center of region
 * @param {number} width - Width of region (X axis)
 * @param {number} depth - Depth of region (Z axis)
 * @param {number} targetY - Target height to flatten to
 */
export function flattenRegion(heightmap, chunkX, chunkZ, centerX, centerZ, width, depth, targetY) {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;

    const minX = Math.floor(centerX - halfWidth);
    const maxX = Math.ceil(centerX + halfWidth);
    const minZ = Math.floor(centerZ - halfDepth);
    const maxZ = Math.ceil(centerZ + halfDepth);

    for (let worldZ = minZ; worldZ <= maxZ; worldZ++) {
        for (let worldX = minX; worldX <= maxX; worldX++) {
            const { index, inBounds } = worldToHeightmapIndex(worldX, worldZ, chunkX, chunkZ);
            if (inBounds) {
                heightmap[index] = targetY;
            }
        }
    }
}

/**
 * Blend terrain from targetY at inner radius to original height at outer radius
 * Creates smooth transitions around flattened areas
 * @param {Float32Array} heightmap - The heightmap array to modify
 * @param {number} chunkX - Chunk X index
 * @param {number} chunkZ - Chunk Z index
 * @param {number} centerX - World X center
 * @param {number} centerZ - World Z center
 * @param {number} innerRadius - Radius at which height equals targetY
 * @param {number} outerRadius - Radius at which height equals original
 * @param {number} targetY - Target height at inner radius
 */
export function blendToTarget(heightmap, chunkX, chunkZ, centerX, centerZ, innerRadius, outerRadius, targetY) {
    // Only process the annular region between inner and outer radius
    const minX = Math.floor(centerX - outerRadius);
    const maxX = Math.ceil(centerX + outerRadius);
    const minZ = Math.floor(centerZ - outerRadius);
    const maxZ = Math.ceil(centerZ + outerRadius);

    for (let worldZ = minZ; worldZ <= maxZ; worldZ++) {
        for (let worldX = minX; worldX <= maxX; worldX++) {
            const { index, inBounds } = worldToHeightmapIndex(worldX, worldZ, chunkX, chunkZ);
            if (!inBounds) continue;

            const dx = worldX - centerX;
            const dz = worldZ - centerZ;
            const dist = Math.sqrt(dx * dx + dz * dz);

            // Skip if inside inner radius (handled by flatten) or outside outer radius
            if (dist <= innerRadius || dist >= outerRadius) continue;

            // Normalized distance: 0 at inner, 1 at outer
            const t = (dist - innerRadius) / (outerRadius - innerRadius);
            const blend = smoothstep(t);

            // Blend from targetY (at t=0) to original (at t=1)
            const originalY = heightmap[index];
            heightmap[index] = targetY + (originalY - targetY) * blend;
        }
    }
}

/**
 * Raise a rectangular region by a delta amount
 * @param {Float32Array} heightmap - The heightmap array to modify
 * @param {number} chunkX - Chunk X index
 * @param {number} chunkZ - Chunk Z index
 * @param {number} centerX - World X center
 * @param {number} centerZ - World Z center
 * @param {number} width - Width of region
 * @param {number} depth - Depth of region
 * @param {number} deltaY - Amount to raise (positive = up)
 */
export function raiseRegion(heightmap, chunkX, chunkZ, centerX, centerZ, width, depth, deltaY) {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;

    const minX = Math.floor(centerX - halfWidth);
    const maxX = Math.ceil(centerX + halfWidth);
    const minZ = Math.floor(centerZ - halfDepth);
    const maxZ = Math.ceil(centerZ + halfDepth);

    for (let worldZ = minZ; worldZ <= maxZ; worldZ++) {
        for (let worldX = minX; worldX <= maxX; worldX++) {
            const { index, inBounds } = worldToHeightmapIndex(worldX, worldZ, chunkX, chunkZ);
            if (inBounds) {
                heightmap[index] += deltaY;
            }
        }
    }
}

/**
 * Lower a rectangular region by a delta amount
 * @param {Float32Array} heightmap - The heightmap array to modify
 * @param {number} chunkX - Chunk X index
 * @param {number} chunkZ - Chunk Z index
 * @param {number} centerX - World X center
 * @param {number} centerZ - World Z center
 * @param {number} width - Width of region
 * @param {number} depth - Depth of region
 * @param {number} deltaY - Amount to lower (positive = down)
 */
export function lowerRegion(heightmap, chunkX, chunkZ, centerX, centerZ, width, depth, deltaY) {
    raiseRegion(heightmap, chunkX, chunkZ, centerX, centerZ, width, depth, -deltaY);
}

/**
 * Apply smoothing/averaging pass to reduce harsh transitions
 * @param {Float32Array} heightmap - The heightmap array to modify
 * @param {number} chunkX - Chunk X index
 * @param {number} chunkZ - Chunk Z index
 * @param {number} centerX - World X center
 * @param {number} centerZ - World Z center
 * @param {number} radius - Radius of area to smooth
 * @param {number} iterations - Number of smoothing passes
 */
export function smooth(heightmap, chunkX, chunkZ, centerX, centerZ, radius, iterations = 1) {
    const minX = Math.floor(centerX - radius);
    const maxX = Math.ceil(centerX + radius);
    const minZ = Math.floor(centerZ - radius);
    const maxZ = Math.ceil(centerZ + radius);

    for (let iter = 0; iter < iterations; iter++) {
        // Create a copy to read from while writing
        const copy = new Float32Array(heightmap);

        for (let worldZ = minZ; worldZ <= maxZ; worldZ++) {
            for (let worldX = minX; worldX <= maxX; worldX++) {
                const { localX, localZ, index, inBounds } = worldToHeightmapIndex(worldX, worldZ, chunkX, chunkZ);
                if (!inBounds) continue;

                // Skip edge vertices to preserve chunk boundaries
                if (localX === 0 || localX === HEIGHTMAP_SIZE - 1 ||
                    localZ === 0 || localZ === HEIGHTMAP_SIZE - 1) continue;

                // Check if within circular radius
                const dx = worldX - centerX;
                const dz = worldZ - centerZ;
                if (dx * dx + dz * dz > radius * radius) continue;

                // Average with 4 neighbors
                const neighbors = [
                    copy[index - 1],                    // left
                    copy[index + 1],                    // right
                    copy[index - HEIGHTMAP_SIZE],       // up
                    copy[index + HEIGHTMAP_SIZE]        // down
                ];

                const avg = (copy[index] + neighbors[0] + neighbors[1] + neighbors[2] + neighbors[3]) / 5;
                heightmap[index] = avg;
            }
        }
    }
}

/**
 * Apply a heightfield modification based on its type
 * @param {Float32Array} heightmap - The heightmap array to modify
 * @param {number} chunkX - Chunk X index
 * @param {number} chunkZ - Chunk Z index
 * @param {Object} modification - The modification specification
 */
export function applyHeightfieldModification(heightmap, chunkX, chunkZ, modification) {
    switch (modification.type) {
        case 'flatten':
            flattenRegion(
                heightmap, chunkX, chunkZ,
                modification.centerX, modification.centerZ,
                modification.width, modification.depth,
                modification.targetY
            );
            break;

        case 'blend':
            blendToTarget(
                heightmap, chunkX, chunkZ,
                modification.centerX, modification.centerZ,
                modification.innerRadius, modification.outerRadius,
                modification.targetY
            );
            break;

        case 'raise':
            raiseRegion(
                heightmap, chunkX, chunkZ,
                modification.centerX, modification.centerZ,
                modification.width, modification.depth,
                modification.deltaY
            );
            break;

        case 'lower':
            lowerRegion(
                heightmap, chunkX, chunkZ,
                modification.centerX, modification.centerZ,
                modification.width, modification.depth,
                modification.deltaY
            );
            break;

        case 'smooth':
            smooth(
                heightmap, chunkX, chunkZ,
                modification.centerX, modification.centerZ,
                modification.radius,
                modification.iterations || 1
            );
            break;

        default:
            console.warn(`Unknown heightfield modification type: ${modification.type}`);
    }
}

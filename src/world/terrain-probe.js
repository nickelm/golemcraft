/**
 * TerrainProbe - Terrain query utility for continuous coordinates
 *
 * Works in both worker and main thread contexts by accepting
 * a terrain provider that implements the required interface.
 *
 * Provider interface:
 * - getContinuousHeight(x, z) -> float (optional, falls back to interpolation)
 * - getHeight(x, z) -> int (floored height)
 * - getBlockType(x, y, z) -> string|null (optional, for voxel queries)
 */
export class TerrainProbe {
    /**
     * @param {Object} provider - Terrain data provider
     */
    constructor(provider) {
        this.provider = provider;

        // Configuration
        this.gradientEpsilon = 0.25;  // Step size for gradient calculation
        this.rayMarchStep = 0.5;      // Step size for depth probing
        this.maxRayDistance = 64;     // Maximum ray march distance
    }

    /**
     * Sample interpolated height at continuous world coordinates
     * @param {number} x - World X coordinate (float)
     * @param {number} z - World Z coordinate (float)
     * @returns {number} Interpolated terrain height
     */
    sampleHeight(x, z) {
        // Use provider's continuous height if available
        if (this.provider.getContinuousHeight) {
            return this.provider.getContinuousHeight(x, z);
        }
        // Fallback: manual bilinear interpolation
        return this._bilinearInterpolate(x, z);
    }

    /**
     * Bilinear interpolation of height using 4 corner samples
     * @private
     */
    _bilinearInterpolate(x, z) {
        const x0 = Math.floor(x);
        const z0 = Math.floor(z);
        const fx = x - x0;
        const fz = z - z0;

        const h00 = this.provider.getHeight(x0, z0);
        const h10 = this.provider.getHeight(x0 + 1, z0);
        const h01 = this.provider.getHeight(x0, z0 + 1);
        const h11 = this.provider.getHeight(x0 + 1, z0 + 1);

        const h0 = h00 * (1 - fx) + h10 * fx;
        const h1 = h01 * (1 - fx) + h11 * fx;
        return h0 * (1 - fz) + h1 * fz;
    }

    /**
     * Sample terrain gradient (slope direction and steepness)
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {{ dx: number, dz: number, magnitude: number }}
     *   dx, dz: Normalized direction of steepest descent
     *   magnitude: Slope steepness (rise over run)
     */
    sampleGradient(x, z) {
        const eps = this.gradientEpsilon;

        // Central difference for better accuracy
        const hLeft = this.sampleHeight(x - eps, z);
        const hRight = this.sampleHeight(x + eps, z);
        const hBack = this.sampleHeight(x, z - eps);
        const hFront = this.sampleHeight(x, z + eps);

        // Gradient = direction of steepest ascent
        const gradX = (hRight - hLeft) / (2 * eps);
        const gradZ = (hFront - hBack) / (2 * eps);

        const magnitude = Math.sqrt(gradX * gradX + gradZ * gradZ);

        // Return descent direction (negative gradient)
        if (magnitude < 0.001) {
            return { dx: 0, dz: 0, magnitude: 0 };
        }

        return {
            dx: -gradX / magnitude,  // Normalize and invert for descent
            dz: -gradZ / magnitude,
            magnitude: magnitude
        };
    }

    /**
     * Sample terrain surface normal
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {{ x: number, y: number, z: number }} Unit normal vector
     */
    sampleNormal(x, z) {
        const eps = this.gradientEpsilon;

        const hLeft = this.sampleHeight(x - eps, z);
        const hRight = this.sampleHeight(x + eps, z);
        const hBack = this.sampleHeight(x, z - eps);
        const hFront = this.sampleHeight(x, z + eps);

        // Compute partial derivatives
        const dHdx = (hRight - hLeft) / (2 * eps);
        const dHdz = (hFront - hBack) / (2 * eps);

        // Normal = cross(tangentZ, tangentX) = (-dHdx, 1, -dHdz)
        // tangentX = (1, dHdx, 0)
        // tangentZ = (0, dHdz, 1)
        let nx = -dHdx;
        let ny = 1.0;
        let nz = -dHdz;

        // Normalize
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        return {
            x: nx / len,
            y: ny / len,
            z: nz / len
        };
    }

    /**
     * Ray march into terrain to find distance until exiting solid
     * @param {number} x - Start X position
     * @param {number} y - Start Y position
     * @param {number} z - Start Z position
     * @param {number} dirX - Ray direction X
     * @param {number} dirY - Ray direction Y
     * @param {number} dirZ - Ray direction Z
     * @returns {number} Distance traveled before exiting solid, or -1 if never exits
     */
    probeDepth(x, y, z, dirX, dirY, dirZ) {
        // Normalize direction
        const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
        if (len < 0.001) return -1;

        const dx = dirX / len;
        const dy = dirY / len;
        const dz = dirZ / len;

        let distance = 0;
        let px = x, py = y, pz = z;

        // Must start inside terrain
        if (!this.isInsideTerrain(px, py, pz)) {
            return 0;  // Already outside
        }

        while (distance < this.maxRayDistance) {
            px += dx * this.rayMarchStep;
            py += dy * this.rayMarchStep;
            pz += dz * this.rayMarchStep;
            distance += this.rayMarchStep;

            if (!this.isInsideTerrain(px, py, pz)) {
                return distance;  // Exited terrain
            }
        }

        return -1;  // Never exited within max distance
    }

    /**
     * Walk vertically to find terrain surface
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @param {number} startY - Starting Y position
     * @param {number} direction - 1 for up, -1 for down
     * @returns {number|null} Y of surface hit, or null if none found
     */
    findSurface(x, z, startY, direction = -1) {
        const MAX_SCAN = 64;
        let y = startY;
        let wasInside = this.isInsideTerrain(x, y, z);

        for (let i = 0; i < MAX_SCAN; i++) {
            y += direction;
            const isInside = this.isInsideTerrain(x, y, z);

            // Detect transition
            if (direction > 0) {
                // Moving up: looking for inside -> outside
                if (wasInside && !isInside) {
                    return y - direction;  // Return last solid position
                }
            } else {
                // Moving down: looking for outside -> inside
                if (!wasInside && isInside) {
                    return y;  // Return first solid position
                }
            }

            wasInside = isInside;
        }

        return null;  // No surface found
    }

    /**
     * Check if position is inside terrain (below heightfield surface)
     * @param {number} x - World X coordinate
     * @param {number} y - World Y coordinate
     * @param {number} z - World Z coordinate
     * @returns {boolean} True if below heightfield surface
     */
    isInsideTerrain(x, y, z) {
        const surfaceHeight = this.sampleHeight(x, z);
        return y <= surfaceHeight;
    }
}

/**
 * Create a TerrainProbe for main thread use with ChunkBlockCache
 * @param {ChunkBlockCache} blockCache - The chunk block cache instance
 * @returns {TerrainProbe} Configured terrain probe
 */
export function createMainThreadTerrainProbe(blockCache) {
    const adapter = {
        getContinuousHeight(x, z) {
            return blockCache.getGroundHeight(x, z);
        },
        getHeight(x, z) {
            const chunk = blockCache.getChunkAt(x, z);
            if (!chunk) return 0;
            // Use integer height from heightmap
            const localX = Math.floor(x) - chunk.worldMinX;
            const localZ = Math.floor(z) - chunk.worldMinZ;
            return Math.floor(chunk.getInterpolatedHeight(localX, localZ));
        },
        getBlockType(x, y, z) {
            return blockCache.getBlockType(Math.floor(x), Math.floor(y), Math.floor(z));
        }
    };
    return new TerrainProbe(adapter);
}

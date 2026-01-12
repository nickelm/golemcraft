/**
 * Distance Field Infrastructure
 *
 * GPU-friendly distance field textures for O(1) spatial queries during
 * procedural world generation. Replaces expensive per-query polyline
 * iteration with pre-computed texture lookups.
 *
 * All functions are pure and worker-compatible (no global state).
 *
 * Texture Layout Conventions:
 * - terrain_sdf: R=ocean dist (signed), G=mountain dist, B=lake dist (signed), A=unused
 * - hydro_sdf: R=river dist, G=river width, B=flow direction, A=water depth
 * - infra_sdf: R=road dist, G=road type, B=settlement dist, A=unused
 * - climate_tex: R=temperature, G=humidity, B=erosion, A=unused
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Default texture size (512x512 texels)
 * At 4 blocks per texel, covers 2048x2048 blocks
 */
export const DEFAULT_SDF_SIZE = 512;

/**
 * Default resolution: blocks per texel
 */
export const DEFAULT_BLOCKS_PER_TEXEL = 4;

/**
 * Channel layout conventions for documentation and tooling
 */
export const CHANNEL_LAYOUTS = {
    terrain: {
        R: 'oceanDistance',      // Distance to ocean (negative = in ocean)
        G: 'mountainDistance',   // Distance to mountain spine
        B: 'lakeDistance',       // Distance to lake (negative = in lake)
        A: 'baseElevation'       // Pre-computed base elevation
    },
    hydro: {
        R: 'riverDistance',      // Distance to nearest river centerline
        G: 'riverWidth',         // Interpolated river width at nearest point
        B: 'flowDirection',      // Flow direction encoded as angle [0,1] = [0, 2PI]
        A: 'waterDepth'          // Expected water depth (for river bed carving)
    },
    infra: {
        R: 'roadDistance',       // Distance to nearest road
        G: 'roadType',           // Road type (0=path, 0.5=road, 1=highway)
        B: 'settlementDistance', // Distance to nearest settlement center
        A: 'unused'
    },
    climate: {
        R: 'temperature',        // Climate temperature [0,1]
        G: 'humidity',           // Climate humidity [0,1]
        B: 'erosion',            // Erosion factor [0,1]
        A: 'unused'
    }
};

// =============================================================================
// Coordinate Mapping
// =============================================================================

/**
 * Convert world coordinates to texel coordinates
 * Handles arbitrary world bounds (not necessarily centered at origin)
 *
 * @param {number} worldX - World X coordinate
 * @param {number} worldZ - World Z coordinate
 * @param {Object} bounds - World bounds { min, max } or { minX, maxX, minZ, maxZ }
 * @param {number} texSize - Texture dimension (assumes square)
 * @returns {{ u: number, v: number }} Texel coordinates [0, texSize)
 */
export function worldToTexel(worldX, worldZ, bounds, texSize = DEFAULT_SDF_SIZE) {
    const minX = bounds.minX ?? bounds.min;
    const maxX = bounds.maxX ?? bounds.max;
    const minZ = bounds.minZ ?? bounds.min;
    const maxZ = bounds.maxZ ?? bounds.max;

    const u = ((worldX - minX) / (maxX - minX)) * texSize;
    const v = ((worldZ - minZ) / (maxZ - minZ)) * texSize;

    return { u, v };
}

/**
 * Convert texel coordinates to world coordinates
 *
 * @param {number} u - Texel U coordinate
 * @param {number} v - Texel V coordinate
 * @param {Object} bounds - World bounds
 * @param {number} texSize - Texture dimension
 * @returns {{ x: number, z: number }} World coordinates
 */
export function texelToWorld(u, v, bounds, texSize = DEFAULT_SDF_SIZE) {
    const minX = bounds.minX ?? bounds.min;
    const maxX = bounds.maxX ?? bounds.max;
    const minZ = bounds.minZ ?? bounds.min;
    const maxZ = bounds.maxZ ?? bounds.max;

    const x = minX + (u / texSize) * (maxX - minX);
    const z = minZ + (v / texSize) * (maxZ - minZ);

    return { x, z };
}

/**
 * Calculate world coverage for a texture
 *
 * @param {Object} bounds - World bounds
 * @param {number} texSize - Texture dimension
 * @returns {{ blocksPerTexel: number, totalBlocks: number }}
 */
export function getTextureCoverage(bounds, texSize = DEFAULT_SDF_SIZE) {
    const minX = bounds.minX ?? bounds.min;
    const maxX = bounds.maxX ?? bounds.max;
    const worldWidth = maxX - minX;

    return {
        blocksPerTexel: worldWidth / texSize,
        totalBlocks: worldWidth
    };
}

// =============================================================================
// SDFTexture Class
// =============================================================================

/**
 * Distance field texture with multi-channel support
 * Pure data structure - no Three.js dependencies for worker compatibility
 */
export class SDFTexture {
    /**
     * @param {number} width - Texture width in texels
     * @param {number} height - Texture height in texels
     * @param {number} channels - Number of channels (1-4)
     * @param {Object} bounds - World bounds this texture covers
     */
    constructor(width, height, channels, bounds) {
        this.width = width;
        this.height = height;
        this.channels = channels;
        this.bounds = {
            minX: bounds.minX ?? bounds.min,
            maxX: bounds.maxX ?? bounds.max,
            minZ: bounds.minZ ?? bounds.min,
            maxZ: bounds.maxZ ?? bounds.max
        };

        // Single interleaved Float32Array for all channels
        // Layout: [R0, G0, B0, A0, R1, G1, B1, A1, ...]
        this.data = new Float32Array(width * height * channels);

        // Initialize to max distance (Infinity for distance fields)
        this.data.fill(Infinity);
    }

    /**
     * Get array index for a texel and channel
     * @param {number} u - Texel U (column)
     * @param {number} v - Texel V (row)
     * @param {number} channel - Channel index (0-3)
     * @returns {number} Array index
     */
    getIndex(u, v, channel = 0) {
        const clampedU = Math.max(0, Math.min(this.width - 1, Math.floor(u)));
        const clampedV = Math.max(0, Math.min(this.height - 1, Math.floor(v)));
        return (clampedV * this.width + clampedU) * this.channels + channel;
    }

    /**
     * Set value at texel
     * @param {number} u - Texel U
     * @param {number} v - Texel V
     * @param {number} channel - Channel index
     * @param {number} value - Value to set
     */
    set(u, v, channel, value) {
        this.data[this.getIndex(u, v, channel)] = value;
    }

    /**
     * Get value at texel (no interpolation)
     * @param {number} u - Texel U
     * @param {number} v - Texel V
     * @param {number} channel - Channel index
     * @returns {number} Value at texel
     */
    get(u, v, channel = 0) {
        return this.data[this.getIndex(u, v, channel)];
    }

    /**
     * Sample with bilinear interpolation at world coordinates
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {number} channel - Channel to sample
     * @returns {number} Interpolated value
     */
    sampleBilinear(worldX, worldZ, channel = 0) {
        const { u, v } = worldToTexel(worldX, worldZ, this.bounds, this.width);

        // Get integer and fractional parts
        const u0 = Math.floor(u);
        const v0 = Math.floor(v);
        const fu = u - u0;
        const fv = v - v0;

        // Sample 4 corners (get handles clamping)
        const c00 = this.get(u0, v0, channel);
        const c10 = this.get(u0 + 1, v0, channel);
        const c01 = this.get(u0, v0 + 1, channel);
        const c11 = this.get(u0 + 1, v0 + 1, channel);

        // Bilinear interpolation
        const c0 = c00 * (1 - fu) + c10 * fu;
        const c1 = c01 * (1 - fu) + c11 * fu;
        return c0 * (1 - fv) + c1 * fv;
    }

    /**
     * Sample all channels at world coordinates
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number[]} Array of channel values
     */
    sampleAllChannels(worldX, worldZ) {
        const result = [];
        for (let c = 0; c < this.channels; c++) {
            result.push(this.sampleBilinear(worldX, worldZ, c));
        }
        return result;
    }

    /**
     * Fill entire channel with a value
     * @param {number} channel - Channel index
     * @param {number} value - Value to fill
     */
    fillChannel(channel, value) {
        for (let v = 0; v < this.height; v++) {
            for (let u = 0; u < this.width; u++) {
                this.set(u, v, channel, value);
            }
        }
    }

    /**
     * Get raw data for transfer to GPU or another thread
     * @returns {{ data: Float32Array, width: number, height: number, channels: number, bounds: Object }}
     */
    getTransferableData() {
        return {
            data: this.data,
            width: this.width,
            height: this.height,
            channels: this.channels,
            bounds: { ...this.bounds }
        };
    }

    /**
     * Create from transferred data
     * @param {Object} transferData - Data from getTransferableData()
     * @returns {SDFTexture}
     */
    static fromTransferableData(transferData) {
        const tex = new SDFTexture(
            transferData.width,
            transferData.height,
            transferData.channels,
            transferData.bounds
        );
        tex.data = transferData.data;
        return tex;
    }
}

// =============================================================================
// Geometry Utilities
// =============================================================================

/**
 * Project point onto line segment
 * Returns the projected point and interpolation factor t
 *
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {number} x1 - Segment start X
 * @param {number} z1 - Segment start Z
 * @param {number} x2 - Segment end X
 * @param {number} z2 - Segment end Z
 * @returns {{ x: number, z: number, t: number }} Projected point and t (0-1 along segment)
 */
export function projectOntoSegment(px, pz, x1, z1, x2, z2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lengthSq = dx * dx + dz * dz;

    // Degenerate segment (single point)
    if (lengthSq === 0) {
        return { x: x1, z: z1, t: 0 };
    }

    // Calculate projection parameter t
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lengthSq));

    return {
        x: x1 + t * dx,
        z: z1 + t * dz,
        t
    };
}

/**
 * Calculate shortest distance from point to line segment
 *
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {number} x1 - Segment start X
 * @param {number} z1 - Segment start Z
 * @param {number} x2 - Segment end X
 * @param {number} z2 - Segment end Z
 * @returns {number} Distance to segment
 */
export function distanceToSegment(px, pz, x1, z1, x2, z2) {
    const projection = projectOntoSegment(px, pz, x1, z1, x2, z2);
    const dx = px - projection.x;
    const dz = pz - projection.z;
    return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Calculate distance from point to polyline
 *
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {Object|Array} polyline - Object with .path array or array of {x, z} points
 * @returns {number} Minimum distance to polyline
 */
export function distanceToPolyline(px, pz, polyline) {
    const path = polyline.path || polyline;
    if (path.length < 2) {
        if (path.length === 1) {
            const dx = px - path[0].x;
            const dz = pz - path[0].z;
            return Math.sqrt(dx * dx + dz * dz);
        }
        return Infinity;
    }

    let minDist = Infinity;

    for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i];
        const p2 = path[i + 1];
        const dist = distanceToSegment(px, pz, p1.x, p1.z, p2.x, p2.z);
        if (dist < minDist) {
            minDist = dist;
        }
    }

    return minDist;
}

/**
 * Get nearest point on polyline with segment info
 *
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {Object|Array} polyline - Polyline object or path array
 * @returns {{ distance: number, segmentIndex: number, t: number, point: {x: number, z: number} }}
 */
export function getNearestPointOnPolyline(px, pz, polyline) {
    const path = polyline.path || polyline;

    if (path.length === 0) {
        return { distance: Infinity, segmentIndex: -1, t: 0, point: { x: px, z: pz } };
    }

    if (path.length === 1) {
        const dx = px - path[0].x;
        const dz = pz - path[0].z;
        return {
            distance: Math.sqrt(dx * dx + dz * dz),
            segmentIndex: 0,
            t: 0,
            point: { x: path[0].x, z: path[0].z }
        };
    }

    let minDist = Infinity;
    let nearestSegment = 0;
    let nearestT = 0;
    let nearestPoint = { x: path[0].x, z: path[0].z };

    for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i];
        const p2 = path[i + 1];
        const proj = projectOntoSegment(px, pz, p1.x, p1.z, p2.x, p2.z);
        const dx = px - proj.x;
        const dz = pz - proj.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < minDist) {
            minDist = dist;
            nearestSegment = i;
            nearestT = proj.t;
            nearestPoint = { x: proj.x, z: proj.z };
        }
    }

    return {
        distance: minDist,
        segmentIndex: nearestSegment,
        t: nearestT,
        point: nearestPoint
    };
}

/**
 * Interpolate property at position along polyline
 * Follows LinearFeature.getWidthAtT() pattern
 *
 * @param {Object} polyline - Polyline with properties
 * @param {number} segmentIndex - Segment index
 * @param {number} t - Interpolation factor (0-1 along segment)
 * @param {string} property - Property name (e.g., 'width')
 * @returns {number} Interpolated property value
 */
export function interpolatePropertyAtT(polyline, segmentIndex, t, property) {
    const path = polyline.path || polyline;
    const props = polyline.properties || {};

    // Check for array of per-point values (e.g., 'widths' for 'width')
    const propArray = props[property + 's'] || null;
    const defaultValue = props[property] ?? 0;

    if (!propArray) {
        return defaultValue;
    }

    const p1Value = propArray[segmentIndex] ?? defaultValue;
    const p2Index = Math.min(segmentIndex + 1, path.length - 1);
    const p2Value = propArray[p2Index] ?? defaultValue;

    return p1Value + (p2Value - p1Value) * t;
}

/**
 * 2D cross product (determines which side of line point is on)
 */
function crossProduct2D(ax, az, bx, bz) {
    return ax * bz - az * bx;
}

/**
 * Point-in-polygon test using winding number algorithm
 *
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {Array} vertices - Array of {x, z} polygon vertices
 * @returns {boolean} True if point is inside polygon
 */
export function isPointInPolygon(px, pz, vertices) {
    let winding = 0;
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % n];

        if (v1.z <= pz) {
            if (v2.z > pz) {
                // Upward crossing
                if (crossProduct2D(v2.x - v1.x, v2.z - v1.z, px - v1.x, pz - v1.z) > 0) {
                    winding++;
                }
            }
        } else {
            if (v2.z <= pz) {
                // Downward crossing
                if (crossProduct2D(v2.x - v1.x, v2.z - v1.z, px - v1.x, pz - v1.z) < 0) {
                    winding--;
                }
            }
        }
    }

    return winding !== 0;
}

/**
 * Calculate signed distance to polygon
 * Negative inside, positive outside
 *
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {Object|Array} polygon - Polygon object with .vertices or array of vertices
 * @returns {number} Signed distance (negative = inside)
 */
export function signedDistanceToPolygon(px, pz, polygon) {
    const vertices = polygon.vertices || polygon;
    const n = vertices.length;

    if (n < 3) return Infinity;

    // Calculate unsigned distance to polygon boundary
    let minDist = Infinity;
    for (let i = 0; i < n; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % n];
        const dist = distanceToSegment(px, pz, v1.x, v1.z, v2.x, v2.z);
        if (dist < minDist) {
            minDist = dist;
        }
    }

    // Determine if point is inside using winding number
    const inside = isPointInPolygon(px, pz, vertices);

    return inside ? -minDist : minDist;
}

// =============================================================================
// Distance Field Generation
// =============================================================================

/**
 * Generate distance field from polylines
 *
 * @param {Array} polylines - Array of polyline objects with .path (array of {x, z})
 * @param {SDFTexture} texture - Target texture
 * @param {number} channel - Target channel
 * @param {Object} options - Generation options
 * @param {number} [options.maxDistance=Infinity] - Maximum distance to compute (optimization)
 */
export function generatePolylineDF(polylines, texture, channel, options = {}) {
    const { maxDistance = Infinity } = options;
    const { width, height, bounds } = texture;

    // For each texel
    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            // Convert to world coordinates (center of texel)
            const world = texelToWorld(u + 0.5, v + 0.5, bounds, width);

            // Find minimum distance to any polyline
            let minDist = Infinity;

            for (const polyline of polylines) {
                const dist = distanceToPolyline(world.x, world.z, polyline);
                if (dist < minDist) {
                    minDist = dist;
                }
            }

            // Clamp to max distance for optimization
            minDist = Math.min(minDist, maxDistance);

            texture.set(u, v, channel, minDist);
        }
    }
}

/**
 * Generate property channel from polylines (e.g., river width)
 * Stores the interpolated property value at the nearest polyline point
 *
 * @param {Array} polylines - Polylines with per-point properties
 * @param {SDFTexture} texture - Target texture
 * @param {number} channel - Target channel
 * @param {string} property - Property name to interpolate (e.g., 'width')
 * @param {number} maxDistance - Only store property within this distance (default 100)
 */
export function generatePropertyChannel(polylines, texture, channel, property, maxDistance = 100) {
    const { width, height, bounds } = texture;

    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            const world = texelToWorld(u + 0.5, v + 0.5, bounds, width);

            let minDist = Infinity;
            let nearestProperty = 0;

            for (const polyline of polylines) {
                const result = getNearestPointOnPolyline(world.x, world.z, polyline);
                if (result.distance < minDist) {
                    minDist = result.distance;
                    nearestProperty = interpolatePropertyAtT(
                        polyline,
                        result.segmentIndex,
                        result.t,
                        property
                    );
                }
            }

            // Store property value if within range, otherwise 0
            const value = minDist <= maxDistance ? nearestProperty : 0;
            texture.set(u, v, channel, value);
        }
    }
}

/**
 * Generate signed distance field from polygons
 * Negative values inside polygon, positive outside
 *
 * @param {Array} polygons - Array of polygon objects with .vertices (array of {x, z})
 * @param {SDFTexture} texture - Target texture
 * @param {number} channel - Target channel
 */
export function generatePolygonSDF(polygons, texture, channel) {
    const { width, height, bounds } = texture;

    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            const world = texelToWorld(u + 0.5, v + 0.5, bounds, width);

            let minSignedDist = Infinity;

            for (const polygon of polygons) {
                const signedDist = signedDistanceToPolygon(world.x, world.z, polygon);
                // Keep the one with smallest absolute value (nearest boundary)
                if (Math.abs(signedDist) < Math.abs(minSignedDist)) {
                    minSignedDist = signedDist;
                }
            }

            texture.set(u, v, channel, minSignedDist);
        }
    }
}

/**
 * Generate flow direction channel from polylines with elevation data
 * Encodes flow direction as angle [0, 1] where 0 = north, 0.25 = east, etc.
 *
 * @param {Array} polylines - Polylines with elevation data
 * @param {SDFTexture} texture - Target texture
 * @param {number} channel - Target channel
 * @param {number} maxDistance - Only store direction within this distance
 */
export function generateFlowDirectionChannel(polylines, texture, channel, maxDistance = 100) {
    const { width, height, bounds } = texture;

    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            const world = texelToWorld(u + 0.5, v + 0.5, bounds, width);

            let minDist = Infinity;
            let flowAngle = 0;

            for (const polyline of polylines) {
                const result = getNearestPointOnPolyline(world.x, world.z, polyline);
                if (result.distance < minDist) {
                    minDist = result.distance;

                    // Calculate flow direction from segment
                    const path = polyline.path || polyline;
                    if (result.segmentIndex < path.length - 1) {
                        const p1 = path[result.segmentIndex];
                        const p2 = path[result.segmentIndex + 1];
                        const dx = p2.x - p1.x;
                        const dz = p2.z - p1.z;
                        // Normalize to [0, 1] where 0 = north (+Z), 0.25 = east (+X)
                        flowAngle = (Math.atan2(dx, dz) / (2 * Math.PI) + 1) % 1;
                    }
                }
            }

            const value = minDist <= maxDistance ? flowAngle : 0;
            texture.set(u, v, channel, value);
        }
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create hydrology SDF texture from river features
 * Channel R: river distance, G: river width, B: flow direction, A: water depth
 *
 * @param {Object} bounds - World bounds { min, max } or { minX, maxX, minZ, maxZ }
 * @param {Array} rivers - Array of river features (LinearFeature or similar)
 * @param {Object} options - Options
 * @param {number} [options.size=512] - Texture size
 * @param {number} [options.maxDistance=200] - Max distance to compute
 * @returns {SDFTexture}
 */
export function createHydroSDF(bounds, rivers, options = {}) {
    const { size = DEFAULT_SDF_SIZE, maxDistance = 200 } = options;
    const texture = new SDFTexture(size, size, 4, bounds);

    if (!rivers || rivers.length === 0) {
        // Return empty texture (all Infinity for distances, 0 for properties)
        texture.fillChannel(1, 0); // width
        texture.fillChannel(2, 0); // flow direction
        texture.fillChannel(3, 0); // water depth
        return texture;
    }

    // Convert river features to polyline format
    const polylines = rivers.map(river => ({
        path: river.path,
        properties: {
            width: river.properties?.width ?? 2,
            widths: river.properties?.widths,
            elevations: river.elevations
        }
    }));

    // Channel 0 (R): River distance
    generatePolylineDF(polylines, texture, 0, { maxDistance });

    // Channel 1 (G): River width
    generatePropertyChannel(polylines, texture, 1, 'width', maxDistance);

    // Channel 2 (B): Flow direction
    generateFlowDirectionChannel(polylines, texture, 2, maxDistance);

    // Channel 3 (A): Water depth (derived from width - simple approximation)
    // Depth ~ width / 4, normalized to [0, 1] with max depth of 10 blocks
    const { width, height } = texture;
    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            const riverWidth = texture.get(u, v, 1);
            const depth = Math.min(1, (riverWidth / 4) / 10);
            texture.set(u, v, 3, depth);
        }
    }

    return texture;
}

/**
 * Create terrain SDF from continental features
 * Channel R: ocean distance (signed), G: mountain distance, B: lake distance (signed), A: unused
 *
 * @param {Object} bounds - World bounds
 * @param {Object} options - Options
 * @param {number} [options.size=512] - Texture size
 * @param {Array} [options.oceanPolygons=[]] - Ocean/coastline polygons
 * @param {Array} [options.mountainSpines=[]] - Mountain spine polylines
 * @param {Array} [options.lakes=[]] - Lake polygons
 * @returns {SDFTexture}
 */
export function createTerrainSDF(bounds, options = {}) {
    const {
        size = DEFAULT_SDF_SIZE,
        oceanPolygons = [],
        mountainSpines = [],
        lakes = []
    } = options;

    const texture = new SDFTexture(size, size, 4, bounds);

    // Initialize unused channel
    texture.fillChannel(3, 0);

    // Channel 0 (R): Ocean distance (signed - negative in ocean)
    if (oceanPolygons.length > 0) {
        generatePolygonSDF(oceanPolygons, texture, 0);
    }

    // Channel 1 (G): Mountain/spine distance
    if (mountainSpines.length > 0) {
        const spinePolylines = mountainSpines.map(spine => ({
            path: spine.path || spine.points || spine,
            properties: { elevation: spine.properties?.elevation || spine.elevation || 0.5 }
        }));
        generatePolylineDF(spinePolylines, texture, 1);
    }

    // Channel 2 (B): Lake distance (signed - negative in lake)
    if (lakes.length > 0) {
        generatePolygonSDF(lakes, texture, 2);
    }

    return texture;
}

/**
 * Create infrastructure SDF from roads and settlements
 * Channel R: road distance, G: road type, B: settlement distance, A: unused
 *
 * @param {Object} bounds - World bounds
 * @param {Array} roads - Road polylines with type property
 * @param {Array} settlements - Settlement points {x, z, radius}
 * @param {Object} options - Options
 * @returns {SDFTexture}
 */
export function createInfraSDF(bounds, roads, settlements, options = {}) {
    const { size = DEFAULT_SDF_SIZE, maxDistance = 200 } = options;
    const texture = new SDFTexture(size, size, 4, bounds);

    // Initialize unused channel
    texture.fillChannel(3, 0);

    // Channel 0 (R): Road distance
    if (roads && roads.length > 0) {
        const roadPolylines = roads.map(road => ({
            path: road.path || road,
            properties: {
                type: road.properties?.type ?? road.type ?? 0.5,
                types: road.properties?.types
            }
        }));
        generatePolylineDF(roadPolylines, texture, 0, { maxDistance });

        // Channel 1 (G): Road type
        generatePropertyChannel(roadPolylines, texture, 1, 'type', maxDistance);
    }

    // Channel 2 (B): Settlement distance
    if (settlements && settlements.length > 0) {
        const { width, height } = texture;
        for (let v = 0; v < height; v++) {
            for (let u = 0; u < width; u++) {
                const world = texelToWorld(u + 0.5, v + 0.5, bounds, width);

                let minDist = Infinity;
                for (const settlement of settlements) {
                    const dx = world.x - settlement.x;
                    const dz = world.z - settlement.z;
                    const dist = Math.sqrt(dx * dx + dz * dz);
                    if (dist < minDist) {
                        minDist = dist;
                    }
                }

                texture.set(u, v, 2, Math.min(minDist, maxDistance));
            }
        }
    }

    return texture;
}

/**
 * Create climate texture using noise sampling
 * Channel R: temperature, G: humidity, B: erosion, A: unused
 *
 * Note: This function requires climate sampling functions from worldgen.js
 * If not provided, it creates an empty texture
 *
 * @param {Object} bounds - World bounds
 * @param {number} seed - World seed
 * @param {Object} template - Continent template
 * @param {Object} options - Options
 * @param {Function} [options.sampleTemperature] - Temperature sampler
 * @param {Function} [options.sampleHumidity] - Humidity sampler
 * @param {Function} [options.sampleErosion] - Erosion sampler
 * @returns {SDFTexture}
 */
export function createClimateTex(bounds, seed, template, options = {}) {
    const {
        size = DEFAULT_SDF_SIZE,
        sampleTemperature,
        sampleHumidity,
        sampleErosion
    } = options;

    const texture = new SDFTexture(size, size, 4, bounds);
    const { width, height } = texture;

    // Initialize unused channel
    texture.fillChannel(3, 0);

    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            const world = texelToWorld(u + 0.5, v + 0.5, bounds, width);

            // Sample climate parameters if samplers provided
            if (sampleTemperature) {
                texture.set(u, v, 0, sampleTemperature(world.x, world.z, seed, template));
            }

            if (sampleHumidity) {
                texture.set(u, v, 1, sampleHumidity(world.x, world.z, seed, template));
            }

            if (sampleErosion) {
                texture.set(u, v, 2, sampleErosion(world.x, world.z, seed, template));
            }
        }
    }

    return texture;
}

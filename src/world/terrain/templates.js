/**
 * Continent Template System
 *
 * Provides high-level parameters to shape procedurally generated worlds.
 * Templates define continent shape, elevation modifiers, and features (bays, spines, lakes).
 *
 * COORDINATE SYSTEMS:
 * - World space: Direct block coordinates (e.g., x=256, z=512)
 * - Normalized space: [0,1] relative to continent center, where (0.5, 0.5) is center
 *
 * MODIFIER SEMANTICS:
 * All modifiers are multiplicative and in range [0, 1]:
 * - 0 = completely suppress feature
 * - 1 = no modification (passthrough)
 * - Intermediate values blend smoothly
 *
 * These modifiers are intended for future integration with worldgen.js.
 */

/**
 * Default template structure with all parameters
 * @typedef {Object} ContinentTemplate
 * @property {Object} shape - Continent shape parameters
 * @property {number} shape.centerX - World-space X coordinate of continent center
 * @property {number} shape.centerZ - World-space Z coordinate of continent center
 * @property {number} shape.radius - Continent radius in world units (blocks)
 * @property {number} shape.falloffSharpness - Edge falloff steepness (0=gradual, 1=sharp)
 * @property {Object} elevation - Elevation modification parameters
 * @property {Object} elevation.mountainBoost - Mountain/spine boost configuration
 * @property {Object|null} elevation.mountainBoost.region - Region bounds { minZ, maxZ } in normalized [0,1], or null
 * @property {number} elevation.mountainBoost.strength - Boost multiplier for mountain regions
 * @property {number} elevation.mountainBoost.ridgeWeight - How much ridgeness noise contributes
 * @property {Object} elevation.flattenRegion - Terrain flattening configuration
 * @property {Object|null} elevation.flattenRegion.region - Region bounds { minZ, maxZ } in normalized [0,1], or null
 * @property {number} elevation.flattenRegion.flatness - Elevation variation suppression (0=flat, 1=normal)
 * @property {Object} features - Named feature definitions
 * @property {Object|null} features.bay - Bay configuration { direction, depth, width } or null
 * @property {Object|null} features.lake - Lake configuration { positionZ, radius } or null
 * @property {Object|null} features.spine - Mountain spine configuration { direction, positionZ } or null
 */

const TEMPLATE_DEFAULTS = {
    shape: {
        centerX: 0,
        centerZ: 0,
        radius: 2000,
        falloffSharpness: 0.3
    },
    elevation: {
        mountainBoost: {
            region: null,
            strength: 0.5,
            ridgeWeight: 0.6
        },
        flattenRegion: {
            region: null,
            flatness: 0.7
        }
    },
    features: {
        bay: null,
        lake: null,
        spine: null
    }
};

/**
 * Simple template with radial falloff and no spine features
 * For backwards compatibility or when spine-first is not desired
 */
export const SIMPLE_TEMPLATE = {
    shape: {
        centerX: 0,
        centerZ: 0,
        radius: 2000,
        falloffSharpness: 0.3
    },
    elevation: {
        mountainBoost: {
            region: null,
            strength: 0.5,
            ridgeWeight: 0.6
        },
        flattenRegion: {
            region: null,
            flatness: 0.7
        }
    },
    features: {
        bay: null,
        lake: null,
        spine: null
    }
};

/**
 * Verdania template - C-shaped continent opening south
 *
 * SPINE-FIRST generation:
 * - Elevation is DIRECTLY derived from distance to spine
 * - Spine = mountain ridge, farther from spine = lower elevation
 * - Land/ocean boundary at landExtent distance from spine
 *
 * The C-shape naturally creates a bay because land only extends
 * landExtent distance from the spine in all directions.
 * Bay opens to the south (high Z), land curves around in the north.
 */
export const VERDANIA_TEMPLATE = {
    // World bounds for coordinate mapping
    worldBounds: { min: -2000, max: 2000 },

    // Bay center for inner/outer side detection
    bayCenter: { x: 0.5, z: 0.85 },  // South bay center (inside the C opening)

    // Shape parameters (kept for legacy compatibility, not used by spine-first)
    shape: {
        centerX: 0,
        centerZ: 0,
        radius: 2000,
        falloffSharpness: 0.3
    },

    // Primary spine: C-shape opening south (bay faces south)
    // The C-shape naturally creates a bay in the center
    spine: {
        points: [
            { x: 0.15, z: 0.70 },   // West horn tip (south)
            { x: 0.18, z: 0.50 },   // West arm
            { x: 0.30, z: 0.32 },   // NW highlands
            { x: 0.50, z: 0.25 },   // Northern peak (back of C)
            { x: 0.70, z: 0.32 },   // NE highlands
            { x: 0.82, z: 0.50 },   // East arm
            { x: 0.85, z: 0.70 }    // East horn tip (south)
        ],
        elevation: 0.85            // Peak elevation along spine
    },

    // Secondary spines for additional ridges
    secondarySpines: [
        {
            // Western coastal ridge
            points: [
                { x: 0.18, z: 0.50 },
                { x: 0.08, z: 0.55 }
            ],
            elevation: 0.50
        },
        {
            // Eastern coastal ridge
            points: [
                { x: 0.82, z: 0.50 },
                { x: 0.92, z: 0.55 }
            ],
            elevation: 0.50
        },
        {
            // Northern outer ridge
            points: [
                { x: 0.35, z: 0.12 },
                { x: 0.50, z: 0.08 },
                { x: 0.65, z: 0.12 }
            ],
            elevation: 0.40
        }
    ],

    // Land extent from spine (in normalized coords)
    // Land extends this far from any spine before becoming ocean
    // 0.20 = 20% of world size = 800 blocks at 4000 world size
    landExtent: {
        inner: 0.20,
        outer: 0.20
    },

    // Legacy (not used by spine-first generation)
    elevation: {
        mountainBoost: { region: null, strength: 0.5, ridgeWeight: 0.6 },
        flattenRegion: { region: null, flatness: 0.7 }
    },
    features: { bay: null, lake: null, spine: null }
};

/**
 * Archipelago template - Chain of islands
 *
 * SPINE-FIRST generation:
 * Multiple small spines create separate islands.
 * Each spine defines a ridge, land extends landExtent from any spine.
 */
export const ARCHIPELAGO_TEMPLATE = {
    worldBounds: { min: -2000, max: 2000 },

    shape: { centerX: 0, centerZ: 0, radius: 2000, falloffSharpness: 0.4 },

    // Primary spine: Main island
    spine: {
        points: [
            { x: 0.25, z: 0.45 },
            { x: 0.35, z: 0.50 },
            { x: 0.40, z: 0.48 }
        ],
        elevation: 0.55
    },

    // Secondary islands as separate spines
    secondarySpines: [
        {
            // Northern island
            points: [{ x: 0.50, z: 0.30 }, { x: 0.58, z: 0.35 }],
            elevation: 0.45
        },
        {
            // Eastern island
            points: [{ x: 0.65, z: 0.50 }, { x: 0.72, z: 0.55 }, { x: 0.75, z: 0.52 }],
            elevation: 0.50
        },
        {
            // Southern island
            points: [{ x: 0.45, z: 0.70 }, { x: 0.52, z: 0.72 }],
            elevation: 0.40
        }
    ],

    // Small land extent for islands
    landExtent: { inner: 0.10, outer: 0.10 },

    // Legacy (not used)
    elevation: { mountainBoost: { region: null, strength: 0.4, ridgeWeight: 0.5 }, flattenRegion: { region: null, flatness: 0.8 } },
    features: { bay: null, lake: null, spine: null }
};

/**
 * Pangaea template - Large irregular supercontinent
 *
 * SPINE-FIRST generation:
 * Single massive landmass with branching mountain ranges.
 * Large landExtent creates expansive lowlands around ridges.
 */
export const PANGAEA_TEMPLATE = {
    worldBounds: { min: -2000, max: 2000 },

    shape: { centerX: 0, centerZ: 0, radius: 2000, falloffSharpness: 0.25 },

    // Primary spine: Main continental ridge (roughly E-W)
    spine: {
        points: [
            { x: 0.15, z: 0.50 },
            { x: 0.30, z: 0.48 },
            { x: 0.50, z: 0.45 },
            { x: 0.70, z: 0.48 },
            { x: 0.85, z: 0.52 }
        ],
        elevation: 0.85
    },

    // Secondary ridges branching from main spine
    secondarySpines: [
        {
            // Northern ridge
            points: [{ x: 0.50, z: 0.45 }, { x: 0.48, z: 0.30 }, { x: 0.45, z: 0.18 }],
            elevation: 0.70
        },
        {
            // Southern ridge
            points: [{ x: 0.50, z: 0.45 }, { x: 0.55, z: 0.62 }, { x: 0.58, z: 0.78 }],
            elevation: 0.65
        },
        {
            // Western peninsula
            points: [{ x: 0.30, z: 0.48 }, { x: 0.18, z: 0.38 }],
            elevation: 0.50
        },
        {
            // Eastern peninsula
            points: [{ x: 0.70, z: 0.48 }, { x: 0.82, z: 0.62 }],
            elevation: 0.55
        }
    ],

    // Large land extent for massive continent
    landExtent: { inner: 0.30, outer: 0.30 },

    // Legacy (not used)
    elevation: { mountainBoost: { region: null, strength: 0.5, ridgeWeight: 0.6 }, flattenRegion: { region: null, flatness: 0.75 } },
    features: { bay: null, lake: null, spine: null }
};

/**
 * Legacy Verdania template - for backwards compatibility testing
 * Uses old format with features.spine: {direction, positionZ}
 */
export const VERDANIA_TEMPLATE_LEGACY = {
    shape: {
        centerX: 0,
        centerZ: 0,
        radius: 2000,
        falloffSharpness: 0.3
    },
    elevation: {
        mountainBoost: {
            region: { minZ: 0.7, maxZ: 1.0 },  // Southern 30%
            strength: 0.6,
            ridgeWeight: 0.6
        },
        flattenRegion: {
            region: { minZ: 0, maxZ: 0.4 },     // Northern 40%
            flatness: 0.7
        }
    },
    features: {
        bay: {
            direction: 'N',
            depth: 0.35,
            width: 0.45
        },
        lake: null,
        spine: {
            direction: 'EW',
            positionZ: 0.85
        }
    }
};

/**
 * Default template - uses VERDANIA spine-first template
 * This ensures spine-first generation works by default
 */
export const DEFAULT_TEMPLATE = VERDANIA_TEMPLATE;

/**
 * Convert world coordinates to normalized [0,1] coordinates relative to continent bounds
 *
 * @param {number} worldX - World X coordinate
 * @param {number} worldZ - World Z coordinate
 * @param {ContinentTemplate} template - Continent template with shape parameters
 * @returns {Object} Normalized position:
 *   - nx: Normalized X in [0,1] (0.5 = center)
 *   - nz: Normalized Z in [0,1] (0.5 = center)
 *   - distanceFromCenter: Radial distance from continent center in world units
 *
 * Note: Values outside [0,1] indicate positions beyond continent bounds
 */
export function getNormalizedPosition(worldX, worldZ, template) {
    const { centerX, centerZ, radius } = template.shape;

    // Calculate relative position from center
    const relX = worldX - centerX;
    const relZ = worldZ - centerZ;

    // Normalize to [0,1] range
    // 0.5 = center, 0 = west/north edge, 1 = east/south edge
    const nx = 0.5 + relX / (2 * radius);
    const nz = 0.5 + relZ / (2 * radius);

    // Calculate radial distance from center
    const distanceFromCenter = Math.sqrt(relX * relX + relZ * relZ);

    return { nx, nz, distanceFromCenter };
}

/**
 * Smoothstep interpolation function
 * Creates smooth transition between 0 and 1
 *
 * @param {number} t - Input value (will be clamped to [0,1])
 * @returns {number} Smoothly interpolated value in [0,1]
 */
function smoothstep(t) {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
}

/**
 * Apply radial shape mask for continent edges
 * Uses smooth falloff curve to transition from land to ocean
 *
 * @param {number} distanceFromCenter - Radial distance from continent center
 * @param {number} radius - Continent radius
 * @param {number} falloffSharpness - Edge falloff steepness (0=gradual, 1=sharp)
 * @returns {number} Shape mask multiplier [0,1]:
 *   - 1.0 at center
 *   - Smooth falloff at edges
 *   - 0.0 beyond falloff distance
 */
function applyShapeMask(distanceFromCenter, radius, falloffSharpness) {
    // Define falloff zone as percentage of radius
    // Lower sharpness = wider falloff zone
    const falloffWidth = radius * (0.5 - 0.3 * falloffSharpness);
    const falloffStart = radius - falloffWidth;

    if (distanceFromCenter < falloffStart) {
        return 1.0;  // Inside solid continent
    }

    if (distanceFromCenter > radius) {
        return 0.0;  // Beyond continent edge
    }

    // Smooth transition in falloff zone
    const t = (radius - distanceFromCenter) / falloffWidth;
    return smoothstep(t);
}

/**
 * Apply bay carving effect
 * Reduces continentalness in bay region based on direction, depth, and width
 *
 * @param {number} nx - Normalized X coordinate [0,1]
 * @param {number} nz - Normalized Z coordinate [0,1]
 * @param {Object} bay - Bay configuration { direction, depth, width }
 * @returns {number} Bay carving multiplier [0,1]:
 *   - 1.0 outside bay region (no carving)
 *   - Lower values inside bay (creates water)
 */
function applyBayCarving(nx, nz, bay) {
    if (!bay) return 1.0;

    const { direction, depth, width } = bay;

    // Calculate bay mask based on direction
    let bayMask = 1.0;

    if (direction === 'N') {
        // North bay carves from nz=0 (north edge) inward
        const distFromEdge = nz;  // Distance from north edge (0 = north edge, 1 = south edge)

        // Bay carves inward from edge up to depth
        if (distFromEdge < depth) {
            // Calculate horizontal distance from center (0.5)
            const horizDist = Math.abs(nx - 0.5);

            // Check if within bay width
            if (horizDist < width / 2) {
                // Depth factor: stronger carving near edge (1.0 at edge, 0.0 at depth limit)
                const depthFactor = smoothstep(1.0 - (distFromEdge / depth));
                // Width factor: stronger carving near center (1.0 at center, 0.0 at width edge)
                const widthFactor = smoothstep(1.0 - (horizDist / (width / 2)));
                // Combine factors for final bay mask (multiply by 0.7 for max 70% carving)
                bayMask = 1.0 - (depthFactor * widthFactor * 0.7);
            }
        }
    } else if (direction === 'S') {
        // South bay carves from nz=1 (south edge) inward
        const distFromEdge = 1.0 - nz;
        if (distFromEdge < depth) {
            const horizDist = Math.abs(nx - 0.5);
            if (horizDist < width / 2) {
                const depthFactor = smoothstep(1.0 - (distFromEdge / depth));
                const widthFactor = smoothstep(1.0 - (horizDist / (width / 2)));
                bayMask = 1.0 - (depthFactor * widthFactor * 0.7);
            }
        }
    } else if (direction === 'E') {
        // East bay carves from nx=1 (east edge) inward
        const distFromEdge = 1.0 - nx;
        if (distFromEdge < depth) {
            const vertDist = Math.abs(nz - 0.5);
            if (vertDist < width / 2) {
                const depthFactor = smoothstep(1.0 - (distFromEdge / depth));
                const widthFactor = smoothstep(1.0 - (vertDist / (width / 2)));
                bayMask = 1.0 - (depthFactor * widthFactor * 0.7);
            }
        }
    } else if (direction === 'W') {
        // West bay carves from nx=0 (west edge) inward
        const distFromEdge = nx;
        if (distFromEdge < depth) {
            const vertDist = Math.abs(nz - 0.5);
            if (vertDist < width / 2) {
                const depthFactor = smoothstep(1.0 - (distFromEdge / depth));
                const widthFactor = smoothstep(1.0 - (vertDist / (width / 2)));
                bayMask = 1.0 - (depthFactor * widthFactor * 0.7);
            }
        }
    }

    return bayMask;
}

/**
 * Apply mountain spine boost
 * Creates a ridge of elevated terrain along a line
 * Uses Gaussian falloff for smooth ridge shape
 *
 * @param {number} nx - Normalized X coordinate [0,1]
 * @param {number} nz - Normalized Z coordinate [0,1]
 * @param {Object} spine - Spine configuration { direction, positionZ }
 * @returns {number} Spine boost multiplier [0,1]:
 *   - High values along spine line
 *   - Smooth Gaussian falloff perpendicular to spine
 */
function applySpineBoost(nx, nz, spine) {
    if (!spine) return 0.0;

    const { direction, positionZ } = spine;

    let perpDistance = 0;

    if (direction === 'EW') {
        // East-west spine (horizontal line at positionZ)
        perpDistance = Math.abs(nz - positionZ);
    } else if (direction === 'NS') {
        // North-south spine (vertical line at positionZ)
        // Note: positionZ parameter is reused as positionX for NS direction
        perpDistance = Math.abs(nx - positionZ);
    }

    // Gaussian falloff (sigma = 0.1 in normalized space)
    const sigma = 0.1;
    const boost = Math.exp(-(perpDistance * perpDistance) / (2 * sigma * sigma));

    return boost;
}

// =============================================================================
// Spine-First Generation Helpers
// =============================================================================

/**
 * Project a point onto a line segment and return distance and projected point
 * Works in normalized [0,1] coordinates
 *
 * @param {number} px - Point X coordinate
 * @param {number} pz - Point Z coordinate
 * @param {{x: number, z: number}} a - Segment start point
 * @param {{x: number, z: number}} b - Segment end point
 * @returns {{dist: number, point: {x: number, z: number}, t: number}}
 */
function projectOntoSegmentNormalized(px, pz, a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;

    if (lenSq < 0.0001) {
        // Degenerate segment
        const dist = Math.sqrt((px - a.x) ** 2 + (pz - a.z) ** 2);
        return { dist, point: { x: a.x, z: a.z }, t: 0 };
    }

    // Project onto line, clamp to segment
    const t = Math.max(0, Math.min(1,
        ((px - a.x) * dx + (pz - a.z) * dz) / lenSq
    ));

    const projX = a.x + t * dx;
    const projZ = a.z + t * dz;
    const dist = Math.sqrt((px - projX) ** 2 + (pz - projZ) ** 2);

    return { dist, point: { x: projX, z: projZ }, t };
}

/**
 * Find nearest point on any spine segment and return distance + nearest point
 *
 * @param {number} nx - Normalized X coordinate [0,1]
 * @param {number} nz - Normalized Z coordinate [0,1]
 * @param {Object} template - Template with spine.points and secondarySpines
 * @returns {{distance: number, nearestPoint: {x: number, z: number}, spineElevation: number, spineWidth: number}}
 */
function getNearestSpineInfo(nx, nz, template) {
    let minDist = Infinity;
    let nearestPoint = { x: nx, z: nz };
    let spineElevation = 0;
    let spineWidth = 0.1;

    // Helper to check a polyline
    const checkPolyline = (points, elevation, width) => {
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const { dist, point } = projectOntoSegmentNormalized(nx, nz, p1, p2);
            if (dist < minDist) {
                minDist = dist;
                nearestPoint = point;
                spineElevation = elevation;
                spineWidth = width;
            }
        }
    };

    // Check primary spine
    if (template.spine?.points && template.spine.points.length >= 2) {
        checkPolyline(
            template.spine.points,
            template.spine.elevation || 0.8,
            template.spine.width || 0.1
        );
    }

    // Check secondary spines
    for (const secondary of template.secondarySpines || []) {
        if (secondary.points && secondary.points.length >= 2) {
            checkPolyline(
                secondary.points,
                secondary.elevation || 0.6,
                secondary.width || 0.08
            );
        }
    }

    return { distance: minDist, nearestPoint, spineElevation, spineWidth };
}

/**
 * Get the "inner" reference point for asymmetric land extent
 *
 * If template has explicit bayCenter, use that.
 * Otherwise, calculate centroid of all spine points (primary + secondary).
 *
 * For C-shapes, bayCenter should be explicitly set to a point in the bay opening.
 *
 * @param {Object} template - Template with spine.points and secondarySpines
 * @returns {{x: number, z: number}} Inner reference point in normalized coordinates
 */
function getInnerReferencePoint(template) {
    // Use explicit bay center if provided
    if (template.bayCenter) {
        return template.bayCenter;
    }

    // Fall back to centroid calculation
    let sumX = 0, sumZ = 0, count = 0;

    for (const p of template.spine?.points || []) {
        sumX += p.x;
        sumZ += p.z;
        count++;
    }

    for (const secondary of template.secondarySpines || []) {
        for (const p of secondary.points || []) {
            sumX += p.x;
            sumZ += p.z;
            count++;
        }
    }

    return count > 0
        ? { x: sumX / count, z: sumZ / count }
        : { x: 0.5, z: 0.5 };
}

/**
 * Get distance to spine and determine which side (inner/outer)
 *
 * Uses the inner reference point (bayCenter if defined, else centroid) to determine sides:
 * - Points TOWARD the inner reference point from spine → inner side (less land)
 * - Points AWAY from the inner reference point from spine → outer side (more land)
 *
 * For a C-shaped spine opening north with bayCenter in the bay:
 * - Points in the bay (toward bayCenter) → inner (less land)
 * - Points on outer coast (away from bayCenter) → outer (more land)
 *
 * @param {number} nx - Normalized X coordinate [0,1]
 * @param {number} nz - Normalized Z coordinate [0,1]
 * @param {Object} template - Template with spine data
 * @returns {{distance: number, isInnerSide: boolean, spineElevation: number, spineWidth: number}}
 */
function getSpineDistanceWithSide(nx, nz, template) {
    // Get inner reference point (bayCenter if defined, else spine centroid)
    const innerRef = getInnerReferencePoint(template);

    // Find nearest point on spine
    const { distance, nearestPoint, spineElevation, spineWidth } = getNearestSpineInfo(nx, nz, template);

    // Determine if query point is on the inner reference side
    const toInnerRefX = innerRef.x - nearestPoint.x;
    const toInnerRefZ = innerRef.z - nearestPoint.z;
    const toQueryX = nx - nearestPoint.x;
    const toQueryZ = nz - nearestPoint.z;

    // Dot product: positive if query is on same side as inner reference
    const dot = toInnerRefX * toQueryX + toInnerRefZ * toQueryZ;

    // Inner = TOWARD inner reference (dot > 0) - the bay side
    // Outer = AWAY from inner reference (dot < 0) - the coast side
    const isInnerSide = dot > 0;

    return { distance, isInnerSide, spineElevation, spineWidth };
}

/**
 * Calculate land mask from spine distance
 * Land extends asymmetrically based on landExtent
 * Uses centroid-based side detection
 *
 * @param {number} nx - Normalized X coordinate [0,1]
 * @param {number} nz - Normalized Z coordinate [0,1]
 * @param {Object} template - Template with spine and landExtent
 * @returns {number} Land mask [0,1]
 */
function calculateSpineLandMask(nx, nz, template) {
    // Check if template has spine-first structure
    if (!template.spine?.points || template.spine.points.length < 2) {
        return 1.0; // No spine defined, don't mask
    }

    const { distance, isInnerSide } = getSpineDistanceWithSide(nx, nz, template);
    const landExtent = template.landExtent || { inner: 0.4, outer: 0.4 };

    // Choose extent based on which side of spine we're on
    const maxExtent = isInnerSide ? landExtent.inner : landExtent.outer;

    // Handle spine endpoints - extend land in a circular cap around them
    // This prevents abrupt cutoffs at the "horns" of C-shaped continents
    const endpointCapRadius = Math.max(landExtent.inner, landExtent.outer) * 1.2;
    const spinePoints = template.spine.points;
    const firstPoint = spinePoints[0];
    const lastPoint = spinePoints[spinePoints.length - 1];

    // Distance to first and last spine points
    const distToFirst = Math.sqrt((nx - firstPoint.x) ** 2 + (nz - firstPoint.z) ** 2);
    const distToLast = Math.sqrt((nx - lastPoint.x) ** 2 + (nz - lastPoint.z) ** 2);
    const minEndpointDist = Math.min(distToFirst, distToLast);

    // If close to endpoint, use circular cap instead of perpendicular distance
    if (minEndpointDist < endpointCapRadius) {
        // Smooth falloff from endpoint
        const capFalloffStart = endpointCapRadius * 0.6;
        if (minEndpointDist < capFalloffStart) return 1.0;
        return smoothstep((endpointCapRadius - minEndpointDist) / (endpointCapRadius - capFalloffStart));
    }

    if (distance > maxExtent) return 0;

    // Smooth falloff at edges
    const falloffStart = maxExtent * 0.7;
    if (distance < falloffStart) return 1.0;

    return smoothstep((maxExtent - distance) / (maxExtent - falloffStart));
}

/**
 * Calculate elevation boost from spine proximity
 * Uses Gaussian falloff from nearest spine segment
 *
 * @param {number} nx - Normalized X coordinate [0,1]
 * @param {number} nz - Normalized Z coordinate [0,1]
 * @param {Object} template - Template with spine data
 * @returns {number} Elevation boost [0,1]
 */
function calculateSpineElevationBoost(nx, nz, template) {
    if (!template.spine?.points || template.spine.points.length < 2) {
        return 0;
    }

    const { distance, spineElevation, spineWidth } = getNearestSpineInfo(nx, nz, template);

    // Gaussian falloff based on spine width
    // Increase sigma to make the ridge wider and more visible
    // spineWidth of 0.12 in normalized space = ~480 blocks at 4000 world size
    // We want the ridge to be visually prominent, so use 1.5x the width
    const sigma = spineWidth * 1.5;
    const influence = Math.exp(-(distance * distance) / (2 * sigma * sigma));

    return spineElevation * influence;
}

/**
 * Normalize template to new spine-first format
 * Converts old format (features.spine: {direction, positionZ}) to new format
 *
 * @param {Object} template - Template in old or new format
 * @returns {Object} Template in new format (or original if already new)
 */
function normalizeTemplate(template) {
    // If using new format (has spine.points), return as-is
    if (template.spine?.points) {
        return template;
    }

    // Convert old format to new
    if (template.features?.spine) {
        const { direction, positionZ } = template.features.spine;
        const points = direction === 'EW'
            ? [{ x: 0.1, z: positionZ }, { x: 0.9, z: positionZ }]
            : [{ x: positionZ, z: 0.1 }, { x: positionZ, z: 0.9 }];

        return {
            ...template,
            spine: { points, elevation: 0.8, width: 0.1 },
            landExtent: { inner: 0.4, outer: 0.4 }
        };
    }

    return template;
}

/**
 * Check if template uses spine-first generation
 * @param {Object} template - Template to check
 * @returns {boolean} True if template has spine polyline points
 */
export function hasSpineFirstGeneration(template) {
    return template.spine?.points?.length >= 2;
}

// =============================================================================
// Legacy Helper Functions
// =============================================================================

/**
 * Check if normalized Z coordinate is within a region
 *
 * @param {number} nz - Normalized Z coordinate [0,1]
 * @param {Object|null} region - Region bounds { minZ, maxZ } or null
 * @returns {number} Region membership [0,1]:
 *   - 1.0 inside region
 *   - 0.0 outside region
 *   - Smooth transition at boundaries
 */
function getRegionMembership(nz, region) {
    if (!region) return 0.0;

    const { minZ, maxZ } = region;
    const transitionWidth = 0.05;  // 5% of normalized space for smooth transition

    if (nz < minZ - transitionWidth || nz > maxZ + transitionWidth) {
        return 0.0;  // Outside region
    }

    if (nz >= minZ + transitionWidth && nz <= maxZ - transitionWidth) {
        return 1.0;  // Inside region
    }

    // Smooth transition at boundaries
    if (nz < minZ + transitionWidth) {
        // Near lower boundary
        return smoothstep((nz - (minZ - transitionWidth)) / (2 * transitionWidth));
    } else {
        // Near upper boundary
        return smoothstep(((maxZ + transitionWidth) - nz) / (2 * transitionWidth));
    }
}

/**
 * Calculate all template modifiers for a world position
 *
 * Returns multiplicative modifiers that should be applied to base noise values
 * from worldgen.js (in future integration).
 *
 * @param {number} worldX - World X coordinate
 * @param {number} worldZ - World Z coordinate
 * @param {ContinentTemplate} template - Continent template
 * @returns {Object} Modifier values:
 *   - continentalnessMultiplier: Shape mask (0=ocean, 1=no change)
 *   - elevationMultiplier: Flatten effect (0=flat, 1=no change)
 *   - mountainBoost: Additive boost for spine/mountain regions [0,1]
 *   - ridgeWeight: How much ridgeness to blend in [0,1]
 *
 * @example
 * const mods = getTemplateModifiers(0, -600, VERDANIA_TEMPLATE);
 * // Bay center: { continentalnessMultiplier: ~0.4, ... }
 *
 * const mods2 = getTemplateModifiers(0, 1400, VERDANIA_TEMPLATE);
 * // Spine center: { mountainBoost: ~0.6, ... }
 */
/**
 * Debug function to diagnose bay orientation issues
 * Call from visualizer click handler to understand coordinate mapping
 *
 * @param {number} worldX - World X coordinate
 * @param {number} worldZ - World Z coordinate
 * @param {ContinentTemplate} template - Continent template
 * @returns {Object} Template modifiers (same as getTemplateModifiers)
 */
export function debugTemplateAt(worldX, worldZ, template) {
    const { nx, nz, distanceFromCenter } = getNormalizedPosition(worldX, worldZ, template);
    const mods = getTemplateModifiers(worldX, worldZ, template);

    console.log(`Position (${worldX}, ${worldZ}):`);
    console.log(`  Normalized: nx=${nx.toFixed(3)}, nz=${nz.toFixed(3)}`);
    console.log(`  Distance from center: ${distanceFromCenter.toFixed(0)}`);
    console.log(`  Shape mask: ${mods.continentalnessMultiplier.toFixed(3)}`);
    console.log(`  Mountain boost: ${mods.mountainBoost.toFixed(3)}`);

    return mods;
}

export function getTemplateModifiers(worldX, worldZ, template) {
    // Normalize template to handle both old and new formats
    const normalizedTemplate = normalizeTemplate(template);

    // Get normalized position
    const { nx, nz, distanceFromCenter } = getNormalizedPosition(worldX, worldZ, normalizedTemplate);

    // Check if using spine-first generation (new format with spine.points)
    const useSpineFirst = normalizedTemplate.spine?.points?.length >= 2;

    // 1. SHAPE MASK (continentalness modifier)
    let shapeMask;

    if (useSpineFirst) {
        // NEW: Spine-first generation - land mask based on distance from spine
        shapeMask = calculateSpineLandMask(nx, nz, normalizedTemplate);

        // Also apply world boundary falloff
        const boundaryMask = applyShapeMask(
            distanceFromCenter,
            normalizedTemplate.shape.radius,
            normalizedTemplate.shape.falloffSharpness
        );
        shapeMask *= boundaryMask;
    } else {
        // LEGACY: Radial shape mask
        shapeMask = applyShapeMask(
            distanceFromCenter,
            normalizedTemplate.shape.radius,
            normalizedTemplate.shape.falloffSharpness
        );
    }

    // Apply bay carving if defined (works for both old and new formats)
    if (normalizedTemplate.features?.bay) {
        const bayCarving = applyBayCarving(nx, nz, normalizedTemplate.features.bay);
        shapeMask *= bayCarving;
    }

    // 2. ELEVATION EFFECTS

    // Flatten region effect
    let elevationMultiplier = 1.0;
    if (normalizedTemplate.elevation?.flattenRegion?.region) {
        const flattenMembership = getRegionMembership(
            nz,
            normalizedTemplate.elevation.flattenRegion.region
        );
        // Blend between normal (1.0) and flattened
        elevationMultiplier = 1.0 - flattenMembership * (1.0 - normalizedTemplate.elevation.flattenRegion.flatness);
    }

    // 3. MOUNTAIN BOOST
    let mountainBoost = 0.0;
    let ridgeWeight = 0.0;

    if (useSpineFirst) {
        // NEW: Spine-first elevation boost from polyline spine
        const spineBoost = calculateSpineElevationBoost(nx, nz, normalizedTemplate);
        mountainBoost = spineBoost;
        ridgeWeight = spineBoost * 0.6;

        // Also apply region-based boost if defined
        if (normalizedTemplate.elevation?.mountainBoost?.region) {
            const boostMembership = getRegionMembership(
                nz,
                normalizedTemplate.elevation.mountainBoost.region
            );
            const regionBoost = boostMembership * normalizedTemplate.elevation.mountainBoost.strength;
            const regionRidge = boostMembership * normalizedTemplate.elevation.mountainBoost.ridgeWeight;
            mountainBoost = Math.max(mountainBoost, regionBoost);
            ridgeWeight = Math.max(ridgeWeight, regionRidge);
        }
    } else {
        // LEGACY: Region and simple spine boost
        if (normalizedTemplate.elevation?.mountainBoost?.region || normalizedTemplate.features?.spine) {
            // Region-based boost
            if (normalizedTemplate.elevation?.mountainBoost?.region) {
                const boostMembership = getRegionMembership(
                    nz,
                    normalizedTemplate.elevation.mountainBoost.region
                );
                mountainBoost = boostMembership * normalizedTemplate.elevation.mountainBoost.strength;
                ridgeWeight = boostMembership * normalizedTemplate.elevation.mountainBoost.ridgeWeight;
            }

            // Simple spine-based boost (old format: direction + positionZ)
            if (normalizedTemplate.features?.spine) {
                const spineBoost = applySpineBoost(nx, nz, normalizedTemplate.features.spine);
                const strength = normalizedTemplate.elevation?.mountainBoost?.strength || 0.5;
                const ridge = normalizedTemplate.elevation?.mountainBoost?.ridgeWeight || 0.6;
                mountainBoost = Math.max(mountainBoost, spineBoost * strength);
                ridgeWeight = Math.max(ridgeWeight, spineBoost * ridge);
            }
        }
    }

    // Ensure no mountain boost in ocean areas
    mountainBoost *= shapeMask;
    ridgeWeight *= shapeMask;

    return {
        continentalnessMultiplier: shapeMask,
        elevationMultiplier: elevationMultiplier,
        mountainBoost: mountainBoost,
        ridgeWeight: ridgeWeight
    };
}

// =============================================================================
// Template Selection
// =============================================================================

/**
 * Available archetype templates for deterministic selection
 */
const ARCHETYPE_TEMPLATES = [
    VERDANIA_TEMPLATE,      // C-shaped continent
    PANGAEA_TEMPLATE,       // Large irregular supercontinent
    ARCHIPELAGO_TEMPLATE,   // Island chain
];

/**
 * Get a template based on seed for deterministic world generation
 * Always returns a spine-first template for consistent continent shapes
 *
 * @param {number} seed - World seed
 * @returns {Object} Selected template
 */
export function getTemplateForSeed(seed) {
    // Use seed to deterministically pick an archetype
    const index = Math.abs(seed) % ARCHETYPE_TEMPLATES.length;
    return ARCHETYPE_TEMPLATES[index];
}

/**
 * Get the default template (VERDANIA for spine-first generation)
 * Use this when no specific template is provided
 *
 * @returns {Object} Default template
 */
export function getDefaultTemplate() {
    return VERDANIA_TEMPLATE;
}

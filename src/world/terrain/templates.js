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
 * Default template with no features
 * Pure noise-based generation with simple radial falloff
 */
export const DEFAULT_TEMPLATE = {
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
 * Verdania template - Example continent with multiple features
 *
 * Features:
 * - Northern bay (carves into north edge)
 * - East-west mountain spine at 85% north
 * - Flattened plains in northern 40%
 * - Mountain boost in southern 30%
 */
export const VERDANIA_TEMPLATE = {
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
export function getTemplateModifiers(worldX, worldZ, template) {
    // Get normalized position
    const { nx, nz, distanceFromCenter } = getNormalizedPosition(worldX, worldZ, template);

    // 1. SHAPE MASK (continentalness modifier)
    let shapeMask = applyShapeMask(
        distanceFromCenter,
        template.shape.radius,
        template.shape.falloffSharpness
    );

    // Apply bay carving if defined
    const bayCarving = applyBayCarving(nx, nz, template.features.bay);
    shapeMask *= bayCarving;

    // 2. ELEVATION EFFECTS

    // Flatten region effect
    let elevationMultiplier = 1.0;
    if (template.elevation.flattenRegion.region) {
        const flattenMembership = getRegionMembership(
            nz,
            template.elevation.flattenRegion.region
        );
        // Blend between normal (1.0) and flattened
        elevationMultiplier = 1.0 - flattenMembership * (1.0 - template.elevation.flattenRegion.flatness);
    }

    // Mountain boost effect
    let mountainBoost = 0.0;
    let ridgeWeight = 0.0;
    if (template.elevation.mountainBoost.region || template.features.spine) {
        // Region-based boost
        if (template.elevation.mountainBoost.region) {
            const boostMembership = getRegionMembership(
                nz,
                template.elevation.mountainBoost.region
            );
            mountainBoost = boostMembership * template.elevation.mountainBoost.strength;
            ridgeWeight = boostMembership * template.elevation.mountainBoost.ridgeWeight;
        }

        // Spine-based boost (additive with region boost)
        if (template.features.spine) {
            const spineBoost = applySpineBoost(nx, nz, template.features.spine);
            mountainBoost = Math.max(mountainBoost, spineBoost * template.elevation.mountainBoost.strength);
            ridgeWeight = Math.max(ridgeWeight, spineBoost * template.elevation.mountainBoost.ridgeWeight);
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

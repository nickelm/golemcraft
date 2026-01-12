/**
 * TemplateBuilder - Converts EditData to valid template structure
 *
 * Takes the edit data from the editor and produces a template
 * compatible with the worldgen system (see templates.js).
 */

/**
 * Build a complete template from EditData
 * @param {Object} editData - The edit data to convert
 * @returns {Object} Valid template for worldgen
 */
export function buildTemplate(editData) {
    if (!editData) {
        return buildEmptyTemplate();
    }

    const template = {
        // World bounds (standard 4000x4000 world)
        worldBounds: { min: -2000, max: 2000 },

        // Shape parameters (for backwards compatibility)
        shape: {
            centerX: 0,
            centerZ: 0,
            radius: 2000,
            falloffSharpness: 0.3
        },

        // Primary spine from Stage 1
        spine: null,

        // Secondary spines from Stage 2
        secondarySpines: [],

        // Land extent from Stage 1
        landExtent: {
            inner: editData.stage1?.landExtent?.inner || 0.2,
            outer: editData.stage1?.landExtent?.outer || 0.2
        },

        // Bay center (auto-calculated if not specified)
        bayCenter: editData.stage1?.bayCenter || null,

        // Legacy elevation params (for backwards compatibility)
        elevation: {
            mountainBoost: { region: null, strength: 0.5, ridgeWeight: 0.6 },
            flattenRegion: { region: null, flatness: 0.7 }
        },

        // Legacy features (for backwards compatibility)
        features: { bay: null, lake: null, spine: null }
    };

    // Build primary spine
    if (editData.stage1?.spine?.points?.length >= 2) {
        template.spine = {
            points: editData.stage1.spine.points.map(p => ({
                x: clamp(p.x, 0, 1),
                z: clamp(p.z, 0, 1)
            })),
            elevation: editData.stage1.spine.elevation || 0.8,
            width: editData.stage1.spine.width || 0.1
        };

        // Auto-calculate bay center if not specified
        if (!template.bayCenter) {
            template.bayCenter = calculateBayCenter(template.spine.points);
        }
    } else {
        // No valid spine yet - use a minimal placeholder to avoid legacy generation issues
        // Make it nearly invisible (at sea level with minimal extent)
        template.spine = {
            points: [
                { x: 0.499, z: 0.5 },
                { x: 0.501, z: 0.5 }
            ],
            elevation: 0.01,  // At sea level - not visible
            width: 0.001
        };
        template.landExtent = { inner: 0.001, outer: 0.001 };
        template.bayCenter = { x: 0.5, z: 0.9 };
    }

    // Build secondary spines from Stage 2
    if (editData.stage2?.secondarySpines?.length > 0) {
        template.secondarySpines = editData.stage2.secondarySpines
            .filter(spine => spine.points?.length >= 2)
            .map(spine => ({
                points: spine.points.map(p => ({
                    x: clamp(p.x, 0, 1),
                    z: clamp(p.z, 0, 1)
                })),
                elevation: spine.elevation || 0.6
            }));
    }

    return template;
}

/**
 * Build an empty template with defaults
 * Uses a minimal placeholder spine to avoid legacy generation path issues
 * @returns {Object}
 */
export function buildEmptyTemplate() {
    return {
        worldBounds: { min: -2000, max: 2000 },
        shape: {
            centerX: 0,
            centerZ: 0,
            radius: 2000,
            falloffSharpness: 0.3
        },
        // Minimal placeholder spine to use spine-first generation
        // Nearly invisible (at sea level) until user draws their own spine
        spine: {
            points: [
                { x: 0.499, z: 0.5 },
                { x: 0.501, z: 0.5 }
            ],
            elevation: 0.01,  // At sea level - not visible
            width: 0.001
        },
        secondarySpines: [],
        landExtent: { inner: 0.001, outer: 0.001 },
        bayCenter: { x: 0.5, z: 0.9 },
        elevation: {
            mountainBoost: { region: null, strength: 0.5, ridgeWeight: 0.6 },
            flattenRegion: { region: null, flatness: 0.7 }
        },
        features: { bay: null, lake: null, spine: null }
    };
}

/**
 * Build hydrology configuration from EditData
 * @param {Object} editData
 * @returns {Object}
 */
export function buildHydrologyConfig(editData) {
    if (!editData?.stage3) {
        return {
            waterSources: [],
            lakeRegions: [],
            riverDensity: 0.5,
            riverMeandering: 0.5
        };
    }

    return {
        waterSources: editData.stage3.waterSources.map(src => ({
            x: clamp(src.x, 0, 1),
            z: clamp(src.z, 0, 1),
            type: src.type || 'spring'
        })),
        lakeRegions: editData.stage3.lakeRegions.map(lake => ({
            center: {
                x: clamp(lake.center?.x || lake.x, 0, 1),
                z: clamp(lake.center?.z || lake.z, 0, 1)
            },
            radius: lake.radius || 0.05,
            depth: lake.depth || 0.3
        })),
        riverDensity: editData.stage3.riverDensity,
        riverMeandering: editData.stage3.riverMeandering
    };
}

/**
 * Build climate configuration from EditData
 * @param {Object} editData
 * @returns {Object}
 */
export function buildClimateConfig(editData) {
    if (!editData?.stage4) {
        return {
            temperatureGradient: { direction: { x: 0, z: -1 }, strength: 1.0 },
            baseHumidity: 0.5,
            excludedBiomes: []
        };
    }

    return {
        temperatureGradient: {
            direction: {
                x: editData.stage4.temperatureGradient?.direction?.x || 0,
                z: editData.stage4.temperatureGradient?.direction?.z || -1
            },
            strength: editData.stage4.temperatureGradient?.strength || 1.0
        },
        baseHumidity: editData.stage4.baseHumidity,
        excludedBiomes: [...(editData.stage4.excludedBiomes || [])]
    };
}

/**
 * Calculate the bay center based on spine points
 * The bay center is typically on the "inside" of a curved spine.
 * For a C-shape opening south, this would be south of the spine center.
 * @param {Array} spinePoints - Array of {x, z} points
 * @returns {{x: number, z: number}}
 */
function calculateBayCenter(spinePoints) {
    if (!spinePoints || spinePoints.length < 2) {
        return { x: 0.5, z: 0.5 };
    }

    // Find the centroid of the spine
    let sumX = 0, sumZ = 0;
    for (const p of spinePoints) {
        sumX += p.x;
        sumZ += p.z;
    }
    const centroid = {
        x: sumX / spinePoints.length,
        z: sumZ / spinePoints.length
    };

    // Find the direction perpendicular to the spine's general direction
    // Use first and last points to determine spine orientation
    const first = spinePoints[0];
    const last = spinePoints[spinePoints.length - 1];

    const dx = last.x - first.x;
    const dz = last.z - first.z;
    const len = Math.sqrt(dx * dx + dz * dz);

    if (len < 0.001) {
        // Spine is essentially a point, default to south
        return { x: centroid.x, z: 0.85 };
    }

    // Normal perpendicular to spine (choose the one pointing away from center)
    const normalX = -dz / len;
    const normalZ = dx / len;

    // Offset from centroid in perpendicular direction
    // Choose the side that's farther from world center (0.5, 0.5)
    const offsetDist = 0.35;

    const bay1 = {
        x: centroid.x + normalX * offsetDist,
        z: centroid.z + normalZ * offsetDist
    };

    const bay2 = {
        x: centroid.x - normalX * offsetDist,
        z: centroid.z - normalZ * offsetDist
    };

    // Choose the bay that's farther from world center
    const dist1 = Math.sqrt(Math.pow(bay1.x - 0.5, 2) + Math.pow(bay1.z - 0.5, 2));
    const dist2 = Math.sqrt(Math.pow(bay2.x - 0.5, 2) + Math.pow(bay2.z - 0.5, 2));

    const bay = dist1 > dist2 ? bay1 : bay2;

    // Clamp to valid range
    return {
        x: clamp(bay.x, 0.1, 0.9),
        z: clamp(bay.z, 0.1, 0.9)
    };
}

/**
 * Clamp a value between min and max
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Export edit data to JSON format for saving/sharing
 * @param {Object} editData
 * @returns {string}
 */
export function exportToJSON(editData) {
    return JSON.stringify({
        version: 1,
        type: 'golemcraft-template',
        editData: editData,
        template: buildTemplate(editData),
        hydrology: buildHydrologyConfig(editData),
        climate: buildClimateConfig(editData)
    }, null, 2);
}

/**
 * Import edit data from JSON format
 * @param {string} json
 * @returns {Object|null} EditData or null if invalid
 */
export function importFromJSON(json) {
    try {
        const data = JSON.parse(json);

        if (data.type !== 'golemcraft-template') {
            console.warn('TemplateBuilder: Invalid template type');
            return null;
        }

        if (data.version !== 1) {
            console.warn('TemplateBuilder: Unknown template version');
            return null;
        }

        return data.editData;
    } catch (e) {
        console.error('TemplateBuilder: Failed to parse JSON', e);
        return null;
    }
}

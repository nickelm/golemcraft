/**
 * Continental Generation Stage Versions
 *
 * Each stage has an independent version number. When a stage's algorithm changes,
 * increment its version to trigger regeneration of that stage (and dependent stages).
 *
 * Version history:
 * - v1: Initial implementation
 */

/**
 * Version numbers for each generation stage.
 * Increment when the stage's algorithm changes to invalidate cached data.
 */
export const STAGE_VERSIONS = {
    shape: 1,      // Coastline shaping / template validation
    mountains: 1,  // Mountain spine generation
    erosion: 1,    // Erosion simulation
    rivers: 1,     // River generation
    climate: 1,    // Climate mapping
    zones: 1,      // Zone discovery and classification
    roads: 1,      // Road network planning
    names: 1,      // Place naming
    sdf: 1         // SDF texture baking
};

/**
 * Combined version hash for quick invalidation check.
 * If this doesn't match stored metadata, at least one stage needs regeneration.
 */
export const CONTINENTAL_VERSION = Object.values(STAGE_VERSIONS).reduce((a, b) => a + b, 0);

/**
 * Stage dependencies - if a stage changes, dependent stages must also regenerate.
 * Key = stage id, Value = array of stages that depend on it.
 */
export const STAGE_DEPENDENCIES = {
    shape: ['mountains', 'rivers', 'zones', 'sdf'],     // Coastline affects everything
    mountains: ['rivers', 'zones', 'sdf'],              // Spines affect river flow and zones
    erosion: ['rivers', 'sdf'],                         // Erosion affects river paths
    rivers: ['zones', 'sdf'],                           // Rivers affect zone boundaries
    climate: ['zones', 'sdf'],                          // Climate affects zone classification
    zones: ['roads', 'names', 'sdf'],                   // Zones affect roads and naming
    roads: ['sdf'],                                     // Roads baked into SDF
    names: [],                                          // Names don't affect other stages
    sdf: []                                             // Final stage, no dependents
};

/**
 * Get all stages that need regeneration when a given stage changes.
 *
 * @param {string} changedStage - The stage that changed
 * @returns {Set<string>} Set of stage IDs that need regeneration
 */
export function getDependentStages(changedStage) {
    const needsRegen = new Set([changedStage]);
    const queue = [changedStage];

    while (queue.length > 0) {
        const current = queue.shift();
        const dependents = STAGE_DEPENDENCIES[current] || [];

        for (const dep of dependents) {
            if (!needsRegen.has(dep)) {
                needsRegen.add(dep);
                queue.push(dep);
            }
        }
    }

    return needsRegen;
}

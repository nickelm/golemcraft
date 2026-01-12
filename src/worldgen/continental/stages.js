/**
 * Continental Generation Stages
 *
 * Defines the ordered stages of continental generation with their execute functions.
 * Each stage wraps the corresponding WorldGenerator method and adds progress reporting.
 *
 * Stage order matters - later stages depend on earlier stages' output.
 */

import { STAGE_VERSIONS } from './versions.js';

/**
 * @typedef {Object} GenerationStage
 * @property {string} id - Unique stage identifier
 * @property {string} name - Display name for logs
 * @property {string} activeForm - Present continuous form for loading screen
 * @property {number} version - Stage algorithm version (from STAGE_VERSIONS)
 * @property {number} weight - Relative time weight for progress calculation (1-10)
 * @property {function} execute - Async function to execute the stage
 */

/**
 * All generation stages in execution order.
 * @type {GenerationStage[]}
 */
export const STAGES = [
    {
        id: 'shape',
        name: 'Shaping coastline',
        activeForm: 'Shaping the coastline...',
        version: STAGE_VERSIONS.shape,
        weight: 1,
        /**
         * Validate template and prepare world bounds.
         * Coastline shape is implicit in the template's continentalness function.
         */
        async execute(generator) {
            // Validate template has required properties
            const template = generator.worldGen.template;
            if (!template) {
                console.warn('Continental generation: No template provided, using defaults');
            }

            // Cache world bounds for later stages
            generator.bounds = template?.worldBounds || { min: -2000, max: 2000 };

            // Coastline is defined by continentalness noise - no explicit generation needed
            // This stage exists to provide loading screen feedback during template parsing
        }
    },

    {
        id: 'mountains',
        name: 'Raising mountains',
        activeForm: 'Raising mountain ranges...',
        version: STAGE_VERSIONS.mountains,
        weight: 3,
        /**
         * Generate mountain spines that define major ridgelines.
         * Spines guide river drainage and create elevation structure.
         */
        async execute(generator) {
            const data = generator.worldGen.getWorldData();

            // If spines already generated (from previous partial run), skip
            if (!data.spines || data.spines.length === 0) {
                generator.worldGen._cache.spines = generator.worldGen.generateSpines();
            }

            generator.spines = generator.worldGen._cache.spines;
            console.log(`Raised ${generator.spines.length} mountain spines`);
        }
    },

    {
        id: 'erosion',
        name: 'Simulating erosion',
        activeForm: 'Simulating erosion...',
        version: STAGE_VERSIONS.erosion,
        weight: 2,
        /**
         * Erosion simulation.
         * Currently a placeholder - erosion is computed per-sample in worldgen.js.
         * Future: pre-bake erosion texture for faster chunk generation.
         */
        async execute(generator) {
            // Erosion is currently computed dynamically in getHeightAtNormalized()
            // This stage is a placeholder for future erosion texture baking

            // For now, just yield to allow UI update
            generator.erosionComplete = true;
        }
    },

    {
        id: 'rivers',
        name: 'Carving river valleys',
        activeForm: 'Carving river valleys...',
        version: STAGE_VERSIONS.rivers,
        weight: 5,
        /**
         * Generate river networks from highlands to ocean.
         * Rivers follow terrain gradient with monotonic descent.
         */
        async execute(generator) {
            const data = generator.worldGen.getWorldData();

            // If rivers already generated, skip
            if (!data.rivers || data.rivers.length === 0) {
                generator.worldGen._cache.rivers = generator.worldGen.generateRivers();
            }

            generator.rivers = generator.worldGen._cache.rivers;
            console.log(`Carved ${generator.rivers.length} rivers`);
        }
    },

    {
        id: 'climate',
        name: 'Mapping climate',
        activeForm: 'Mapping climate zones...',
        version: STAGE_VERSIONS.climate,
        weight: 2,
        /**
         * Climate mapping.
         * Temperature and humidity are computed per-sample in worldgen.js.
         * This stage could pre-bake climate texture for faster lookups.
         */
        async execute(generator) {
            // Climate (temperature, humidity) is computed dynamically
            // This stage is a placeholder for future climate texture baking

            generator.climateComplete = true;
        }
    },

    {
        id: 'zones',
        name: 'Drawing zone boundaries',
        activeForm: 'Drawing zone boundaries...',
        version: STAGE_VERSIONS.zones,
        weight: 3,
        /**
         * Discover and classify world zones.
         * Zones define level ranges and gameplay feel for regions.
         */
        async execute(generator) {
            const data = generator.worldGen.getWorldData();

            // If zones already generated, skip
            if (!data.zones || data.zones.size === 0) {
                generator.worldGen._cache.zones = generator.worldGen.discoverZones();
            }

            generator.zones = generator.worldGen._cache.zones;
            console.log(`Discovered ${generator.zones.size} zones`);
        }
    },

    {
        id: 'roads',
        name: 'Planning roads',
        activeForm: 'Planning road network...',
        version: STAGE_VERSIONS.roads,
        weight: 2,
        /**
         * Generate road network connecting settlements.
         * Currently a stub - WorldGenerator.generateRoads() returns empty array.
         */
        async execute(generator) {
            const data = generator.worldGen.getWorldData();

            // Roads and settlements are currently stubs
            if (!data.roads || data.roads.length === 0) {
                generator.worldGen._cache.roads = generator.worldGen.generateRoads();
            }
            if (!data.settlements || data.settlements.length === 0) {
                generator.worldGen._cache.settlements = generator.worldGen.placeSettlements();
            }

            generator.roads = generator.worldGen._cache.roads;
            generator.settlements = generator.worldGen._cache.settlements;
        }
    },

    {
        id: 'names',
        name: 'Naming the land',
        activeForm: 'Naming places...',
        version: STAGE_VERSIONS.names,
        weight: 1,
        /**
         * Generate names for zones.
         * Zone names are already generated in WorldGenerator._generateZoneName().
         * This stage ensures all zones have proper names.
         */
        async execute(generator) {
            // Zone names are generated during discoverZones()
            // This stage verifies naming is complete

            const zones = generator.zones || generator.worldGen._cache.zones;
            let namedCount = 0;

            if (zones) {
                for (const [key, zone] of zones) {
                    if (zone.name && zone.name !== 'Unknown') {
                        namedCount++;
                    }
                }
            }

            console.log(`Named ${namedCount} zones`);
            generator.namingComplete = true;
        }
    },

    {
        id: 'sdf',
        name: 'Finalizing',
        activeForm: 'Baking distance field textures...',
        version: STAGE_VERSIONS.sdf,
        weight: 4,
        /**
         * Bake all SDF (signed distance field) textures for GPU-accelerated lookups.
         * Creates terrain, hydro, infra, and climate textures.
         */
        async execute(generator) {
            await generator._bakeSdfTextures();
            console.log('SDF textures baked');
        }
    }
];

/**
 * Calculate total weight for progress normalization
 */
export const TOTAL_WEIGHT = STAGES.reduce((sum, stage) => sum + stage.weight, 0);

/**
 * Get stage by ID
 *
 * @param {string} id - Stage identifier
 * @returns {GenerationStage|undefined} Stage object or undefined
 */
export function getStageById(id) {
    return STAGES.find(s => s.id === id);
}

/**
 * Get stages that need regeneration based on stored versions
 *
 * @param {Object} storedVersions - Version numbers from stored metadata
 * @returns {string[]} Array of stage IDs that need regeneration
 */
export function getStaleStages(storedVersions) {
    if (!storedVersions) {
        return STAGES.map(s => s.id);
    }

    return STAGES
        .filter(stage => storedVersions[stage.id] !== stage.version)
        .map(s => s.id);
}

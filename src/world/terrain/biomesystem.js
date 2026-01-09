/**
 * BiomeSystem - Extensible biome definitions and configuration
 * 
 * Defines all biome types with their terrain characteristics,
 * surface blocks, objects, mobs, and future mechanics.
 */

/**
 * Biome Definitions
 *
 * Each biome defines:
 * - name: Display name
 * - baseHeight: Base terrain height
 * - heightScale: Vertical variation
 * - terrain: { primary, tint } - Surface texture and RGB tint (0-1, linear space)
 * - subsurface: { primary, tint } - Block type 1-3 blocks below surface
 * - underwater: { primary, tint } - Surface block when underwater
 * - objects: Array of object types that can spawn
 * - objectDensities: Spawn density per object type (0-1)
 * - mobs: Array of mob types that can spawn in this biome
 * - spawnWeights: Relative spawn rates for mobs
 */
export const BIOMES = {
    // WATER BIOMES (sand-based)
    ocean: {
        name: 'Ocean',
        baseHeight: 3,
        heightScale: 2,
        terrain: { primary: 'sand', tint: [1.3, 1.5, 1.8] },  // Bright blue-tinted sand
        subsurface: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        underwater: { primary: 'sand', tint: [0.7, 0.85, 1.0] },
        objects: [],
        objectDensities: {},
        mobs: [],
        spawnWeights: {}
    },

    beach: {
        name: 'Beach',
        baseHeight: 6,
        heightScale: 1,
        terrain: { primary: 'sand', tint: [1.8, 1.7, 1.4] },  // Very bright sandy beach
        subsurface: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        underwater: { primary: 'sand', tint: [1.0, 0.98, 0.92] },
        objects: ['rock'],
        objectDensities: { rock: 0.005 },
        mobs: [],
        spawnWeights: {}
    },

    // TEMPERATE BIOMES (grass-based)
    plains: {
        name: 'Plains',
        baseHeight: 8,
        heightScale: 6,
        terrain: { primary: 'grass', tint: [1.0, 1.6, 0.9] },  // Bright vibrant green grass
        subsurface: { primary: 'dirt', tint: [1.0, 1.0, 1.0] },
        underwater: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        objects: ['tree', 'rock', 'grass'],
        objectDensities: {
            tree: 0.08,      // Forest clustering applied
            rock: 0.015,
            grass: 0         // Disabled for performance
        },
        mobs: ['cow', 'pig', 'chicken', 'zombie', 'creeper'],
        spawnWeights: {
            cow: 30,
            pig: 35,
            chicken: 40,
            zombie: 30,
            creeper: 15
        }
    },

    savanna: {
        name: 'Savanna',
        baseHeight: 8,
        heightScale: 4,
        terrain: { primary: 'grass', tint: [1.6, 1.5, 0.9] },  // Bright golden savanna grass
        subsurface: { primary: 'dirt', tint: [1.0, 0.9, 0.8] },
        underwater: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        objects: ['tree', 'rock'],
        objectDensities: { tree: 0.02, rock: 0.01 },
        mobs: ['cow', 'zombie', 'creeper'],
        spawnWeights: { cow: 40, zombie: 25, creeper: 15 }
    },

    taiga: {
        name: 'Taiga',
        baseHeight: 9,
        heightScale: 5,
        terrain: { primary: 'grass', tint: [0.9, 1.4, 1.2] },  // Bright cool teal-green grass
        subsurface: { primary: 'dirt', tint: [0.9, 0.9, 0.85] },
        underwater: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        objects: ['snowTree', 'rock'],
        objectDensities: { snowTree: 0.1, rock: 0.015 },
        mobs: ['zombie', 'skeleton'],
        spawnWeights: { zombie: 30, skeleton: 25 }
    },

    // FOREST BIOMES (forest_floor-based)
    jungle: {
        name: 'Jungle',
        baseHeight: 10,
        heightScale: 8,
        terrain: { primary: 'forest_floor', tint: [0.9, 1.4, 0.8] },  // Bright lush jungle green
        subsurface: { primary: 'dirt', tint: [0.8, 0.7, 0.5] },
        underwater: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        objects: ['jungleTree', 'rock'],
        objectDensities: {
            jungleTree: 0.12,    // Dense jungle trees
            rock: 0.01
        },
        mobs: ['zombie', 'creeper', 'chicken'],
        spawnWeights: {
            zombie: 30,
            creeper: 20,
            chicken: 35
        }
    },

    rainforest: {
        name: 'Rainforest',
        baseHeight: 11,
        heightScale: 9,
        terrain: { primary: 'forest_floor', tint: [0.8, 1.7, 0.9] },  // Very bright vibrant green
        subsurface: { primary: 'dirt', tint: [0.7, 0.6, 0.4] },
        underwater: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        objects: ['jungleTree', 'rock'],
        objectDensities: { jungleTree: 0.15, rock: 0.008 },
        mobs: ['zombie', 'creeper', 'chicken'],
        spawnWeights: { zombie: 30, creeper: 20, chicken: 40 }
    },

    swamp: {
        name: 'Swamp',
        baseHeight: 6,
        heightScale: 3,
        terrain: { primary: 'forest_floor', tint: [0.8, 1.1, 0.8] },  // Brighter swamp green
        subsurface: { primary: 'dirt', tint: [0.5, 0.5, 0.45] },
        underwater: { primary: 'sand', tint: [0.6, 0.7, 0.6] },
        objects: ['tree', 'rock'],
        objectDensities: { tree: 0.05, rock: 0.02 },
        mobs: ['zombie', 'skeleton'],
        spawnWeights: { zombie: 40, skeleton: 30 }
    },

    // DRY BIOMES (sand-based)
    desert: {
        name: 'Desert',
        baseHeight: 7,
        heightScale: 4,
        terrain: { primary: 'sand', tint: [1.7, 1.6, 1.2] },  // Bright golden desert sand
        subsurface: { primary: 'sand', tint: [1.0, 0.9, 0.7] },
        underwater: { primary: 'sand', tint: [1.0, 0.92, 0.7] },
        objects: ['cactus', 'rock'],
        objectDensities: {
            cactus: 0.02,
            rock: 0.01
        },
        mobs: ['zombie', 'creeper', 'chicken'],
        spawnWeights: {
            zombie: 30,
            creeper: 15,
            chicken: 40
        }
    },

    badlands: {
        name: 'Badlands',
        baseHeight: 9,
        heightScale: 12,
        terrain: { primary: 'sand', tint: [1.6, 0.9, 0.6] },  // Bright red-orange badlands
        subsurface: { primary: 'sand', tint: [0.85, 0.45, 0.25] },
        underwater: { primary: 'sand', tint: [0.9, 0.5, 0.3] },
        objects: ['rock'],
        objectDensities: { rock: 0.025 },
        mobs: ['zombie', 'skeleton'],
        spawnWeights: { zombie: 30, skeleton: 25 }
    },

    // COLD BIOMES (snow-based)
    snow: {
        name: 'Snowy Plains',
        baseHeight: 9,
        heightScale: 5,
        terrain: { primary: 'snow', tint: [2.0, 2.0, 2.0] },  // Bright white snow
        subsurface: { primary: 'dirt', tint: [1.0, 1.0, 1.0] },
        underwater: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        objects: ['snowTree', 'rock'],
        objectDensities: {
            snowTree: 0.06,  // Forest clustering applied
            rock: 0.015
        },
        mobs: ['zombie', 'skeleton'],
        spawnWeights: {
            zombie: 30,
            skeleton: 25
        }
    },

    tundra: {
        name: 'Tundra',
        baseHeight: 8,
        heightScale: 3,
        terrain: { primary: 'snow', tint: [1.7, 1.8, 2.0] },  // Bright blue-white snow
        subsurface: { primary: 'dirt', tint: [0.85, 0.85, 0.9] },
        underwater: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        objects: ['rock'],
        objectDensities: { rock: 0.02 },
        mobs: ['skeleton', 'zombie'],
        spawnWeights: { skeleton: 30, zombie: 25 }
    },

    alpine: {
        name: 'Alpine',
        baseHeight: 20,
        heightScale: 15,
        terrain: { primary: 'snow', tint: [2.0, 1.8, 1.9] },  // Bright pink-tinted alpine snow
        subsurface: { primary: 'rock', tint: [0.9, 0.9, 0.9] },
        underwater: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        objects: ['boulder', 'rock'],
        objectDensities: { boulder: 0.015, rock: 0.02 },
        mobs: ['skeleton'],
        spawnWeights: { skeleton: 40 }
    },

    // MOUNTAIN BIOMES (rock-based)
    mountains: {
        name: 'Mountains',
        baseHeight: 18,
        heightScale: 20,
        terrain: { primary: 'rock', tint: [1.5, 1.5, 1.6] },  // Bright grey-blue rock
        subsurface: { primary: 'rock', tint: [0.85, 0.85, 0.9] },
        underwater: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        objects: ['boulder', 'rock'],
        objectDensities: {
            boulder: 0.02,
            rock: 0.015
        },
        mobs: ['skeleton', 'zombie'],
        spawnWeights: {
            skeleton: 25,
            zombie: 30
        }
    },

    highlands: {
        name: 'Highlands',
        baseHeight: 15,
        heightScale: 12,
        terrain: { primary: 'rock', tint: [1.6, 1.5, 1.4] },  // Bright warm rock
        subsurface: { primary: 'rock', tint: [0.9, 0.88, 0.85] },
        underwater: { primary: 'sand', tint: [1.0, 1.0, 1.0] },
        objects: ['boulder', 'rock', 'tree'],
        objectDensities: { boulder: 0.015, rock: 0.01, tree: 0.03 },
        mobs: ['skeleton', 'zombie'],
        spawnWeights: { skeleton: 25, zombie: 30 }
    },

    volcanic: {
        name: 'Volcanic',
        baseHeight: 12,
        heightScale: 18,
        terrain: { primary: 'rock', tint: [1.3, 0.7, 0.5] },  // Bright red-brown volcanic rock
        subsurface: { primary: 'rock', tint: [0.5, 0.25, 0.2] },
        underwater: { primary: 'sand', tint: [0.7, 0.4, 0.3] },
        objects: ['boulder', 'rock'],
        objectDensities: { boulder: 0.025, rock: 0.02 },
        mobs: ['zombie', 'skeleton', 'creeper'],
        spawnWeights: { zombie: 35, skeleton: 30, creeper: 20 }
    }
};

/**
 * Get biome configuration by name
 * @param {string} biomeName - Name of biome
 * @returns {Object} Biome configuration object
 */
export function getBiomeConfig(biomeName) {
    return BIOMES[biomeName];
}

/**
 * Get all biome names
 * @returns {Array<string>} Array of biome names
 */
export function getBiomeNames() {
    return Object.keys(BIOMES);
}

/**
 * Check if an object type should spawn in a biome
 * @param {string} biomeName - Biome name
 * @param {string} objectType - Object type
 * @returns {boolean} True if object can spawn in biome
 */
export function canObjectSpawnInBiome(biomeName, objectType) {
    const biome = BIOMES[biomeName];
    return biome && biome.objects.includes(objectType);
}

/**
 * Get object density for a biome
 * @param {string} biomeName - Biome name
 * @param {string} objectType - Object type
 * @returns {number} Density value (0-1), or 0 if not applicable
 */
export function getObjectDensity(biomeName, objectType) {
    const biome = BIOMES[biomeName];
    return biome?.objectDensities?.[objectType] || 0;
}

/**
 * Check if a mob type can spawn in a biome
 * @param {string} biomeName - Biome name
 * @param {string} mobType - Mob type
 * @returns {boolean} True if mob can spawn in biome
 */
export function canMobSpawnInBiome(biomeName, mobType) {
    const biome = BIOMES[biomeName];
    return biome && biome.mobs.includes(mobType);
}

/**
 * Get spawn weight for a mob in a biome
 * @param {string} biomeName - Biome name
 * @param {string} mobType - Mob type
 * @returns {number} Spawn weight, or 0 if not applicable
 */
export function getMobSpawnWeight(biomeName, mobType) {
    const biome = BIOMES[biomeName];
    return biome?.spawnWeights?.[mobType] || 0;
}

/**
 * Get surface texture name for a biome (backward compatible helper)
 * @param {string} biomeName - Biome name
 * @returns {string} Texture name (e.g., 'grass', 'sand', 'rock')
 */
export function getSurfaceTexture(biomeName) {
    const biome = BIOMES[biomeName];
    if (!biome) return 'grass';  // Fallback
    return biome.terrain?.primary || biome.surface || 'grass';
}

/**
 * Get surface tint color for a biome
 * @param {string} biomeName - Biome name
 * @returns {Array<number>} RGB tint color [r, g, b] in linear space (0-1)
 */
export function getSurfaceTint(biomeName) {
    const biome = BIOMES[biomeName];
    if (!biome) return [1.0, 1.0, 1.0];  // Neutral white fallback
    return biome.terrain?.tint || [1.0, 1.0, 1.0];
}

/**
 * Get subsurface texture name for a biome
 * @param {string} biomeName - Biome name
 * @returns {string} Texture name
 */
export function getSubsurfaceTexture(biomeName) {
    const biome = BIOMES[biomeName];
    if (!biome) return 'dirt';
    return biome.subsurface?.primary || biome.subsurface || 'dirt';
}

/**
 * Get subsurface tint color for a biome
 * @param {string} biomeName - Biome name
 * @returns {Array<number>} RGB tint color [r, g, b]
 */
export function getSubsurfaceTint(biomeName) {
    const biome = BIOMES[biomeName];
    if (!biome) return [1.0, 1.0, 1.0];
    return biome.subsurface?.tint || [1.0, 1.0, 1.0];
}

/**
 * Get underwater texture name for a biome
 * @param {string} biomeName - Biome name
 * @returns {string} Texture name
 */
export function getUnderwaterTexture(biomeName) {
    const biome = BIOMES[biomeName];
    if (!biome) return 'sand';
    return biome.underwater?.primary || biome.underwater || 'sand';
}

/**
 * Get underwater tint color for a biome
 * @param {string} biomeName - Biome name
 * @returns {Array<number>} RGB tint color [r, g, b]
 */
export function getUnderwaterTint(biomeName) {
    const biome = BIOMES[biomeName];
    if (!biome) return [1.0, 1.0, 1.0];
    return biome.underwater?.tint || [1.0, 1.0, 1.0];
}
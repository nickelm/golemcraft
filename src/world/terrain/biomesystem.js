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
 * - surface: Primary surface block type
 * - subsurface: Block type 1-3 blocks below surface
 * - underwater: Surface block when underwater
 * - objects: Array of object types that can spawn
 * - objectDensities: Spawn density per object type (0-1)
 * - mobs: Array of mob types that can spawn in this biome
 * - spawnWeights: Relative spawn rates for mobs
 */
export const BIOMES = {
    ocean: {
        name: 'Ocean',
        baseHeight: 3,
        heightScale: 2,
        surface: 'sand',
        subsurface: 'sand',
        underwater: 'sand',
        objects: [],
        objectDensities: {},
        mobs: [],
        spawnWeights: {}
    },
    
    plains: {
        name: 'Plains',
        baseHeight: 8,
        heightScale: 6,
        surface: 'grass',
        subsurface: 'dirt',
        underwater: 'sand',
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
    
    desert: {
        name: 'Desert',
        baseHeight: 7,
        heightScale: 4,
        surface: 'sand',
        subsurface: 'sand',
        underwater: 'sand',
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
    
    snow: {
        name: 'Snowy Plains',
        baseHeight: 9,
        heightScale: 5,
        surface: 'snow',
        subsurface: 'dirt',
        underwater: 'sand',
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
    
    mountains: {
        name: 'Mountains',
        baseHeight: 18,
        heightScale: 20,
        surface: 'stone',
        subsurface: 'stone',
        underwater: 'sand',
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
    
    jungle: {
        name: 'Jungle',
        baseHeight: 10,
        heightScale: 8,
        surface: 'grass',
        subsurface: 'dirt',
        underwater: 'sand',
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
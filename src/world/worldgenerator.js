/**
 * WorldGenerator - Global world feature generation pipeline
 *
 * Generates and caches global features: rivers, lakes, zones, roads, settlements, landmarks.
 * Pure class with no DOM/Three.js dependencies - compatible with both main thread and workers.
 *
 * The pipeline runs once when world is created; results are cached and saved with the world.
 */

import {
    deriveSeed,
    getTerrainParams,
    getCoastProximity
} from './terrain/worldgen.js';
import { DEFAULT_TEMPLATE, VERDANIA_TEMPLATE } from './terrain/templates.js';

// Grid sizes for spatial indexing (match existing patterns)
const ZONE_GRID_SIZE = 800;  // ~5×5 = 25 max grid cells, filtered to 10-15 land zones
const LANDMARK_GRID_SIZE = 128;

// World boundaries for zone discovery (fixed 4000-block world)
const WORLD_BOUNDS = {
    min: -2000,
    max: 2000,
    size: 4000
};

// Zone type definitions with associated mood/feel metadata
const ZONE_TYPES = {
    haven: { mood: 'safe', openness: 0.8, danger: 0.1 },
    crossroads: { mood: 'busy', openness: 0.7, danger: 0.3 },
    borderlands: { mood: 'tense', openness: 0.5, danger: 0.6 },
    wilderness: { mood: 'wild', openness: 0.6, danger: 0.5 },
    mountains: { mood: 'harsh', openness: 0.3, danger: 0.7 },
    coast: { mood: 'calm', openness: 0.9, danger: 0.2 },
    forest: { mood: 'mysterious', openness: 0.3, danger: 0.4 },
    desert: { mood: 'desolate', openness: 1.0, danger: 0.5 },
    ocean: { mood: 'vast', openness: 1.0, danger: 0.3 }
};

/**
 * WorldGenerator class - orchestrates global world feature generation
 */
export class WorldGenerator {
    /**
     * @param {number} seed - World seed for deterministic generation
     * @param {Object|null} template - Continent template (defaults to DEFAULT_TEMPLATE)
     */
    constructor(seed, template = null) {
        this.seed = seed;
        this.template = template || DEFAULT_TEMPLATE;
        this._cache = null;
    }

    /**
     * Run full generation pipeline and cache results
     * @returns {Object} Generated world data
     */
    generate() {
        this._cache = {
            seed: this.seed,
            template: this._getTemplateName(),
            rivers: this.generateRivers(),
            lakes: this.discoverLakes(),
            zones: this.discoverZones(),
            roads: this.generateRoads(),
            settlements: this.placeSettlements(),
            landmarks: this.placeLandmarks(),
        };
        return this._cache;
    }

    /**
     * Get cached world data, generating if needed
     * @returns {Object} World data
     */
    getWorldData() {
        if (!this._cache) {
            return this.generate();
        }
        return this._cache;
    }

    /**
     * Generate river networks
     * TODO(design): Implement river generation using flow simulation
     * Rivers should flow from high elevation to ocean/lakes
     * @returns {Array} Array of river objects
     */
    generateRivers() {
        // Stub - will use deriveSeed(this.seed, 'rivers') for determinism
        return [];
    }

    /**
     * Discover natural lakes based on terrain
     * TODO(design): Implement lake discovery
     * Lakes form in terrain depressions (local minima)
     * @returns {Array} Array of lake objects
     */
    discoverLakes() {
        // Stub - will use deriveSeed(this.seed, 'lakes') for determinism
        return [];
    }

    /**
     * Discover and classify world zones
     * Analyzes terrain to find natural regions and assign level-appropriate zones.
     * @returns {Map} Map of zone data by grid key "gridX,gridZ"
     */
    discoverZones() {
        const zones = new Map();

        // Phase 1: Find key landmarks
        const haven = this._findHavenLocation();
        const lakes = this._findLakes();
        const passes = this._findMountainPasses();

        // Phase 2: Place anchor zones
        if (haven) {
            const havenZone = this._createZone('Haven', 'haven', haven, [1, 3]);
            zones.set(havenZone.gridKey, havenZone);
        }

        for (const lake of lakes) {
            const lakeZone = this._createZone('Lake Settlement', 'crossroads',
                lake.bestShore, [8, 10]);
            if (!zones.has(lakeZone.gridKey)) {
                zones.set(lakeZone.gridKey, lakeZone);
            }
        }

        for (const pass of passes) {
            const passZone = this._createZone('Borderlands', 'borderlands',
                pass, [18, 20]);
            if (!zones.has(passZone.gridKey)) {
                zones.set(passZone.gridKey, passZone);
            }
        }

        // Phase 3: Fill remaining grid cells
        this._fillProceduralZones(zones, haven);

        // Phase 4: Compute adjacencies
        this._computeAdjacencies(zones);

        return zones;
    }

    /**
     * Generate road network connecting settlements
     * TODO(design): Implement road generation
     * Roads connect settlements via pathfinding
     * @returns {Array} Array of road objects
     */
    generateRoads() {
        // Stub - will use deriveSeed(this.seed, 'roads') for determinism
        return [];
    }

    /**
     * Place settlements in suitable locations
     * TODO(design): Implement settlement placement
     * Settlements prefer flat terrain near water
     * @returns {Array} Array of settlement objects
     */
    placeSettlements() {
        // Stub - will use deriveSeed(this.seed, 'settlements') for determinism
        return [];
    }

    /**
     * Place major landmarks
     * TODO(design): Implement landmark placement
     * Coordinates with WorkerLandmarkSystem for per-chunk generation
     * @returns {Map} Map of landmark data by grid key "gridX,gridZ"
     */
    placeLandmarks() {
        // Stub - will use deriveSeed(this.seed, 'landmarks') for determinism
        return new Map();
    }

    /**
     * Serialize world data for save/load
     * Converts Maps to arrays for JSON compatibility
     * @returns {string} JSON string of world data
     */
    serialize() {
        const data = this.getWorldData();

        const serializable = {
            seed: data.seed,
            template: data.template,
            rivers: data.rivers,
            lakes: data.lakes,
            zones: Array.from(data.zones.entries()),
            roads: data.roads,
            settlements: data.settlements,
            landmarks: Array.from(data.landmarks.entries())
        };

        return JSON.stringify(serializable);
    }

    /**
     * Deserialize world data from JSON
     * @param {string} json - JSON string from serialize()
     * @returns {WorldGenerator} New WorldGenerator instance with restored data
     */
    static deserialize(json) {
        const data = JSON.parse(json);

        const generator = new WorldGenerator(data.seed);
        generator._cache = {
            seed: data.seed,
            template: data.template,
            rivers: data.rivers || [],
            lakes: data.lakes || [],
            zones: new Map(data.zones || []),
            roads: data.roads || [],
            settlements: data.settlements || [],
            landmarks: new Map(data.landmarks || [])
        };

        return generator;
    }

    /**
     * Get template name from template object
     * @private
     * @returns {string} Template name
     */
    _getTemplateName() {
        if (!this.template) return 'procedural';
        if (this.template === DEFAULT_TEMPLATE) return 'default';
        if (this.template === VERDANIA_TEMPLATE) return 'verdania';
        return this.template.name || 'custom';
    }

    /**
     * Hash function for deterministic placement (matches WorkerLandmarkSystem)
     * @private
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @param {number} salt - Additional salt value
     * @returns {number} Hash value in [0, 1]
     */
    _hash(x, z, salt = 0) {
        let h = this.seed + salt + x * 374761393 + z * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
    }

    // ========== Zone Discovery Helpers ==========

    /**
     * Find the best haven (starting zone) location
     * Searches for sheltered coastal spots with low elevation
     * @private
     * @returns {Object} Location with x, z, score properties
     */
    _findHavenLocation() {
        const candidates = [];
        const sampleStep = 128;

        for (let x = WORLD_BOUNDS.min; x <= WORLD_BOUNDS.max; x += sampleStep) {
            for (let z = WORLD_BOUNDS.min; z <= WORLD_BOUNDS.max; z += sampleStep) {
                const params = getTerrainParams(x, z, this.seed, this.template);

                // Must be on land near coast
                if (params.waterType !== 'none') continue;
                const coastProximity = getCoastProximity(x, z, this.seed, this.template);
                if (coastProximity < 0.2) continue;

                // Score by shelteredness (prefer bays, low elevation, low ridgeness)
                const score = coastProximity * 0.4 +
                              (1 - params.ridgeness) * 0.3 +
                              (1 - params.heightNormalized) * 0.3;

                candidates.push({ x, z, score });
            }
        }

        // Return best candidate
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0] || { x: 0, z: 0, score: 0 };
    }

    /**
     * Find inland lakes (shallow water surrounded by land)
     * @private
     * @returns {Array} Array of lake objects with center and bestShore
     */
    _findLakes() {
        const lakes = [];
        const visited = new Set();
        const sampleStep = 64;

        for (let x = WORLD_BOUNDS.min; x <= WORLD_BOUNDS.max; x += sampleStep) {
            for (let z = WORLD_BOUNDS.min; z <= WORLD_BOUNDS.max; z += sampleStep) {
                const key = `${Math.floor(x / 256)},${Math.floor(z / 256)}`;
                if (visited.has(key)) continue;

                const params = getTerrainParams(x, z, this.seed, this.template);

                // Check for shallow water (lakes) vs deep (ocean)
                if (params.waterType === 'shallow') {
                    const isInland = this._isInlandWater(x, z);
                    if (isInland) {
                        const bestShore = this._findBestShore(x, z);
                        lakes.push({ center: { x, z }, bestShore });
                        visited.add(key);
                    }
                }
            }
        }

        return lakes;
    }

    /**
     * Find mountain passes (saddle points in high terrain)
     * @private
     * @returns {Array} Array of pass locations {x, z}
     */
    _findMountainPasses() {
        const passes = [];
        const sampleStep = 128;

        for (let x = WORLD_BOUNDS.min; x <= WORLD_BOUNDS.max; x += sampleStep) {
            for (let z = WORLD_BOUNDS.min; z <= WORLD_BOUNDS.max; z += sampleStep) {
                const params = getTerrainParams(x, z, this.seed, this.template);

                // Look for mid-elevation in mountain biomes
                if (!['mountains', 'alpine', 'highlands'].includes(params.biome)) continue;
                if (params.heightNormalized > 0.6) continue;
                if (params.heightNormalized < 0.35) continue;

                // Check if surrounded by higher terrain (saddle point)
                const isSaddle = this._isSaddlePoint(x, z, params.heightNormalized);
                if (isSaddle) {
                    passes.push({ x, z });
                }
            }
        }

        return passes;
    }

    /**
     * Create a zone object
     * @private
     * @param {string} name - Zone display name
     * @param {string} type - Zone type (haven, wilderness, etc.)
     * @param {Object} center - Center position {x, z}
     * @param {Array} levels - Level range [min, max]
     * @returns {Object} Zone object
     */
    _createZone(name, type, center, levels) {
        const gridX = Math.floor(center.x / ZONE_GRID_SIZE);
        const gridZ = Math.floor(center.z / ZONE_GRID_SIZE);
        const feel = ZONE_TYPES[type] || ZONE_TYPES.wilderness;

        return {
            id: `${type}_${gridX}_${gridZ}`,
            name,
            type,
            center: { x: center.x, z: center.z },
            gridKey: `${gridX},${gridZ}`,
            radius: ZONE_GRID_SIZE / 2,
            levels,
            feel: { ...feel },
            adjacentZones: []
        };
    }

    /**
     * Fill remaining grid cells with procedural zones
     * @private
     * @param {Map} zones - Existing zones map (modified in place)
     * @param {Object} haven - Haven location for distance calculation
     */
    _fillProceduralZones(zones, haven) {
        const havenX = haven?.x || 0;
        const havenZ = haven?.z || 0;

        const minGrid = Math.floor(WORLD_BOUNDS.min / ZONE_GRID_SIZE);
        const maxGrid = Math.floor(WORLD_BOUNDS.max / ZONE_GRID_SIZE);

        for (let gx = minGrid; gx <= maxGrid; gx++) {
            for (let gz = minGrid; gz <= maxGrid; gz++) {
                const key = `${gx},${gz}`;
                if (zones.has(key)) continue;

                const centerX = gx * ZONE_GRID_SIZE + ZONE_GRID_SIZE / 2;
                const centerZ = gz * ZONE_GRID_SIZE + ZONE_GRID_SIZE / 2;

                // Sample land coverage across the cell
                const landRatio = this._sampleLandCoverage(centerX, centerZ, ZONE_GRID_SIZE);

                // Skip cells that are mostly water (ocean or coastal water)
                if (landRatio < 0.3) continue;

                // Calculate distance from haven
                const dist = Math.sqrt(
                    Math.pow(centerX - havenX, 2) +
                    Math.pow(centerZ - havenZ, 2)
                );

                // Get terrain characteristics at center
                const params = getTerrainParams(centerX, centerZ, this.seed, this.template);

                // Determine zone type and levels
                const { type, levels, name } = this._classifyZone(params, dist, gx, gz);

                const zone = this._createZone(name, type, { x: centerX, z: centerZ }, levels);
                zones.set(key, zone);
            }
        }
    }

    /**
     * Classify a zone based on terrain and distance from haven
     * @private
     * @param {Object} params - Terrain parameters
     * @param {number} distanceFromHaven - Distance from haven in blocks
     * @param {number} gridX - Grid X coordinate for unique naming
     * @param {number} gridZ - Grid Z coordinate for unique naming
     * @returns {Object} Classification {type, levels, name}
     */
    _classifyZone(params, distanceFromHaven, gridX = 0, gridZ = 0) {
        // Skip ocean
        if (params.biome === 'ocean') {
            return { type: 'ocean', levels: [1, 1], name: 'Ocean' };
        }

        // Base levels from distance
        let baseLevelMin, baseLevelMax;
        if (distanceFromHaven < 500) {
            baseLevelMin = 1; baseLevelMax = 5;
        } else if (distanceFromHaven < 1000) {
            baseLevelMin = 5; baseLevelMax = 10;
        } else if (distanceFromHaven < 1500) {
            baseLevelMin = 10; baseLevelMax = 15;
        } else {
            baseLevelMin = 15; baseLevelMax = 20;
        }

        // Elevation modifier (higher = more dangerous)
        const elevBonus = Math.floor(params.heightNormalized * 3);
        const levels = [
            Math.min(20, baseLevelMin + elevBonus),
            Math.min(20, baseLevelMax + elevBonus)
        ];

        // Determine type from biome
        const type = this._biomeToZoneType(params.biome);
        const name = this._generateZoneName(type, params.biome, gridX, gridZ);

        return { type, levels, name };
    }

    /**
     * Map biome to zone type
     * @private
     * @param {string} biome - Biome name
     * @returns {string} Zone type
     */
    _biomeToZoneType(biome) {
        const mapping = {
            ocean: 'ocean',
            beach: 'coast',
            plains: 'wilderness',
            meadow: 'wilderness',
            savanna: 'wilderness',
            desert: 'desert',
            red_desert: 'desert',
            swamp: 'wilderness',
            jungle: 'forest',
            rainforest: 'forest',
            deciduous_forest: 'forest',
            autumn_forest: 'forest',
            taiga: 'forest',
            tundra: 'wilderness',
            snow: 'wilderness',
            mountains: 'mountains',
            alpine: 'mountains',
            highlands: 'mountains',
            glacier: 'mountains',
            badlands: 'borderlands',
            volcanic: 'borderlands'
        };
        return mapping[biome] || 'wilderness';
    }

    /**
     * Generate a zone name based on type and biome
     * @private
     * @param {string} type - Zone type
     * @param {string} biome - Biome name
     * @param {number} gridX - Grid X coordinate for unique naming
     * @param {number} gridZ - Grid Z coordinate for unique naming
     * @returns {string} Generated zone name
     */
    _generateZoneName(type, biome, gridX = 0, gridZ = 0) {
        const prefixes = {
            wilderness: ['Verdant', 'Wild', 'Untamed', 'Open', 'Rolling', 'Sunlit'],
            forest: ['Dark', 'Ancient', 'Whispering', 'Mossy', 'Thornwood', 'Shadowed'],
            mountains: ['High', 'Frozen', 'Jagged', 'Storm', 'Iron', 'Granite'],
            desert: ['Scorched', 'Endless', 'Sun-bleached', 'Amber', 'Dusty'],
            coast: ['Windswept', 'Sandy', 'Rocky', 'Coral', 'Driftwood'],
            borderlands: ['Contested', 'Rugged', 'Treacherous', 'Broken', 'Scarred'],
            ocean: ['Deep', 'Vast', 'Open']
        };
        const suffixes = {
            wilderness: ['Wilds', 'Fields', 'Plains', 'Meadows', 'Grasslands'],
            forest: ['Woods', 'Forest', 'Grove', 'Thicket', 'Timberland'],
            mountains: ['Peaks', 'Heights', 'Crags', 'Ridges', 'Summits'],
            desert: ['Wastes', 'Dunes', 'Barrens', 'Expanse'],
            coast: ['Shore', 'Coast', 'Strand', 'Cove'],
            borderlands: ['Marches', 'Frontier', 'Reaches', 'Borderlands'],
            ocean: ['Waters', 'Depths', 'Sea']
        };

        // Use grid position for unique deterministic name per zone
        const prefixList = prefixes[type] || ['Unknown'];
        const suffixList = suffixes[type] || ['Lands'];
        const prefixIndex = Math.abs(this._hash(gridX, gridZ, type.length) * prefixList.length) | 0;
        const suffixIndex = Math.abs(this._hash(gridX + 100, gridZ + 100, type.length + 7) * suffixList.length) | 0;
        const prefix = prefixList[prefixIndex % prefixList.length];
        const suffix = suffixList[suffixIndex % suffixList.length];

        return `${prefix} ${suffix}`.trim();
    }

    /**
     * Check if water at position is inland (surrounded by land)
     * @private
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @returns {boolean} True if inland water
     */
    _isInlandWater(x, z) {
        const checkDist = 256;
        let landCount = 0;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const params = getTerrainParams(
                    x + dx * checkDist,
                    z + dz * checkDist,
                    this.seed,
                    this.template
                );
                if (params.waterType === 'none') landCount++;
            }
        }

        return landCount >= 4; // At least half surrounded by land
    }

    /**
     * Find the best shore location near water
     * @private
     * @param {number} x - Water X coordinate
     * @param {number} z - Water Z coordinate
     * @returns {Object} Best shore location {x, z}
     */
    _findBestShore(x, z) {
        const checkDist = 64;

        for (let r = checkDist; r <= 512; r += checkDist) {
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                const checkX = x + Math.cos(angle) * r;
                const checkZ = z + Math.sin(angle) * r;
                const params = getTerrainParams(checkX, checkZ, this.seed, this.template);
                if (params.waterType === 'none') {
                    return { x: checkX, z: checkZ };
                }
            }
        }

        return { x, z };
    }

    /**
     * Check if position is a saddle point (surrounded by higher terrain)
     * @private
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @param {number} height - Current normalized height
     * @returns {boolean} True if saddle point
     */
    _isSaddlePoint(x, z, height) {
        const checkDist = 64;
        let higherCount = 0;

        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dz] of dirs) {
            const params = getTerrainParams(
                x + dx * checkDist,
                z + dz * checkDist,
                this.seed,
                this.template
            );
            if (params.heightNormalized > height + 0.1) higherCount++;
        }

        return higherCount >= 2;
    }

    /**
     * Sample land coverage ratio within a zone cell
     * @private
     * @param {number} centerX - Cell center X
     * @param {number} centerZ - Cell center Z
     * @param {number} size - Cell size
     * @returns {number} Land ratio in [0, 1]
     */
    _sampleLandCoverage(centerX, centerZ, size) {
        const samples = 9;  // 3×3 grid
        const step = size / 3;
        let landCount = 0;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const x = centerX + dx * step;
                const z = centerZ + dz * step;
                const params = getTerrainParams(x, z, this.seed, this.template);
                if (params.waterType === 'none') {
                    landCount++;
                }
            }
        }

        return landCount / samples;
    }

    /**
     * Compute zone adjacencies
     * @private
     * @param {Map} zones - Zones map (modified in place)
     */
    _computeAdjacencies(zones) {
        for (const [key, zone] of zones) {
            const [gx, gz] = key.split(',').map(Number);

            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const neighborKey = `${gx + dx},${gz + dz}`;
                    if (zones.has(neighborKey)) {
                        zone.adjacentZones.push(neighborKey);
                    }
                }
            }
        }
    }
}

// Singleton instance for shared access
let _sharedInstance = null;

/**
 * Get the shared WorldGenerator instance
 * @returns {WorldGenerator|null} Shared instance or null if not initialized
 */
export function getSharedWorldGenerator() {
    return _sharedInstance;
}

/**
 * Initialize the shared WorldGenerator instance
 * @param {number} seed - World seed
 * @param {Object|null} template - Continent template
 * @returns {WorldGenerator} The initialized shared instance
 */
export function initSharedWorldGenerator(seed, template = null) {
    _sharedInstance = new WorldGenerator(seed, template);
    return _sharedInstance;
}

/**
 * Factory function to create a new WorldGenerator
 * @param {number} seed - World seed
 * @param {Object|null} template - Continent template
 * @returns {WorldGenerator} New WorldGenerator instance
 */
export function createWorldGenerator(seed, template = null) {
    return new WorldGenerator(seed, template);
}

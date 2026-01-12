/**
 * Serialization Utilities
 *
 * Functions for converting world generator output to/from JSON-compatible format.
 * Handles Map <-> Array conversion, Feature class serialization, etc.
 */

import { SpineFeature } from '../world/features/spinefeature.js';
import { LinearFeature } from '../world/features/linearfeature.js';

// =============================================================================
// Continent Metadata Serialization
// =============================================================================

/**
 * Serialize WorldGenerator output to storage-compatible format
 *
 * @param {Object} worldGenOutput - Output from WorldGenerator.generate()
 * @returns {Object} Serialized continent data
 */
export function serializeContinent(worldGenOutput) {
    return {
        seed: worldGenOutput.seed,
        template: worldGenOutput.template,
        spines: serializeSpines(worldGenOutput.spines),
        rivers: serializeRivers(worldGenOutput.rivers),
        lakes: worldGenOutput.lakes || [],
        zones: serializeMap(worldGenOutput.zones),
        roads: worldGenOutput.roads || [],
        settlements: worldGenOutput.settlements || [],
        landmarks: serializeMap(worldGenOutput.landmarks),
    };
}

/**
 * Deserialize stored continent data back to WorldGenerator format
 *
 * @param {Object} stored - Stored continent metadata
 * @returns {Object} Restored world data compatible with WorldGenerator._cache
 */
export function deserializeContinent(stored) {
    return {
        seed: stored.seed,
        template: stored.template,
        spines: deserializeSpines(stored.spines || []),
        rivers: deserializeRivers(stored.rivers || []),
        lakes: stored.lakes || [],
        zones: deserializeMap(stored.zones || []),
        roads: stored.roads || [],
        settlements: stored.settlements || [],
        landmarks: deserializeMap(stored.landmarks || []),
    };
}

// =============================================================================
// Spine Serialization
// =============================================================================

/**
 * Serialize an array of SpineFeature objects
 *
 * @param {Array<SpineFeature>} spines - Spine features to serialize
 * @returns {Array<Object>} Serialized spine data
 */
export function serializeSpines(spines) {
    if (!spines || !Array.isArray(spines)) return [];
    return spines.map(spine => {
        if (typeof spine.toJSON === 'function') {
            return spine.toJSON();
        }
        // Fallback for plain objects
        return {
            id: spine.id,
            path: spine.path,
            properties: spine.properties
        };
    });
}

/**
 * Deserialize spine data back to SpineFeature objects
 *
 * @param {Array<Object>} serialized - Serialized spine data
 * @returns {Array<SpineFeature>} Restored SpineFeature objects
 */
export function deserializeSpines(serialized) {
    if (!serialized || !Array.isArray(serialized)) return [];
    return serialized.map(data => {
        if (SpineFeature.fromJSON) {
            return SpineFeature.fromJSON(data);
        }
        // Fallback construction
        return new SpineFeature(data.path, data.properties);
    });
}

// =============================================================================
// River (LinearFeature) Serialization
// =============================================================================

/**
 * Serialize an array of LinearFeature objects (rivers)
 *
 * @param {Array<LinearFeature>} rivers - River features to serialize
 * @returns {Array<Object>} Serialized river data
 */
export function serializeRivers(rivers) {
    if (!rivers || !Array.isArray(rivers)) return [];
    return rivers.map(river => {
        if (typeof river.toJSON === 'function') {
            return river.toJSON();
        }
        // Fallback for objects without toJSON
        return {
            id: river.id,
            type: river.type,
            path: river.path,
            properties: river.properties,
            elevations: river.elevations
        };
    });
}

/**
 * Deserialize river data back to LinearFeature objects
 *
 * @param {Array<Object>} serialized - Serialized river data
 * @returns {Array<LinearFeature>} Restored LinearFeature objects
 */
export function deserializeRivers(serialized) {
    if (!serialized || !Array.isArray(serialized)) return [];
    return serialized.map(data => {
        if (LinearFeature.fromJSON) {
            return LinearFeature.fromJSON(data);
        }
        // Fallback construction
        const feature = new LinearFeature(data.type, data.path, {
            ...data.properties,
            elevations: data.elevations
        });
        // Restore original ID if possible
        if (data.id) {
            feature.id = data.id;
        }
        return feature;
    });
}

// =============================================================================
// Map Serialization
// =============================================================================

/**
 * Serialize a Map to an array of [key, value] pairs
 *
 * @param {Map<string, any>} map - Map to serialize
 * @returns {Array<[string, any]>} Array of entries
 */
export function serializeMap(map) {
    if (!map) return [];
    if (map instanceof Map) {
        return Array.from(map.entries());
    }
    // Already an array (or other iterable)
    if (Array.isArray(map)) {
        return map;
    }
    // Plain object
    return Object.entries(map);
}

/**
 * Deserialize an array of [key, value] pairs back to a Map
 *
 * @param {Array<[string, any]>} entries - Array of entries
 * @returns {Map<string, any>} Restored Map
 */
export function deserializeMap(entries) {
    if (!entries || !Array.isArray(entries)) {
        return new Map();
    }
    return new Map(entries);
}

// =============================================================================
// World Record Helpers
// =============================================================================

/**
 * Create a fresh world record with default values
 *
 * @param {string} worldId - Unique world identifier
 * @param {string} name - World display name
 * @param {number} seed - World seed
 * @param {number} storageVersion - Storage format version
 * @returns {import('./constants.js').WorldRecord} New world record
 */
export function createWorldRecord(worldId, name, seed, storageVersion) {
    return {
        worldId,
        name,
        seed,
        created: Date.now(),
        lastPlayed: Date.now(),
        heroPosition: null,
        heroRotation: 0,
        golems: [],
        gameTime: 0,
        storageVersion
    };
}

/**
 * Validate a world record has required fields
 *
 * @param {Object} record - Record to validate
 * @returns {boolean} True if valid
 */
export function isValidWorldRecord(record) {
    return (
        record &&
        typeof record.worldId === 'string' &&
        typeof record.name === 'string' &&
        typeof record.seed === 'number' &&
        typeof record.created === 'number'
    );
}

/**
 * Convert a world record to a list item (for menu display)
 *
 * @param {import('./constants.js').WorldRecord} record - Full world record
 * @returns {import('./constants.js').WorldListItem} List item
 */
export function worldRecordToListItem(record) {
    return {
        id: record.worldId,
        name: record.name,
        seed: record.seed,
        lastPlayed: record.lastPlayed,
        heroPosition: record.heroPosition
    };
}

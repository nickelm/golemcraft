/**
 * WorldStorage Module - Public API
 *
 * IndexedDB-based persistence for world records, continent metadata,
 * and binary texture data.
 *
 * Usage:
 *   import { WorldStorage, TERRAIN_GENERATION_VERSION } from './storage/index.js';
 *
 *   const storage = await WorldStorage.getInstance();
 *   const world = await storage.createWorld('My World');
 */

// Main storage class
export { WorldStorage, getWorldStorage } from './worldstorage.js';

// Constants and types
export {
    // Database config
    DB_NAME,
    DB_VERSION,
    TERRAIN_GENERATION_VERSION,
    WORLD_STORAGE_VERSION,

    // Store names (rarely needed externally)
    STORE_WORLDS,
    STORE_CONTINENTS,
    STORE_TEXTURES,
    STORE_METADATA,

    // Error handling
    WorldStorageError,
    ErrorCodes
} from './constants.js';

// Serialization utilities (for WorldGenerator integration)
export {
    serializeContinent,
    deserializeContinent,
    serializeSpines,
    deserializeSpines,
    serializeRivers,
    deserializeRivers,
    serializeMap,
    deserializeMap
} from './serialization.js';

// Migration utilities (for debugging/testing)
export {
    isMigrationNeeded,
    migrateFromLocalStorage,
    clearLegacyStorage,
    hasLegacyStorage
} from './migration.js';

// Database helpers (for advanced usage)
export {
    isIndexedDBAvailable
} from './dbhelpers.js';

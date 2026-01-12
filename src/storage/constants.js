/**
 * WorldStorage Constants
 *
 * Database configuration, version numbers, and error codes for the
 * IndexedDB-based world/continent storage system.
 */

// =============================================================================
// Database Configuration
// =============================================================================

/** IndexedDB database name */
export const DB_NAME = 'GolemCraftDB';

/** Current database schema version - increment when object stores change */
export const DB_VERSION = 1;

/**
 * Terrain generation version - increment when generation algorithms change
 * to trigger regeneration of stored continent metadata.
 *
 * Increment when:
 * - worldgen.js algorithm changes
 * - biomesystem.js biome definitions change
 * - templates.js spine/landExtent changes
 * - Any change affecting deterministic terrain output
 */
export const TERRAIN_GENERATION_VERSION = 1;

/** World storage format version - increment when world record schema changes */
export const WORLD_STORAGE_VERSION = 1;

// =============================================================================
// Object Store Names
// =============================================================================

/** World metadata (light, frequently accessed) */
export const STORE_WORLDS = 'worlds';

/** Continent metadata (large, infrequent access) */
export const STORE_CONTINENTS = 'continents';

/** Binary texture data (large binary blobs) */
export const STORE_TEXTURES = 'textures';

/** Database-level metadata (settings, migration status) */
export const STORE_METADATA = 'metadata';

// =============================================================================
// Metadata Keys
// =============================================================================

/** Key for storing last played world ID */
export const META_LAST_WORLD_ID = 'lastWorldId';

/** Key for storing migration completion status */
export const META_MIGRATION_COMPLETE = 'migrationComplete';

// =============================================================================
// localStorage Keys (for migration)
// =============================================================================

/** localStorage key used by legacy session.js */
export const LEGACY_STORAGE_KEY = 'golemcraft_worlds';

/** localStorage key for last world ID in legacy system */
export const LEGACY_LAST_WORLD_KEY = 'golemcraft_last_world';

/** Legacy storage version to check during migration */
export const LEGACY_STORAGE_VERSION = 1;

// =============================================================================
// Error Codes
// =============================================================================

export const ErrorCodes = {
    /** Failed to open IndexedDB database */
    DB_OPEN_FAILED: 'DB_OPEN_FAILED',

    /** Storage quota exceeded */
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',

    /** Requested record not found */
    NOT_FOUND: 'NOT_FOUND',

    /** Transaction failed */
    TRANSACTION_FAILED: 'TRANSACTION_FAILED',

    /** Migration from localStorage failed */
    MIGRATION_FAILED: 'MIGRATION_FAILED',

    /** Database corruption detected */
    CORRUPTION: 'CORRUPTION',

    /** Version mismatch requiring regeneration */
    VERSION_MISMATCH: 'VERSION_MISMATCH',
};

// =============================================================================
// Custom Error Class
// =============================================================================

/**
 * Custom error class for WorldStorage operations
 */
export class WorldStorageError extends Error {
    /**
     * @param {string} message - Error message
     * @param {string} code - Error code from ErrorCodes
     * @param {Error} [cause] - Original error that caused this
     */
    constructor(message, code, cause = null) {
        super(message);
        this.name = 'WorldStorageError';
        this.code = code;
        this.cause = cause;
    }
}

// =============================================================================
// Type Definitions (JSDoc)
// =============================================================================

/**
 * @typedef {Object} WorldRecord
 * @property {string} worldId - Unique world identifier
 * @property {string} name - Display name
 * @property {number} seed - World generation seed
 * @property {number} created - Creation timestamp
 * @property {number} lastPlayed - Last played timestamp
 * @property {{ x: number, y: number, z: number } | null} heroPosition - Last hero position
 * @property {number} heroRotation - Last hero Y rotation
 * @property {Array<{ x: number, y: number, z: number, health: number }>} golems - Golem states
 * @property {number} gameTime - In-game time
 * @property {number} storageVersion - World storage format version
 */

/**
 * @typedef {Object} WorldListItem
 * @property {string} id - World ID
 * @property {string} name - Display name
 * @property {number} seed - World seed
 * @property {number} lastPlayed - Last played timestamp
 * @property {{ x: number, y: number, z: number } | null} heroPosition - Last hero position
 */

/**
 * @typedef {Object} ContinentMetadata
 * @property {string} worldId - Parent world ID
 * @property {string} continentId - Continent identifier (e.g., 'main')
 * @property {number} generationVersion - Terrain generation version when created
 * @property {Object} template - Continent template configuration
 * @property {Array<Object>} spines - Serialized SpineFeature objects
 * @property {Array<Object>} rivers - Serialized LinearFeature objects
 * @property {Array<[string, Object]>} zones - Zone definitions as [key, zone] pairs
 * @property {Array<[string, Object]>} landmarks - Landmark data as [key, landmark] pairs
 * @property {Array<Object>} lakes - Lake definitions
 * @property {Array<Object>} roads - Road definitions
 * @property {Array<Object>} settlements - Settlement definitions
 * @property {Object} [bounds] - World bounds { min, max } in blocks
 * @property {Object} [stageVersions] - Per-stage version numbers for partial regeneration
 * @property {number} [stageVersions.shape] - Coastline shaping version
 * @property {number} [stageVersions.mountains] - Mountain generation version
 * @property {number} [stageVersions.erosion] - Erosion simulation version
 * @property {number} [stageVersions.rivers] - River generation version
 * @property {number} [stageVersions.climate] - Climate mapping version
 * @property {number} [stageVersions.zones] - Zone discovery version
 * @property {number} [stageVersions.roads] - Road planning version
 * @property {number} [stageVersions.names] - Naming version
 * @property {number} [stageVersions.sdf] - SDF baking version
 */

/**
 * @typedef {Object} TextureRecord
 * @property {string} worldId - Parent world ID
 * @property {string} continentId - Continent identifier
 * @property {string} textureType - Texture type (e.g., 'sdf', 'heightmap_preview')
 * @property {number} generationVersion - Version when created
 * @property {{ width: number, height: number }} resolution - Texture dimensions
 * @property {string} format - Data format (e.g., 'float32', 'uint8')
 * @property {ArrayBuffer} data - Binary texture data
 */

/**
 * @typedef {Object} MigrationResult
 * @property {number} migrated - Number of worlds successfully migrated
 * @property {Array<{ worldId: string, error: string }>} failed - Failed migrations
 * @property {number} skipped - Number of worlds skipped (already migrated)
 * @property {string} [error] - Overall migration error message
 */

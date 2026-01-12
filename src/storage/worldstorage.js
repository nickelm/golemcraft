/**
 * WorldStorage - IndexedDB-based World and Continent Persistence
 *
 * Provides async API for storing world records, continent metadata, and binary
 * texture data. Replaces localStorage-based session.js for large data storage.
 *
 * Usage:
 *   const storage = await WorldStorage.getInstance();
 *   const world = await storage.createWorld('My World', 12345);
 *   await storage.saveContinentMetadata({ worldId: world.worldId, ... });
 */

import {
    DB_NAME,
    DB_VERSION,
    STORE_WORLDS,
    STORE_CONTINENTS,
    STORE_TEXTURES,
    STORE_METADATA,
    META_LAST_WORLD_ID,
    TERRAIN_GENERATION_VERSION,
    WORLD_STORAGE_VERSION,
    WorldStorageError,
    ErrorCodes
} from './constants.js';

import {
    openDatabase,
    deleteDatabase,
    getRecord,
    putRecord,
    deleteRecord,
    getAllRecords,
    getByIndex,
    deleteByIndex,
    withRetry,
    isIndexedDBAvailable
} from './dbhelpers.js';

import { isMigrationNeeded, migrateFromLocalStorage } from './migration.js';
import { createWorldRecord, worldRecordToListItem } from './serialization.js';

// =============================================================================
// Singleton Instance
// =============================================================================

/** @type {WorldStorage | null} */
let instance = null;

/** @type {Promise<WorldStorage> | null} */
let initPromise = null;

// =============================================================================
// WorldStorage Class
// =============================================================================

export class WorldStorage {
    constructor() {
        /** @type {IDBDatabase | null} */
        this.db = null;
        /** @type {string | null} */
        this.currentWorldId = null;
    }

    // =========================================================================
    // Singleton Access
    // =========================================================================

    /**
     * Get the singleton WorldStorage instance
     * Opens the database and runs migration on first call
     *
     * @returns {Promise<WorldStorage>} The storage instance
     */
    static async getInstance() {
        if (instance && instance.db) {
            return instance;
        }

        if (initPromise) {
            return initPromise;
        }

        initPromise = (async () => {
            if (!isIndexedDBAvailable()) {
                throw new WorldStorageError(
                    'IndexedDB is not available in this environment',
                    ErrorCodes.DB_OPEN_FAILED
                );
            }

            instance = new WorldStorage();
            await instance.open();
            return instance;
        })();

        return initPromise;
    }

    /**
     * Reset the singleton instance (for testing)
     */
    static reset() {
        if (instance) {
            instance.close();
        }
        instance = null;
        initPromise = null;
    }

    // =========================================================================
    // Database Lifecycle
    // =========================================================================

    /**
     * Open the database and run schema creation/migration
     *
     * @returns {Promise<void>}
     */
    async open() {
        if (this.db) return;

        this.db = await openDatabase(DB_NAME, DB_VERSION, (db, oldVersion, newVersion) => {
            this._upgradeSchema(db, oldVersion, newVersion);
        });

        // Auto-migrate from localStorage
        if (await isMigrationNeeded(this.db)) {
            const result = await migrateFromLocalStorage(this.db);
            if (result.migrated > 0) {
                console.log(`Migrated ${result.migrated} worlds from localStorage`);
            }
        }
    }

    /**
     * Create object stores and indexes during database upgrade
     *
     * @param {IDBDatabase} db - Database being upgraded
     * @param {number} oldVersion - Previous version
     * @param {number} newVersion - New version
     * @private
     */
    _upgradeSchema(db, oldVersion, newVersion) {
        // Version 0 -> 1: Initial schema
        if (oldVersion < 1) {
            // Worlds store
            const worldStore = db.createObjectStore(STORE_WORLDS, { keyPath: 'worldId' });
            worldStore.createIndex('lastPlayed', 'lastPlayed', { unique: false });
            worldStore.createIndex('name', 'name', { unique: false });

            // Continents store (compound key)
            const continentStore = db.createObjectStore(STORE_CONTINENTS, {
                keyPath: ['worldId', 'continentId']
            });
            continentStore.createIndex('worldId', 'worldId', { unique: false });
            continentStore.createIndex('generationVersion', 'generationVersion', { unique: false });

            // Textures store (compound key)
            const textureStore = db.createObjectStore(STORE_TEXTURES, {
                keyPath: ['worldId', 'continentId', 'textureType']
            });
            textureStore.createIndex('worldId', 'worldId', { unique: false });

            // Metadata store
            db.createObjectStore(STORE_METADATA, { keyPath: 'key' });
        }

        // Future schema upgrades go here:
        // if (oldVersion < 2) { ... }
    }

    /**
     * Close the database connection
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    /**
     * Delete the entire database (for testing/reset)
     *
     * @returns {Promise<void>}
     */
    async deleteDatabase() {
        this.close();
        await deleteDatabase(DB_NAME);
    }

    // =========================================================================
    // World Operations
    // =========================================================================

    /**
     * Create a new world
     *
     * @param {string} name - World display name
     * @param {number} [seed] - World seed (random if not provided)
     * @returns {Promise<import('./constants.js').WorldRecord>} Created world record
     */
    async createWorld(name, seed = null) {
        this._ensureOpen();

        const worldId = this._generateWorldId();
        const actualSeed = seed ?? Math.floor(Math.random() * 100000);

        const record = createWorldRecord(
            worldId,
            name || `World ${await this._getWorldCount() + 1}`,
            actualSeed,
            WORLD_STORAGE_VERSION
        );

        await withRetry(() => putRecord(this.db, STORE_WORLDS, record));

        this.currentWorldId = worldId;
        await this.setLastWorldId(worldId);

        return record;
    }

    /**
     * Get a world by ID
     *
     * @param {string} worldId - World identifier
     * @returns {Promise<import('./constants.js').WorldRecord | null>} World record or null
     */
    async getWorld(worldId) {
        this._ensureOpen();
        return await getRecord(this.db, STORE_WORLDS, worldId) || null;
    }

    /**
     * Update a world's data
     *
     * @param {string} worldId - World identifier
     * @param {Partial<import('./constants.js').WorldRecord>} updates - Fields to update
     * @returns {Promise<void>}
     */
    async updateWorld(worldId, updates) {
        this._ensureOpen();

        const existing = await this.getWorld(worldId);
        if (!existing) {
            throw new WorldStorageError(
                `World not found: ${worldId}`,
                ErrorCodes.NOT_FOUND
            );
        }

        const updated = {
            ...existing,
            ...updates,
            worldId, // Ensure ID can't be changed
            lastPlayed: Date.now()
        };

        await withRetry(() => putRecord(this.db, STORE_WORLDS, updated));
    }

    /**
     * Delete a world and all associated data
     *
     * @param {string} worldId - World identifier
     * @returns {Promise<void>}
     */
    async deleteWorld(worldId) {
        this._ensureOpen();

        // Delete world record
        await deleteRecord(this.db, STORE_WORLDS, worldId);

        // Delete associated continents
        await this.deleteContinentMetadata(worldId);

        // Delete associated textures
        await this.deleteTextures(worldId);

        // Clear last world if it was deleted
        const lastWorldId = await this.getLastWorldId();
        if (lastWorldId === worldId) {
            await this._setMetadata(META_LAST_WORLD_ID, null);
        }

        if (this.currentWorldId === worldId) {
            this.currentWorldId = null;
        }
    }

    /**
     * Get all worlds
     *
     * @returns {Promise<import('./constants.js').WorldRecord[]>} All world records
     */
    async getAllWorlds() {
        this._ensureOpen();
        return await getAllRecords(this.db, STORE_WORLDS);
    }

    /**
     * Get world list sorted by last played (for menu display)
     *
     * @returns {Promise<import('./constants.js').WorldListItem[]>} Sorted world list
     */
    async getWorldList() {
        const worlds = await this.getAllWorlds();
        return worlds
            .map(worldRecordToListItem)
            .sort((a, b) => b.lastPlayed - a.lastPlayed);
    }

    /**
     * Load a world (sets current world and updates last played)
     *
     * @param {string} worldId - World identifier
     * @returns {Promise<import('./constants.js').WorldRecord | null>} World record or null
     */
    async loadWorld(worldId) {
        const world = await this.getWorld(worldId);

        if (world) {
            this.currentWorldId = worldId;
            await this.setLastWorldId(worldId);
        }

        return world;
    }

    /**
     * Save current game state to current world
     *
     * @param {Object} gameState - Current game state
     * @param {{ x: number, y: number, z: number }} [gameState.heroPosition] - Hero position
     * @param {number} [gameState.heroRotation] - Hero Y rotation
     * @param {Array<{ position: { x: number, y: number, z: number }, health: number }>} [gameState.golems] - Golem states
     * @param {number} [gameState.gameTime] - In-game time
     * @returns {Promise<boolean>} True if saved successfully
     */
    async saveCurrentWorld(gameState) {
        if (!this.currentWorldId) {
            console.warn('No current world to save');
            return false;
        }

        const updates = {};

        if (gameState.heroPosition) {
            updates.heroPosition = {
                x: gameState.heroPosition.x,
                y: gameState.heroPosition.y,
                z: gameState.heroPosition.z
            };
        }

        if (gameState.heroRotation !== undefined) {
            updates.heroRotation = gameState.heroRotation;
        }

        if (gameState.golems) {
            updates.golems = gameState.golems.map(g => ({
                x: g.position.x,
                y: g.position.y,
                z: g.position.z,
                health: g.health
            }));
        }

        if (gameState.gameTime !== undefined) {
            updates.gameTime = gameState.gameTime;
        }

        try {
            await this.updateWorld(this.currentWorldId, updates);
            return true;
        } catch (err) {
            console.error('Failed to save world:', err);
            return false;
        }
    }

    // =========================================================================
    // Continent Metadata Operations
    // =========================================================================

    /**
     * Get continent metadata
     *
     * @param {string} worldId - World identifier
     * @param {string} continentId - Continent identifier (e.g., 'main')
     * @returns {Promise<import('./constants.js').ContinentMetadata | null>} Metadata or null
     */
    async getContinentMetadata(worldId, continentId) {
        this._ensureOpen();
        return await getRecord(this.db, STORE_CONTINENTS, [worldId, continentId]) || null;
    }

    /**
     * Save continent metadata
     *
     * @param {import('./constants.js').ContinentMetadata} metadata - Continent metadata
     * @returns {Promise<void>}
     */
    async saveContinentMetadata(metadata) {
        this._ensureOpen();

        const record = {
            ...metadata,
            generationVersion: metadata.generationVersion ?? TERRAIN_GENERATION_VERSION
        };

        await withRetry(() => putRecord(this.db, STORE_CONTINENTS, record));
    }

    /**
     * Delete continent metadata
     *
     * @param {string} worldId - World identifier
     * @param {string} [continentId] - Specific continent, or all if omitted
     * @returns {Promise<void>}
     */
    async deleteContinentMetadata(worldId, continentId) {
        this._ensureOpen();

        if (continentId) {
            await deleteRecord(this.db, STORE_CONTINENTS, [worldId, continentId]);
        } else {
            await deleteByIndex(this.db, STORE_CONTINENTS, 'worldId', worldId);
        }
    }

    // =========================================================================
    // Texture Operations
    // =========================================================================

    /**
     * Get a texture record
     *
     * @param {string} worldId - World identifier
     * @param {string} continentId - Continent identifier
     * @param {string} textureType - Texture type (e.g., 'sdf')
     * @returns {Promise<import('./constants.js').TextureRecord | null>} Texture or null
     */
    async getTexture(worldId, continentId, textureType) {
        this._ensureOpen();
        return await getRecord(this.db, STORE_TEXTURES, [worldId, continentId, textureType]) || null;
    }

    /**
     * Save a texture record
     *
     * @param {import('./constants.js').TextureRecord} record - Texture record
     * @returns {Promise<void>}
     */
    async saveTexture(record) {
        this._ensureOpen();

        const fullRecord = {
            ...record,
            generationVersion: record.generationVersion ?? TERRAIN_GENERATION_VERSION
        };

        await withRetry(() => putRecord(this.db, STORE_TEXTURES, fullRecord));
    }

    /**
     * Delete textures
     *
     * @param {string} worldId - World identifier
     * @param {string} [continentId] - Specific continent, or all if omitted
     * @returns {Promise<void>}
     */
    async deleteTextures(worldId, continentId) {
        this._ensureOpen();

        if (continentId) {
            // Delete textures for specific continent
            const textures = await getByIndex(this.db, STORE_TEXTURES, 'worldId', worldId);
            for (const tex of textures) {
                if (tex.continentId === continentId) {
                    await deleteRecord(this.db, STORE_TEXTURES, [worldId, continentId, tex.textureType]);
                }
            }
        } else {
            await deleteByIndex(this.db, STORE_TEXTURES, 'worldId', worldId);
        }
    }

    // =========================================================================
    // Version Management
    // =========================================================================

    /**
     * Check if continent needs regeneration due to version mismatch
     *
     * @param {string} worldId - World identifier
     * @param {string} continentId - Continent identifier
     * @returns {Promise<boolean>} True if regeneration needed
     */
    async needsRegeneration(worldId, continentId) {
        const metadata = await this.getContinentMetadata(worldId, continentId);

        if (!metadata) {
            return true; // No stored data, needs generation
        }

        return metadata.generationVersion !== TERRAIN_GENERATION_VERSION;
    }

    /**
     * Get the current terrain generation version
     *
     * @returns {number} Current version
     */
    getTerrainVersion() {
        return TERRAIN_GENERATION_VERSION;
    }

    // =========================================================================
    // Session Helpers
    // =========================================================================

    /**
     * Get the last played world ID
     *
     * @returns {Promise<string | null>} World ID or null
     */
    async getLastWorldId() {
        this._ensureOpen();
        const record = await getRecord(this.db, STORE_METADATA, META_LAST_WORLD_ID);
        return record?.value || null;
    }

    /**
     * Set the last played world ID
     *
     * @param {string} worldId - World identifier
     * @returns {Promise<void>}
     */
    async setLastWorldId(worldId) {
        await this._setMetadata(META_LAST_WORLD_ID, worldId);
    }

    /**
     * Check if there's a world to continue
     *
     * @returns {Promise<boolean>} True if continue is available
     */
    async hasContinueWorld() {
        const lastId = await this.getLastWorldId();
        if (!lastId) return false;

        const world = await this.getWorld(lastId);
        return world !== null;
    }

    /**
     * Load the last played world
     *
     * @returns {Promise<import('./constants.js').WorldRecord | null>} World or null
     */
    async loadLastWorld() {
        const lastId = await this.getLastWorldId();
        if (!lastId) return null;
        return await this.loadWorld(lastId);
    }

    // =========================================================================
    // Private Helpers
    // =========================================================================

    /**
     * Ensure database is open
     *
     * @throws {WorldStorageError} If database not open
     * @private
     */
    _ensureOpen() {
        if (!this.db) {
            throw new WorldStorageError(
                'Database not open. Call WorldStorage.getInstance() first.',
                ErrorCodes.DB_OPEN_FAILED
            );
        }
    }

    /**
     * Generate a unique world ID
     *
     * @returns {string} New world ID
     * @private
     */
    _generateWorldId() {
        return 'world_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Get total world count
     *
     * @returns {Promise<number>} Number of worlds
     * @private
     */
    async _getWorldCount() {
        const worlds = await this.getAllWorlds();
        return worlds.length;
    }

    /**
     * Set a metadata value
     *
     * @param {string} key - Metadata key
     * @param {any} value - Value to store
     * @returns {Promise<void>}
     * @private
     */
    async _setMetadata(key, value) {
        this._ensureOpen();
        await putRecord(this.db, STORE_METADATA, { key, value });
    }

    /**
     * Get a metadata value
     *
     * @param {string} key - Metadata key
     * @returns {Promise<any>} Stored value or undefined
     * @private
     */
    async _getMetadata(key) {
        this._ensureOpen();
        const record = await getRecord(this.db, STORE_METADATA, key);
        return record?.value;
    }
}

// =============================================================================
// Convenience Export
// =============================================================================

/**
 * Get the WorldStorage singleton instance
 * Shorthand for WorldStorage.getInstance()
 *
 * @returns {Promise<WorldStorage>}
 */
export async function getWorldStorage() {
    return WorldStorage.getInstance();
}

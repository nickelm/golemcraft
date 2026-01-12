/**
 * Migration Module
 *
 * Handles migration from legacy localStorage-based session.js to
 * the new IndexedDB-based WorldStorage system.
 */

import {
    LEGACY_STORAGE_KEY,
    LEGACY_LAST_WORLD_KEY,
    LEGACY_STORAGE_VERSION,
    STORE_WORLDS,
    STORE_METADATA,
    META_LAST_WORLD_ID,
    META_MIGRATION_COMPLETE,
    WORLD_STORAGE_VERSION,
    WorldStorageError,
    ErrorCodes
} from './constants.js';
import { putRecord, getRecord, withTransaction } from './dbhelpers.js';

// =============================================================================
// Migration Check
// =============================================================================

/**
 * Check if migration from localStorage is needed
 *
 * @param {IDBDatabase} db - Open database instance
 * @returns {Promise<boolean>} True if migration is needed
 */
export async function isMigrationNeeded(db) {
    // Check if migration already completed
    const migrationComplete = await getRecord(db, STORE_METADATA, META_MIGRATION_COMPLETE);
    if (migrationComplete?.value === true) {
        return false;
    }

    // Check if there's localStorage data to migrate
    try {
        const oldData = localStorage.getItem(LEGACY_STORAGE_KEY);
        return oldData !== null;
    } catch {
        // localStorage not available (e.g., in worker context)
        return false;
    }
}

// =============================================================================
// Migration Execution
// =============================================================================

/**
 * Migrate all worlds from localStorage to IndexedDB
 *
 * @param {IDBDatabase} db - Open database instance
 * @returns {Promise<import('./constants.js').MigrationResult>} Migration result
 */
export async function migrateFromLocalStorage(db) {
    /** @type {import('./constants.js').MigrationResult} */
    const result = {
        migrated: 0,
        failed: [],
        skipped: 0
    };

    // Check if migration already done
    const migrationComplete = await getRecord(db, STORE_METADATA, META_MIGRATION_COMPLETE);
    if (migrationComplete?.value === true) {
        result.skipped = -1; // Signal already migrated
        return result;
    }

    // Check localStorage availability
    let oldDataRaw;
    try {
        oldDataRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    } catch (err) {
        // localStorage not available
        await markMigrationComplete(db);
        return result;
    }

    if (!oldDataRaw) {
        // No data to migrate
        await markMigrationComplete(db);
        return result;
    }

    // Parse localStorage data
    let parsed;
    try {
        parsed = JSON.parse(oldDataRaw);
    } catch (err) {
        result.error = `Failed to parse localStorage data: ${err.message}`;
        await markMigrationComplete(db);
        return result;
    }

    // Check version compatibility
    if (parsed._version !== undefined && parsed._version !== LEGACY_STORAGE_VERSION) {
        console.warn(`Incompatible localStorage version ${parsed._version}, expected ${LEGACY_STORAGE_VERSION}`);
        result.skipped = Object.keys(parsed).filter(k => k !== '_version').length;
        await markMigrationComplete(db);
        return result;
    }

    // Extract worlds (everything except _version)
    const { _version, ...worlds } = parsed;

    // Migrate each world
    for (const [worldId, worldData] of Object.entries(worlds)) {
        try {
            await migrateWorld(db, worldId, worldData);
            result.migrated++;
        } catch (err) {
            result.failed.push({
                worldId,
                error: err.message || 'Unknown error'
            });
        }
    }

    // Migrate last world ID
    try {
        const lastWorldId = localStorage.getItem(LEGACY_LAST_WORLD_KEY);
        if (lastWorldId) {
            await putRecord(db, STORE_METADATA, {
                key: META_LAST_WORLD_ID,
                value: lastWorldId
            });
        }
    } catch (err) {
        console.warn('Failed to migrate last world ID:', err);
    }

    // Mark migration complete
    await markMigrationComplete(db);

    console.log(`Migration complete: ${result.migrated} worlds migrated, ${result.failed.length} failed`);

    return result;
}

/**
 * Migrate a single world from localStorage format
 *
 * @param {IDBDatabase} db - Database instance
 * @param {string} worldId - World identifier
 * @param {Object} oldData - Legacy world data
 * @returns {Promise<void>}
 */
async function migrateWorld(db, worldId, oldData) {
    // Convert to new schema
    const newRecord = {
        worldId: worldId,
        name: oldData.name || 'Unnamed World',
        seed: oldData.seed ?? Math.floor(Math.random() * 100000),
        created: oldData.created || Date.now(),
        lastPlayed: oldData.lastPlayed || Date.now(),
        heroPosition: oldData.heroPosition || null,
        heroRotation: oldData.heroRotation ?? 0,
        golems: oldData.golems || [],
        gameTime: oldData.gameTime ?? 0,
        storageVersion: WORLD_STORAGE_VERSION
    };

    // Validate critical fields
    if (typeof newRecord.seed !== 'number' || !isFinite(newRecord.seed)) {
        throw new Error('Invalid seed value');
    }

    // Store in new database
    await putRecord(db, STORE_WORLDS, newRecord);
}

/**
 * Mark migration as complete in metadata store
 *
 * @param {IDBDatabase} db - Database instance
 * @returns {Promise<void>}
 */
async function markMigrationComplete(db) {
    await putRecord(db, STORE_METADATA, {
        key: META_MIGRATION_COMPLETE,
        value: true
    });
}

// =============================================================================
// Cleanup (Optional)
// =============================================================================

/**
 * Clear legacy localStorage data after successful migration
 * Call this only after verifying IndexedDB data is intact
 *
 * @returns {boolean} True if cleanup succeeded
 */
export function clearLegacyStorage() {
    try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        localStorage.removeItem(LEGACY_LAST_WORLD_KEY);
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if legacy storage still has data
 *
 * @returns {boolean} True if legacy data exists
 */
export function hasLegacyStorage() {
    try {
        return localStorage.getItem(LEGACY_STORAGE_KEY) !== null;
    } catch {
        return false;
    }
}

/**
 * IndexedDB Helper Utilities
 *
 * Promise-based wrappers and utilities for IndexedDB operations.
 * Provides retry logic, error handling, and transaction management.
 */

import { WorldStorageError, ErrorCodes } from './constants.js';

// =============================================================================
// Database Opening
// =============================================================================

/**
 * Open an IndexedDB database with Promise-based API
 *
 * @param {string} name - Database name
 * @param {number} version - Database version
 * @param {function(IDBDatabase, number, number): void} onUpgrade - Called during version upgrade
 * @returns {Promise<IDBDatabase>} Opened database
 * @throws {WorldStorageError} If database fails to open
 */
export function openDatabase(name, version, onUpgrade) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);

        request.onerror = () => {
            reject(new WorldStorageError(
                `Failed to open database: ${request.error?.message || 'Unknown error'}`,
                ErrorCodes.DB_OPEN_FAILED,
                request.error
            ));
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = request.result;
            const oldVersion = event.oldVersion;
            const newVersion = event.newVersion || version;

            try {
                onUpgrade(db, oldVersion, newVersion);
            } catch (err) {
                reject(new WorldStorageError(
                    `Database upgrade failed: ${err.message}`,
                    ErrorCodes.DB_OPEN_FAILED,
                    err
                ));
            }
        };

        request.onblocked = () => {
            console.warn('Database upgrade blocked - close other tabs using this database');
        };
    });
}

// =============================================================================
// Transaction Helpers
// =============================================================================

/**
 * Create a transaction and wait for completion
 *
 * @param {IDBDatabase} db - Database instance
 * @param {string|string[]} storeNames - Object store name(s)
 * @param {IDBTransactionMode} mode - Transaction mode ('readonly' or 'readwrite')
 * @param {function(IDBTransaction): void} operation - Operation to perform
 * @returns {Promise<void>} Resolves when transaction completes
 * @throws {WorldStorageError} If transaction fails
 */
export function withTransaction(db, storeNames, mode, operation) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);

        tx.oncomplete = () => resolve();

        tx.onerror = () => {
            reject(new WorldStorageError(
                `Transaction failed: ${tx.error?.message || 'Unknown error'}`,
                ErrorCodes.TRANSACTION_FAILED,
                tx.error
            ));
        };

        tx.onabort = () => {
            reject(new WorldStorageError(
                'Transaction aborted',
                ErrorCodes.TRANSACTION_FAILED
            ));
        };

        try {
            operation(tx);
        } catch (err) {
            tx.abort();
            reject(err);
        }
    });
}

/**
 * Get a single record by key
 *
 * @param {IDBDatabase} db - Database instance
 * @param {string} storeName - Object store name
 * @param {IDBValidKey} key - Record key
 * @returns {Promise<any>} Record or undefined if not found
 */
export function getRecord(db, storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            reject(new WorldStorageError(
                `Failed to get record: ${request.error?.message || 'Unknown error'}`,
                ErrorCodes.TRANSACTION_FAILED,
                request.error
            ));
        };
    });
}

/**
 * Put a record (insert or update)
 *
 * @param {IDBDatabase} db - Database instance
 * @param {string} storeName - Object store name
 * @param {any} value - Record to store
 * @param {IDBValidKey} [key] - Optional key (if not using keyPath)
 * @returns {Promise<IDBValidKey>} Key of stored record
 */
export function putRecord(db, storeName, value, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = key !== undefined ? store.put(value, key) : store.put(value);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            const err = request.error;
            // Check for quota exceeded
            if (err?.name === 'QuotaExceededError') {
                reject(new WorldStorageError(
                    'Storage quota exceeded. Delete some worlds to free space.',
                    ErrorCodes.QUOTA_EXCEEDED,
                    err
                ));
            } else {
                reject(new WorldStorageError(
                    `Failed to put record: ${err?.message || 'Unknown error'}`,
                    ErrorCodes.TRANSACTION_FAILED,
                    err
                ));
            }
        };
    });
}

/**
 * Delete a record by key
 *
 * @param {IDBDatabase} db - Database instance
 * @param {string} storeName - Object store name
 * @param {IDBValidKey} key - Record key to delete
 * @returns {Promise<void>}
 */
export function deleteRecord(db, storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            reject(new WorldStorageError(
                `Failed to delete record: ${request.error?.message || 'Unknown error'}`,
                ErrorCodes.TRANSACTION_FAILED,
                request.error
            ));
        };
    });
}

/**
 * Get all records from a store
 *
 * @param {IDBDatabase} db - Database instance
 * @param {string} storeName - Object store name
 * @returns {Promise<any[]>} Array of all records
 */
export function getAllRecords(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => {
            reject(new WorldStorageError(
                `Failed to get all records: ${request.error?.message || 'Unknown error'}`,
                ErrorCodes.TRANSACTION_FAILED,
                request.error
            ));
        };
    });
}

/**
 * Get all records matching an index value
 *
 * @param {IDBDatabase} db - Database instance
 * @param {string} storeName - Object store name
 * @param {string} indexName - Index name
 * @param {IDBValidKey} value - Index value to match
 * @returns {Promise<any[]>} Array of matching records
 */
export function getByIndex(db, storeName, indexName, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);
        const request = index.getAll(value);

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => {
            reject(new WorldStorageError(
                `Failed to query index: ${request.error?.message || 'Unknown error'}`,
                ErrorCodes.TRANSACTION_FAILED,
                request.error
            ));
        };
    });
}

/**
 * Delete all records matching an index value
 *
 * @param {IDBDatabase} db - Database instance
 * @param {string} storeName - Object store name
 * @param {string} indexName - Index name
 * @param {IDBValidKey} value - Index value to match
 * @returns {Promise<number>} Number of records deleted
 */
export function deleteByIndex(db, storeName, indexName, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);
        const request = index.openCursor(value);
        let deleteCount = 0;

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                deleteCount++;
                cursor.continue();
            }
        };

        tx.oncomplete = () => resolve(deleteCount);
        tx.onerror = () => {
            reject(new WorldStorageError(
                `Failed to delete by index: ${tx.error?.message || 'Unknown error'}`,
                ErrorCodes.TRANSACTION_FAILED,
                tx.error
            ));
        };
    });
}

// =============================================================================
// Retry Logic
// =============================================================================

/**
 * Retry an async operation with exponential backoff
 *
 * @param {function(): Promise<T>} operation - Async operation to retry
 * @param {number} [maxRetries=3] - Maximum number of retry attempts
 * @param {number} [baseDelay=100] - Base delay in ms (doubles each retry)
 * @returns {Promise<T>} Result of successful operation
 * @throws {WorldStorageError} If all retries fail
 * @template T
 */
export async function withRetry(operation, maxRetries = 3, baseDelay = 100) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await operation();
        } catch (err) {
            lastError = err;

            // Don't retry quota exceeded errors
            if (err instanceof WorldStorageError && err.code === ErrorCodes.QUOTA_EXCEEDED) {
                throw err;
            }

            // Wait before retrying (exponential backoff)
            if (attempt < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, attempt);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    // All retries failed
    if (lastError instanceof WorldStorageError) {
        throw lastError;
    }

    throw new WorldStorageError(
        `Operation failed after ${maxRetries} retries: ${lastError?.message || 'Unknown error'}`,
        ErrorCodes.TRANSACTION_FAILED,
        lastError
    );
}

// =============================================================================
// Database Deletion
// =============================================================================

/**
 * Delete an IndexedDB database
 *
 * @param {string} name - Database name to delete
 * @returns {Promise<void>}
 */
export function deleteDatabase(name) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);

        request.onsuccess = () => resolve();
        request.onerror = () => {
            reject(new WorldStorageError(
                `Failed to delete database: ${request.error?.message || 'Unknown error'}`,
                ErrorCodes.DB_OPEN_FAILED,
                request.error
            ));
        };
        request.onblocked = () => {
            console.warn('Database deletion blocked - close other tabs using this database');
        };
    });
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if IndexedDB is available in current environment
 *
 * @returns {boolean} True if IndexedDB is available
 */
export function isIndexedDBAvailable() {
    try {
        return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
        return false;
    }
}

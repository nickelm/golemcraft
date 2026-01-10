/**
 * TerrainCache - IndexedDB-based cache for terrain visualizer
 *
 * Caches computed heightmaps and terrain data to avoid regenerating unchanged chunks.
 * Automatically invalidates when seed, template, or generation algorithm changes.
 */

// Generator version - bump this when terrain generation algorithm changes
const GENERATOR_VERSION = 1;

/**
 * Simple string hash function for template config objects
 * Uses djb2 algorithm
 * @param {string} str - String to hash
 * @returns {number} Hash value
 */
function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash >>> 0; // Ensure unsigned
}

/**
 * Generate hash for a template config object
 * @param {Object} template - Template configuration object
 * @returns {string} Hash string
 */
function hashTemplate(template) {
    try {
        const str = JSON.stringify(template);
        return hashString(str).toString(16);
    } catch {
        return '0';
    }
}

export class TerrainCache {
    /**
     * @param {string} dbName - IndexedDB database name
     */
    constructor(dbName = 'golemcraft-terrain') {
        this.dbName = dbName;
        this.storeName = 'terrain-chunks';
        this.db = null;
        this.available = true;

        // Cache version components
        this.seed = 0;
        this.templateHash = '0';
        this.generatorVersion = GENERATOR_VERSION;
    }

    /**
     * Initialize the cache - open database and create object store if needed
     * @returns {Promise<boolean>} True if initialization succeeded
     */
    async init() {
        if (!this._isIndexedDBAvailable()) {
            console.warn('TerrainCache: IndexedDB not available, caching disabled');
            this.available = false;
            return false;
        }

        try {
            this.db = await this._openDatabase();
            console.log('TerrainCache: Initialized successfully');
            return true;
        } catch (error) {
            console.warn('TerrainCache: Failed to initialize IndexedDB, caching disabled', error);
            this.available = false;
            return false;
        }
    }

    /**
     * Check if IndexedDB is available
     * @private
     * @returns {boolean}
     */
    _isIndexedDBAvailable() {
        try {
            return typeof indexedDB !== 'undefined' && indexedDB !== null;
        } catch {
            return false;
        }
    }

    /**
     * Open the IndexedDB database
     * @private
     * @returns {Promise<IDBDatabase>}
     */
    _openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => {
                reject(request.error);
            };

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create object store if it doesn't exist
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'key' });
                }
            };
        });
    }

    /**
     * Generate cache key for a chunk
     * Format: "{seed}:{templateHash}:{generatorVersion}:{chunkX},{chunkZ}"
     * @private
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {string} Cache key
     */
    _makeKey(chunkX, chunkZ) {
        return `${this.seed}:${this.templateHash}:${this.generatorVersion}:${chunkX},${chunkZ}`;
    }

    /**
     * Set cache version parameters
     * Call this when seed or template changes to invalidate old entries
     * @param {number} seed - World seed
     * @param {Object|string} template - Template config object or pre-computed hash
     * @param {number} [generatorVersion] - Generator version (defaults to GENERATOR_VERSION)
     */
    setCacheVersion(seed, template, generatorVersion = GENERATOR_VERSION) {
        this.seed = seed;
        this.templateHash = typeof template === 'string' ? template : hashTemplate(template);
        this.generatorVersion = generatorVersion;
    }

    /**
     * Get cached terrain data for a chunk
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {Promise<Object|null>} Cached data or null if not found
     */
    async get(chunkX, chunkZ) {
        if (!this.available || !this.db) {
            return null;
        }

        const key = this._makeKey(chunkX, chunkZ);

        try {
            return await this._dbGet(key);
        } catch (error) {
            console.warn('TerrainCache: Error reading from cache', error);
            return null;
        }
    }

    /**
     * Read from IndexedDB
     * @private
     * @param {string} key - Cache key
     * @returns {Promise<Object|null>}
     */
    _dbGet(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    // Return the data without the key wrapper
                    resolve({
                        heightmap: result.heightmap,
                        biomeData: result.biomeData,
                        timestamp: result.timestamp
                    });
                } else {
                    resolve(null);
                }
            };
        });
    }

    /**
     * Store terrain data for a chunk
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {Object} data - Terrain data to cache
     * @param {Float32Array} data.heightmap - Heightmap data
     * @param {Uint8Array} [data.biomeData] - Optional biome data
     * @returns {Promise<boolean>} True if storage succeeded
     */
    async set(chunkX, chunkZ, data) {
        if (!this.available || !this.db) {
            return false;
        }

        const key = this._makeKey(chunkX, chunkZ);

        try {
            await this._dbSet(key, {
                key,
                heightmap: data.heightmap,
                biomeData: data.biomeData || null,
                timestamp: Date.now()
            });
            return true;
        } catch (error) {
            console.warn('TerrainCache: Error writing to cache', error);
            // Handle quota exceeded
            if (error.name === 'QuotaExceededError') {
                console.warn('TerrainCache: Quota exceeded, clearing cache');
                await this.invalidateAll();
            }
            return false;
        }
    }

    /**
     * Write to IndexedDB
     * @private
     * @param {string} key - Cache key
     * @param {Object} value - Value to store
     * @returns {Promise<void>}
     */
    _dbSet(key, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(value);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }

    /**
     * Clear all cached entries
     * @returns {Promise<boolean>} True if successful
     */
    async invalidateAll() {
        if (!this.available || !this.db) {
            return false;
        }

        try {
            await this._dbClear();
            console.log('TerrainCache: Cache cleared');
            return true;
        } catch (error) {
            console.warn('TerrainCache: Error clearing cache', error);
            return false;
        }
    }

    /**
     * Clear IndexedDB store
     * @private
     * @returns {Promise<void>}
     */
    _dbClear() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }

    /**
     * Get cache statistics
     * @returns {Promise<{entryCount: number, approximateSize: number}>}
     */
    async getCacheStats() {
        if (!this.available || !this.db) {
            return { entryCount: 0, approximateSize: 0 };
        }

        try {
            const entries = await this._dbGetAll();
            let approximateSize = 0;

            for (const entry of entries) {
                // Estimate size from typed arrays
                if (entry.heightmap) {
                    approximateSize += entry.heightmap.byteLength || 0;
                }
                if (entry.biomeData) {
                    approximateSize += entry.biomeData.byteLength || 0;
                }
                // Add overhead for key and metadata
                approximateSize += 100;
            }

            return {
                entryCount: entries.length,
                approximateSize
            };
        } catch (error) {
            console.warn('TerrainCache: Error getting stats', error);
            return { entryCount: 0, approximateSize: 0 };
        }
    }

    /**
     * Get all entries from IndexedDB
     * @private
     * @returns {Promise<Array>}
     */
    _dbGetAll() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result || []);
        });
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
}

/**
 * Export hash utilities for external use
 */
export { hashString, hashTemplate, GENERATOR_VERSION };

/**
 * Tile cache for terrain visualizer
 * Caches pre-rendered tiles to improve pan/zoom performance
 * Integrates with TerrainCache for persistent IndexedDB storage
 */

import { getTerrainParams } from '../../world/terrain/worldgen.js';
import { getColorForMode } from './colors.js';

export class TileCache {
  /**
   * @param {number} tileSize - Size of each tile in pixels (default 128)
   * @param {number} maxTiles - Maximum number of tiles to cache (default 64)
   */
  constructor(tileSize = 128, maxTiles = 64) {
    this.tileSize = tileSize;
    this.maxTiles = maxTiles;
    this.cache = new Map(); // Key: "worldX,worldZ,mode,seed" -> { imageData, lastUsed }
    this.accessOrder = []; // Track access order for LRU eviction
    this.terrainCache = null; // Optional TerrainCache for IndexedDB persistence
  }

  /**
   * Set the terrain cache for persistent storage
   * @param {TerrainCache} terrainCache - TerrainCache instance
   */
  setTerrainCache(terrainCache) {
    this.terrainCache = terrainCache;
  }

  /**
   * Generate cache key for a tile
   * @param {number} worldX - Tile world X coordinate (aligned to tileSize grid)
   * @param {number} worldZ - Tile world Z coordinate (aligned to tileSize grid)
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {number} lodLevel - LOD level (0 = 1:1, 1 = 1:2, 2 = 1:4, etc.)
   * @param {number} refinementLevel - Progressive refinement level (0-5)
   * @returns {string} Cache key
   */
  _makeKey(worldX, worldZ, mode, seed, lodLevel = 0, refinementLevel = 5) {
    return `${worldX},${worldZ},${mode},${seed},${lodLevel},${refinementLevel}`;
  }

  /**
   * Generate base key for a tile (without refinement level, for lookups)
   * @private
   */
  _makeBaseKey(worldX, worldZ, mode, seed, lodLevel = 0) {
    return `${worldX},${worldZ},${mode},${seed},${lodLevel}`;
  }

  /**
   * Align a world coordinate to tile grid
   * @param {number} coord - World coordinate
   * @param {number} lodLevel - LOD level (0 = 1:1, 1 = 1:2, 2 = 1:4, etc.)
   * @returns {number} Aligned coordinate
   */
  alignToGrid(coord, lodLevel = 0) {
    const step = 1 << lodLevel; // 2^lodLevel
    const worldTileSize = this.tileSize * step;
    return Math.floor(coord / worldTileSize) * worldTileSize;
  }

  /**
   * Get the world size covered by a tile at a given LOD level
   * @param {number} lodLevel - LOD level
   * @returns {number} World size in blocks
   */
  getWorldTileSize(lodLevel = 0) {
    return this.tileSize * (1 << lodLevel);
  }

  /**
   * Generate terrain cache key for a tile
   * @private
   * @param {number} worldX - Tile world X coordinate
   * @param {number} worldZ - Tile world Z coordinate
   * @param {number} lodLevel - LOD level
   * @returns {string} Terrain cache coordinates as "chunkX,chunkZ"
   */
  _makeTerrainKey(worldX, worldZ, lodLevel) {
    // Use tile coordinates as chunk coordinates for terrain cache
    return { chunkX: worldX, chunkZ: worldZ, lod: lodLevel };
  }

  /**
   * Get or render a tile
   * @param {number} worldX - Tile world X coordinate (should be aligned to tileSize grid)
   * @param {number} worldZ - Tile world Z coordinate (should be aligned to tileSize grid)
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {Object} template - Terrain template
   * @param {number} lodLevel - LOD level (0 = 1:1, 1 = 1:2, 2 = 1:4, etc.)
   * @returns {ImageData} The tile's image data
   */
  getTile(worldX, worldZ, mode, seed, template, lodLevel = 0) {
    const key = this._makeKey(worldX, worldZ, mode, seed, lodLevel);

    // Check cache
    if (this.cache.has(key)) {
      // Update access order for LRU
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
      }
      this.accessOrder.push(key);

      return this.cache.get(key).imageData;
    }

    // Render the tile
    const imageData = this._renderTile(worldX, worldZ, mode, seed, template, lodLevel);

    // Evict oldest if over capacity
    while (this.cache.size >= this.maxTiles && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift();
      this.cache.delete(oldestKey);
    }

    // Cache the new tile
    this.cache.set(key, { imageData, lastUsed: Date.now() });
    this.accessOrder.push(key);

    return imageData;
  }

  /**
   * Get or render a tile with async terrain cache support
   * Checks TerrainCache (IndexedDB) first for persistent cached terrain data
   * @param {number} worldX - Tile world X coordinate (should be aligned to tileSize grid)
   * @param {number} worldZ - Tile world Z coordinate (should be aligned to tileSize grid)
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {Object} template - Terrain template
   * @param {number} lodLevel - LOD level (0 = 1:1, 1 = 1:2, 2 = 1:4, etc.)
   * @returns {Promise<{imageData: ImageData, fromTerrainCache: boolean}>}
   */
  async getTileAsync(worldX, worldZ, mode, seed, template, lodLevel = 0) {
    const key = this._makeKey(worldX, worldZ, mode, seed, lodLevel);

    // Check in-memory cache first
    if (this.cache.has(key)) {
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
      }
      this.accessOrder.push(key);
      return { imageData: this.cache.get(key).imageData, fromTerrainCache: false };
    }

    let terrainData = null;
    let fromTerrainCache = false;

    // Check TerrainCache (IndexedDB) for cached terrain data
    if (this.terrainCache) {
      const { chunkX, chunkZ, lod } = this._makeTerrainKey(worldX, worldZ, lodLevel);
      const cacheKey = `${chunkX},${chunkZ},${lod}`;
      terrainData = await this.terrainCache.get(chunkX, chunkZ + lod * 1000000);
      if (terrainData) {
        fromTerrainCache = true;
      }
    }

    // Render the tile (using cached terrain data if available)
    const { imageData, heightmap, biomeData } = this._renderTileWithData(
      worldX, worldZ, mode, seed, template, lodLevel, terrainData
    );

    // Store terrain data in TerrainCache if it was newly generated
    if (this.terrainCache && !fromTerrainCache && heightmap) {
      const { chunkX, chunkZ, lod } = this._makeTerrainKey(worldX, worldZ, lodLevel);
      await this.terrainCache.set(chunkX, chunkZ + lod * 1000000, { heightmap, biomeData });
    }

    // Evict oldest if over capacity
    while (this.cache.size >= this.maxTiles && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift();
      this.cache.delete(oldestKey);
    }

    // Cache in memory
    this.cache.set(key, { imageData, lastUsed: Date.now() });
    this.accessOrder.push(key);

    return { imageData, fromTerrainCache };
  }

  /**
   * Render a single tile
   * @private
   * @param {number} worldX - Tile world X coordinate
   * @param {number} worldZ - Tile world Z coordinate
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {Object} template - Terrain template
   * @param {number} lodLevel - LOD level (0 = 1:1, 1 = 1:2, 2 = 1:4, etc.)
   */
  _renderTile(worldX, worldZ, mode, seed, template, lodLevel = 0) {
    // Create an offscreen canvas for rendering
    const canvas = new OffscreenCanvas(this.tileSize, this.tileSize);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(this.tileSize, this.tileSize);
    const data = imageData.data;

    const needsNeighbors = mode === 'elevation' || mode === 'composite';

    // LOD step: sample every 2^lodLevel blocks
    const step = 1 << lodLevel;

    for (let py = 0; py < this.tileSize; py++) {
      for (let px = 0; px < this.tileSize; px++) {
        // Scale pixel position by LOD step to sample world coordinates
        const wx = worldX + px * step;
        const wz = worldZ + py * step;

        const params = getTerrainParams(wx, wz, seed, template);

        let rgb;

        if (needsNeighbors) {
          // Scale neighbor offsets by LOD step for consistent hillshade appearance
          const leftParams = getTerrainParams(wx - step, wz, seed, template);
          const rightParams = getTerrainParams(wx + step, wz, seed, template);
          const upParams = getTerrainParams(wx, wz - step, seed, template);
          const downParams = getTerrainParams(wx, wz + step, seed, template);

          const neighbors = {
            left: leftParams.height,
            right: rightParams.height,
            up: upParams.height,
            down: downParams.height
          };

          rgb = getColorForMode(params, mode, neighbors);
        } else {
          rgb = getColorForMode(params, mode);
        }

        const index = (py * this.tileSize + px) * 4;
        data[index] = rgb[0];
        data[index + 1] = rgb[1];
        data[index + 2] = rgb[2];
        data[index + 3] = 255;
      }
    }

    return imageData;
  }

  /**
   * Render a tile with optional cached terrain data
   * Returns both the rendered image and the terrain data for caching
   * @private
   * @param {number} worldX - Tile world X coordinate
   * @param {number} worldZ - Tile world Z coordinate
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {Object} template - Terrain template
   * @param {number} lodLevel - LOD level
   * @param {Object|null} cachedTerrainData - Cached terrain data or null
   * @returns {{imageData: ImageData, heightmap: Float32Array, biomeData: Uint8Array}}
   */
  _renderTileWithData(worldX, worldZ, mode, seed, template, lodLevel, cachedTerrainData) {
    const canvas = new OffscreenCanvas(this.tileSize, this.tileSize);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(this.tileSize, this.tileSize);
    const data = imageData.data;

    const needsNeighbors = mode === 'elevation' || mode === 'composite';
    const step = 1 << lodLevel;
    const totalPixels = this.tileSize * this.tileSize;

    // Prepare terrain data arrays
    let heightmap = cachedTerrainData?.heightmap;
    let biomeData = cachedTerrainData?.biomeData;
    const generateTerrain = !heightmap;

    if (generateTerrain) {
      heightmap = new Float32Array(totalPixels);
      biomeData = new Uint8Array(totalPixels);
    }

    // Pre-generate or use cached terrain params
    const paramsGrid = new Array(totalPixels);

    for (let py = 0; py < this.tileSize; py++) {
      for (let px = 0; px < this.tileSize; px++) {
        const wx = worldX + px * step;
        const wz = worldZ + py * step;
        const idx = py * this.tileSize + px;

        if (generateTerrain) {
          const params = getTerrainParams(wx, wz, seed, template);
          paramsGrid[idx] = params;
          heightmap[idx] = params.heightNormalized;
          // Simple biome encoding (first char code for now)
          biomeData[idx] = params.biome ? params.biome.charCodeAt(0) : 0;
        } else {
          // Reconstruct minimal params from cached data
          const params = getTerrainParams(wx, wz, seed, template);
          paramsGrid[idx] = params;
        }
      }
    }

    // Render pixels
    for (let py = 0; py < this.tileSize; py++) {
      for (let px = 0; px < this.tileSize; px++) {
        const idx = py * this.tileSize + px;
        const params = paramsGrid[idx];

        let rgb;

        if (needsNeighbors) {
          const wx = worldX + px * step;
          const wz = worldZ + py * step;

          const leftParams = getTerrainParams(wx - step, wz, seed, template);
          const rightParams = getTerrainParams(wx + step, wz, seed, template);
          const upParams = getTerrainParams(wx, wz - step, seed, template);
          const downParams = getTerrainParams(wx, wz + step, seed, template);

          const neighbors = {
            left: leftParams.height,
            right: rightParams.height,
            up: upParams.height,
            down: downParams.height
          };

          rgb = getColorForMode(params, mode, neighbors);
        } else {
          rgb = getColorForMode(params, mode);
        }

        const pixelIdx = idx * 4;
        data[pixelIdx] = rgb[0];
        data[pixelIdx + 1] = rgb[1];
        data[pixelIdx + 2] = rgb[2];
        data[pixelIdx + 3] = 255;
      }
    }

    return {
      imageData,
      heightmap: generateTerrain ? heightmap : null,
      biomeData: generateTerrain ? biomeData : null
    };
  }

  /**
   * Get tile from memory cache only (synchronous, non-blocking)
   * Does NOT trigger rendering if tile is not cached
   * @param {number} worldX - Tile world X coordinate
   * @param {number} worldZ - Tile world Z coordinate
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {number} lodLevel - LOD level
   * @returns {ImageData|null} Cached tile or null if not in memory
   */
  getFromMemory(worldX, worldZ, mode, seed, lodLevel = 0) {
    const key = this._makeKey(worldX, worldZ, mode, seed, lodLevel);

    if (this.cache.has(key)) {
      // Update access order for LRU
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
      }
      this.accessOrder.push(key);

      return this.cache.get(key).imageData;
    }

    return null;
  }

  /**
   * Check if tile exists in memory cache at full resolution (refinement level 5)
   * For progressive rendering, use getCurrentRefinementLevel() instead
   * @param {number} worldX - Tile world X coordinate
   * @param {number} worldZ - Tile world Z coordinate
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {number} lodLevel - LOD level
   * @returns {boolean} True if tile is cached at full resolution
   */
  hasTile(worldX, worldZ, mode, seed, lodLevel = 0) {
    // Check for full resolution (level 5) for backwards compatibility
    const key = this._makeKey(worldX, worldZ, mode, seed, lodLevel, 5);
    return this.cache.has(key);
  }

  /**
   * Check if tile has any refinement level cached
   * @param {number} worldX - Tile world X coordinate
   * @param {number} worldZ - Tile world Z coordinate
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {number} lodLevel - LOD level
   * @returns {boolean} True if any refinement level is cached
   */
  hasAnyRefinement(worldX, worldZ, mode, seed, lodLevel = 0) {
    return this.getCurrentRefinementLevel(worldX, worldZ, mode, seed, lodLevel) >= 0;
  }

  /**
   * Store a tile in memory cache (from worker or external source)
   * @param {number} worldX - Tile world X coordinate
   * @param {number} worldZ - Tile world Z coordinate
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {number} lodLevel - LOD level
   * @param {ImageData} imageData - Tile image data to store
   * @param {number} refinementLevel - Progressive refinement level (0-5, default 5 = full)
   */
  setTile(worldX, worldZ, mode, seed, lodLevel, imageData, refinementLevel = 5) {
    const key = this._makeKey(worldX, worldZ, mode, seed, lodLevel, refinementLevel);

    // Evict oldest if over capacity
    while (this.cache.size >= this.maxTiles && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift();
      this.cache.delete(oldestKey);
    }

    // Remove from access order if already exists
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }

    // Cache the tile with refinement metadata
    this.cache.set(key, { imageData, lastUsed: Date.now(), refinementLevel });
    this.accessOrder.push(key);
  }

  /**
   * Get the best available refinement level for a tile
   * Returns the highest refinement level cached, or null if none cached
   * @param {number} worldX - Tile world X coordinate
   * @param {number} worldZ - Tile world Z coordinate
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {number} lodLevel - LOD level
   * @returns {{imageData: ImageData, refinementLevel: number}|null}
   */
  getBestAvailable(worldX, worldZ, mode, seed, lodLevel = 0) {
    let best = null;
    let bestLevel = -1;

    // Check all refinement levels (0-5), return highest available
    for (let refLevel = 5; refLevel >= 0; refLevel--) {
      const key = this._makeKey(worldX, worldZ, mode, seed, lodLevel, refLevel);
      if (this.cache.has(key)) {
        const entry = this.cache.get(key);
        if (refLevel > bestLevel) {
          best = { imageData: entry.imageData, refinementLevel: refLevel };
          bestLevel = refLevel;
        }
        // Update LRU for accessed entry
        const idx = this.accessOrder.indexOf(key);
        if (idx !== -1) {
          this.accessOrder.splice(idx, 1);
        }
        this.accessOrder.push(key);
        // Return immediately if we found the highest level (full resolution)
        if (refLevel === 5) break;
      }
    }

    return best;
  }

  /**
   * Check if a tile has full resolution (refinement level 5) cached
   * @param {number} worldX - Tile world X coordinate
   * @param {number} worldZ - Tile world Z coordinate
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {number} lodLevel - LOD level
   * @returns {boolean}
   */
  hasFullResolution(worldX, worldZ, mode, seed, lodLevel = 0) {
    const key = this._makeKey(worldX, worldZ, mode, seed, lodLevel, 5);
    return this.cache.has(key);
  }

  /**
   * Get the current refinement level for a tile
   * @param {number} worldX - Tile world X coordinate
   * @param {number} worldZ - Tile world Z coordinate
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {number} lodLevel - LOD level
   * @returns {number} Current refinement level (0-5), or -1 if not cached
   */
  getCurrentRefinementLevel(worldX, worldZ, mode, seed, lodLevel = 0) {
    for (let refLevel = 5; refLevel >= 0; refLevel--) {
      const key = this._makeKey(worldX, worldZ, mode, seed, lodLevel, refLevel);
      if (this.cache.has(key)) {
        return refLevel;
      }
    }
    return -1;
  }

  /**
   * Invalidate all cached tiles
   * Call this when seed or template changes
   */
  invalidate() {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      maxTiles: this.maxTiles,
      tileSize: this.tileSize
    };
  }
}

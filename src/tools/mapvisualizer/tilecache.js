/**
 * Tile cache for terrain visualizer
 * Caches pre-rendered tiles to improve pan/zoom performance
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
  }

  /**
   * Generate cache key for a tile
   * @param {number} worldX - Tile world X coordinate (aligned to tileSize grid)
   * @param {number} worldZ - Tile world Z coordinate (aligned to tileSize grid)
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {number} lodLevel - LOD level (0 = 1:1, 1 = 1:2, 2 = 1:4, etc.)
   * @returns {string} Cache key
   */
  _makeKey(worldX, worldZ, mode, seed, lodLevel = 0) {
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

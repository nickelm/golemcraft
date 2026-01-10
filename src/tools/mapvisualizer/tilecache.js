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
   * @returns {string} Cache key
   */
  _makeKey(worldX, worldZ, mode, seed) {
    return `${worldX},${worldZ},${mode},${seed}`;
  }

  /**
   * Align a world coordinate to tile grid
   * @param {number} coord - World coordinate
   * @returns {number} Aligned coordinate
   */
  alignToGrid(coord) {
    return Math.floor(coord / this.tileSize) * this.tileSize;
  }

  /**
   * Get or render a tile
   * @param {number} worldX - Tile world X coordinate (should be aligned to tileSize grid)
   * @param {number} worldZ - Tile world Z coordinate (should be aligned to tileSize grid)
   * @param {string} mode - Visualization mode
   * @param {number} seed - World seed
   * @param {Object} template - Terrain template
   * @returns {ImageData} The tile's image data
   */
  getTile(worldX, worldZ, mode, seed, template) {
    const key = this._makeKey(worldX, worldZ, mode, seed);

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
    const imageData = this._renderTile(worldX, worldZ, mode, seed, template);

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
   */
  _renderTile(worldX, worldZ, mode, seed, template) {
    // Create an offscreen canvas for rendering
    const canvas = new OffscreenCanvas(this.tileSize, this.tileSize);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(this.tileSize, this.tileSize);
    const data = imageData.data;

    const needsNeighbors = mode === 'elevation' || mode === 'composite';

    for (let py = 0; py < this.tileSize; py++) {
      for (let px = 0; px < this.tileSize; px++) {
        const wx = worldX + px;
        const wz = worldZ + py;

        const params = getTerrainParams(wx, wz, seed, template);

        let rgb;

        if (needsNeighbors) {
          const leftParams = getTerrainParams(wx - 1, wz, seed, template);
          const rightParams = getTerrainParams(wx + 1, wz, seed, template);
          const upParams = getTerrainParams(wx, wz - 1, seed, template);
          const downParams = getTerrainParams(wx, wz + 1, seed, template);

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

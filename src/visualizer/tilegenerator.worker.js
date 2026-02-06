/**
 * TileGeneratorWorker - Web Worker for off-thread terrain tile generation
 *
 * Generates 128x128 ImageData tiles for the terrain visualizer.
 * Uses Transferable ArrayBuffers for zero-copy data transfer.
 */

import { getTerrainParams } from '../world/terrain/terraincore.js';
import { getColorForMode } from '../tools/mapvisualizer/colors.js';
import { getNominalRadius } from '../world/terrain/continentshape.js';

const TILE_SIZE = 128;

// Ocean color for positions outside the coastline
const OCEAN_COLOR = [15, 30, 80];

// Progressive refinement levels: sampling step and output grid size
const REFINEMENT_CONFIG = [
    { sampling: 32, gridSize: 4 },    // Level 0: 4x4
    { sampling: 16, gridSize: 8 },    // Level 1: 8x8
    { sampling: 8, gridSize: 16 },    // Level 2: 16x16
    { sampling: 4, gridSize: 32 },    // Level 3: 32x32
    { sampling: 2, gridSize: 64 },    // Level 4: 64x64
    { sampling: 1, gridSize: 128 }    // Level 5: 128x128 (full)
];

/**
 * Check if a world position is outside the coastline (in the ocean).
 * @param {number} wx - World X
 * @param {number} wz - World Z
 * @param {number} shapeSeed - Seed for silhouette shape
 * @param {number} baseRadius - Base island radius
 * @returns {boolean} True if outside coastline
 */
function isOutsideCoastline(wx, wz, shapeSeed, baseRadius) {
    const dist = Math.sqrt(wx * wx + wz * wz);
    const angle = Math.atan2(wz, wx);
    const radius = getNominalRadius(angle, shapeSeed, baseRadius);
    return dist > radius;
}

/**
 * Generate a tile at a specific refinement level (progressive rendering)
 * @param {Object} params - Tile generation parameters
 * @returns {{buffer: ArrayBuffer, width: number, height: number}}
 */
function generateProgressiveTile(params) {
    const { tileX, tileZ, lodLevel, refinementLevel, seed, mode, shapeSeed, baseRadius } = params;
    const hasCoastline = shapeSeed !== undefined && baseRadius !== undefined;

    const config = REFINEMENT_CONFIG[refinementLevel] || REFINEMENT_CONFIG[5];
    const { sampling, gridSize } = config;

    // Create pixel buffer at the refinement grid size
    const buffer = new ArrayBuffer(gridSize * gridSize * 4);
    const data = new Uint8ClampedArray(buffer);

    const needsNeighbors = mode === 'elevation' || mode === 'composite';

    // LOD step combined with refinement sampling
    const lodStep = 1 << lodLevel;
    const totalStep = sampling * lodStep;

    for (let py = 0; py < gridSize; py++) {
        for (let px = 0; px < gridSize; px++) {
            // World coordinates: tile origin + pixel * sampling * LOD
            const wx = tileX + px * totalStep;
            const wz = tileZ + py * totalStep;

            const index = (py * gridSize + px) * 4;

            // Check coastline - skip terrain generation for ocean positions
            if (hasCoastline && isOutsideCoastline(wx, wz, shapeSeed, baseRadius)) {
                data[index] = OCEAN_COLOR[0];
                data[index + 1] = OCEAN_COLOR[1];
                data[index + 2] = OCEAN_COLOR[2];
                data[index + 3] = 255;
                continue;
            }

            const terrainParams = getTerrainParams(wx, wz, seed);

            let rgb;

            if (needsNeighbors) {
                const leftParams = getTerrainParams(wx - totalStep, wz, seed);
                const rightParams = getTerrainParams(wx + totalStep, wz, seed);
                const upParams = getTerrainParams(wx, wz - totalStep, seed);
                const downParams = getTerrainParams(wx, wz + totalStep, seed);

                const neighbors = {
                    left: leftParams.height,
                    right: rightParams.height,
                    up: upParams.height,
                    down: downParams.height
                };

                rgb = getColorForMode(terrainParams, mode, neighbors);
            } else {
                rgb = getColorForMode(terrainParams, mode);
            }

            data[index] = rgb[0];
            data[index + 1] = rgb[1];
            data[index + 2] = rgb[2];
            data[index + 3] = 255;
        }
    }

    return { buffer, width: gridSize, height: gridSize };
}

/**
 * Generate a single tile
 * @param {Object} params - Tile generation parameters
 * @returns {ArrayBuffer} RGBA pixel data buffer
 */
function generateTile(params) {
    const { tileX, tileZ, lodLevel, seed, mode, shapeSeed, baseRadius } = params;
    const hasCoastline = shapeSeed !== undefined && baseRadius !== undefined;

    // Create pixel buffer (128 x 128 x 4 bytes RGBA)
    const buffer = new ArrayBuffer(TILE_SIZE * TILE_SIZE * 4);
    const data = new Uint8ClampedArray(buffer);

    const needsNeighbors = mode === 'elevation' || mode === 'composite';

    // LOD step: sample every 2^lodLevel blocks
    const step = 1 << lodLevel;

    for (let py = 0; py < TILE_SIZE; py++) {
        for (let px = 0; px < TILE_SIZE; px++) {
            // Scale pixel position by LOD step to sample world coordinates
            const wx = tileX + px * step;
            const wz = tileZ + py * step;

            const index = (py * TILE_SIZE + px) * 4;

            // Check coastline - skip terrain generation for ocean positions
            if (hasCoastline && isOutsideCoastline(wx, wz, shapeSeed, baseRadius)) {
                data[index] = OCEAN_COLOR[0];
                data[index + 1] = OCEAN_COLOR[1];
                data[index + 2] = OCEAN_COLOR[2];
                data[index + 3] = 255;
                continue;
            }

            const terrainParams = getTerrainParams(wx, wz, seed);

            let rgb;

            if (needsNeighbors) {
                // Scale neighbor offsets by LOD step for consistent hillshade appearance
                const leftParams = getTerrainParams(wx - step, wz, seed);
                const rightParams = getTerrainParams(wx + step, wz, seed);
                const upParams = getTerrainParams(wx, wz - step, seed);
                const downParams = getTerrainParams(wx, wz + step, seed);

                const neighbors = {
                    left: leftParams.height,
                    right: rightParams.height,
                    up: upParams.height,
                    down: downParams.height
                };

                rgb = getColorForMode(terrainParams, mode, neighbors);
            } else {
                rgb = getColorForMode(terrainParams, mode);
            }

            data[index] = rgb[0];
            data[index + 1] = rgb[1];
            data[index + 2] = rgb[2];
            data[index + 3] = 255; // Alpha
        }
    }

    return buffer;
}

/**
 * Handle incoming messages from main thread
 */
self.onmessage = function(e) {
    const { type, data } = e.data;

    switch (type) {
        case 'generate': {
            const { requestId, tileX, tileZ, lodLevel, seed, mode, shapeSeed, baseRadius } = data;

            try {
                const buffer = generateTile({
                    tileX,
                    tileZ,
                    lodLevel,
                    seed,
                    mode,
                    shapeSeed,
                    baseRadius
                });

                // Send response with transferred buffer (zero-copy)
                self.postMessage({
                    type: 'tile',
                    requestId,
                    tileX,
                    tileZ,
                    lodLevel,
                    mode,
                    buffer,
                    width: TILE_SIZE,
                    height: TILE_SIZE
                }, [buffer]);
            } catch (error) {
                console.error(`Worker: Error generating tile ${requestId}:`, error);
                self.postMessage({
                    type: 'error',
                    requestId,
                    tileX,
                    tileZ,
                    error: error.message
                });
            }
            break;
        }

        case 'generate_progressive': {
            // Progressive refinement tile generation
            const { requestId, tileX, tileZ, lodLevel, refinementLevel, seed, mode, shapeSeed, baseRadius } = data;

            try {
                const result = generateProgressiveTile({
                    tileX,
                    tileZ,
                    lodLevel,
                    refinementLevel,
                    seed,
                    mode,
                    shapeSeed,
                    baseRadius
                });

                // Send response with refinement metadata
                self.postMessage({
                    type: 'tile_progressive',
                    requestId,
                    tileX,
                    tileZ,
                    lodLevel,
                    refinementLevel,
                    mode,
                    buffer: result.buffer,
                    width: result.width,
                    height: result.height
                }, [result.buffer]);
            } catch (error) {
                console.error(`Worker: Error generating progressive tile ${requestId}:`, error);
                self.postMessage({
                    type: 'error',
                    requestId,
                    tileX,
                    tileZ,
                    refinementLevel,
                    error: error.message
                });
            }
            break;
        }

        case 'ping': {
            // Simple health check
            self.postMessage({ type: 'pong' });
            break;
        }

        default:
            console.warn('TileGeneratorWorker: Unknown message type:', type);
    }
};

// Signal that worker is ready
self.postMessage({ type: 'ready' });

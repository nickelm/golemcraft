/**
 * TileGeneratorWorker - Web Worker for off-thread terrain tile generation
 *
 * Generates 128x128 ImageData tiles for the terrain visualizer.
 * Uses Transferable ArrayBuffers for zero-copy data transfer.
 */

import { getTerrainParams } from '../world/terrain/worldgen.js';
import { getColorForMode } from '../tools/mapvisualizer/colors.js';

const TILE_SIZE = 128;

/**
 * Generate a single tile
 * @param {Object} params - Tile generation parameters
 * @returns {ArrayBuffer} RGBA pixel data buffer
 */
function generateTile(params) {
    const { tileX, tileZ, lodLevel, seed, mode, template } = params;

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

            const terrainParams = getTerrainParams(wx, wz, seed, template);

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

                rgb = getColorForMode(terrainParams, mode, neighbors);
            } else {
                rgb = getColorForMode(terrainParams, mode);
            }

            const index = (py * TILE_SIZE + px) * 4;
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
            const { requestId, tileX, tileZ, lodLevel, seed, mode, template } = data;

            try {
                const buffer = generateTile({
                    tileX,
                    tileZ,
                    lodLevel,
                    seed,
                    mode,
                    template
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

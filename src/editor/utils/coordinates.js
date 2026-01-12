/**
 * Template Editor - Coordinate Utilities
 *
 * Functions for converting between coordinate systems:
 * - Normalized [0,1]: Template space (matches templates.js convention)
 * - World: Block coordinates (matches worldgen.js)
 * - Canvas: Pixel coordinates on screen
 */

/**
 * Convert normalized coordinates to world coordinates
 * @param {number} nx - Normalized X [0,1]
 * @param {number} nz - Normalized Z [0,1]
 * @param {Object} template - Template with worldBounds
 * @returns {{x: number, z: number}} World coordinates
 */
export function normalizedToWorld(nx, nz, template) {
    const bounds = template.worldBounds || { min: -2000, max: 2000 };
    const range = bounds.max - bounds.min;

    return {
        x: bounds.min + nx * range,
        z: bounds.min + nz * range
    };
}

/**
 * Convert world coordinates to normalized coordinates
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {Object} template - Template with worldBounds
 * @returns {{x: number, z: number}} Normalized coordinates [0,1]
 */
export function worldToNormalized(x, z, template) {
    const bounds = template.worldBounds || { min: -2000, max: 2000 };
    const range = bounds.max - bounds.min;

    return {
        x: (x - bounds.min) / range,
        z: (z - bounds.min) / range
    };
}

/**
 * Convert world coordinates to canvas (screen) coordinates
 * @param {number} worldX - World X coordinate
 * @param {number} worldZ - World Z coordinate
 * @param {Object} viewState - View state with viewX, viewZ, zoom
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 * @returns {{x: number, y: number}} Canvas coordinates
 */
export function worldToCanvas(worldX, worldZ, viewState, canvasWidth, canvasHeight) {
    const halfWidth = canvasWidth / 2;
    const halfHeight = canvasHeight / 2;

    return {
        x: halfWidth + (worldX - viewState.viewX) * viewState.zoom,
        y: halfHeight + (worldZ - viewState.viewZ) * viewState.zoom
    };
}

/**
 * Convert canvas (screen) coordinates to world coordinates
 * @param {number} canvasX - Canvas X coordinate (pixels)
 * @param {number} canvasY - Canvas Y coordinate (pixels)
 * @param {Object} viewState - View state with viewX, viewZ, zoom
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 * @returns {{x: number, z: number}} World coordinates
 */
export function canvasToWorld(canvasX, canvasY, viewState, canvasWidth, canvasHeight) {
    const halfWidth = canvasWidth / 2;
    const halfHeight = canvasHeight / 2;

    return {
        x: viewState.viewX + (canvasX - halfWidth) / viewState.zoom,
        z: viewState.viewZ + (canvasY - halfHeight) / viewState.zoom
    };
}

/**
 * Convert canvas coordinates to normalized coordinates
 * @param {number} canvasX - Canvas X coordinate (pixels)
 * @param {number} canvasY - Canvas Y coordinate (pixels)
 * @param {Object} viewState - View state with viewX, viewZ, zoom
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 * @param {Object} template - Template with worldBounds
 * @returns {{x: number, z: number}} Normalized coordinates [0,1]
 */
export function canvasToNormalized(canvasX, canvasY, viewState, canvasWidth, canvasHeight, template) {
    const world = canvasToWorld(canvasX, canvasY, viewState, canvasWidth, canvasHeight);
    return worldToNormalized(world.x, world.z, template);
}

/**
 * Convert normalized coordinates to canvas coordinates
 * @param {number} nx - Normalized X [0,1]
 * @param {number} nz - Normalized Z [0,1]
 * @param {Object} viewState - View state with viewX, viewZ, zoom
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 * @param {Object} template - Template with worldBounds
 * @returns {{x: number, y: number}} Canvas coordinates
 */
export function normalizedToCanvas(nx, nz, viewState, canvasWidth, canvasHeight, template) {
    const world = normalizedToWorld(nx, nz, template);
    return worldToCanvas(world.x, world.z, viewState, canvasWidth, canvasHeight);
}

/**
 * Calculate the visible world bounds from the current view state
 * @param {Object} viewState - View state with viewX, viewZ, zoom
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 * @returns {{minX: number, maxX: number, minZ: number, maxZ: number}} World bounds
 */
export function getVisibleWorldBounds(viewState, canvasWidth, canvasHeight) {
    const halfWidth = canvasWidth / 2;
    const halfHeight = canvasHeight / 2;

    return {
        minX: viewState.viewX - halfWidth / viewState.zoom,
        maxX: viewState.viewX + halfWidth / viewState.zoom,
        minZ: viewState.viewZ - halfHeight / viewState.zoom,
        maxZ: viewState.viewZ + halfHeight / viewState.zoom
    };
}

/**
 * Check if a world-space bounding box is visible in the current view
 * @param {Object} bounds - Bounds with minX, maxX, minZ, maxZ
 * @param {Object} viewState - View state with viewX, viewZ, zoom
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 * @returns {boolean} True if bounds intersect with visible area
 */
export function isWorldBoundsVisible(bounds, viewState, canvasWidth, canvasHeight) {
    const visible = getVisibleWorldBounds(viewState, canvasWidth, canvasHeight);

    return bounds.maxX >= visible.minX &&
           bounds.minX <= visible.maxX &&
           bounds.maxZ >= visible.minZ &&
           bounds.minZ <= visible.maxZ;
}

/**
 * Calculate LOD level from zoom
 * Higher LOD = lower resolution (for zoomed-out views)
 * @param {number} zoom - Zoom level (pixels per world block)
 * @returns {number} LOD level (0 = full resolution)
 */
export function calculateLOD(zoom) {
    if (zoom >= 1) return 0;
    const lod = Math.floor(-Math.log2(zoom));
    return Math.min(lod, 6); // Cap at LOD 6 (1:64 sampling)
}

/**
 * Align a coordinate to the tile grid at a given LOD level
 * @param {number} coord - World coordinate
 * @param {number} tileSize - Base tile size in pixels
 * @param {number} lodLevel - LOD level
 * @returns {number} Aligned coordinate
 */
export function alignToTileGrid(coord, tileSize, lodLevel = 0) {
    const worldTileSize = tileSize * (1 << lodLevel);
    return Math.floor(coord / worldTileSize) * worldTileSize;
}

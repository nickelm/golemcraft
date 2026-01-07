/**
 * ClearingRegistry - Spatial index for object suppression zones
 * Tracks areas where trees, rocks, and other objects should not spawn.
 *
 * Uses a grid-based spatial hash for O(1) queries.
 * Runs on the main thread, queried during object spawning.
 */

const DEFAULT_CELL_SIZE = 32;

/**
 * Check if a point is inside a rotated rectangle
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {number} cx - Rectangle center X
 * @param {number} cz - Rectangle center Z
 * @param {number} halfWidth - Half width of rectangle
 * @param {number} halfDepth - Half depth of rectangle
 * @param {number} cos - Cosine of rotation angle
 * @param {number} sin - Sine of rotation angle
 * @returns {boolean}
 */
function pointInRotatedRect(px, pz, cx, cz, halfWidth, halfDepth, cos, sin) {
    // Translate point to rectangle's local coordinates
    const dx = px - cx;
    const dz = pz - cz;

    // Rotate point by negative angle (inverse rotation)
    const localX = dx * cos + dz * sin;
    const localZ = -dx * sin + dz * cos;

    // Check if in axis-aligned bounds
    return Math.abs(localX) <= halfWidth && Math.abs(localZ) <= halfDepth;
}

/**
 * Check if a point is inside a circle
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {number} cx - Circle center X
 * @param {number} cz - Circle center Z
 * @param {number} radius - Circle radius
 * @returns {boolean}
 */
function pointInCircle(px, pz, cx, cz, radius) {
    const dx = px - cx;
    const dz = pz - cz;
    return dx * dx + dz * dz <= radius * radius;
}

export class ClearingRegistry {
    /**
     * @param {number} cellSize - Size of spatial hash cells (default 32)
     */
    constructor(cellSize = DEFAULT_CELL_SIZE) {
        this.cellSize = cellSize;
        this.clearings = new Map();      // landmarkId -> array of shapes
        this.spatialHash = new Map();    // "cellX,cellZ" -> Set of landmarkIds
    }

    /**
     * Get the cell key for a world position
     * @param {number} x - World X
     * @param {number} z - World Z
     * @returns {string}
     */
    getCellKey(x, z) {
        const cellX = Math.floor(x / this.cellSize);
        const cellZ = Math.floor(z / this.cellSize);
        return `${cellX},${cellZ}`;
    }

    /**
     * Get all cell keys that a bounding box overlaps
     * @param {number} minX - Minimum X
     * @param {number} maxX - Maximum X
     * @param {number} minZ - Minimum Z
     * @param {number} maxZ - Maximum Z
     * @returns {string[]}
     */
    getCellsForBounds(minX, maxX, minZ, maxZ) {
        const cells = [];
        const minCellX = Math.floor(minX / this.cellSize);
        const maxCellX = Math.floor(maxX / this.cellSize);
        const minCellZ = Math.floor(minZ / this.cellSize);
        const maxCellZ = Math.floor(maxZ / this.cellSize);

        for (let cx = minCellX; cx <= maxCellX; cx++) {
            for (let cz = minCellZ; cz <= maxCellZ; cz++) {
                cells.push(`${cx},${cz}`);
            }
        }
        return cells;
    }

    /**
     * Add a landmark to a cell's spatial hash
     * @param {string} cellKey - Cell key
     * @param {string} landmarkId - Landmark identifier
     */
    addToCell(cellKey, landmarkId) {
        if (!this.spatialHash.has(cellKey)) {
            this.spatialHash.set(cellKey, new Set());
        }
        this.spatialHash.get(cellKey).add(landmarkId);
    }

    /**
     * Add a circular clearing
     * @param {number} centerX - Center X
     * @param {number} centerZ - Center Z
     * @param {number} radius - Circle radius
     * @param {string} landmarkId - Landmark identifier
     */
    addCircle(centerX, centerZ, radius, landmarkId) {
        const shape = {
            type: 'circle',
            centerX,
            centerZ,
            radius
        };

        // Store shape
        if (!this.clearings.has(landmarkId)) {
            this.clearings.set(landmarkId, []);
        }
        this.clearings.get(landmarkId).push(shape);

        // Add to spatial hash (all cells the bounding box overlaps)
        const cells = this.getCellsForBounds(
            centerX - radius, centerX + radius,
            centerZ - radius, centerZ + radius
        );
        for (const cell of cells) {
            this.addToCell(cell, landmarkId);
        }
    }

    /**
     * Add a rectangular clearing (optionally rotated)
     * @param {number} centerX - Center X
     * @param {number} centerZ - Center Z
     * @param {number} width - Width (X axis before rotation)
     * @param {number} depth - Depth (Z axis before rotation)
     * @param {number} rotation - Rotation angle in radians
     * @param {string} landmarkId - Landmark identifier
     */
    addRect(centerX, centerZ, width, depth, rotation, landmarkId) {
        const halfWidth = width / 2;
        const halfDepth = depth / 2;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);

        const shape = {
            type: 'rect',
            centerX,
            centerZ,
            halfWidth,
            halfDepth,
            cos,
            sin
        };

        // Store shape
        if (!this.clearings.has(landmarkId)) {
            this.clearings.set(landmarkId, []);
        }
        this.clearings.get(landmarkId).push(shape);

        // Calculate axis-aligned bounding box for rotated rectangle
        // The corners in local space are (+/-halfWidth, +/-halfDepth)
        // Rotate each corner to find AABB
        const corners = [
            { x: halfWidth, z: halfDepth },
            { x: halfWidth, z: -halfDepth },
            { x: -halfWidth, z: halfDepth },
            { x: -halfWidth, z: -halfDepth }
        ];

        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (const corner of corners) {
            // Rotate corner
            const rx = corner.x * cos - corner.z * sin + centerX;
            const rz = corner.x * sin + corner.z * cos + centerZ;
            minX = Math.min(minX, rx);
            maxX = Math.max(maxX, rx);
            minZ = Math.min(minZ, rz);
            maxZ = Math.max(maxZ, rz);
        }

        // Add to spatial hash
        const cells = this.getCellsForBounds(minX, maxX, minZ, maxZ);
        for (const cell of cells) {
            this.addToCell(cell, landmarkId);
        }
    }

    /**
     * Check if a position is inside any clearing
     * @param {number} x - World X
     * @param {number} z - World Z
     * @returns {boolean}
     */
    isInClearing(x, z) {
        const cellKey = this.getCellKey(x, z);
        const landmarkIds = this.spatialHash.get(cellKey);

        if (!landmarkIds) return false;

        for (const landmarkId of landmarkIds) {
            const shapes = this.clearings.get(landmarkId);
            if (!shapes) continue;

            for (const shape of shapes) {
                if (shape.type === 'circle') {
                    if (pointInCircle(x, z, shape.centerX, shape.centerZ, shape.radius)) {
                        return true;
                    }
                } else if (shape.type === 'rect') {
                    if (pointInRotatedRect(
                        x, z,
                        shape.centerX, shape.centerZ,
                        shape.halfWidth, shape.halfDepth,
                        shape.cos, shape.sin
                    )) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Get the landmark ID of the clearing at a position (for debugging)
     * @param {number} x - World X
     * @param {number} z - World Z
     * @returns {string|null}
     */
    getClearingAt(x, z) {
        const cellKey = this.getCellKey(x, z);
        const landmarkIds = this.spatialHash.get(cellKey);

        if (!landmarkIds) return null;

        for (const landmarkId of landmarkIds) {
            const shapes = this.clearings.get(landmarkId);
            if (!shapes) continue;

            for (const shape of shapes) {
                if (shape.type === 'circle') {
                    if (pointInCircle(x, z, shape.centerX, shape.centerZ, shape.radius)) {
                        return landmarkId;
                    }
                } else if (shape.type === 'rect') {
                    if (pointInRotatedRect(
                        x, z,
                        shape.centerX, shape.centerZ,
                        shape.halfWidth, shape.halfDepth,
                        shape.cos, shape.sin
                    )) {
                        return landmarkId;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Remove all clearings for a landmark
     * @param {string} landmarkId - Landmark identifier
     */
    removeLandmark(landmarkId) {
        // Remove from clearings
        this.clearings.delete(landmarkId);

        // Remove from spatial hash (scan all cells)
        for (const [cellKey, landmarkIds] of this.spatialHash) {
            landmarkIds.delete(landmarkId);
            if (landmarkIds.size === 0) {
                this.spatialHash.delete(cellKey);
            }
        }
    }

    /**
     * Clear all clearings (for world regeneration)
     */
    clear() {
        this.clearings.clear();
        this.spatialHash.clear();
    }

    /**
     * Get statistics for debugging
     * @returns {{clearingCount: number, shapeCount: number, cellCount: number}}
     */
    getStats() {
        let shapeCount = 0;
        for (const shapes of this.clearings.values()) {
            shapeCount += shapes.length;
        }
        return {
            clearingCount: this.clearings.size,
            shapeCount,
            cellCount: this.spatialHash.size
        };
    }
}

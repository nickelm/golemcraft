/**
 * LinearFeature - Shared data structure for rivers, roads, trails, and paths
 *
 * Provides geometry utilities and spatial indexing for linear world features.
 * Follows the ClearingRegistry pattern for grid-based spatial queries.
 */

// =============================================================================
// Geometry Helper Functions
// =============================================================================

/**
 * Calculate shortest distance from point to line segment
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {number} x1 - Segment start X
 * @param {number} z1 - Segment start Z
 * @param {number} x2 - Segment end X
 * @param {number} z2 - Segment end Z
 * @returns {number} Distance to segment
 */
export function distanceToSegment(px, pz, x1, z1, x2, z2) {
    const projection = projectOntoSegment(px, pz, x1, z1, x2, z2);
    const dx = px - projection.x;
    const dz = pz - projection.z;
    return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Project point onto line segment
 * @param {number} px - Point X
 * @param {number} pz - Point Z
 * @param {number} x1 - Segment start X
 * @param {number} z1 - Segment start Z
 * @param {number} x2 - Segment end X
 * @param {number} z2 - Segment end Z
 * @returns {{ x: number, z: number, t: number }} Projected point and t (0-1 along segment)
 */
export function projectOntoSegment(px, pz, x1, z1, x2, z2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lengthSq = dx * dx + dz * dz;

    // Degenerate segment (single point)
    if (lengthSq === 0) {
        return { x: x1, z: z1, t: 0 };
    }

    // Calculate projection parameter t
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lengthSq));

    return {
        x: x1 + t * dx,
        z: z1 + t * dz,
        t
    };
}

// =============================================================================
// LinearFeature Class
// =============================================================================

let featureIdCounter = 0;

/**
 * Represents a linear feature in the world (river, road, trail, path)
 */
export class LinearFeature {
    /**
     * @param {string} type - Feature type: 'river' | 'road' | 'trail' | 'path'
     * @param {Array<{x: number, z: number}>} path - Array of points defining the feature
     * @param {Object} properties - Additional properties
     * @param {number} [properties.width=2] - Default width of the feature
     * @param {number[]} [properties.widths] - Per-point widths (optional, for varying width)
     */
    constructor(type, path, properties = {}) {
        this.id = `feature_${featureIdCounter++}`;
        this.type = type;
        this.path = path;
        this.properties = {
            width: properties.width || 2,
            ...properties
        };
    }

    /**
     * Get width at a specific path point index
     * @param {number} index - Path point index
     * @returns {number} Width at that point
     */
    getWidthAt(index) {
        if (this.properties.widths && this.properties.widths[index] !== undefined) {
            return this.properties.widths[index];
        }
        return this.properties.width;
    }

    /**
     * Get interpolated width at a position along a segment
     * @param {number} index - Start index of segment
     * @param {number} t - Interpolation factor (0-1 along segment)
     * @returns {number} Interpolated width
     */
    getWidthAtT(index, t) {
        const width1 = this.getWidthAt(index);
        const nextIndex = Math.min(index + 1, this.path.length - 1);
        const width2 = this.getWidthAt(nextIndex);
        return width1 + (width2 - width1) * t;
    }

    /**
     * Find nearest point on path to world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {{ index: number, distance: number, point: {x: number, z: number}, t: number }}
     */
    getNearestPoint(worldX, worldZ) {
        let nearestIndex = 0;
        let nearestDistance = Infinity;
        let nearestPoint = { x: this.path[0].x, z: this.path[0].z };
        let nearestT = 0;

        for (let i = 0; i < this.path.length - 1; i++) {
            const p1 = this.path[i];
            const p2 = this.path[i + 1];

            const projection = projectOntoSegment(worldX, worldZ, p1.x, p1.z, p2.x, p2.z);
            const dx = worldX - projection.x;
            const dz = worldZ - projection.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = i;
                nearestPoint = { x: projection.x, z: projection.z };
                nearestT = projection.t;
            }
        }

        return {
            index: nearestIndex,
            distance: nearestDistance,
            point: nearestPoint,
            t: nearestT
        };
    }

    /**
     * Get influence at world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {{ distance: number, width: number, influence: number, centerDistance: number } | null}
     */
    getInfluence(worldX, worldZ) {
        const nearest = this.getNearestPoint(worldX, worldZ);
        const width = this.getWidthAtT(nearest.index, nearest.t);
        const blendDistance = width * 1.5;

        if (nearest.distance > blendDistance) {
            return null;
        }

        return {
            distance: nearest.distance,
            width: width,
            influence: 1 - (nearest.distance / blendDistance),
            centerDistance: nearest.distance / (width / 2)  // 0 = center, 1 = edge, >1 = outside core
        };
    }

    /**
     * Get axis-aligned bounding box of the feature
     * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number }}
     */
    getBounds() {
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (let i = 0; i < this.path.length; i++) {
            const p = this.path[i];
            const w = this.getWidthAt(i) * 1.5; // Include blend distance
            minX = Math.min(minX, p.x - w);
            maxX = Math.max(maxX, p.x + w);
            minZ = Math.min(minZ, p.z - w);
            maxZ = Math.max(maxZ, p.z + w);
        }

        return { minX, maxX, minZ, maxZ };
    }
}

// =============================================================================
// LinearFeatureIndex Class
// =============================================================================

const DEFAULT_CELL_SIZE = 256;

/**
 * Grid-based spatial index for fast linear feature queries
 */
export class LinearFeatureIndex {
    /**
     * @param {number} cellSize - Size of spatial hash cells (default 256)
     */
    constructor(cellSize = DEFAULT_CELL_SIZE) {
        this.cellSize = cellSize;
        this.grid = new Map();      // cellKey -> Set<featureId>
        this.features = new Map();  // featureId -> LinearFeature
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
     * Add a feature to a cell's spatial hash
     * @param {string} cellKey - Cell key
     * @param {string} featureId - Feature identifier
     */
    addToCell(cellKey, featureId) {
        if (!this.grid.has(cellKey)) {
            this.grid.set(cellKey, new Set());
        }
        this.grid.get(cellKey).add(featureId);
    }

    /**
     * Add a linear feature to the index
     * @param {LinearFeature} feature - The feature to add
     */
    add(feature) {
        // Store feature by ID
        this.features.set(feature.id, feature);

        // Index each segment in all cells it passes through
        for (let i = 0; i < feature.path.length - 1; i++) {
            const p1 = feature.path[i];
            const p2 = feature.path[i + 1];
            const w1 = feature.getWidthAt(i) * 1.5;
            const w2 = feature.getWidthAt(i + 1) * 1.5;
            const maxW = Math.max(w1, w2);

            // Segment bounding box with width buffer
            const minX = Math.min(p1.x, p2.x) - maxW;
            const maxX = Math.max(p1.x, p2.x) + maxW;
            const minZ = Math.min(p1.z, p2.z) - maxW;
            const maxZ = Math.max(p1.z, p2.z) + maxW;

            const cells = this.getCellsForBounds(minX, maxX, minZ, maxZ);
            for (const cell of cells) {
                this.addToCell(cell, feature.id);
            }
        }
    }

    /**
     * Remove a feature from the index
     * @param {string} featureId - The feature ID to remove
     */
    remove(featureId) {
        // Remove from features map
        this.features.delete(featureId);

        // Remove from all grid cells
        for (const [cellKey, featureIds] of this.grid) {
            featureIds.delete(featureId);
            if (featureIds.size === 0) {
                this.grid.delete(cellKey);
            }
        }
    }

    /**
     * Query features near a world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {LinearFeature[]} Array of features in this cell and neighbors
     */
    query(worldX, worldZ) {
        const cellKey = this.getCellKey(worldX, worldZ);
        const featureIds = this.grid.get(cellKey);

        if (!featureIds) {
            return [];
        }

        const result = [];
        for (const featureId of featureIds) {
            const feature = this.features.get(featureId);
            if (feature) {
                result.push(feature);
            }
        }
        return result;
    }

    /**
     * Get the strongest influence at a world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {{ feature: LinearFeature, influence: Object } | null}
     */
    getInfluenceAt(worldX, worldZ) {
        const features = this.query(worldX, worldZ);

        let strongest = null;
        let strongestInfluence = null;

        for (const feature of features) {
            const influence = feature.getInfluence(worldX, worldZ);
            if (influence && (!strongestInfluence || influence.influence > strongestInfluence.influence)) {
                strongest = feature;
                strongestInfluence = influence;
            }
        }

        if (!strongest) {
            return null;
        }

        return {
            feature: strongest,
            influence: strongestInfluence
        };
    }

    /**
     * Get all influences at a world position (for blending multiple features)
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {Array<{ feature: LinearFeature, influence: Object }>}
     */
    getAllInfluencesAt(worldX, worldZ) {
        const features = this.query(worldX, worldZ);
        const results = [];

        for (const feature of features) {
            const influence = feature.getInfluence(worldX, worldZ);
            if (influence) {
                results.push({ feature, influence });
            }
        }

        // Sort by influence strength (strongest first)
        results.sort((a, b) => b.influence.influence - a.influence.influence);

        return results;
    }

    /**
     * Clear all features from the index
     */
    clear() {
        this.grid.clear();
        this.features.clear();
    }

    /**
     * Get statistics for debugging
     * @returns {{ featureCount: number, cellCount: number }}
     */
    getStats() {
        return {
            featureCount: this.features.size,
            cellCount: this.grid.size
        };
    }
}

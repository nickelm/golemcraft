/**
 * SpineFeature - Mountain spine/ridge data structure
 *
 * Represents linear elevation features (mountain range backbones) for defining
 * drainage basins and terrain structure. Unlike LinearFeature (used for rivers
 * which carve terrain), SpineFeature additively boosts elevation.
 *
 * Pure data structure with no Three.js dependencies - compatible with web workers.
 */

import { projectOntoSegment } from './linearfeature.js';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Spine configuration constants
 */
export const SPINE_CONFIG = {
    defaultFalloffWidth: 150,   // Gaussian sigma in blocks (increased for wider ridges)
    maxInfluenceRadius: 500,    // Beyond this, influence is effectively 0 (increased)
    minProminence: 0.2,         // Minimum prominence value for spine points
};

// =============================================================================
// SpineFeature Class
// =============================================================================

let spineIdCounter = 0;

/**
 * Represents a mountain spine/ridge in the world
 *
 * Each path point contains:
 * - x, z: World coordinates
 * - elevation: Normalized height [0-1] representing spine peak height
 * - prominence: Local dominance [0-1] representing how dominant this ridge is
 */
export class SpineFeature {
    /**
     * @param {Array<{x: number, z: number, elevation: number, prominence: number}>} path - Spine path points
     * @param {Object} properties - Additional metadata
     * @param {string} [properties.name] - Optional name (e.g., "Northern Range")
     * @param {string} [properties.direction] - Primary direction: 'EW', 'NS', 'NE', 'NW'
     */
    constructor(path, properties = {}) {
        this.id = `spine_${spineIdCounter++}`;
        this.path = path;
        this.properties = { ...properties };
    }

    /**
     * Get elevation at a specific path point index
     * @param {number} index - Path point index
     * @returns {number} Elevation [0-1] at that point
     */
    getElevationAt(index) {
        if (index < 0 || index >= this.path.length) {
            return 0;
        }
        return this.path[index].elevation;
    }

    /**
     * Get interpolated elevation along a segment
     * @param {number} index - Start index of segment
     * @param {number} t - Interpolation factor [0-1] along segment
     * @returns {number} Interpolated elevation [0-1]
     */
    getElevationAtT(index, t) {
        const elev1 = this.getElevationAt(index);
        const nextIndex = Math.min(index + 1, this.path.length - 1);
        const elev2 = this.getElevationAt(nextIndex);
        return elev1 + (elev2 - elev1) * t;
    }

    /**
     * Get prominence at a specific path point index
     * @param {number} index - Path point index
     * @returns {number} Prominence [0-1] at that point
     */
    getProminenceAt(index) {
        if (index < 0 || index >= this.path.length) {
            return 0;
        }
        return this.path[index].prominence;
    }

    /**
     * Get interpolated prominence along a segment
     * @param {number} index - Start index of segment
     * @param {number} t - Interpolation factor [0-1] along segment
     * @returns {number} Interpolated prominence [0-1]
     */
    getProminenceAtT(index, t) {
        const prom1 = this.getProminenceAt(index);
        const nextIndex = Math.min(index + 1, this.path.length - 1);
        const prom2 = this.getProminenceAt(nextIndex);
        return prom1 + (prom2 - prom1) * t;
    }

    /**
     * Find nearest point on spine path to world position
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
     * Get axis-aligned bounding box of the spine
     * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number }}
     */
    getBounds() {
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (const p of this.path) {
            // Include influence radius in bounds
            const buffer = SPINE_CONFIG.maxInfluenceRadius;
            minX = Math.min(minX, p.x - buffer);
            maxX = Math.max(maxX, p.x + buffer);
            minZ = Math.min(minZ, p.z - buffer);
            maxZ = Math.max(maxZ, p.z + buffer);
        }

        return { minX, maxX, minZ, maxZ };
    }

    /**
     * Get influence at world position using Gaussian falloff
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @param {number} [falloffWidth] - Gaussian sigma (default: SPINE_CONFIG.defaultFalloffWidth)
     * @returns {{ distance: number, elevation: number, prominence: number, influence: number, boost: number } | null}
     */
    getInfluence(worldX, worldZ, falloffWidth = SPINE_CONFIG.defaultFalloffWidth) {
        const nearest = this.getNearestPoint(worldX, worldZ);

        // Early out if too far away
        if (nearest.distance > SPINE_CONFIG.maxInfluenceRadius) {
            return null;
        }

        // Get interpolated elevation and prominence at nearest point
        const elevation = this.getElevationAtT(nearest.index, nearest.t);
        const prominence = this.getProminenceAtT(nearest.index, nearest.t);

        // Gaussian falloff based on perpendicular distance
        const sigma = falloffWidth;
        const influence = Math.exp(-(nearest.distance * nearest.distance) / (2 * sigma * sigma));

        // Combined boost = elevation * prominence * influence
        const boost = elevation * prominence * influence;

        return {
            distance: nearest.distance,
            elevation,
            prominence,
            influence,
            boost
        };
    }

    /**
     * Serialize to JSON-compatible object
     * @returns {Object} Serializable representation
     */
    toJSON() {
        return {
            id: this.id,
            path: this.path,
            properties: this.properties
        };
    }

    /**
     * Deserialize from JSON object
     * @param {Object} json - Serialized spine data
     * @returns {SpineFeature} Reconstructed SpineFeature
     */
    static fromJSON(json) {
        const spine = new SpineFeature(json.path, json.properties);
        // Preserve original ID if present
        if (json.id) {
            spine.id = json.id;
        }
        return spine;
    }
}

// =============================================================================
// SpineFeatureIndex Class
// =============================================================================

const DEFAULT_CELL_SIZE = 256;

/**
 * Grid-based spatial index for fast spine queries
 * Wraps LinearFeatureIndex pattern with spine-specific query methods
 */
export class SpineFeatureIndex {
    /**
     * @param {number} cellSize - Size of spatial hash cells (default 256)
     */
    constructor(cellSize = DEFAULT_CELL_SIZE) {
        this.cellSize = cellSize;
        this.grid = new Map();      // cellKey -> Set<spineId>
        this.spines = new Map();    // spineId -> SpineFeature
    }

    /**
     * Get the cell key for a world position
     * @param {number} x - World X
     * @param {number} z - World Z
     * @returns {string} Cell key
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
     * @returns {string[]} Array of cell keys
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
     * Add a spine to a cell's spatial hash
     * @param {string} cellKey - Cell key
     * @param {string} spineId - Spine identifier
     */
    addToCell(cellKey, spineId) {
        if (!this.grid.has(cellKey)) {
            this.grid.set(cellKey, new Set());
        }
        this.grid.get(cellKey).add(spineId);
    }

    /**
     * Add a spine feature to the index
     * @param {SpineFeature} spine - The spine to add
     */
    add(spine) {
        // Store spine by ID
        this.spines.set(spine.id, spine);

        // Index each segment in all cells it passes through
        for (let i = 0; i < spine.path.length - 1; i++) {
            const p1 = spine.path[i];
            const p2 = spine.path[i + 1];
            const buffer = SPINE_CONFIG.maxInfluenceRadius;

            // Segment bounding box with influence buffer
            const minX = Math.min(p1.x, p2.x) - buffer;
            const maxX = Math.max(p1.x, p2.x) + buffer;
            const minZ = Math.min(p1.z, p2.z) - buffer;
            const maxZ = Math.max(p1.z, p2.z) + buffer;

            const cells = this.getCellsForBounds(minX, maxX, minZ, maxZ);
            for (const cell of cells) {
                this.addToCell(cell, spine.id);
            }
        }
    }

    /**
     * Remove a spine from the index
     * @param {string} spineId - The spine ID to remove
     */
    remove(spineId) {
        // Remove from spines map
        this.spines.delete(spineId);

        // Remove from all grid cells
        for (const [cellKey, spineIds] of this.grid) {
            spineIds.delete(spineId);
            if (spineIds.size === 0) {
                this.grid.delete(cellKey);
            }
        }
    }

    /**
     * Query spines near a world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {SpineFeature[]} Array of spines in this cell
     */
    query(worldX, worldZ) {
        const cellKey = this.getCellKey(worldX, worldZ);
        const spineIds = this.grid.get(cellKey);

        if (!spineIds) {
            return [];
        }

        const result = [];
        for (const spineId of spineIds) {
            const spine = this.spines.get(spineId);
            if (spine) {
                result.push(spine);
            }
        }
        return result;
    }

    /**
     * Get the strongest spine influence at a world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {{ spine: SpineFeature, influence: Object } | null}
     */
    getInfluenceAt(worldX, worldZ) {
        const spines = this.query(worldX, worldZ);

        let strongest = null;
        let strongestInfluence = null;

        for (const spine of spines) {
            const influence = spine.getInfluence(worldX, worldZ);
            if (influence && (!strongestInfluence || influence.boost > strongestInfluence.boost)) {
                strongest = spine;
                strongestInfluence = influence;
            }
        }

        if (!strongest) {
            return null;
        }

        return {
            spine: strongest,
            influence: strongestInfluence
        };
    }

    /**
     * Get all spine influences at a world position (for blending multiple spines)
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {Array<{ spine: SpineFeature, influence: Object }>}
     */
    getAllInfluencesAt(worldX, worldZ) {
        const spines = this.query(worldX, worldZ);
        const results = [];

        for (const spine of spines) {
            const influence = spine.getInfluence(worldX, worldZ);
            if (influence) {
                results.push({ spine, influence });
            }
        }

        // Sort by boost strength (strongest first)
        results.sort((a, b) => b.influence.boost - a.influence.boost);

        return results;
    }

    /**
     * Get combined elevation boost from all nearby spines
     * Uses max() for overlapping spines (not additive to avoid extreme heights)
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {number} Combined elevation boost [0-1]
     */
    getElevationBoostAt(worldX, worldZ) {
        const influences = this.getAllInfluencesAt(worldX, worldZ);

        let maxBoost = 0;
        for (const { influence } of influences) {
            maxBoost = Math.max(maxBoost, influence.boost);
        }

        return maxBoost;
    }

    /**
     * Clear all spines from the index
     */
    clear() {
        this.grid.clear();
        this.spines.clear();
    }

    /**
     * Get statistics for debugging
     * @returns {{ spineCount: number, cellCount: number }}
     */
    getStats() {
        return {
            spineCount: this.spines.size,
            cellCount: this.grid.size
        };
    }
}

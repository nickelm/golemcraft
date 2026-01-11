/**
 * WorldGenerator - Global world feature generation pipeline
 *
 * Generates and caches global features: rivers, lakes, zones, roads, settlements, landmarks.
 * Pure class with no DOM/Three.js dependencies - compatible with both main thread and workers.
 *
 * The pipeline runs once when world is created; results are cached and saved with the world.
 */

import {
    deriveSeed,
    getTerrainParams,
    getCoastProximity,
    getHeightForRiverGen,
    sampleHumidity,
    getEffectiveContinentalness
} from './terrain/worldgen.js';
import { warpedNoise2D, hash } from '../utils/math/noise.js';
import { DEFAULT_TEMPLATE, VERDANIA_TEMPLATE } from './terrain/templates.js';
import { LinearFeature } from './features/linearfeature.js';
import { SpineFeature } from './features/spinefeature.js';

// Grid sizes for spatial indexing (match existing patterns)
const ZONE_GRID_SIZE = 800;  // ~5×5 = 25 max grid cells, filtered to 10-15 land zones
const LANDMARK_GRID_SIZE = 128;
const ZONE_INDEX_CELL_SIZE = 256;  // Finer grid for zone influence queries

// World boundaries for zone discovery (fixed 4000-block world)
const WORLD_BOUNDS = {
    min: -2000,
    max: 2000,
    size: 4000
};

// River generation configuration
const RIVER_CONFIG = {
    sourceGridSize: 300,        // One potential source per 300×300 area
    minSourceElevation: 0.25,   // Minimum normalized height for river source
    minHumidity: 0.15,          // Minimum humidity to spawn a river
    stepSize: 12,               // Sample every 12 blocks when tracing (smaller for smoother paths)
    maxPathLength: 800,         // Maximum river path points
    minPathLength: 15,          // Minimum points for valid river
    seaLevel: 0.12,             // Normalized sea level (slightly higher to ensure rivers reach)
    gradientEpsilon: 16,        // Sample distance for gradient calculation (larger for smoother flow)
    meanderStrength: 0.25,      // How much rivers curve in flat areas
    minGradient: 0.0005,        // Minimum gradient before stopping (very small to keep flowing)
    minDescentPerStep: 0.001,   // Minimum elevation drop per step in flat terrain
    // River width categories (blocks)
    widths: {
        stream: { min: 3, max: 5 },
        creek: { min: 6, max: 10 },
        river: { min: 12, max: 20 },
        greatRiver: { min: 25, max: 50 }
    }
};

// Zone type definitions with associated mood/feel metadata
const ZONE_TYPES = {
    haven: { mood: 'safe', openness: 0.8, danger: 0.1 },
    crossroads: { mood: 'busy', openness: 0.7, danger: 0.3 },
    borderlands: { mood: 'tense', openness: 0.5, danger: 0.6 },
    wilderness: { mood: 'wild', openness: 0.6, danger: 0.5 },
    mountains: { mood: 'harsh', openness: 0.3, danger: 0.7 },
    coast: { mood: 'calm', openness: 0.9, danger: 0.2 },
    forest: { mood: 'mysterious', openness: 0.3, danger: 0.4 },
    desert: { mood: 'desolate', openness: 1.0, danger: 0.5 },
    ocean: { mood: 'vast', openness: 1.0, danger: 0.3 }
};

// Continental spine generation configuration
const SPINE_CONFIG = {
    // Continent detection
    detectionGridSize: 100,      // Sample continentalness every 100 blocks
    landThreshold: 0.25,         // Matches OCEAN_THRESHOLDS.land
    minContinentCells: 20,       // Minimum cells to count as a continent (not an island)

    // Coast avoidance
    minCoastDistance: 200,       // Minimum blocks from coast for spine points
    maxCoastDistance: 400,       // Maximum (ideal) distance from coast
    coastCheckRadius: 250,       // Radius to search for ocean when checking coast distance

    // Spine tracing
    spinePointSpacing: 50,       // Distance between spine path points
    noiseWarpStrength: 30,       // Organic variation amplitude
    noiseWarpFrequency: 0.003,   // Low frequency for smooth curves

    // Elevation profile
    centerElevation: 0.9,        // Peak elevation at spine center
    endElevation: 0.4,           // Tapered elevation at spine ends
    centerProminence: 1.0,       // Peak prominence at center
    endProminence: 0.5,          // Tapered prominence at ends

    // Secondary spines
    secondaryBranchChance: 0.4,      // Probability of secondary spine per candidate point
    secondaryBranchMinAngle: 30,     // Minimum branch angle (degrees)
    secondaryBranchMaxAngle: 60,     // Maximum branch angle (degrees)
    secondaryLengthRatio: 0.4,       // Secondary spine length as ratio of primary
    secondaryElevationScale: 0.7,    // Elevation reduction for secondary spines
};

/**
 * WorldGenerator class - orchestrates global world feature generation
 */
export class WorldGenerator {
    /**
     * @param {number} seed - World seed for deterministic generation
     * @param {Object|null} template - Continent template (defaults to DEFAULT_TEMPLATE)
     */
    constructor(seed, template = null) {
        this.seed = seed;
        this.template = template || DEFAULT_TEMPLATE;
        this._cache = null;
        this._zoneIndex = null;  // Built lazily for zone influence queries
    }

    /**
     * Run full generation pipeline and cache results
     * @returns {Object} Generated world data
     */
    generate() {
        this._cache = {
            seed: this.seed,
            template: this._getTemplateName(),
            spines: this.generateSpines(),  // Generate spines FIRST (influences rivers)
            rivers: this.generateRivers(),
            lakes: this.discoverLakes(),
            zones: this.discoverZones(),
            roads: this.generateRoads(),
            settlements: this.placeSettlements(),
            landmarks: this.placeLandmarks(),
        };
        return this._cache;
    }

    /**
     * Get cached world data, generating if needed
     * @returns {Object} World data
     */
    getWorldData() {
        if (!this._cache) {
            return this.generate();
        }
        return this._cache;
    }

    /**
     * Generate river networks using terrain-following flow simulation
     * Rivers flow from high elevation sources to ocean/lakes
     * @returns {Array<LinearFeature>} Array of river LinearFeature objects
     */
    generateRivers() {
        const rivers = [];
        const riverSeed = deriveSeed(this.seed, 'rivers');

        // Find river sources (high elevation points with sufficient humidity)
        const sources = this._findRiverSources(riverSeed);
        console.log(`River generation: found ${sources.length} potential sources`);

        for (const source of sources) {
            // Trace river path downhill (now returns { path, elevations })
            const { path: riverPath, elevations } = this._traceRiverDownhill(source, riverSeed);

            if (riverPath.length >= RIVER_CONFIG.minPathLength) {
                // Calculate width at each point (widens downstream)
                const widths = this._calculateRiverWidths(riverPath, source);

                // Create LinearFeature for this river with per-point elevations
                const river = new LinearFeature('river', riverPath, {
                    width: widths[0],
                    widths: widths,
                    elevations: elevations,  // Per-point monotonically descending elevations
                    sourceElevation: source.elevation,
                    riverType: this._getRiverType(widths[widths.length - 1])
                });

                rivers.push(river);
            }
        }

        // Merge rivers that meet (tributaries join main rivers)
        this._mergeRivers(rivers);

        return rivers;
    }

    /**
     * Find potential river source locations
     * @private
     * @param {number} riverSeed - Derived seed for rivers
     * @returns {Array<{x: number, z: number, elevation: number, humidity: number}>}
     */
    _findRiverSources(riverSeed) {
        const sources = [];
        const gridSize = RIVER_CONFIG.sourceGridSize;

        // Grid-based sampling to ensure even distribution
        const minGrid = Math.floor(WORLD_BOUNDS.min / gridSize);
        const maxGrid = Math.floor(WORLD_BOUNDS.max / gridSize);

        for (let gx = minGrid; gx <= maxGrid; gx++) {
            for (let gz = minGrid; gz <= maxGrid; gz++) {
                // Deterministic offset within grid cell
                const offsetX = this._hash(gx, gz, riverSeed) * gridSize * 0.8 + gridSize * 0.1;
                const offsetZ = this._hash(gx + 100, gz + 100, riverSeed) * gridSize * 0.8 + gridSize * 0.1;

                const x = gx * gridSize + offsetX;
                const z = gz * gridSize + offsetZ;

                // Check elevation and humidity
                const elevation = getHeightForRiverGen(x, z, this.seed, this.template);
                const humidity = sampleHumidity(x, z, this.seed, this.template);
                const params = getTerrainParams(x, z, this.seed, this.template);

                // Source requirements:
                // - Above minimum elevation (hills/highlands)
                // - Sufficient humidity
                // - Not in water
                if (elevation >= RIVER_CONFIG.minSourceElevation &&
                    humidity >= RIVER_CONFIG.minHumidity &&
                    params.waterType === 'none') {

                    // Add source - higher elevation and humidity = better source
                    sources.push({ x, z, elevation, humidity, score: elevation + humidity });
                }
            }
        }

        // Sort by score (best sources first) and return all
        sources.sort((a, b) => b.score - a.score);
        return sources;
    }

    /**
     * Trace a river path downhill from source to ocean/lake
     * Uses a combination of gradient descent and ocean-seeking behavior.
     * Tracks elevation at each point and enforces monotonic descent.
     * @private
     * @param {Object} source - Source position {x, z, elevation}
     * @param {number} riverSeed - Derived seed for determinism
     * @returns {{path: Array<{x: number, z: number}>, elevations: number[]}} Path points and elevations
     */
    _traceRiverDownhill(source, riverSeed) {
        const path = [{ x: source.x, z: source.z }];
        const elevations = [source.elevation];  // Track elevation at each point
        let current = { x: source.x, z: source.z };
        let currentHeight = source.elevation;
        const stepSize = RIVER_CONFIG.stepSize;
        const eps = RIVER_CONFIG.gradientEpsilon;
        let stuckCounter = 0;

        // Find nearest ocean direction for bias
        const oceanDir = this._findOceanDirection(source.x, source.z);

        for (let i = 0; i < RIVER_CONFIG.maxPathLength; i++) {
            // Calculate terrain gradient using central differences
            const gradient = this._getTerrainGradient(current.x, current.z, eps);

            let dx, dz;

            // If gradient is too flat, use ocean direction with noise
            if (gradient.magnitude < RIVER_CONFIG.minGradient) {
                stuckCounter++;

                if (stuckCounter > 3) {
                    // Strongly bias toward ocean when stuck
                    const oceanBias = 0.8;
                    const noiseBias = 0.2;
                    dx = oceanDir.dx * oceanBias + (this._hash(i, 0, riverSeed) - 0.5) * noiseBias;
                    dz = oceanDir.dz * oceanBias + (this._hash(i, 1, riverSeed) - 0.5) * noiseBias;
                    const len = Math.sqrt(dx * dx + dz * dz);
                    if (len > 0) { dx /= len; dz /= len; }
                } else {
                    // Mix gradient with ocean direction
                    dx = gradient.dx * 0.4 + oceanDir.dx * 0.6;
                    dz = gradient.dz * 0.4 + oceanDir.dz * 0.6;
                    const len = Math.sqrt(dx * dx + dz * dz);
                    if (len > 0) { dx /= len; dz /= len; }
                }
            } else {
                stuckCounter = 0;
                // Blend gradient with ocean bias for consistent flow toward sea
                const oceanWeight = 0.2;
                dx = gradient.dx * (1 - oceanWeight) + oceanDir.dx * oceanWeight;
                dz = gradient.dz * (1 - oceanWeight) + oceanDir.dz * oceanWeight;
                const len = Math.sqrt(dx * dx + dz * dz);
                if (len > 0) { dx /= len; dz /= len; }
            }

            // Calculate meander offset based on flatness
            const meander = this._getMeanderOffset(
                current.x, current.z,
                gradient.magnitude,
                riverSeed + i
            );

            // Step in chosen direction with meandering
            const next = {
                x: current.x + dx * stepSize + meander.x,
                z: current.z + dz * stepSize + meander.z
            };

            // Check if we've reached water (ocean or lake)
            const nextTerrainHeight = getHeightForRiverGen(next.x, next.z, this.seed, this.template);
            if (nextTerrainHeight < RIVER_CONFIG.seaLevel) {
                path.push(next);
                // Final elevation at sea level
                elevations.push(RIVER_CONFIG.seaLevel);
                break;
            }

            // Check if out of world bounds - but add the edge point first
            if (next.x < WORLD_BOUNDS.min || next.x > WORLD_BOUNDS.max ||
                next.z < WORLD_BOUNDS.min || next.z > WORLD_BOUNDS.max) {
                path.push({
                    x: Math.max(WORLD_BOUNDS.min, Math.min(WORLD_BOUNDS.max, next.x)),
                    z: Math.max(WORLD_BOUNDS.min, Math.min(WORLD_BOUNDS.max, next.z))
                });
                // Use current height at boundary
                elevations.push(currentHeight);
                break;
            }

            // ENFORCE MONOTONIC DESCENT
            // River elevation must never increase - take minimum of current and terrain
            let monotonicHeight = Math.min(currentHeight, nextTerrainHeight);

            // In flat terrain, force minimum descent to ensure river always flows downhill
            if (stuckCounter > 0) {
                monotonicHeight = Math.min(
                    monotonicHeight,
                    currentHeight - RIVER_CONFIG.minDescentPerStep
                );
            }

            // Never go below sea level
            monotonicHeight = Math.max(RIVER_CONFIG.seaLevel, monotonicHeight);

            path.push(next);
            elevations.push(monotonicHeight);
            current = next;
            currentHeight = monotonicHeight;
        }

        return { path, elevations };
    }

    /**
     * Find direction toward nearest ocean
     * Samples in a large radius to find the closest ocean point
     * @private
     */
    _findOceanDirection(x, z) {
        // Sample points in concentric circles to find ocean
        const sampleRadii = [150, 300, 500, 800, 1200, 1600];
        const sampleCount = 16; // Points per circle

        let bestOceanDist = Infinity;
        let bestOceanDir = { dx: 0, dz: -1 }; // Default: flow north if no ocean found

        for (const radius of sampleRadii) {
            for (let i = 0; i < sampleCount; i++) {
                const angle = (i / sampleCount) * Math.PI * 2;
                const sx = x + Math.cos(angle) * radius;
                const sz = z + Math.sin(angle) * radius;

                const height = getHeightForRiverGen(sx, sz, this.seed, this.template);

                if (height < RIVER_CONFIG.seaLevel) {
                    // Found ocean! Calculate direction
                    if (radius < bestOceanDist) {
                        bestOceanDist = radius;
                        const dx = sx - x;
                        const dz = sz - z;
                        const len = Math.sqrt(dx * dx + dz * dz);
                        bestOceanDir = { dx: dx / len, dz: dz / len };
                    }
                }
            }
            // If we found ocean at this radius, don't need to search further
            if (bestOceanDist < Infinity) break;
        }

        return bestOceanDir;
    }

    /**
     * Find the lowest neighboring point in 8 directions
     * @private
     */
    _findLowestNeighbor(x, z, radius) {
        let lowestHeight = getHeightForRiverGen(x, z, this.seed, this.template);
        let bestDir = null;

        const directions = [
            { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
            { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
            { dx: 0.707, dz: 0.707 }, { dx: -0.707, dz: 0.707 },
            { dx: 0.707, dz: -0.707 }, { dx: -0.707, dz: -0.707 }
        ];

        for (const dir of directions) {
            const nx = x + dir.dx * radius;
            const nz = z + dir.dz * radius;
            const height = getHeightForRiverGen(nx, nz, this.seed, this.template);

            if (height < lowestHeight) {
                lowestHeight = height;
                bestDir = { dx: dir.dx, dz: dir.dz, height };
            }
        }

        return bestDir;
    }

    /**
     * Calculate terrain gradient at a position (points downhill)
     * @private
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @param {number} eps - Sample distance for gradient
     * @returns {{dx: number, dz: number, magnitude: number}} Normalized downhill direction
     */
    _getTerrainGradient(x, z, eps) {
        // Central difference for accuracy
        const hLeft = getHeightForRiverGen(x - eps, z, this.seed, this.template);
        const hRight = getHeightForRiverGen(x + eps, z, this.seed, this.template);
        const hBack = getHeightForRiverGen(x, z - eps, this.seed, this.template);
        const hFront = getHeightForRiverGen(x, z + eps, this.seed, this.template);

        // Gradient = direction of steepest ascent
        const gradX = (hRight - hLeft) / (2 * eps);
        const gradZ = (hFront - hBack) / (2 * eps);

        const magnitude = Math.sqrt(gradX * gradX + gradZ * gradZ);

        if (magnitude < 0.0001) {
            return { dx: 0, dz: 0, magnitude: 0 };
        }

        // Return descent direction (negative gradient, normalized)
        return {
            dx: -gradX / magnitude,
            dz: -gradZ / magnitude,
            magnitude
        };
    }

    /**
     * Calculate meandering offset for river path
     * More meandering in flatter terrain
     * @private
     * @param {number} x - Current X
     * @param {number} z - Current Z
     * @param {number} slopeMagnitude - Current slope steepness
     * @param {number} seed - Seed for determinism
     * @returns {{x: number, z: number}} Offset to apply
     */
    _getMeanderOffset(x, z, slopeMagnitude, seed) {
        // Less meandering on steep slopes
        const flatness = 1 - Math.min(1, slopeMagnitude * 10);
        const strength = RIVER_CONFIG.meanderStrength * flatness * RIVER_CONFIG.stepSize;

        // Use position-based noise for consistent meandering
        const angle = this._hash(Math.floor(x / 32), Math.floor(z / 32), seed) * Math.PI * 2;

        return {
            x: Math.cos(angle) * strength,
            z: Math.sin(angle) * strength
        };
    }

    /**
     * Calculate river widths along path (widens downstream)
     * @private
     * @param {Array<{x: number, z: number}>} path - River path points
     * @param {Object} source - Source info for humidity-based scaling
     * @returns {number[]} Width at each path point
     */
    _calculateRiverWidths(path, source) {
        const widths = [];
        const pathLength = path.length;

        // Base width scaling from humidity (more humidity = wider rivers)
        const humidityScale = 0.6 + source.humidity * 0.6;

        // Longer rivers get wider
        const lengthScale = Math.min(2.0, 1.0 + pathLength / 100);

        for (let i = 0; i < pathLength; i++) {
            // Progress along river (0 at source, 1 at mouth)
            const t = i / Math.max(1, pathLength - 1);

            // Width increases downstream (quadratic for smoother growth)
            const progressScale = t * t;

            // Calculate width: starts as stream, grows to river
            const minWidth = RIVER_CONFIG.widths.stream.min;
            const maxWidth = RIVER_CONFIG.widths.river.max * humidityScale * lengthScale;

            const width = minWidth + (maxWidth - minWidth) * progressScale;
            widths.push(Math.round(width * 10) / 10); // Round to 0.1
        }

        return widths;
    }

    /**
     * Get river type based on width
     * @private
     * @param {number} width - River width in blocks
     * @returns {string} River type: 'stream', 'creek', 'river', or 'greatRiver'
     */
    _getRiverType(width) {
        const w = RIVER_CONFIG.widths;
        if (width <= w.stream.max) return 'stream';
        if (width <= w.creek.max) return 'creek';
        if (width <= w.river.max) return 'river';
        return 'greatRiver';
    }

    /**
     * Merge rivers that meet (create tributary system)
     * Handles width widening and elevation smoothing at confluences.
     * @private
     * @param {Array<LinearFeature>} rivers - Array of river features (modified in place)
     */
    _mergeRivers(rivers) {
        // Track which rivers have been merged into others
        const merged = new Set();

        for (let i = 0; i < rivers.length; i++) {
            if (merged.has(i)) continue;

            const mainRiver = rivers[i];
            const mainPath = mainRiver.path;

            for (let j = i + 1; j < rivers.length; j++) {
                if (merged.has(j)) continue;

                const tributary = rivers[j];
                const tribPath = tributary.path;

                // Check if tributary end point is near main river
                const tribEnd = tribPath[tribPath.length - 1];
                const nearest = mainRiver.getNearestPoint(tribEnd.x, tribEnd.z);

                // If tributary ends within 32 blocks of main river, mark as merged
                if (nearest.distance < 32) {
                    // Widen main river downstream of junction
                    const junctionIndex = nearest.index;
                    for (let k = junctionIndex; k < mainPath.length; k++) {
                        const currentWidth = mainRiver.getWidthAt(k);
                        const tribWidth = tributary.getWidthAt(Math.min(k - junctionIndex, tribPath.length - 1));
                        // Add tributary flow (simplified: add 50% of tributary width)
                        mainRiver.properties.widths[k] = currentWidth + tribWidth * 0.5;
                    }

                    // Smooth tributary elevation at junction
                    // Snap tributary end elevation to main river elevation at junction point
                    if (tributary.elevations && mainRiver.elevations) {
                        const mainElevation = mainRiver.getElevationAtT(nearest.index, nearest.t);
                        if (mainElevation !== null) {
                            const tribEndIndex = tributary.elevations.length - 1;
                            // Smooth last few points of tributary to join main river elevation
                            const smoothLength = Math.min(5, tribEndIndex);
                            for (let k = 0; k <= smoothLength; k++) {
                                const idx = tribEndIndex - smoothLength + k;
                                if (idx >= 0) {
                                    const t = k / smoothLength;  // 0 at start of smooth, 1 at junction
                                    const originalElev = tributary.elevations[idx];
                                    // Interpolate toward main river elevation
                                    tributary.elevations[idx] = originalElev + (mainElevation - originalElev) * t * t;
                                }
                            }
                        }
                    }

                    // Mark tributary as merged but keep it (it's still a visible river)
                    tributary.properties.mergedInto = mainRiver.id;
                    tributary.properties.junctionPoint = { x: nearest.point.x, z: nearest.point.z };
                }
            }
        }
    }

    /**
     * Generate mountain spines based on continent shape
     * Spines define major ridgelines that guide river drainage.
     *
     * NEW: If template has spine.points defined (spine-first generation),
     * convert those directly to SpineFeature objects instead of detecting blobs.
     *
     * LEGACY Algorithm (when no template spines):
     * 1. Detect continent blobs via coarse-grid continentalness sampling
     * 2. Calculate principal axis (longest extent) for each continent
     * 3. Trace primary spine along axis, staying 200-400 blocks from coast
     * 4. Branch secondary spines at 30-60 degree angles
     * 5. Assign elevation profiles (highest at center, tapering at ends)
     *
     * @returns {Array<SpineFeature>} Generated spine features
     */
    generateSpines() {
        const spineSeed = deriveSeed(this.seed, 'spines');
        const spines = [];

        // NEW: Check if template has spine-first definition
        if (this.template?.spine?.points?.length >= 2) {
            console.log('Spine generation: using template spine-first mode');
            return this._generateSpinesFromTemplate();
        }

        // LEGACY: Detect continent blobs and generate spines procedurally
        // Phase 1: Detect continent blobs
        const blobs = this._detectContinentBlobs();
        console.log(`Spine generation: found ${blobs.size} continent blobs`);

        // Sort blobs by size (largest first) for consistent processing
        const sortedBlobs = [...blobs.entries()].sort((a, b) => b[1].length - a[1].length);

        // Phase 2-5: Generate spines for each continent
        for (const [blobId, cells] of sortedBlobs) {
            // Skip small islands
            if (cells.length < SPINE_CONFIG.minContinentCells) {
                continue;
            }

            // Calculate principal axis
            const axis = this._calculatePrincipalAxis(cells);
            if (!axis || axis.extent.length < 200) {
                continue; // Skip if continent is too small for a spine
            }

            // Trace primary spine path
            const primaryPath = this._traceSpinePath(axis, spineSeed + blobId);
            if (primaryPath.length < 5) {
                continue; // Skip if path is too short
            }

            // Create primary spine
            const primary = new SpineFeature(primaryPath, {
                name: `Continental Spine ${blobId}`,
                type: 'primary',
                direction: this._getSpineDirection(axis.axis)
            });
            spines.push(primary);

            // Generate secondary branches
            const secondaries = this._generateSecondarySpines(primary, spineSeed + blobId * 1000);
            spines.push(...secondaries);
        }

        console.log(`Spine generation: generated ${spines.length} spines`);
        return spines;
    }

    /**
     * Generate SpineFeature objects from template spine definitions
     * Converts normalized [0,1] coordinates to world coordinates
     *
     * @private
     * @returns {Array<SpineFeature>} Spine features from template
     */
    _generateSpinesFromTemplate() {
        const spines = [];
        const template = this.template;

        // Get world bounds for coordinate conversion
        const bounds = template.worldBounds || { min: -2000, max: 2000 };
        const worldSize = bounds.max - bounds.min;

        /**
         * Convert normalized point to world coordinates with elevation profile
         * @param {Array<{x: number, z: number}>} normalizedPoints
         * @param {number} baseElevation
         * @returns {Array<{x: number, z: number, elevation: number, prominence: number}>}
         */
        const convertToWorldPath = (normalizedPoints, baseElevation) => {
            const worldPath = [];
            const numPoints = normalizedPoints.length;

            for (let i = 0; i < numPoints; i++) {
                const np = normalizedPoints[i];

                // Convert normalized [0,1] to world coordinates
                const worldX = bounds.min + np.x * worldSize;
                const worldZ = bounds.min + np.z * worldSize;

                // Calculate elevation profile: peaks at center, tapers at ends
                const t = numPoints > 1 ? i / (numPoints - 1) : 0.5;
                const centerDistance = Math.abs(t - 0.5);
                const falloff = Math.cos(centerDistance * 2 * Math.PI) * 0.5 + 0.5;

                const elevation = SPINE_CONFIG.endElevation +
                    (baseElevation - SPINE_CONFIG.endElevation) * falloff;
                const prominence = SPINE_CONFIG.endProminence +
                    (SPINE_CONFIG.centerProminence - SPINE_CONFIG.endProminence) * falloff;

                worldPath.push({
                    x: worldX,
                    z: worldZ,
                    elevation,
                    prominence
                });
            }

            return worldPath;
        };

        // Create primary spine
        if (template.spine?.points?.length >= 2) {
            const primaryPath = convertToWorldPath(
                template.spine.points,
                template.spine.elevation || SPINE_CONFIG.centerElevation
            );

            const primary = new SpineFeature(primaryPath, {
                name: 'Primary Continental Spine',
                type: 'primary',
                direction: this._estimateSpineDirection(template.spine.points)
            });
            spines.push(primary);
        }

        // Create secondary spines
        for (let i = 0; i < (template.secondarySpines || []).length; i++) {
            const secondary = template.secondarySpines[i];
            if (!secondary.points || secondary.points.length < 2) continue;

            const secondaryPath = convertToWorldPath(
                secondary.points,
                secondary.elevation || SPINE_CONFIG.centerElevation * SPINE_CONFIG.secondaryElevationScale
            );

            const secondarySpine = new SpineFeature(secondaryPath, {
                name: `Secondary Spine ${i}`,
                type: 'secondary',
                direction: this._estimateSpineDirection(secondary.points)
            });
            spines.push(secondarySpine);
        }

        console.log(`Spine generation: created ${spines.length} spines from template`);
        return spines;
    }

    /**
     * Estimate spine direction from normalized points
     * @private
     * @param {Array<{x: number, z: number}>} points - Normalized points
     * @returns {string} Direction label (E, NE, N, NW, W, SW, S, SE)
     */
    _estimateSpineDirection(points) {
        if (points.length < 2) return 'E';

        const first = points[0];
        const last = points[points.length - 1];
        const dx = last.x - first.x;
        const dz = last.z - first.z;

        return this._getSpineDirection({ dx, dz });
    }

    // ========== Spine Generation Helpers ==========

    /**
     * Detect continent blobs using coarse grid sampling and connected components
     * @private
     * @returns {Map<number, Array<{gx: number, gz: number, x: number, z: number}>>} Map of blobId to cells
     */
    _detectContinentBlobs() {
        const gridSize = SPINE_CONFIG.detectionGridSize;
        const minGrid = Math.floor(WORLD_BOUNDS.min / gridSize);
        const maxGrid = Math.floor(WORLD_BOUNDS.max / gridSize);

        // Phase 1: Sample continentalness on coarse grid
        const cells = new Map();
        for (let gx = minGrid; gx <= maxGrid; gx++) {
            for (let gz = minGrid; gz <= maxGrid; gz++) {
                const x = gx * gridSize + gridSize / 2;
                const z = gz * gridSize + gridSize / 2;
                const continental = getEffectiveContinentalness(x, z, this.seed, this.template);
                const isLand = continental >= SPINE_CONFIG.landThreshold;

                cells.set(`${gx},${gz}`, {
                    gx, gz, x, z, isLand, blobId: -1
                });
            }
        }

        // Phase 2: Connected components via flood fill (4-connectivity)
        const blobs = new Map();
        let nextBlobId = 0;

        for (const [key, cell] of cells) {
            if (!cell.isLand || cell.blobId >= 0) continue;

            // Start new blob with flood fill
            const blobCells = [];
            const stack = [key];

            while (stack.length > 0) {
                const currentKey = stack.pop();
                const current = cells.get(currentKey);
                if (!current || !current.isLand || current.blobId >= 0) continue;

                current.blobId = nextBlobId;
                blobCells.push({ gx: current.gx, gz: current.gz, x: current.x, z: current.z });

                // Add 4-connected neighbors
                const neighbors = [
                    `${current.gx - 1},${current.gz}`,
                    `${current.gx + 1},${current.gz}`,
                    `${current.gx},${current.gz - 1}`,
                    `${current.gx},${current.gz + 1}`
                ];
                for (const nKey of neighbors) {
                    const neighbor = cells.get(nKey);
                    if (neighbor && neighbor.isLand && neighbor.blobId < 0) {
                        stack.push(nKey);
                    }
                }
            }

            if (blobCells.length > 0) {
                blobs.set(nextBlobId, blobCells);
                nextBlobId++;
            }
        }

        return blobs;
    }

    /**
     * Calculate principal axis of a continent blob using covariance analysis
     * @private
     * @param {Array<{x: number, z: number}>} cells - Blob cells
     * @returns {{ centroid: {x: number, z: number}, axis: {dx: number, dz: number}, extent: {min: number, max: number, length: number} }}
     */
    _calculatePrincipalAxis(cells) {
        if (cells.length === 0) return null;

        // Calculate centroid
        let sumX = 0, sumZ = 0;
        for (const cell of cells) {
            sumX += cell.x;
            sumZ += cell.z;
        }
        const centroid = {
            x: sumX / cells.length,
            z: sumZ / cells.length
        };

        // Build covariance matrix
        let covXX = 0, covXZ = 0, covZZ = 0;
        for (const cell of cells) {
            const dx = cell.x - centroid.x;
            const dz = cell.z - centroid.z;
            covXX += dx * dx;
            covXZ += dx * dz;
            covZZ += dz * dz;
        }
        covXX /= cells.length;
        covXZ /= cells.length;
        covZZ /= cells.length;

        // Find principal eigenvector (closed-form for 2x2)
        let axisX, axisZ;
        if (Math.abs(covXZ) > 0.001) {
            const trace = covXX + covZZ;
            const det = covXX * covZZ - covXZ * covXZ;
            const eigenvalue1 = trace / 2 + Math.sqrt(Math.max(0, (trace / 2) * (trace / 2) - det));
            axisX = eigenvalue1 - covZZ;
            axisZ = covXZ;
        } else {
            // Already axis-aligned
            axisX = covXX >= covZZ ? 1 : 0;
            axisZ = covXX >= covZZ ? 0 : 1;
        }

        // Normalize axis
        const axisLen = Math.sqrt(axisX * axisX + axisZ * axisZ);
        if (axisLen > 0) {
            axisX /= axisLen;
            axisZ /= axisLen;
        }

        // Calculate extent along axis
        let minProj = Infinity, maxProj = -Infinity;
        for (const cell of cells) {
            const dx = cell.x - centroid.x;
            const dz = cell.z - centroid.z;
            const proj = dx * axisX + dz * axisZ;
            minProj = Math.min(minProj, proj);
            maxProj = Math.max(maxProj, proj);
        }

        return {
            centroid,
            axis: { dx: axisX, dz: axisZ },
            extent: {
                min: minProj,
                max: maxProj,
                length: maxProj - minProj
            }
        };
    }

    /**
     * Estimate distance to nearest coast from a position
     * @private
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {number} Distance to coast in blocks, or Infinity if no coast found
     */
    _estimateCoastDistance(x, z) {
        const sampleRadii = [50, 100, 150, 200, 250, 300, 400];
        const sampleCount = 12;

        for (const radius of sampleRadii) {
            for (let i = 0; i < sampleCount; i++) {
                const angle = (i / sampleCount) * Math.PI * 2;
                const sx = x + Math.cos(angle) * radius;
                const sz = z + Math.sin(angle) * radius;

                const continental = getEffectiveContinentalness(sx, sz, this.seed, this.template);
                if (continental < SPINE_CONFIG.landThreshold) {
                    // Found ocean - estimate distance
                    return radius * 0.8; // Approximate
                }
            }
        }

        return Infinity; // No coast found within search radius
    }

    /**
     * Adjust a point to maintain proper coast distance
     * @private
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @param {number} targetX - Direction to push toward (for inland adjustment)
     * @param {number} targetZ - Direction to push toward
     * @returns {{x: number, z: number} | null} Adjusted point or null if invalid
     */
    _adjustForCoastDistance(x, z, targetX, targetZ) {
        // Check if point is on land
        const continental = getEffectiveContinentalness(x, z, this.seed, this.template);
        if (continental < SPINE_CONFIG.landThreshold) {
            return null; // In water
        }

        const coastDist = this._estimateCoastDistance(x, z);

        // If too close to coast, push inland
        if (coastDist < SPINE_CONFIG.minCoastDistance) {
            const pushDist = SPINE_CONFIG.minCoastDistance - coastDist + 50;
            const dx = targetX - x;
            const dz = targetZ - z;
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0) {
                const newX = x + (dx / len) * pushDist;
                const newZ = z + (dz / len) * pushDist;

                // Verify new point is still on land
                const newCont = getEffectiveContinentalness(newX, newZ, this.seed, this.template);
                if (newCont >= SPINE_CONFIG.landThreshold) {
                    return { x: newX, z: newZ };
                }
            }
            return null; // Couldn't find valid inland point
        }

        return { x, z };
    }

    /**
     * Trace a spine path along the principal axis with organic noise
     * @private
     * @param {{ centroid: {x: number, z: number}, axis: {dx: number, dz: number}, extent: {min: number, max: number, length: number} }} axis
     * @param {number} spineSeed - Seed for deterministic noise
     * @returns {Array<{x: number, z: number, elevation: number, prominence: number}>}
     */
    _traceSpinePath(axis, spineSeed) {
        const path = [];
        const { centroid, axis: dir, extent } = axis;

        // Calculate endpoints at 90% of extent (avoid edges)
        const startProj = extent.min * 0.9;
        const endProj = extent.max * 0.9;
        const projLength = endProj - startProj;

        const numPoints = Math.max(5, Math.ceil(projLength / SPINE_CONFIG.spinePointSpacing));

        for (let i = 0; i < numPoints; i++) {
            const t = i / (numPoints - 1);
            const proj = startProj + t * projLength;

            // Base position on axis
            let baseX = centroid.x + dir.dx * proj;
            let baseZ = centroid.z + dir.dz * proj;

            // Add organic noise warp
            const boundHash = (x, z) => hash(x, z, spineSeed);
            const warpX = (warpedNoise2D(baseX, baseZ, 2, SPINE_CONFIG.noiseWarpFrequency, SPINE_CONFIG.noiseWarpStrength * 0.5, boundHash) - 0.5) * 2 * SPINE_CONFIG.noiseWarpStrength;
            const warpZ = (warpedNoise2D(baseX + 500, baseZ + 500, 2, SPINE_CONFIG.noiseWarpFrequency, SPINE_CONFIG.noiseWarpStrength * 0.5, boundHash) - 0.5) * 2 * SPINE_CONFIG.noiseWarpStrength;

            let candidateX = baseX + warpX;
            let candidateZ = baseZ + warpZ;

            // Clamp to world bounds
            candidateX = Math.max(WORLD_BOUNDS.min + 100, Math.min(WORLD_BOUNDS.max - 100, candidateX));
            candidateZ = Math.max(WORLD_BOUNDS.min + 100, Math.min(WORLD_BOUNDS.max - 100, candidateZ));

            // Adjust for coast distance
            const adjusted = this._adjustForCoastDistance(candidateX, candidateZ, centroid.x, centroid.z);
            if (!adjusted) continue;

            // Calculate elevation profile (peaks at center, tapers at ends)
            const centerDistance = Math.abs(t - 0.5);
            const falloff = Math.cos(centerDistance * 2 * Math.PI) * 0.5 + 0.5;

            const elevation = SPINE_CONFIG.endElevation +
                (SPINE_CONFIG.centerElevation - SPINE_CONFIG.endElevation) * falloff;
            const prominence = SPINE_CONFIG.endProminence +
                (SPINE_CONFIG.centerProminence - SPINE_CONFIG.endProminence) * falloff;

            path.push({
                x: adjusted.x,
                z: adjusted.z,
                elevation,
                prominence
            });
        }

        return path;
    }

    /**
     * Generate secondary spines branching from a primary spine
     * @private
     * @param {SpineFeature} primary - Primary spine to branch from
     * @param {number} branchSeed - Seed for deterministic branching
     * @returns {Array<SpineFeature>} Secondary spine features
     */
    _generateSecondarySpines(primary, branchSeed) {
        const secondaries = [];
        const path = primary.path;
        if (path.length < 5) return secondaries;

        // Skip first and last 20% of spine
        const startIdx = Math.floor(path.length * 0.2);
        const endIdx = Math.floor(path.length * 0.8);

        for (let i = startIdx; i < endIdx; i++) {
            // Check branch chance
            const branchRoll = this._hash(i, 0, branchSeed);
            if (branchRoll > SPINE_CONFIG.secondaryBranchChance) continue;

            // Calculate local tangent
            const prev = path[Math.max(0, i - 1)];
            const next = path[Math.min(path.length - 1, i + 1)];
            let tangentX = next.x - prev.x;
            let tangentZ = next.z - prev.z;
            const tangentLen = Math.sqrt(tangentX * tangentX + tangentZ * tangentZ);
            if (tangentLen < 1) continue;
            tangentX /= tangentLen;
            tangentZ /= tangentLen;

            // Calculate perpendicular
            const perpX = -tangentZ;
            const perpZ = tangentX;

            // Choose branch angle (30-60 degrees)
            const angleRange = SPINE_CONFIG.secondaryBranchMaxAngle - SPINE_CONFIG.secondaryBranchMinAngle;
            const angleDeg = SPINE_CONFIG.secondaryBranchMinAngle + this._hash(i, 1, branchSeed) * angleRange;
            const angleRad = angleDeg * Math.PI / 180;

            // Rotate tangent by angle
            let branchDirX = tangentX * Math.cos(angleRad) + perpX * Math.sin(angleRad);
            let branchDirZ = tangentZ * Math.cos(angleRad) + perpZ * Math.sin(angleRad);

            // Randomly flip to other side
            if (this._hash(i, 2, branchSeed) > 0.5) {
                branchDirX = -branchDirX;
                branchDirZ = -branchDirZ;
            }

            // Calculate secondary spine length
            const primaryLength = this._getPathLength(path);
            const secondaryLength = primaryLength * SPINE_CONFIG.secondaryLengthRatio;
            const numPoints = Math.max(3, Math.ceil(secondaryLength / SPINE_CONFIG.spinePointSpacing));

            // Trace secondary spine
            const secondaryPath = [];
            const branchPoint = path[i];

            for (let j = 0; j < numPoints; j++) {
                const t = j / (numPoints - 1);
                const dist = t * secondaryLength;

                let sx = branchPoint.x + branchDirX * dist;
                let sz = branchPoint.z + branchDirZ * dist;

                // Clamp to world bounds
                sx = Math.max(WORLD_BOUNDS.min + 100, Math.min(WORLD_BOUNDS.max - 100, sx));
                sz = Math.max(WORLD_BOUNDS.min + 100, Math.min(WORLD_BOUNDS.max - 100, sz));

                // Check if on land
                const continental = getEffectiveContinentalness(sx, sz, this.seed, this.template);
                if (continental < SPINE_CONFIG.landThreshold) break;

                // Elevation: peaks at junction, tapers toward end
                const falloff = 1 - t;
                const baseElevation = branchPoint.elevation * SPINE_CONFIG.secondaryElevationScale;
                const elevation = SPINE_CONFIG.endElevation +
                    (baseElevation - SPINE_CONFIG.endElevation) * falloff;
                const prominence = SPINE_CONFIG.endProminence +
                    (branchPoint.prominence * SPINE_CONFIG.secondaryElevationScale - SPINE_CONFIG.endProminence) * falloff;

                secondaryPath.push({ x: sx, z: sz, elevation, prominence });
            }

            if (secondaryPath.length >= 3) {
                secondaries.push(new SpineFeature(secondaryPath, {
                    name: `Secondary Spine ${i}`,
                    type: 'secondary',
                    parentId: primary.id
                }));
            }
        }

        return secondaries;
    }

    /**
     * Get total path length
     * @private
     */
    _getPathLength(path) {
        let length = 0;
        for (let i = 1; i < path.length; i++) {
            const dx = path[i].x - path[i - 1].x;
            const dz = path[i].z - path[i - 1].z;
            length += Math.sqrt(dx * dx + dz * dz);
        }
        return length;
    }

    /**
     * Get spine direction label from axis vector
     * @private
     */
    _getSpineDirection(axis) {
        const angle = Math.atan2(axis.dz, axis.dx) * 180 / Math.PI;
        if (angle >= -22.5 && angle < 22.5) return 'E';
        if (angle >= 22.5 && angle < 67.5) return 'NE';
        if (angle >= 67.5 && angle < 112.5) return 'N';
        if (angle >= 112.5 && angle < 157.5) return 'NW';
        if (angle >= 157.5 || angle < -157.5) return 'W';
        if (angle >= -157.5 && angle < -112.5) return 'SW';
        if (angle >= -112.5 && angle < -67.5) return 'S';
        return 'SE';
    }

    /**
     * Discover natural lakes based on terrain
     * TODO(design): Implement lake discovery
     * Lakes form in terrain depressions (local minima)
     * @returns {Array} Array of lake objects
     */
    discoverLakes() {
        // Stub - will use deriveSeed(this.seed, 'lakes') for determinism
        return [];
    }

    /**
     * Discover and classify world zones
     * Analyzes terrain to find natural regions and assign level-appropriate zones.
     * @returns {Map} Map of zone data by grid key "gridX,gridZ"
     */
    discoverZones() {
        const zones = new Map();

        // Phase 1: Find key landmarks
        const haven = this._findHavenLocation();
        const lakes = this._findLakes();
        const passes = this._findMountainPasses();

        // Phase 2: Place anchor zones
        if (haven) {
            const havenZone = this._createZone('Haven', 'haven', haven, [1, 3]);
            zones.set(havenZone.gridKey, havenZone);
        }

        for (const lake of lakes) {
            const lakeZone = this._createZone('Lake Settlement', 'crossroads',
                lake.bestShore, [8, 10]);
            if (!zones.has(lakeZone.gridKey)) {
                zones.set(lakeZone.gridKey, lakeZone);
            }
        }

        for (const pass of passes) {
            const passZone = this._createZone('Borderlands', 'borderlands',
                pass, [18, 20]);
            if (!zones.has(passZone.gridKey)) {
                zones.set(passZone.gridKey, passZone);
            }
        }

        // Phase 3: Fill remaining grid cells
        this._fillProceduralZones(zones, haven);

        // Phase 4: Compute adjacencies
        this._computeAdjacencies(zones);

        return zones;
    }

    /**
     * Generate road network connecting settlements
     * TODO(design): Implement road generation
     * Roads connect settlements via pathfinding
     * @returns {Array} Array of road objects
     */
    generateRoads() {
        // Stub - will use deriveSeed(this.seed, 'roads') for determinism
        return [];
    }

    /**
     * Place settlements in suitable locations
     * TODO(design): Implement settlement placement
     * Settlements prefer flat terrain near water
     * @returns {Array} Array of settlement objects
     */
    placeSettlements() {
        // Stub - will use deriveSeed(this.seed, 'settlements') for determinism
        return [];
    }

    /**
     * Place major landmarks
     * TODO(design): Implement landmark placement
     * Coordinates with WorkerLandmarkSystem for per-chunk generation
     * @returns {Map} Map of landmark data by grid key "gridX,gridZ"
     */
    placeLandmarks() {
        // Stub - will use deriveSeed(this.seed, 'landmarks') for determinism
        return new Map();
    }

    /**
     * Serialize world data for save/load
     * Converts Maps to arrays for JSON compatibility
     * @returns {string} JSON string of world data
     */
    serialize() {
        const data = this.getWorldData();

        const serializable = {
            seed: data.seed,
            template: data.template,
            spines: data.spines.map(s => s.toJSON()),
            rivers: data.rivers,
            lakes: data.lakes,
            zones: Array.from(data.zones.entries()),
            roads: data.roads,
            settlements: data.settlements,
            landmarks: Array.from(data.landmarks.entries())
        };

        return JSON.stringify(serializable);
    }

    /**
     * Deserialize world data from JSON
     * @param {string} json - JSON string from serialize()
     * @returns {WorldGenerator} New WorldGenerator instance with restored data
     */
    static deserialize(json) {
        const data = JSON.parse(json);

        const generator = new WorldGenerator(data.seed);
        generator._cache = {
            seed: data.seed,
            template: data.template,
            spines: (data.spines || []).map(s => SpineFeature.fromJSON(s)),
            rivers: data.rivers || [],
            lakes: data.lakes || [],
            zones: new Map(data.zones || []),
            roads: data.roads || [],
            settlements: data.settlements || [],
            landmarks: new Map(data.landmarks || [])
        };

        return generator;
    }

    /**
     * Get template name from template object
     * @private
     * @returns {string} Template name
     */
    _getTemplateName() {
        if (!this.template) return 'procedural';
        if (this.template === DEFAULT_TEMPLATE) return 'default';
        if (this.template === VERDANIA_TEMPLATE) return 'verdania';
        return this.template.name || 'custom';
    }

    /**
     * Hash function for deterministic placement (matches WorkerLandmarkSystem)
     * @private
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @param {number} salt - Additional salt value
     * @returns {number} Hash value in [0, 1]
     */
    _hash(x, z, salt = 0) {
        let h = this.seed + salt + x * 374761393 + z * 668265263;
        h = (h ^ (h >> 13)) * 1274126177;
        return ((h ^ (h >> 16)) & 0xffffffff) / 0xffffffff;
    }

    // ========== Zone Discovery Helpers ==========

    /**
     * Find the best haven (starting zone) location
     * Searches for sheltered coastal spots with low elevation
     * @private
     * @returns {Object} Location with x, z, score properties
     */
    _findHavenLocation() {
        const candidates = [];
        const sampleStep = 128;

        for (let x = WORLD_BOUNDS.min; x <= WORLD_BOUNDS.max; x += sampleStep) {
            for (let z = WORLD_BOUNDS.min; z <= WORLD_BOUNDS.max; z += sampleStep) {
                const params = getTerrainParams(x, z, this.seed, this.template);

                // Must be on land near coast
                if (params.waterType !== 'none') continue;
                const coastProximity = getCoastProximity(x, z, this.seed, this.template);
                if (coastProximity < 0.2) continue;

                // Score by shelteredness (prefer bays, low elevation, low ridgeness)
                const score = coastProximity * 0.4 +
                              (1 - params.ridgeness) * 0.3 +
                              (1 - params.heightNormalized) * 0.3;

                candidates.push({ x, z, score });
            }
        }

        // Return best candidate
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0] || { x: 0, z: 0, score: 0 };
    }

    /**
     * Find inland lakes (shallow water surrounded by land)
     * @private
     * @returns {Array} Array of lake objects with center and bestShore
     */
    _findLakes() {
        const lakes = [];
        const visited = new Set();
        const sampleStep = 64;

        for (let x = WORLD_BOUNDS.min; x <= WORLD_BOUNDS.max; x += sampleStep) {
            for (let z = WORLD_BOUNDS.min; z <= WORLD_BOUNDS.max; z += sampleStep) {
                const key = `${Math.floor(x / 256)},${Math.floor(z / 256)}`;
                if (visited.has(key)) continue;

                const params = getTerrainParams(x, z, this.seed, this.template);

                // Check for shallow water (lakes) vs deep (ocean)
                if (params.waterType === 'shallow') {
                    const isInland = this._isInlandWater(x, z);
                    if (isInland) {
                        const bestShore = this._findBestShore(x, z);
                        lakes.push({ center: { x, z }, bestShore });
                        visited.add(key);
                    }
                }
            }
        }

        return lakes;
    }

    /**
     * Find mountain passes (saddle points in high terrain)
     * @private
     * @returns {Array} Array of pass locations {x, z}
     */
    _findMountainPasses() {
        const passes = [];
        const sampleStep = 128;

        for (let x = WORLD_BOUNDS.min; x <= WORLD_BOUNDS.max; x += sampleStep) {
            for (let z = WORLD_BOUNDS.min; z <= WORLD_BOUNDS.max; z += sampleStep) {
                const params = getTerrainParams(x, z, this.seed, this.template);

                // Look for mid-elevation in mountain biomes
                if (!['mountains', 'alpine', 'highlands'].includes(params.biome)) continue;
                if (params.heightNormalized > 0.6) continue;
                if (params.heightNormalized < 0.35) continue;

                // Check if surrounded by higher terrain (saddle point)
                const isSaddle = this._isSaddlePoint(x, z, params.heightNormalized);
                if (isSaddle) {
                    passes.push({ x, z });
                }
            }
        }

        return passes;
    }

    /**
     * Create a zone object
     * @private
     * @param {string} name - Zone display name
     * @param {string} type - Zone type (haven, wilderness, etc.)
     * @param {Object} center - Center position {x, z}
     * @param {Array} levels - Level range [min, max]
     * @returns {Object} Zone object
     */
    _createZone(name, type, center, levels) {
        const gridX = Math.floor(center.x / ZONE_GRID_SIZE);
        const gridZ = Math.floor(center.z / ZONE_GRID_SIZE);
        const feel = ZONE_TYPES[type] || ZONE_TYPES.wilderness;

        return {
            id: `${type}_${gridX}_${gridZ}`,
            name,
            type,
            center: { x: center.x, z: center.z },
            gridKey: `${gridX},${gridZ}`,
            radius: ZONE_GRID_SIZE / 2,
            levels,
            feel: { ...feel },
            adjacentZones: []
        };
    }

    /**
     * Fill remaining grid cells with procedural zones
     * @private
     * @param {Map} zones - Existing zones map (modified in place)
     * @param {Object} haven - Haven location for distance calculation
     */
    _fillProceduralZones(zones, haven) {
        const havenX = haven?.x || 0;
        const havenZ = haven?.z || 0;

        const minGrid = Math.floor(WORLD_BOUNDS.min / ZONE_GRID_SIZE);
        const maxGrid = Math.floor(WORLD_BOUNDS.max / ZONE_GRID_SIZE);

        for (let gx = minGrid; gx <= maxGrid; gx++) {
            for (let gz = minGrid; gz <= maxGrid; gz++) {
                const key = `${gx},${gz}`;
                if (zones.has(key)) continue;

                const centerX = gx * ZONE_GRID_SIZE + ZONE_GRID_SIZE / 2;
                const centerZ = gz * ZONE_GRID_SIZE + ZONE_GRID_SIZE / 2;

                // Sample land coverage across the cell
                const landRatio = this._sampleLandCoverage(centerX, centerZ, ZONE_GRID_SIZE);

                // Skip cells that are mostly water (ocean or coastal water)
                if (landRatio < 0.3) continue;

                // Calculate distance from haven
                const dist = Math.sqrt(
                    Math.pow(centerX - havenX, 2) +
                    Math.pow(centerZ - havenZ, 2)
                );

                // Get terrain characteristics at center
                const params = getTerrainParams(centerX, centerZ, this.seed, this.template);

                // Determine zone type and levels
                const { type, levels, name } = this._classifyZone(params, dist, gx, gz);

                const zone = this._createZone(name, type, { x: centerX, z: centerZ }, levels);
                zones.set(key, zone);
            }
        }
    }

    /**
     * Classify a zone based on terrain and distance from haven
     * @private
     * @param {Object} params - Terrain parameters
     * @param {number} distanceFromHaven - Distance from haven in blocks
     * @param {number} gridX - Grid X coordinate for unique naming
     * @param {number} gridZ - Grid Z coordinate for unique naming
     * @returns {Object} Classification {type, levels, name}
     */
    _classifyZone(params, distanceFromHaven, gridX = 0, gridZ = 0) {
        // Skip ocean
        if (params.biome === 'ocean') {
            return { type: 'ocean', levels: [1, 1], name: 'Ocean' };
        }

        // Base levels from distance
        let baseLevelMin, baseLevelMax;
        if (distanceFromHaven < 500) {
            baseLevelMin = 1; baseLevelMax = 5;
        } else if (distanceFromHaven < 1000) {
            baseLevelMin = 5; baseLevelMax = 10;
        } else if (distanceFromHaven < 1500) {
            baseLevelMin = 10; baseLevelMax = 15;
        } else {
            baseLevelMin = 15; baseLevelMax = 20;
        }

        // Elevation modifier (higher = more dangerous)
        const elevBonus = Math.floor(params.heightNormalized * 3);
        const levels = [
            Math.min(20, baseLevelMin + elevBonus),
            Math.min(20, baseLevelMax + elevBonus)
        ];

        // Determine type from biome
        const type = this._biomeToZoneType(params.biome);
        const name = this._generateZoneName(type, params.biome, gridX, gridZ);

        return { type, levels, name };
    }

    /**
     * Map biome to zone type
     * @private
     * @param {string} biome - Biome name
     * @returns {string} Zone type
     */
    _biomeToZoneType(biome) {
        const mapping = {
            ocean: 'ocean',
            beach: 'coast',
            plains: 'wilderness',
            meadow: 'wilderness',
            savanna: 'wilderness',
            desert: 'desert',
            red_desert: 'desert',
            swamp: 'wilderness',
            jungle: 'forest',
            rainforest: 'forest',
            deciduous_forest: 'forest',
            autumn_forest: 'forest',
            taiga: 'forest',
            tundra: 'wilderness',
            snow: 'wilderness',
            mountains: 'mountains',
            alpine: 'mountains',
            highlands: 'mountains',
            glacier: 'mountains',
            badlands: 'borderlands',
            volcanic: 'borderlands'
        };
        return mapping[biome] || 'wilderness';
    }

    /**
     * Generate a zone name based on type and biome
     * @private
     * @param {string} type - Zone type
     * @param {string} biome - Biome name
     * @param {number} gridX - Grid X coordinate for unique naming
     * @param {number} gridZ - Grid Z coordinate for unique naming
     * @returns {string} Generated zone name
     */
    _generateZoneName(type, biome, gridX = 0, gridZ = 0) {
        const prefixes = {
            wilderness: ['Verdant', 'Wild', 'Untamed', 'Open', 'Rolling', 'Sunlit'],
            forest: ['Dark', 'Ancient', 'Whispering', 'Mossy', 'Thornwood', 'Shadowed'],
            mountains: ['High', 'Frozen', 'Jagged', 'Storm', 'Iron', 'Granite'],
            desert: ['Scorched', 'Endless', 'Sun-bleached', 'Amber', 'Dusty'],
            coast: ['Windswept', 'Sandy', 'Rocky', 'Coral', 'Driftwood'],
            borderlands: ['Contested', 'Rugged', 'Treacherous', 'Broken', 'Scarred'],
            ocean: ['Deep', 'Vast', 'Open']
        };
        const suffixes = {
            wilderness: ['Wilds', 'Fields', 'Plains', 'Meadows', 'Grasslands'],
            forest: ['Woods', 'Forest', 'Grove', 'Thicket', 'Timberland'],
            mountains: ['Peaks', 'Heights', 'Crags', 'Ridges', 'Summits'],
            desert: ['Wastes', 'Dunes', 'Barrens', 'Expanse'],
            coast: ['Shore', 'Coast', 'Strand', 'Cove'],
            borderlands: ['Marches', 'Frontier', 'Reaches', 'Borderlands'],
            ocean: ['Waters', 'Depths', 'Sea']
        };

        // Use grid position for unique deterministic name per zone
        const prefixList = prefixes[type] || ['Unknown'];
        const suffixList = suffixes[type] || ['Lands'];
        const prefixIndex = Math.abs(this._hash(gridX, gridZ, type.length) * prefixList.length) | 0;
        const suffixIndex = Math.abs(this._hash(gridX + 100, gridZ + 100, type.length + 7) * suffixList.length) | 0;
        const prefix = prefixList[prefixIndex % prefixList.length];
        const suffix = suffixList[suffixIndex % suffixList.length];

        return `${prefix} ${suffix}`.trim();
    }

    /**
     * Check if water at position is inland (surrounded by land)
     * @private
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @returns {boolean} True if inland water
     */
    _isInlandWater(x, z) {
        const checkDist = 256;
        let landCount = 0;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const params = getTerrainParams(
                    x + dx * checkDist,
                    z + dz * checkDist,
                    this.seed,
                    this.template
                );
                if (params.waterType === 'none') landCount++;
            }
        }

        return landCount >= 4; // At least half surrounded by land
    }

    /**
     * Find the best shore location near water
     * @private
     * @param {number} x - Water X coordinate
     * @param {number} z - Water Z coordinate
     * @returns {Object} Best shore location {x, z}
     */
    _findBestShore(x, z) {
        const checkDist = 64;

        for (let r = checkDist; r <= 512; r += checkDist) {
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                const checkX = x + Math.cos(angle) * r;
                const checkZ = z + Math.sin(angle) * r;
                const params = getTerrainParams(checkX, checkZ, this.seed, this.template);
                if (params.waterType === 'none') {
                    return { x: checkX, z: checkZ };
                }
            }
        }

        return { x, z };
    }

    /**
     * Check if position is a saddle point (surrounded by higher terrain)
     * @private
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @param {number} height - Current normalized height
     * @returns {boolean} True if saddle point
     */
    _isSaddlePoint(x, z, height) {
        const checkDist = 64;
        let higherCount = 0;

        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dz] of dirs) {
            const params = getTerrainParams(
                x + dx * checkDist,
                z + dz * checkDist,
                this.seed,
                this.template
            );
            if (params.heightNormalized > height + 0.1) higherCount++;
        }

        return higherCount >= 2;
    }

    /**
     * Sample land coverage ratio within a zone cell
     * @private
     * @param {number} centerX - Cell center X
     * @param {number} centerZ - Cell center Z
     * @param {number} size - Cell size
     * @returns {number} Land ratio in [0, 1]
     */
    _sampleLandCoverage(centerX, centerZ, size) {
        const samples = 9;  // 3×3 grid
        const step = size / 3;
        let landCount = 0;

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const x = centerX + dx * step;
                const z = centerZ + dz * step;
                const params = getTerrainParams(x, z, this.seed, this.template);
                if (params.waterType === 'none') {
                    landCount++;
                }
            }
        }

        return landCount / samples;
    }

    /**
     * Compute zone adjacencies
     * @private
     * @param {Map} zones - Zones map (modified in place)
     */
    _computeAdjacencies(zones) {
        for (const [key, zone] of zones) {
            const [gx, gz] = key.split(',').map(Number);

            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dz === 0) continue;
                    const neighborKey = `${gx + dx},${gz + dz}`;
                    if (zones.has(neighborKey)) {
                        zone.adjacentZones.push(neighborKey);
                    }
                }
            }
        }
    }

    // ========== Zone Lookup Methods ==========

    /**
     * Build spatial index for zone influence queries
     * Creates a finer-grained grid (256×256) mapping cells to overlapping zones.
     * Called lazily when getZoneInfluence() is first used.
     */
    buildZoneIndex() {
        if (!this._cache) this.generate();

        this._zoneIndex = new Map();

        for (const [key, zone] of this._cache.zones) {
            // Calculate which index cells this zone overlaps
            const minCellX = Math.floor((zone.center.x - zone.radius) / ZONE_INDEX_CELL_SIZE);
            const maxCellX = Math.floor((zone.center.x + zone.radius) / ZONE_INDEX_CELL_SIZE);
            const minCellZ = Math.floor((zone.center.z - zone.radius) / ZONE_INDEX_CELL_SIZE);
            const maxCellZ = Math.floor((zone.center.z + zone.radius) / ZONE_INDEX_CELL_SIZE);

            for (let cx = minCellX; cx <= maxCellX; cx++) {
                for (let cz = minCellZ; cz <= maxCellZ; cz++) {
                    const cellKey = `${cx},${cz}`;
                    if (!this._zoneIndex.has(cellKey)) {
                        this._zoneIndex.set(cellKey, []);
                    }
                    this._zoneIndex.get(cellKey).push(zone);
                }
            }
        }
    }

    /**
     * Get the zone at a world position (O(1) lookup)
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {Object|null} Zone object or null if in wilderness (no zone)
     */
    getZoneAt(x, z) {
        if (!this._cache) this.generate();

        const gridX = Math.floor(x / ZONE_GRID_SIZE);
        const gridZ = Math.floor(z / ZONE_GRID_SIZE);
        const gridKey = `${gridX},${gridZ}`;

        return this._cache.zones.get(gridKey) || null;
    }

    /**
     * Get zone influence at a world position for smooth boundary blending
     * Returns all zones that have influence at this position, sorted by influence.
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {Array<{zone: Object, influence: number}>} Array of zone/influence pairs
     */
    getZoneInfluence(x, z) {
        if (!this._cache) this.generate();
        if (!this._zoneIndex) this.buildZoneIndex();

        const cellX = Math.floor(x / ZONE_INDEX_CELL_SIZE);
        const cellZ = Math.floor(z / ZONE_INDEX_CELL_SIZE);

        const results = [];
        const checked = new Set();

        // Check this cell and neighbors (3×3) to catch zones at boundaries
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const cellKey = `${cellX + dx},${cellZ + dz}`;
                const zones = this._zoneIndex.get(cellKey) || [];

                for (const zone of zones) {
                    if (checked.has(zone.id)) continue;
                    checked.add(zone.id);

                    const influence = this._calculateInfluence(x, z, zone);
                    if (influence > 0) {
                        results.push({ zone, influence });
                    }
                }
            }
        }

        // Sort by influence (highest first)
        results.sort((a, b) => b.influence - a.influence);
        return results;
    }

    /**
     * Calculate zone influence at a position
     * @private
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @param {Object} zone - Zone object
     * @returns {number} Influence value in [0, 1]
     */
    _calculateInfluence(x, z, zone) {
        const dx = x - zone.center.x;
        const dz = z - zone.center.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        // Normalize distance by zone radius
        const normalizedDist = distance / zone.radius;
        if (normalizedDist >= 1.0) return 0;

        // Smooth falloff: full influence until 50% radius, then smooth drop to 0
        const influence = 1.0 - this._smoothstep(0.5, 1.0, normalizedDist);

        // TODO(design): Add river/cliff boundary modifiers when rivers are implemented
        return influence;
    }

    /**
     * Smoothstep interpolation function
     * @private
     * @param {number} edge0 - Lower edge
     * @param {number} edge1 - Upper edge
     * @param {number} x - Value to interpolate
     * @returns {number} Smoothed value in [0, 1]
     */
    _smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }
}

// Singleton instance for shared access
let _sharedInstance = null;

/**
 * Get the shared WorldGenerator instance
 * @returns {WorldGenerator|null} Shared instance or null if not initialized
 */
export function getSharedWorldGenerator() {
    return _sharedInstance;
}

/**
 * Initialize the shared WorldGenerator instance
 * @param {number} seed - World seed
 * @param {Object|null} template - Continent template
 * @returns {WorldGenerator} The initialized shared instance
 */
export function initSharedWorldGenerator(seed, template = null) {
    _sharedInstance = new WorldGenerator(seed, template);
    return _sharedInstance;
}

/**
 * Factory function to create a new WorldGenerator
 * @param {number} seed - World seed
 * @param {Object|null} template - Continent template
 * @returns {WorldGenerator} New WorldGenerator instance
 */
export function createWorldGenerator(seed, template = null) {
    return new WorldGenerator(seed, template);
}

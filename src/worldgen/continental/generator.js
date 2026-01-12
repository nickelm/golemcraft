/**
 * ContinentalGenerator - Async World Generation with Progress Reporting
 *
 * Wraps WorldGenerator to provide:
 * - Async generation with UI yield points
 * - Progress callbacks for loading screen
 * - SDF texture baking
 * - IndexedDB persistence integration
 * - Partial regeneration support
 *
 * Usage:
 *   const generator = new ContinentalGenerator(seed, template);
 *   const metadata = await generator.generateAsync((progress) => {
 *       console.log(`${progress.message} (${Math.round(progress.progress * 100)}%)`);
 *   });
 *   await generator.save(worldId);
 */

import { WorldGenerator } from '../../world/worldgenerator.js';
import { STAGES, TOTAL_WEIGHT, getStaleStages } from './stages.js';
import { STAGE_VERSIONS, CONTINENTAL_VERSION, getDependentStages } from './versions.js';
import {
    createHydroSDF,
    createTerrainSDF,
    createInfraSDF,
    createClimateTex
} from '../sdf.js';
import { serializeContinent } from '../../storage/serialization.js';

/**
 * @typedef {Object} ProgressInfo
 * @property {string} stage - Stage identifier (e.g., 'carving_rivers')
 * @property {number} stageIndex - Current stage index (0-based)
 * @property {number} stageCount - Total number of stages
 * @property {number} progress - Overall progress 0.0-1.0
 * @property {number} stageProgress - Progress within current stage 0.0-1.0
 * @property {string} message - Human-readable status message
 */

/**
 * @typedef {Object} GeneratorOptions
 * @property {number} [sdfSize=512] - SDF texture resolution
 * @property {boolean} [skipSdf=false] - Skip SDF baking (for testing)
 * @property {boolean} [verbose=false] - Enable verbose logging
 */

/**
 * Async continental generator with progress reporting
 */
export class ContinentalGenerator {
    /**
     * @param {number} seed - World generation seed
     * @param {Object|null} template - Continent template (null for default)
     * @param {GeneratorOptions} options - Generation options
     */
    constructor(seed, template = null, options = {}) {
        this.seed = seed;
        this.template = template;
        this.options = {
            sdfSize: 512,
            skipSdf: false,
            verbose: false,
            ...options
        };

        // Create wrapped WorldGenerator
        this.worldGen = new WorldGenerator(seed, template);

        // Generation state
        this.bounds = null;
        this.spines = null;
        this.rivers = null;
        this.zones = null;
        this.roads = null;
        this.settlements = null;
        this.textures = {};

        // Progress tracking
        this._startTime = 0;
        this._stageStartTime = 0;
        this._completedStages = new Set();
    }

    /**
     * Generate all continental features asynchronously with progress reporting.
     *
     * @param {function(ProgressInfo): void} onProgress - Progress callback
     * @returns {Promise<Object>} Generated continent metadata
     */
    async generateAsync(onProgress = () => {}) {
        this._startTime = performance.now();
        let weightCompleted = 0;

        for (let i = 0; i < STAGES.length; i++) {
            const stage = STAGES[i];
            this._stageStartTime = performance.now();

            // Report stage start
            onProgress(this._createProgressInfo(stage, i, weightCompleted, 0));

            // Execute stage
            try {
                await stage.execute(this);
            } catch (error) {
                console.error(`Stage ${stage.id} failed:`, error);
                throw new Error(`Continental generation failed at stage '${stage.name}': ${error.message}`);
            }

            // Mark completed
            this._completedStages.add(stage.id);
            weightCompleted += stage.weight;

            // Yield to UI
            await this._yieldToUI();

            // Report stage complete
            onProgress(this._createProgressInfo(stage, i, weightCompleted, 1));

            if (this.options.verbose) {
                const elapsed = performance.now() - this._stageStartTime;
                console.log(`Stage '${stage.name}' completed in ${elapsed.toFixed(0)}ms`);
            }
        }

        const totalTime = performance.now() - this._startTime;
        console.log(`Continental generation complete in ${(totalTime / 1000).toFixed(1)}s`);

        return this._buildMetadata();
    }

    /**
     * Regenerate only stages that have changed since stored metadata.
     *
     * @param {Object} existingMetadata - Previously stored continent metadata
     * @param {function(ProgressInfo): void} onProgress - Progress callback
     * @returns {Promise<Object>} Updated continent metadata
     */
    async regenerateStale(existingMetadata, onProgress = () => {}) {
        // Determine which stages need regeneration
        const staleIds = getStaleStages(existingMetadata?.stageVersions);

        // Also regenerate stages that depend on stale stages
        const needsRegen = new Set(staleIds);
        for (const staleId of staleIds) {
            const dependents = getDependentStages(staleId);
            for (const dep of dependents) {
                needsRegen.add(dep);
            }
        }

        if (needsRegen.size === 0) {
            console.log('All stages up to date, skipping regeneration');
            return existingMetadata;
        }

        console.log(`Regenerating stages: ${[...needsRegen].join(', ')}`);

        // Restore existing data that doesn't need regeneration
        this._restoreFromMetadata(existingMetadata, needsRegen);

        // Run only stages that need regeneration
        this._startTime = performance.now();
        let weightCompleted = 0;

        for (let i = 0; i < STAGES.length; i++) {
            const stage = STAGES[i];

            if (!needsRegen.has(stage.id)) {
                // Skip this stage, count its weight
                weightCompleted += stage.weight;
                this._completedStages.add(stage.id);
                continue;
            }

            this._stageStartTime = performance.now();
            onProgress(this._createProgressInfo(stage, i, weightCompleted, 0));

            await stage.execute(this);

            this._completedStages.add(stage.id);
            weightCompleted += stage.weight;

            await this._yieldToUI();
            onProgress(this._createProgressInfo(stage, i, weightCompleted, 1));
        }

        return this._buildMetadata();
    }

    /**
     * Save generated metadata and textures to IndexedDB.
     *
     * @param {string} worldId - World identifier
     * @param {string} continentId - Continent identifier (default 'main')
     * @returns {Promise<void>}
     */
    async save(worldId, continentId = 'main') {
        // Lazy import to avoid circular dependencies
        const { WorldStorage } = await import('../../storage/worldstorage.js');
        const storage = await WorldStorage.getInstance();

        // Build and save continent metadata
        const metadata = this._buildMetadata();
        const continentRecord = {
            worldId,
            continentId,
            generationVersion: CONTINENTAL_VERSION,
            ...serializeContinent(metadata),
            stageVersions: this._buildStageVersions()
        };

        await storage.saveContinentMetadata(continentRecord);

        // Save textures separately (they're large binary blobs)
        for (const [type, texture] of Object.entries(this.textures)) {
            if (!texture) continue;

            const transferData = texture.getTransferableData();
            await storage.saveTexture({
                worldId,
                continentId,
                textureType: type,
                generationVersion: CONTINENTAL_VERSION,
                resolution: { width: transferData.width, height: transferData.height },
                format: 'float32',
                data: transferData.data.buffer
            });
        }

        console.log(`Saved continent '${continentId}' to storage`);
    }

    /**
     * Get the raw world data from the wrapped WorldGenerator.
     *
     * @returns {Object} World generation data
     */
    getWorldData() {
        return this.worldGen.getWorldData();
    }

    /**
     * Get the generated SDF textures.
     *
     * @returns {Object} Map of texture type to SDFTexture
     */
    getTextures() {
        return this.textures;
    }

    // =========================================================================
    // Internal Methods
    // =========================================================================

    /**
     * Bake all SDF textures from generated features.
     * Called by the 'sdf' stage.
     *
     * @private
     */
    async _bakeSdfTextures() {
        if (this.options.skipSdf) {
            console.log('Skipping SDF baking (skipSdf option)');
            return;
        }

        const bounds = this.bounds || { min: -2000, max: 2000 };
        const size = this.options.sdfSize;
        const data = this.worldGen.getWorldData();

        // Terrain SDF: ocean distance, mountain distance, lake distance
        this.textures.terrain = createTerrainSDF(bounds, {
            size,
            mountainSpines: data.spines || [],
            lakes: data.lakes || []
            // oceanPolygons would require coastline extraction - future enhancement
        });
        await this._yieldToUI();

        // Hydro SDF: river distance, width, flow direction, depth
        this.textures.hydro = createHydroSDF(bounds, data.rivers || [], { size });
        await this._yieldToUI();

        // Infra SDF: road distance, type, settlement distance
        this.textures.infra = createInfraSDF(bounds, data.roads || [], data.settlements || [], { size });
        await this._yieldToUI();

        // Climate texture: temperature, humidity, erosion
        // Note: createClimateTex needs sampler functions which we don't have here
        // For now, create an empty texture - climate is computed dynamically
        this.textures.climate = null; // Will be baked when climate samplers are available
    }

    /**
     * Build the final continent metadata object.
     *
     * @private
     * @returns {Object} Continent metadata
     */
    _buildMetadata() {
        const data = this.worldGen.getWorldData();

        return {
            seed: this.seed,
            template: data.template,
            bounds: this.bounds || { min: -2000, max: 2000 },
            spines: data.spines || [],
            rivers: data.rivers || [],
            lakes: data.lakes || [],
            zones: data.zones || new Map(),
            roads: data.roads || [],
            settlements: data.settlements || [],
            landmarks: data.landmarks || new Map(),
            stageVersions: this._buildStageVersions()
        };
    }

    /**
     * Build stage version snapshot for storage.
     *
     * @private
     * @returns {Object} Map of stage ID to version
     */
    _buildStageVersions() {
        const versions = {};
        for (const stage of STAGES) {
            if (this._completedStages.has(stage.id)) {
                versions[stage.id] = stage.version;
            }
        }
        return versions;
    }

    /**
     * Restore existing data that doesn't need regeneration.
     *
     * @private
     * @param {Object} metadata - Existing metadata
     * @param {Set<string>} needsRegen - Stages that need regeneration
     */
    _restoreFromMetadata(metadata, needsRegen) {
        if (!metadata) return;

        // Restore data from completed stages
        if (!needsRegen.has('shape')) {
            this.bounds = metadata.bounds;
        }
        if (!needsRegen.has('mountains') && metadata.spines) {
            this.spines = metadata.spines;
            this.worldGen._cache = this.worldGen._cache || {};
            this.worldGen._cache.spines = metadata.spines;
        }
        if (!needsRegen.has('rivers') && metadata.rivers) {
            this.rivers = metadata.rivers;
            this.worldGen._cache = this.worldGen._cache || {};
            this.worldGen._cache.rivers = metadata.rivers;
        }
        if (!needsRegen.has('zones') && metadata.zones) {
            this.zones = metadata.zones;
            this.worldGen._cache = this.worldGen._cache || {};
            this.worldGen._cache.zones = metadata.zones;
        }
        if (!needsRegen.has('roads') && metadata.roads) {
            this.roads = metadata.roads;
            this.worldGen._cache = this.worldGen._cache || {};
            this.worldGen._cache.roads = metadata.roads;
        }
    }

    /**
     * Create progress info object for callback.
     *
     * @private
     * @param {Object} stage - Current stage
     * @param {number} stageIndex - Stage index
     * @param {number} weightCompleted - Sum of completed stage weights
     * @param {number} stageProgress - Progress within stage (0-1)
     * @returns {ProgressInfo}
     */
    _createProgressInfo(stage, stageIndex, weightCompleted, stageProgress) {
        // Overall progress based on weight
        const overallProgress = (weightCompleted + stage.weight * stageProgress) / TOTAL_WEIGHT;

        return {
            stage: stage.id,
            stageIndex,
            stageCount: STAGES.length,
            progress: Math.min(1, Math.max(0, overallProgress)),
            stageProgress,
            message: stage.activeForm
        };
    }

    /**
     * Yield to the UI thread to prevent blocking.
     *
     * @private
     * @returns {Promise<void>}
     */
    _yieldToUI() {
        return new Promise(resolve => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(resolve);
            } else {
                // Node.js or worker context
                setTimeout(resolve, 0);
            }
        });
    }
}

/**
 * Create a ContinentalGenerator and generate immediately.
 * Convenience function for simple use cases.
 *
 * @param {number} seed - World seed
 * @param {Object|null} template - Continent template
 * @param {function} onProgress - Progress callback
 * @returns {Promise<Object>} Generated metadata
 */
export async function generateContinent(seed, template = null, onProgress = () => {}) {
    const generator = new ContinentalGenerator(seed, template);
    return generator.generateAsync(onProgress);
}

/**
 * Load or generate continent metadata.
 * Checks storage first, generates if missing or outdated.
 *
 * @param {string} worldId - World identifier
 * @param {number} seed - World seed
 * @param {Object|null} template - Continent template
 * @param {function} onProgress - Progress callback
 * @returns {Promise<Object>} Continent metadata
 */
export async function loadOrGenerateContinent(worldId, seed, template = null, onProgress = () => {}) {
    const { WorldStorage } = await import('../../storage/worldstorage.js');
    const { deserializeContinent } = await import('../../storage/serialization.js');

    const storage = await WorldStorage.getInstance();
    const existing = await storage.getContinentMetadata(worldId, 'main');

    // Check if regeneration needed
    const needsRegen = await storage.needsRegeneration(worldId, 'main');

    if (existing && !needsRegen) {
        // Use cached data
        console.log('Loading continent from storage');
        return deserializeContinent(existing);
    }

    // Generate new or regenerate stale
    const generator = new ContinentalGenerator(seed, template);

    let metadata;
    if (existing) {
        // Partial regeneration
        metadata = await generator.regenerateStale(deserializeContinent(existing), onProgress);
    } else {
        // Full generation
        metadata = await generator.generateAsync(onProgress);
    }

    // Save to storage
    await generator.save(worldId);

    return metadata;
}

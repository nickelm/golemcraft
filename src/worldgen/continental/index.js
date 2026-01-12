/**
 * Continental Generation Module
 *
 * Provides async world generation with progress reporting, SDF baking,
 * and IndexedDB persistence for continent metadata.
 *
 * Usage:
 *   import { ContinentalGenerator, loadOrGenerateContinent } from './worldgen/continental/index.js';
 *
 *   // Option 1: Manual control
 *   const generator = new ContinentalGenerator(seed, template);
 *   const metadata = await generator.generateAsync(onProgress);
 *   await generator.save(worldId);
 *
 *   // Option 2: Automatic load-or-generate
 *   const metadata = await loadOrGenerateContinent(worldId, seed, template, onProgress);
 */

// Main generator class
export {
    ContinentalGenerator,
    generateContinent,
    loadOrGenerateContinent
} from './generator.js';

// Stage definitions
export {
    STAGES,
    TOTAL_WEIGHT,
    getStageById,
    getStaleStages
} from './stages.js';

// Version constants
export {
    STAGE_VERSIONS,
    CONTINENTAL_VERSION,
    STAGE_DEPENDENCIES,
    getDependentStages
} from './versions.js';

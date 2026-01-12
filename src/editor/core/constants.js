/**
 * Template Editor - Shared Constants
 *
 * Centralized configuration for the editor application.
 */

// Zoom limits
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4.0;
export const DEFAULT_ZOOM = 0.5;  // Start zoomed out to show more of the continent

// Tile rendering
export const TILE_SIZE = 128;
export const MAX_LOD_LEVEL = 6;
export const MAX_CACHED_TILES = 512;

// Progressive refinement levels (coarse-to-fine rendering)
// Level 0: 4x4 grid (every 32px), Level 5: 128x128 (full resolution)
export const MAX_REFINEMENT_LEVEL = 5;
export const REFINEMENT_LEVELS = [
    { level: 0, sampling: 32, gridSize: 4 },    // 16 samples, <1ms
    { level: 1, sampling: 16, gridSize: 8 },    // 64 samples, ~2ms
    { level: 2, sampling: 8, gridSize: 16 },    // 256 samples, ~8ms
    { level: 3, sampling: 4, gridSize: 32 },    // 1024 samples, ~30ms
    { level: 4, sampling: 2, gridSize: 64 },    // 4096 samples, ~100ms
    { level: 5, sampling: 1, gridSize: 128 }    // 16384 samples (full), ~300ms
];

// UI dimensions
export const CONTROL_PANEL_WIDTH = 260;
export const INFO_PANEL_WIDTH = 200;
export const STATUS_BAR_HEIGHT = 32;

// Layer definitions
export const LAYERS = {
    elevation: { name: 'Elevation', defaultVisible: true },
    biomes: { name: 'Biomes', defaultVisible: true },
    rivers: { name: 'Rivers', defaultVisible: true },
    zones: { name: 'Zones', defaultVisible: false },
    roads: { name: 'Roads', defaultVisible: false },
    spines: { name: 'Spines', defaultVisible: false }
};

// Visualization modes
export const VISUALIZATION_MODES = {
    composite: { name: 'Composite (Map)', description: 'In-game map view' },
    elevation: { name: 'Elevation', description: 'Terrain height with hillshade' },
    continental: { name: 'Continentalness', description: 'Land/ocean distribution' },
    temperature: { name: 'Temperature', description: 'Climate zones' },
    humidity: { name: 'Humidity', description: 'Precipitation patterns' },
    erosion: { name: 'Erosion', description: 'Valley detail' },
    ridgeness: { name: 'Ridgeness', description: 'Mountain ridge highlighting' },
    biome: { name: 'Biome', description: 'Biome distribution' }
};

// Compare mode
export const MAX_COMPARE_SEEDS = 4;
export const COMPARE_GRID_SIZES = [1, 2, 4]; // 1x1, 2x2 grid

// Colors
export const COLORS = {
    background: '#1a1a2e',
    panelBackground: 'rgba(0, 0, 0, 0.85)',
    panelBorder: '#333',
    accent: '#4a9eff',
    text: '#fff',
    textMuted: '#888',
    pendingTile: 'rgba(100, 100, 150, 0.3)',
    river: '#4080C0',
    spinePrimary: '#FF6600',
    spineSecondary: '#FFAA00'
};

// Event names (for EventBus)
export const EVENTS = {
    VIEWPORT_CHANGE: 'viewport:change',
    SEED_CHANGE: 'seed:change',
    TEMPLATE_CHANGE: 'template:change',
    LAYER_TOGGLE: 'layer:toggle',
    MODE_CHANGE: 'mode:change',
    TILE_READY: 'tile:ready',
    HOVER_UPDATE: 'hover:update',
    COMPARE_TOGGLE: 'compare:toggle',
    STATE_CHANGE: 'state:change',
    RENDER_REQUEST: 'render:request'
};

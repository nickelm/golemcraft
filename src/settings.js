/**
 * Settings Manager for GolemCraft
 *
 * Manages game settings with localStorage persistence and auto-detection.
 * Settings are stored in localStorage and merged with defaults on load.
 * New settings are automatically added when the code introduces them.
 */

const STORAGE_KEY = 'golemcraft_settings';

/**
 * Detect device capabilities to determine default quality tier
 * @returns {'high' | 'medium' | 'low'}
 */
function detectDeviceTier() {
    const ua = navigator.userAgent;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);

    if (!isMobile) {
        return 'high';
    }

    // Check for low device memory (available on some browsers)
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) {
        return 'low';
    }

    // Check WebGL capabilities for GPU limits
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const maxTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
            const maxFragmentUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);

            // Conservative thresholds - older devices report lower values
            if (maxTextureUnits < 16 || maxFragmentUniforms < 256) {
                return 'low';
            }
        }
    } catch (e) {
        // WebGL not available, assume low-power
        return 'low';
    }

    // Modern mobile device
    return 'medium';
}

/**
 * Detect default draw distance based on device
 * @returns {'far' | 'medium' | 'near'}
 */
function detectDrawDistance() {
    const tier = detectDeviceTier();
    switch (tier) {
        case 'high': return 'far';
        case 'medium': return 'medium';
        case 'low': return 'near';
        default: return 'medium';
    }
}

export class SettingsManager {
    constructor() {
        this.defaults = {
            textureBlending: 'auto',      // 'high' | 'medium' | 'low' | 'auto'
            drawDistance: 'auto',         // 'far' | 'medium' | 'near' | 'auto'
            showFps: false,
            showPerformance: false,
            showLoadingIndicator: true
        };

        this.settings = this.load();

        // Cache detected values
        this._detectedTier = null;
        this._detectedDrawDistance = null;
    }

    /**
     * Load settings from localStorage, merging with defaults
     * This ensures new settings are automatically available
     */
    load() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Merge with defaults to pick up any new settings
                return { ...this.defaults, ...parsed };
            }
        } catch (e) {
            console.warn('Failed to load settings from localStorage:', e);
        }
        return { ...this.defaults };
    }

    /**
     * Save current settings to localStorage
     */
    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
        } catch (e) {
            console.warn('Failed to save settings to localStorage:', e);
        }
    }

    /**
     * Get a setting value, resolving 'auto' to detected value
     * @param {string} key - Setting key
     * @returns {*} Resolved setting value
     */
    get(key) {
        const value = this.settings[key];

        // Resolve 'auto' values
        if (value === 'auto') {
            switch (key) {
                case 'textureBlending':
                    if (!this._detectedTier) {
                        this._detectedTier = detectDeviceTier();
                    }
                    return this._detectedTier;

                case 'drawDistance':
                    if (!this._detectedDrawDistance) {
                        this._detectedDrawDistance = detectDrawDistance();
                    }
                    return this._detectedDrawDistance;

                default:
                    return value;
            }
        }

        return value;
    }

    /**
     * Get the raw setting value (without resolving 'auto')
     * @param {string} key - Setting key
     * @returns {*} Raw setting value
     */
    getRaw(key) {
        return this.settings[key];
    }

    /**
     * Set a setting value and save
     * @param {string} key - Setting key
     * @param {*} value - New value
     */
    set(key, value) {
        this.settings[key] = value;
        this.save();

        // Clear cached detected values if auto is set
        if (value === 'auto') {
            if (key === 'textureBlending') {
                this._detectedTier = null;
            } else if (key === 'drawDistance') {
                this._detectedDrawDistance = null;
            }
        }
    }

    /**
     * Get the detected device tier (useful for display)
     * @returns {'high' | 'medium' | 'low'}
     */
    getDetectedTier() {
        if (!this._detectedTier) {
            this._detectedTier = detectDeviceTier();
        }
        return this._detectedTier;
    }

    /**
     * Get the detected draw distance (useful for display)
     * @returns {'far' | 'medium' | 'near'}
     */
    getDetectedDrawDistance() {
        if (!this._detectedDrawDistance) {
            this._detectedDrawDistance = detectDrawDistance();
        }
        return this._detectedDrawDistance;
    }

    /**
     * Reset all settings to defaults
     */
    reset() {
        this.settings = { ...this.defaults };
        this._detectedTier = null;
        this._detectedDrawDistance = null;
        this.save();
    }

    /**
     * Get all settings (for debugging/display)
     * @returns {Object} All settings with resolved values
     */
    getAll() {
        const resolved = {};
        for (const key of Object.keys(this.defaults)) {
            resolved[key] = this.get(key);
        }
        return resolved;
    }

    /**
     * Get all raw settings (for debugging/display)
     * @returns {Object} All settings with raw values
     */
    getAllRaw() {
        return { ...this.settings };
    }
}

// Singleton instance
export const settingsManager = new SettingsManager();

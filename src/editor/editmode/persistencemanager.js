/**
 * PersistenceManager - Auto-save System for Edit Mode
 *
 * Manages automatic saving of edit data to localStorage.
 * Supports versioned saves for future compatibility.
 */

import { EVENTS, EDIT_STORAGE_KEY, EDIT_AUTOSAVE_INTERVAL } from '../core/constants.js';

const SAVE_VERSION = 1;

export class PersistenceManager {
    /**
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for notifications
     */
    constructor(state, eventBus) {
        this.state = state;
        this.eventBus = eventBus;

        this.autosaveTimer = null;
        this.lastSaveTime = 0;
        this.isDirty = false;

        this._setupEventListeners();
    }

    _setupEventListeners() {
        // Schedule autosave on edit data changes
        this.eventBus.on(EVENTS.EDIT_DATA_CHANGE, () => {
            this.isDirty = true;
            this._scheduleAutosave();
        });

        // Save when exiting edit mode
        this.eventBus.on(EVENTS.EDIT_MODE_TOGGLE, ({ enabled }) => {
            if (!enabled && this.isDirty) {
                this.save();
            }
        });
    }

    /**
     * Schedule an autosave after the debounce interval
     * @private
     */
    _scheduleAutosave() {
        if (this.autosaveTimer) {
            clearTimeout(this.autosaveTimer);
        }

        this.autosaveTimer = setTimeout(() => {
            this.save();
        }, EDIT_AUTOSAVE_INTERVAL);
    }

    /**
     * Save current edit data to localStorage
     * @returns {boolean} True if save succeeded
     */
    save() {
        const editData = this.state.editData;
        if (!editData) {
            console.log('PersistenceManager: No edit data to save');
            return false;
        }

        const saveData = {
            version: SAVE_VERSION,
            timestamp: Date.now(),
            templateName: this.state.templateName,
            editStage: this.state.editStage,
            editData: editData
        };

        try {
            localStorage.setItem(EDIT_STORAGE_KEY, JSON.stringify(saveData));
            this.lastSaveTime = Date.now();
            this.isDirty = false;
            console.log(`PersistenceManager: Autosave complete at ${new Date(this.lastSaveTime).toLocaleTimeString()}`);
            return true;
        } catch (e) {
            console.error('PersistenceManager: Save failed:', e);
            return false;
        }
    }

    /**
     * Load edit data from localStorage
     * @returns {Object|null} Saved data object or null if not found/invalid
     */
    load() {
        try {
            const json = localStorage.getItem(EDIT_STORAGE_KEY);
            if (!json) {
                console.log('PersistenceManager: No saved data found');
                return null;
            }

            const data = JSON.parse(json);

            // Version check
            if (data.version !== SAVE_VERSION) {
                console.warn(`PersistenceManager: Unknown save version ${data.version}, expected ${SAVE_VERSION}`);
                return null;
            }

            // Validate required fields
            if (!data.editData) {
                console.warn('PersistenceManager: Invalid save data (missing editData)');
                return null;
            }

            console.log(`PersistenceManager: Loaded save from ${new Date(data.timestamp).toLocaleString()}`);
            return data;
        } catch (e) {
            console.error('PersistenceManager: Load failed:', e);
            return null;
        }
    }

    /**
     * Check if there's a saved session available
     * @returns {boolean}
     */
    hasSavedSession() {
        try {
            const json = localStorage.getItem(EDIT_STORAGE_KEY);
            if (!json) return false;

            const data = JSON.parse(json);
            return data.version === SAVE_VERSION && !!data.editData;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get info about the saved session without loading full data
     * @returns {Object|null} { timestamp, templateName, editStage } or null
     */
    getSavedSessionInfo() {
        try {
            const json = localStorage.getItem(EDIT_STORAGE_KEY);
            if (!json) return null;

            const data = JSON.parse(json);
            if (data.version !== SAVE_VERSION) return null;

            return {
                timestamp: data.timestamp,
                templateName: data.templateName,
                editStage: data.editStage
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * Restore saved session to editor state
     * @returns {boolean} True if restore succeeded
     */
    restore() {
        const data = this.load();
        if (!data) return false;

        try {
            // Restore edit data
            this.state.setEditData(data.editData);

            // Restore stage
            if (data.editStage) {
                this.state.setEditStage(data.editStage);
            }

            this.isDirty = false;
            console.log('PersistenceManager: Session restored');
            return true;
        } catch (e) {
            console.error('PersistenceManager: Restore failed:', e);
            return false;
        }
    }

    /**
     * Clear saved data from localStorage
     */
    clear() {
        try {
            localStorage.removeItem(EDIT_STORAGE_KEY);
            console.log('PersistenceManager: Saved data cleared');
        } catch (e) {
            console.error('PersistenceManager: Clear failed:', e);
        }
    }

    /**
     * Force an immediate save (bypasses debounce)
     */
    saveNow() {
        if (this.autosaveTimer) {
            clearTimeout(this.autosaveTimer);
            this.autosaveTimer = null;
        }
        return this.save();
    }

    /**
     * Get time since last save in milliseconds
     * @returns {number}
     */
    getTimeSinceLastSave() {
        return Date.now() - this.lastSaveTime;
    }

    /**
     * Clean up timers and event listeners
     */
    destroy() {
        if (this.autosaveTimer) {
            clearTimeout(this.autosaveTimer);
            this.autosaveTimer = null;
        }
    }
}

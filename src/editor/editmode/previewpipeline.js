/**
 * PreviewPipeline - Debounced template regeneration for Edit Mode
 *
 * Listens for edit data changes and regenerates the template
 * with debouncing to prevent excessive recomputation during
 * interactive editing (e.g., dragging points).
 */

import { EVENTS } from '../core/constants.js';
import { buildTemplate } from './templatebuilder.js';

const DEFAULT_DEBOUNCE_DELAY = 150; // ms

export class PreviewPipeline {
    /**
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for notifications
     * @param {number} debounceDelay - Debounce delay in milliseconds
     */
    constructor(state, eventBus, debounceDelay = DEFAULT_DEBOUNCE_DELAY) {
        this.state = state;
        this.eventBus = eventBus;
        this.debounceDelay = debounceDelay;

        this.debounceTimer = null;
        this.regenerationPending = false;
        this.lastRegenerationTime = 0;

        this._setupEventListeners();
    }

    _setupEventListeners() {
        // Listen for edit data changes
        this.eventBus.on(EVENTS.EDIT_DATA_CHANGE, (data) => {
            this._scheduleRegeneration(data.source);
        });

        // Listen for stage changes (may need immediate regeneration)
        this.eventBus.on(EVENTS.EDIT_STAGE_CHANGE, () => {
            this._scheduleRegeneration('stage-change');
        });
    }

    /**
     * Schedule a regeneration with debouncing
     * @param {string} source - Source of the change
     * @private
     */
    _scheduleRegeneration(source) {
        // Only regenerate in edit mode
        if (!this.state.isEditMode) return;

        // Clear existing timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.regenerationPending = true;

        // Schedule new regeneration
        this.debounceTimer = setTimeout(() => {
            this._regenerate(source);
        }, this.debounceDelay);
    }

    /**
     * Force immediate regeneration (bypasses debounce)
     */
    regenerateNow() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this._regenerate('force');
    }

    /**
     * Perform the actual regeneration
     * @param {string} source - Source of the change
     * @private
     */
    _regenerate(source) {
        this.regenerationPending = false;
        this.debounceTimer = null;

        const editData = this.state.editData;
        if (!editData) {
            console.log('PreviewPipeline: No edit data to regenerate');
            return;
        }

        const startTime = performance.now();

        // Build template from edit data
        const template = buildTemplate(editData);

        // Update state with new template
        // This will trigger worldData regeneration and emit TEMPLATE_CHANGE
        this.state.setTemplate(template, 'custom');

        const elapsed = performance.now() - startTime;
        this.lastRegenerationTime = elapsed;

        console.log(`PreviewPipeline: Regenerated template in ${elapsed.toFixed(1)}ms (source: ${source})`);
    }

    /**
     * Check if a regeneration is currently scheduled
     * @returns {boolean}
     */
    isRegenerationPending() {
        return this.regenerationPending;
    }

    /**
     * Get the last regeneration time in milliseconds
     * @returns {number}
     */
    getLastRegenerationTime() {
        return this.lastRegenerationTime;
    }

    /**
     * Set the debounce delay
     * @param {number} delay - Delay in milliseconds
     */
    setDebounceDelay(delay) {
        this.debounceDelay = Math.max(0, delay);
    }

    /**
     * Cancel any pending regeneration
     */
    cancel() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.regenerationPending = false;
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.cancel();
    }
}

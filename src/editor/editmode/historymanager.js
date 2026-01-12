/**
 * HistoryManager - Undo/Redo System for Edit Mode
 *
 * Manages a stack of edit data states for undo/redo functionality.
 * Uses deep cloning to ensure state isolation.
 */

import { EVENTS, EDIT_HISTORY_MAX_STATES } from '../core/constants.js';

export class HistoryManager {
    /**
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for notifications
     * @param {number} maxStates - Maximum states to keep in history
     */
    constructor(state, eventBus, maxStates = EDIT_HISTORY_MAX_STATES) {
        this.state = state;
        this.eventBus = eventBus;
        this.maxStates = maxStates;

        this.undoStack = [];
        this.redoStack = [];
        this.currentState = null;
        this._isPushing = false;

        this._setupEventListeners();
    }

    _setupEventListeners() {
        // Listen for explicit history push requests
        this.eventBus.on(EVENTS.HISTORY_PUSH, () => {
            this.push();
        });

        // Listen for undo/redo keyboard shortcuts
        this.eventBus.on(EVENTS.HISTORY_UNDO, () => {
            this.undo();
        });

        this.eventBus.on(EVENTS.HISTORY_REDO, () => {
            this.redo();
        });
    }

    /**
     * Push current edit data state onto the history stack
     */
    push() {
        const editData = this.state.editData;
        if (!editData) return;

        this._isPushing = true;

        // Move current state to undo stack
        if (this.currentState !== null) {
            this.undoStack.push(this.currentState);

            // Trim undo stack if it exceeds max size
            if (this.undoStack.length > this.maxStates) {
                this.undoStack.shift();
            }
        }

        // Clone and store current state
        this.currentState = this._deepClone(editData);

        // Clear redo stack on new action
        this.redoStack = [];

        this._isPushing = false;

        console.log(`History: Pushed state (${this.undoStack.length} undos available)`);
    }

    /**
     * Undo the last action
     * @returns {boolean} True if undo was performed
     */
    undo() {
        if (!this.canUndo()) {
            console.log('History: Nothing to undo');
            return false;
        }

        // Save current state to redo stack
        if (this.currentState !== null) {
            this.redoStack.push(this.currentState);
        }

        // Pop from undo stack
        this.currentState = this.undoStack.pop();

        // Restore state
        this._restoreState(this.currentState);

        console.log(`History: Undo (${this.undoStack.length} undos, ${this.redoStack.length} redos remaining)`);
        return true;
    }

    /**
     * Redo the last undone action
     * @returns {boolean} True if redo was performed
     */
    redo() {
        if (!this.canRedo()) {
            console.log('History: Nothing to redo');
            return false;
        }

        // Save current state to undo stack
        if (this.currentState !== null) {
            this.undoStack.push(this.currentState);
        }

        // Pop from redo stack
        this.currentState = this.redoStack.pop();

        // Restore state
        this._restoreState(this.currentState);

        console.log(`History: Redo (${this.undoStack.length} undos, ${this.redoStack.length} redos remaining)`);
        return true;
    }

    /**
     * Check if undo is available
     * @returns {boolean}
     */
    canUndo() {
        return this.undoStack.length > 0;
    }

    /**
     * Check if redo is available
     * @returns {boolean}
     */
    canRedo() {
        return this.redoStack.length > 0;
    }

    /**
     * Get the number of available undo steps
     * @returns {number}
     */
    getUndoCount() {
        return this.undoStack.length;
    }

    /**
     * Get the number of available redo steps
     * @returns {number}
     */
    getRedoCount() {
        return this.redoStack.length;
    }

    /**
     * Clear all history
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.currentState = null;
        console.log('History: Cleared');
    }

    /**
     * Initialize history with current state (call when entering edit mode)
     */
    initialize() {
        this.clear();
        const editData = this.state.editData;
        if (editData) {
            this.currentState = this._deepClone(editData);
        }
    }

    /**
     * Deep clone an object using JSON serialization
     * @private
     */
    _deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    /**
     * Restore edit data state
     * @private
     */
    _restoreState(editData) {
        if (!editData) return;

        // Set the edit data without triggering a history push
        this.state.setEditData(this._deepClone(editData));
    }

    /**
     * Clean up event listeners
     */
    destroy() {
        // EventBus doesn't store references in a way that requires cleanup
        // but we clear internal state
        this.clear();
    }
}

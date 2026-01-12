/**
 * Template Editor - EventBus
 *
 * Decoupled component communication via publish/subscribe pattern.
 * Components can emit events and subscribe to events from other components
 * without direct references.
 */

export class EventBus {
    constructor() {
        this._listeners = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} handler - Callback function
     * @returns {Function} Unsubscribe function
     */
    on(event, handler) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(handler);

        // Return unsubscribe function
        return () => this.off(event, handler);
    }

    /**
     * Subscribe to an event for a single invocation
     * @param {string} event - Event name
     * @param {Function} handler - Callback function
     * @returns {Function} Unsubscribe function
     */
    once(event, handler) {
        const wrapper = (data) => {
            this.off(event, wrapper);
            handler(data);
        };
        return this.on(event, wrapper);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {Function} handler - Callback function to remove
     */
    off(event, handler) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            listeners.delete(handler);
            if (listeners.size === 0) {
                this._listeners.delete(event);
            }
        }
    }

    /**
     * Emit an event to all subscribers
     * @param {string} event - Event name
     * @param {*} data - Data to pass to handlers
     */
    emit(event, data) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            for (const handler of listeners) {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`EventBus: Error in handler for "${event}":`, error);
                }
            }
        }
    }

    /**
     * Remove all listeners for an event (or all events if no event specified)
     * @param {string} [event] - Optional event name
     */
    clear(event) {
        if (event) {
            this._listeners.delete(event);
        } else {
            this._listeners.clear();
        }
    }

    /**
     * Get the number of listeners for an event
     * @param {string} event - Event name
     * @returns {number} Number of listeners
     */
    listenerCount(event) {
        const listeners = this._listeners.get(event);
        return listeners ? listeners.size : 0;
    }
}

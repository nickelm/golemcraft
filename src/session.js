/**
 * Session Management for GolemCraft
 * 
 * Handles saving/loading world state to localStorage.
 * Each world is stored with a unique ID and includes:
 * - Seed (for terrain regeneration)
 * - Hero position and rotation
 * - Golem positions
 * - Timestamp of last save
 * - World name
 */

const STORAGE_KEY = 'golemcraft_worlds';
const LAST_WORLD_KEY = 'golemcraft_last_world';
const STORAGE_VERSION = 1;

export class SessionManager {
    constructor() {
        this.currentWorldId = null;
    }

    /**
     * Get all saved worlds
     * @returns {Object} Map of worldId -> worldData
     */
    getAllWorlds() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (!data) return {};
            
            const parsed = JSON.parse(data);
            
            // Version check - clear incompatible data
            if (parsed._version !== STORAGE_VERSION) {
                console.warn('Incompatible save data version, clearing...');
                this.clearAllWorlds();
                return {};
            }
            
            const { _version, ...worlds } = parsed;
            return worlds;
        } catch (e) {
            console.error('Failed to load worlds:', e);
            return {};
        }
    }

    /**
     * Get list of worlds sorted by last played
     * @returns {Array} Array of { id, name, seed, lastPlayed, heroPosition }
     */
    getWorldList() {
        const worlds = this.getAllWorlds();
        return Object.entries(worlds)
            .map(([id, data]) => ({
                id,
                name: data.name,
                seed: data.seed,
                lastPlayed: data.lastPlayed,
                heroPosition: data.heroPosition
            }))
            .sort((a, b) => b.lastPlayed - a.lastPlayed);
    }

    /**
     * Get the last played world ID
     * @returns {string|null}
     */
    getLastWorldId() {
        return localStorage.getItem(LAST_WORLD_KEY);
    }

    /**
     * Check if there's a world to continue
     * @returns {boolean}
     */
    hasContinueWorld() {
        const lastId = this.getLastWorldId();
        if (!lastId) return false;
        
        const worlds = this.getAllWorlds();
        return !!worlds[lastId];
    }

    /**
     * Load a specific world
     * @param {string} worldId
     * @returns {Object|null} World data or null if not found
     */
    loadWorld(worldId) {
        const worlds = this.getAllWorlds();
        const world = worlds[worldId];
        
        if (world) {
            this.currentWorldId = worldId;
            localStorage.setItem(LAST_WORLD_KEY, worldId);
        }
        
        return world || null;
    }

    /**
     * Load the last played world
     * @returns {Object|null}
     */
    loadLastWorld() {
        const lastId = this.getLastWorldId();
        if (!lastId) return null;
        return this.loadWorld(lastId);
    }

    /**
     * Create a new world
     * @param {string} name - World name
     * @param {number} seed - Terrain seed (optional, random if not provided)
     * @returns {Object} New world data with id
     */
    createWorld(name, seed = null) {
        const worldId = this.generateWorldId();
        const actualSeed = seed ?? Math.floor(Math.random() * 100000);
        
        const worldData = {
            name: name || `World ${this.getWorldList().length + 1}`,
            seed: actualSeed,
            created: Date.now(),
            lastPlayed: Date.now(),
            heroPosition: null,
            heroRotation: 0,
            golems: [],
            gameTime: 0,
            visitedMapCells: []
        };
        
        this.saveWorldData(worldId, worldData);
        this.currentWorldId = worldId;
        localStorage.setItem(LAST_WORLD_KEY, worldId);
        
        return { id: worldId, ...worldData };
    }

    /**
     * Save current game state
     * @param {Object} gameState - Current game state to save
     */
    saveCurrentWorld(gameState) {
        if (!this.currentWorldId) {
            console.warn('No current world to save');
            return false;
        }
        
        const worlds = this.getAllWorlds();
        const world = worlds[this.currentWorldId];
        
        if (!world) {
            console.warn('Current world not found in storage');
            return false;
        }
        
        // Update world data
        world.lastPlayed = Date.now();
        
        if (gameState.heroPosition) {
            world.heroPosition = {
                x: gameState.heroPosition.x,
                y: gameState.heroPosition.y,
                z: gameState.heroPosition.z
            };
        }
        
        if (gameState.heroRotation !== undefined) {
            world.heroRotation = gameState.heroRotation;
        }
        
        if (gameState.golems) {
            world.golems = gameState.golems.map(g => ({
                x: g.position.x,
                y: g.position.y,
                z: g.position.z,
                health: g.health
            }));
        }
        
        if (gameState.gameTime !== undefined) {
            world.gameTime = gameState.gameTime;
        }

        if (gameState.visitedMapCells !== undefined) {
            world.visitedMapCells = gameState.visitedMapCells;
        }
        
        this.saveWorldData(this.currentWorldId, world);
        return true;
    }

    /**
     * Delete a world
     * @param {string} worldId
     */
    deleteWorld(worldId) {
        const worlds = this.getAllWorlds();
        delete worlds[worldId];
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            _version: STORAGE_VERSION,
            ...worlds
        }));
        
        // Clear last world if it was deleted
        if (this.getLastWorldId() === worldId) {
            localStorage.removeItem(LAST_WORLD_KEY);
        }
        
        if (this.currentWorldId === worldId) {
            this.currentWorldId = null;
        }
    }

    /**
     * Rename a world
     * @param {string} worldId
     * @param {string} newName
     */
    renameWorld(worldId, newName) {
        const worlds = this.getAllWorlds();
        if (worlds[worldId]) {
            worlds[worldId].name = newName;
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                _version: STORAGE_VERSION,
                ...worlds
            }));
        }
    }

    /**
     * Clear all saved worlds (for debugging/reset)
     */
    clearAllWorlds() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LAST_WORLD_KEY);
        this.currentWorldId = null;
    }

    /**
     * Export all worlds as JSON (for backup)
     * @returns {string}
     */
    exportWorlds() {
        return localStorage.getItem(STORAGE_KEY) || '{}';
    }

    /**
     * Import worlds from JSON (for restore)
     * @param {string} jsonData
     */
    importWorlds(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            if (data._version === STORAGE_VERSION) {
                localStorage.setItem(STORAGE_KEY, jsonData);
                return true;
            } else {
                console.error('Incompatible import version');
                return false;
            }
        } catch (e) {
            console.error('Failed to import worlds:', e);
            return false;
        }
    }

    // Private methods
    
    generateWorldId() {
        return 'world_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }

    saveWorldData(worldId, worldData) {
        const worlds = this.getAllWorlds();
        worlds[worldId] = worldData;
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            _version: STORAGE_VERSION,
            ...worlds
        }));
    }
}

// Singleton instance
export const sessionManager = new SessionManager();
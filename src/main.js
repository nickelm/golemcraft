import { Game } from './game.js';
import { sessionManager } from './session.js';

// Hide loading screen and start game
window.addEventListener('DOMContentLoaded', () => {
    const loading = document.getElementById('loading');
    const worldNameEl = document.getElementById('world-name');
    const menuBtn = document.getElementById('menu-btn');
    
    // Get world data from sessionStorage (set by menu)
    let worldData = null;
    const worldJson = sessionStorage.getItem('golemcraft_current_world');
    
    if (worldJson) {
        try {
            worldData = JSON.parse(worldJson);
            // Set the current world in session manager
            sessionManager.currentWorldId = worldData.id;
        } catch (e) {
            console.error('Failed to parse world data:', e);
        }
    }
    
    // If no world data, redirect to menu
    if (!worldData) {
        window.location.href = 'index.html';
        return;
    }
    
    // Display world name
    if (worldNameEl) {
        worldNameEl.textContent = worldData.name;
    }
    
    // Initialize game with world data
    const game = new Game(worldData);
    window.game = game; // For debugging
    
    // Menu button handler
    menuBtn?.addEventListener('click', () => {
        saveAndReturnToMenu(game);
    });
    
    // Escape key to return to menu (use keyup to avoid double-trigger)
    window.addEventListener('keyup', (e) => {
        if (e.key === 'Escape') {
            // Close map overlay first if open
            if (game.mapOverlay?.isOpen) {
                game.mapOverlay.close();
                e.preventDefault();
                return;
            }
            e.preventDefault();
            saveAndReturnToMenu(game);
        }
    });
    
    // Auto-save every 30 seconds
    setInterval(() => {
        saveGame(game);
    }, 30000);
    
    // Save on page unload
    window.addEventListener('beforeunload', () => {
        saveGame(game);
    });
    
    // Hide loading screen once texture is loaded (handled in Game constructor)
    setTimeout(() => {
        loading.classList.add('hidden');
    }, 100);
});

function saveGame(game) {
    if (!game || !game.hero) return;
    
    const gameState = {
        heroPosition: game.hero.position,
        heroRotation: game.hero.rotation,
        golems: game.hero.commandedGolems.filter(g => g.health > 0),
        gameTime: game.gameTime || 0
    };
    
    const saved = sessionManager.saveCurrentWorld(gameState);
    
    if (saved) {
        showSaveIndicator();
    }
}

function showSaveIndicator() {
    const indicator = document.getElementById('save-indicator');
    if (indicator) {
        indicator.classList.add('visible');
        setTimeout(() => {
            indicator.classList.remove('visible');
        }, 2000);
    }
}

function saveAndReturnToMenu(game) {
    saveGame(game);
    window.location.href = 'index.html';
}
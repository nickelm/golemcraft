import { Game } from './game.js';

// Hide loading screen and start game
window.addEventListener('DOMContentLoaded', () => {
    const loading = document.getElementById('loading');
    
    // Initialize game
    const game = new Game();
    
    // Hide loading screen once texture is loaded (handled in Game constructor)
    setTimeout(() => {
        loading.classList.add('hidden');
    }, 100);
});

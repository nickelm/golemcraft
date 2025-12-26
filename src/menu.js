/**
 * Menu System for GolemCraft
 * 
 * Handles the main menu UI and navigation between screens:
 * - Main menu (Continue, Load, New, Debug)
 * - World list (Load existing worlds)
 * - New world dialog
 * - Confirmation dialogs
 */

import { sessionManager } from './session.js';

export class MenuSystem {
    constructor() {
        this.currentScreen = 'main';
        this.selectedWorldId = null;
        
        this.init();
    }

    init() {
        this.createTwinklingStars();
        this.cacheElements();
        this.bindEvents();
        this.updateMainMenu();
    }
    
    createTwinklingStars() {
        // Create container for twinkling stars
        const container = document.createElement('div');
        container.className = 'starfield-twinkle';
        
        // Generate 60 randomly positioned twinkling stars
        for (let i = 0; i < 60; i++) {
            const star = document.createElement('div');
            star.className = 'twinkle-star';
            star.style.left = `${Math.random() * 100}%`;
            star.style.top = `${Math.random() * 100}%`;
            star.style.setProperty('--duration', `${1.5 + Math.random() * 4}s`);
            star.style.setProperty('--delay', `${Math.random() * 8}s`);
            
            // Vary star colors - more whites, some colored
            const colors = ['white', 'white', 'white', '#4ade80', '#60a5fa', '#fbbf24', 'white'];
            star.style.background = colors[Math.floor(Math.random() * colors.length)];
            
            // Vary star sizes (1-3px)
            const size = 1 + Math.random() * 2;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            
            container.appendChild(star);
        }
        
        document.body.appendChild(container);
    }

    cacheElements() {
        // Main menu
        this.mainMenu = document.getElementById('main-menu');
        this.continueBtn = document.getElementById('btn-continue');
        this.loadBtn = document.getElementById('btn-load');
        this.newBtn = document.getElementById('btn-new');
        this.debugBtn = document.getElementById('btn-debug');
        
        // World list screen
        this.worldListScreen = document.getElementById('world-list-screen');
        this.worldList = document.getElementById('world-list');
        this.backToMainBtn = document.getElementById('btn-back-main');
        this.loadSelectedBtn = document.getElementById('btn-load-selected');
        
        // New world screen
        this.newWorldScreen = document.getElementById('new-world-screen');
        this.worldNameInput = document.getElementById('world-name-input');
        this.worldSeedInput = document.getElementById('world-seed-input');
        this.createWorldBtn = document.getElementById('btn-create-world');
        this.cancelNewBtn = document.getElementById('btn-cancel-new');
        
        // Modal overlay
        this.modalOverlay = document.getElementById('modal-overlay');
    }

    bindEvents() {
        // Main menu buttons
        this.continueBtn?.addEventListener('click', () => this.handleContinue());
        this.loadBtn?.addEventListener('click', () => this.showScreen('load'));
        this.newBtn?.addEventListener('click', () => this.showScreen('new'));
        this.debugBtn?.addEventListener('click', () => this.handleDebug());
        
        // World list buttons
        this.backToMainBtn?.addEventListener('click', () => this.showScreen('main'));
        this.loadSelectedBtn?.addEventListener('click', () => this.loadSelectedWorld());
        
        // New world buttons
        this.createWorldBtn?.addEventListener('click', () => this.handleCreateWorld());
        this.cancelNewBtn?.addEventListener('click', () => this.showScreen('main'));
        
        // Enter key in inputs
        this.worldNameInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleCreateWorld();
        });
        
        // Close modal on overlay click
        this.modalOverlay?.addEventListener('click', (e) => {
            if (e.target === this.modalOverlay) {
                this.closeModal();
            }
        });
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.currentScreen !== 'main') {
                    this.showScreen('main');
                }
            }
        });
    }

    updateMainMenu() {
        const hasContinue = sessionManager.hasContinueWorld();
        const worldList = sessionManager.getWorldList();
        
        // Update Continue button
        if (this.continueBtn) {
            this.continueBtn.disabled = !hasContinue;
            
            if (hasContinue) {
                const lastWorld = sessionManager.loadLastWorld();
                if (lastWorld) {
                    this.continueBtn.textContent = `Continue: ${lastWorld.name}`;
                    // Reset to avoid side effects
                    sessionManager.currentWorldId = null;
                }
            }
        }
        
        // Update Load button
        if (this.loadBtn) {
            this.loadBtn.disabled = worldList.length === 0;
            this.loadBtn.textContent = worldList.length > 0 
                ? `Load World (${worldList.length})` 
                : 'Load World';
        }
    }

    showScreen(screen) {
        this.currentScreen = screen;
        
        // Hide all screens
        this.mainMenu?.classList.add('hidden');
        this.worldListScreen?.classList.add('hidden');
        this.newWorldScreen?.classList.add('hidden');
        this.modalOverlay?.classList.add('hidden');
        
        switch (screen) {
            case 'main':
                this.mainMenu?.classList.remove('hidden');
                this.updateMainMenu();
                break;
                
            case 'load':
                this.worldListScreen?.classList.remove('hidden');
                this.renderWorldList();
                break;
                
            case 'new':
                this.newWorldScreen?.classList.remove('hidden');
                this.worldNameInput.value = '';
                this.worldSeedInput.value = '';
                this.worldNameInput?.focus();
                break;
        }
    }

    renderWorldList() {
        const worlds = sessionManager.getWorldList();
        this.selectedWorldId = null;
        
        if (!this.worldList) return;
        
        if (worlds.length === 0) {
            this.worldList.innerHTML = `
                <div class="empty-state">
                    No saved worlds yet.<br>
                    Create a new world to begin!
                </div>
            `;
            if (this.loadSelectedBtn) {
                this.loadSelectedBtn.disabled = true;
            }
            return;
        }
        
        this.worldList.innerHTML = worlds.map(world => `
            <div class="world-item" data-world-id="${world.id}">
                <div class="world-info">
                    <div class="world-name">${this.escapeHtml(world.name)}</div>
                    <div class="world-meta">
                        Seed: ${world.seed} | 
                        ${this.formatDate(world.lastPlayed)}
                    </div>
                </div>
                <div class="world-actions">
                    <button class="world-action-btn world-action-btn--delete" 
                            data-action="delete" 
                            data-world-id="${world.id}"
                            title="Delete world">
                        ×
                    </button>
                </div>
            </div>
        `).join('');
        
        // Bind events for world items
        this.worldList.querySelectorAll('.world-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.world-action-btn')) {
                    this.selectWorld(item.dataset.worldId);
                }
            });
            
            item.addEventListener('dblclick', (e) => {
                if (!e.target.closest('.world-action-btn')) {
                    this.loadWorld(item.dataset.worldId);
                }
            });
        });
        
        // Bind delete buttons
        this.worldList.querySelectorAll('.world-action-btn--delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.confirmDeleteWorld(btn.dataset.worldId);
            });
        });
        
        if (this.loadSelectedBtn) {
            this.loadSelectedBtn.disabled = true;
        }
    }

    selectWorld(worldId) {
        this.selectedWorldId = worldId;
        
        // Update visual selection
        this.worldList.querySelectorAll('.world-item').forEach(item => {
            item.classList.toggle('world-item--selected', item.dataset.worldId === worldId);
        });
        
        if (this.loadSelectedBtn) {
            this.loadSelectedBtn.disabled = false;
        }
    }

    loadSelectedWorld() {
        if (this.selectedWorldId) {
            this.loadWorld(this.selectedWorldId);
        }
    }

    loadWorld(worldId) {
        const world = sessionManager.loadWorld(worldId);
        if (world) {
            // Navigate to game with world data
            this.startGame(world);
        }
    }

    handleContinue() {
        const world = sessionManager.loadLastWorld();
        if (world) {
            this.startGame(world);
        }
    }

    handleCreateWorld() {
        const name = this.worldNameInput?.value.trim() || `World ${sessionManager.getWorldList().length + 1}`;
        const seedInput = this.worldSeedInput?.value.trim();
        const seed = seedInput ? parseInt(seedInput, 10) : null;
        
        const world = sessionManager.createWorld(name, isNaN(seed) ? null : seed);
        this.startGame(world);
    }

    startGame(world) {
        // Store world data for game.html to pick up
        sessionStorage.setItem('golemcraft_current_world', JSON.stringify(world));
        
        // Navigate to game page
        window.location.href = 'game.html';
    }

    confirmDeleteWorld(worldId) {
        const worlds = sessionManager.getWorldList();
        const world = worlds.find(w => w.id === worldId);
        
        if (!world) return;
        
        this.showConfirmDialog(
            `Delete "${world.name}"?`,
            'This action cannot be undone.',
            () => {
                sessionManager.deleteWorld(worldId);
                this.renderWorldList();
                this.updateMainMenu();
            }
        );
    }

    showConfirmDialog(title, message, onConfirm) {
        if (!this.modalOverlay) return;
        
        this.modalOverlay.innerHTML = `
            <div class="menu-panel modal">
                <div class="panel-header">${this.escapeHtml(title)}</div>
                <p style="font-family: var(--font-terminal); font-size: 1.25rem; margin-bottom: 1.5rem; color: var(--color-text-dim);">
                    ${this.escapeHtml(message)}
                </p>
                <div class="btn-row">
                    <button class="menu-btn" id="modal-cancel">Cancel</button>
                    <button class="menu-btn menu-btn--danger" id="modal-confirm">Delete</button>
                </div>
            </div>
        `;
        
        this.modalOverlay.classList.remove('hidden');
        
        document.getElementById('modal-cancel')?.addEventListener('click', () => this.closeModal());
        document.getElementById('modal-confirm')?.addEventListener('click', () => {
            onConfirm();
            this.closeModal();
        });
    }

    closeModal() {
        this.modalOverlay?.classList.add('hidden');
    }

    handleDebug() {
        this.showConfirmDialog(
            'Clear All Data?',
            'This will delete all saved worlds. Use this if you encounter data issues.',
            () => {
                sessionManager.clearAllWorlds();
                this.updateMainMenu();
                this.showScreen('main');
            }
        );
    }

    // Utility methods
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    formatDate(timestamp) {
        if (!timestamp) return 'Never';
        
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return date.toLocaleDateString();
    }
}

// Initialize menu when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.menuSystem = new MenuSystem();
});
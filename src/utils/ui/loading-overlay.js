/**
 * LoadingOverlay - Shows progress while chunks are loading
 * 
 * Used for:
 * - Initial world load
 * - When player catches up to terrain generation
 * - Teleportation
 * 
 * Progress is shown as percentage based on minimum safe chunks needed
 * to unpause the game (not total world chunks).
 */
export class LoadingOverlay {
    constructor() {
        this.element = null;
        this.progressBar = null;
        this.progressText = null;
        this.visible = false;
        
        this.createOverlay();
    }

    createOverlay() {
        // Create overlay container
        this.element = document.createElement('div');
        this.element.id = 'chunk-loading-overlay';
        this.element.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.85);
            display: none;
            justify-content: center;
            align-items: center;
            flex-direction: column;
            z-index: 10000;
            font-family: monospace;
            color: white;
        `;

        // Create content container
        const content = document.createElement('div');
        content.style.cssText = `
            text-align: center;
            padding: 20px;
        `;

        // Title
        const title = document.createElement('div');
        title.textContent = 'Loading Terrain...';
        title.style.cssText = `
            font-size: 24px;
            margin-bottom: 20px;
            color: #4ade80;
        `;
        content.appendChild(title);

        // Progress bar container
        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            width: 300px;
            height: 20px;
            background: #333;
            border-radius: 10px;
            overflow: hidden;
            margin-bottom: 10px;
        `;

        // Progress bar fill
        this.progressBar = document.createElement('div');
        this.progressBar.style.cssText = `
            width: 0%;
            height: 100%;
            background: linear-gradient(90deg, #4ade80, #22c55e);
            transition: width 0.1s ease-out;
        `;
        progressContainer.appendChild(this.progressBar);
        content.appendChild(progressContainer);

        // Progress text
        this.progressText = document.createElement('div');
        this.progressText.textContent = '0%';
        this.progressText.style.cssText = `
            font-size: 14px;
            color: #888;
        `;
        content.appendChild(this.progressText);

        this.element.appendChild(content);
        document.body.appendChild(this.element);
    }

    /**
     * Show the loading overlay
     */
    show() {
        if (this.visible) return;
        this.visible = true;
        this.element.style.display = 'flex';
    }

    /**
     * Hide the loading overlay
     */
    hide() {
        if (!this.visible) return;
        this.visible = false;
        this.element.style.display = 'none';
    }

    /**
     * Update progress display
     * @param {number} loaded - Number of chunks loaded
     * @param {number} required - Number of chunks required to unpause
     */
    setProgress(loaded, required) {
        // Clamp to 0-100% range
        const percent = required > 0 ? Math.min(100, Math.max(0, (loaded / required) * 100)) : 0;
        this.progressBar.style.width = `${percent}%`;
        this.progressText.textContent = `${Math.floor(percent)}%`;
    }

    /**
     * Check if overlay is visible
     */
    isVisible() {
        return this.visible;
    }

    /**
     * Clean up
     */
    destroy() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}
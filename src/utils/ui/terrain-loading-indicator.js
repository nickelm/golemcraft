/**
 * TerrainLoadingIndicator - Subtle corner indicator for terrain streaming
 * 
 * Shows when the terrain worker is actively generating chunks.
 * Non-blocking - just informative feedback that streaming is happening.
 */
export class TerrainLoadingIndicator {
    constructor() {
        this.element = null;
        this.progressBar = null;
        this.text = null;
        this.visible = false;
        this.fadeTimeout = null;
        this.batchSize = 0;  // Track current batch of pending chunks
        
        this.createIndicator();
    }

    createIndicator() {
        // Create container
        this.element = document.createElement('div');
        this.element.id = 'terrain-loading-indicator';
        this.element.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.7);
            border-radius: 8px;
            padding: 10px 15px;
            display: none;
            align-items: center;
            gap: 10px;
            z-index: 1000;
            font-family: monospace;
            font-size: 12px;
            color: #888;
            transition: opacity 0.3s ease-out;
            pointer-events: none;
        `;

        // Spinner/icon
        const spinner = document.createElement('div');
        spinner.style.cssText = `
            width: 12px;
            height: 12px;
            border: 2px solid #444;
            border-top-color: #4ade80;
            border-radius: 50%;
            animation: terrain-spin 1s linear infinite;
        `;
        this.element.appendChild(spinner);

        // Add spinner animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes terrain-spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);

        // Text
        this.text = document.createElement('span');
        this.text.textContent = 'Loading terrain...';
        this.element.appendChild(this.text);

        // Mini progress bar
        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            width: 60px;
            height: 4px;
            background: #333;
            border-radius: 2px;
            overflow: hidden;
        `;

        this.progressBar = document.createElement('div');
        this.progressBar.style.cssText = `
            width: 0%;
            height: 100%;
            background: #4ade80;
            transition: width 0.2s ease-out;
        `;
        progressContainer.appendChild(this.progressBar);
        this.element.appendChild(progressContainer);

        document.body.appendChild(this.element);
    }

    /**
     * Update the indicator state
     * @param {number} pending - Number of pending chunks
     * @param {number} loaded - Number of loaded chunks
     * @param {number} total - Total chunks in load radius
     */
    update(pending, loaded, total) {
        const isWorking = pending > 0;

        if (isWorking) {
            this.show();
            
            // Track the batch size when streaming starts
            if (this.batchSize === 0 || pending > this.batchSize) {
                this.batchSize = pending;
            }
            
            // Progress is relative to current batch, not total world
            // As pending decreases from batchSize to 0, progress goes 0% to 100%
            const completed = this.batchSize - pending;
            const percent = this.batchSize > 0 ? (completed / this.batchSize) * 100 : 0;
            this.progressBar.style.width = `${percent}%`;
            
            // Update text
            this.text.textContent = `Streaming terrain... ${pending}`;
            
            // Clear any pending fade
            if (this.fadeTimeout) {
                clearTimeout(this.fadeTimeout);
                this.fadeTimeout = null;
            }
        } else {
            // Reset batch size when done
            this.batchSize = 0;
            
            // Fade out after a short delay when done
            if (this.visible && !this.fadeTimeout) {
                // Show 100% briefly before fading
                this.progressBar.style.width = '100%';
                this.text.textContent = 'Terrain loaded';
                
                this.fadeTimeout = setTimeout(() => {
                    this.hide();
                    this.fadeTimeout = null;
                }, 500);
            }
        }
    }

    show() {
        if (this.visible) return;
        this.visible = true;
        this.element.style.display = 'flex';
        this.element.style.opacity = '1';
    }

    hide() {
        if (!this.visible) return;
        this.element.style.opacity = '0';
        setTimeout(() => {
            this.visible = false;
            this.element.style.display = 'none';
        }, 300);
    }

    /**
     * Force hide immediately (for cleanup)
     */
    forceHide() {
        this.visible = false;
        this.element.style.display = 'none';
        if (this.fadeTimeout) {
            clearTimeout(this.fadeTimeout);
            this.fadeTimeout = null;
        }
    }

    destroy() {
        if (this.fadeTimeout) {
            clearTimeout(this.fadeTimeout);
        }
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}
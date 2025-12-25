// Simple FPS Counter
// Usage: 
// import { FPSCounter } from './fps-counter.js';
// const fpsCounter = new FPSCounter();
// // In your animate loop:
// fpsCounter.update();

export class FPSCounter {
    constructor() {
        this.frames = 0;
        this.lastTime = performance.now();
        this.fps = 0;
        this.element = this.createDisplay();
    }

    createDisplay() {
        const div = document.createElement('div');
        div.id = 'fps-counter';
        div.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: #0f0;
            font-family: monospace;
            font-size: 24px;
            padding: 10px 15px;
            border-radius: 5px;
            z-index: 1000;
        `;
        div.textContent = 'FPS: --';
        document.body.appendChild(div);
        return div;
    }

    update() {
        this.frames++;
        const currentTime = performance.now();
        const delta = currentTime - this.lastTime;

        // Update FPS display every 500ms
        if (delta >= 500) {
            this.fps = Math.round((this.frames * 1000) / delta);
            this.element.textContent = `FPS: ${this.fps}`;
            
            // Color code based on performance
            if (this.fps >= 50) {
                this.element.style.color = '#0f0'; // Green
            } else if (this.fps >= 30) {
                this.element.style.color = '#ff0'; // Yellow
            } else {
                this.element.style.color = '#f00'; // Red
            }

            this.frames = 0;
            this.lastTime = currentTime;
        }
    }

    getFPS() {
        return this.fps;
    }

    destroy() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}

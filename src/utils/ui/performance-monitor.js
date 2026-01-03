/**
 * PerformanceMonitor - Debugging display with worker stats
 * 
 * Shows:
 * - FPS and frame timing
 * - Render stats (draw calls, triangles)
 * - Chunk loading status
 * - Worker queue stats
 * - Memory usage
 */
export class PerformanceMonitor {
    constructor() {
        this.metrics = {
            fps: 60,
            frameTime: 0,
            deltaTime: 0,
            drawCalls: 0,
            triangles: 0,
            geometries: 0,
            textures: 0,
            programs: 0,
            memoryMB: 0,
            timestamp: performance.now(),
            // Game-specific metrics
            chunks: 0,
            pendingChunks: 0,
            mobs: 0,
            entities: 0,
            arrows: 0,
            // Worker metrics
            workerStats: null
        };

        this.history = {
            fps: [],
            frameTime: [],
            deltaTime: [],
            drawCalls: []
        };

        this.maxHistory = 60;
        this.frameCount = 0;

        this.createDisplay();
    }

    createDisplay() {
        const div = document.createElement('div');
        div.id = 'perf-monitor';
        div.style.cssText = `
            position: absolute;
            top: 60px;
            right: 10px;
            background: rgba(0, 0, 0, 0.85);
            color: #0f0;
            font-family: monospace;
            font-size: 11px;
            padding: 8px;
            border-radius: 5px;
            z-index: 1000;
            line-height: 1.4;
            min-width: 220px;
        `;
        document.body.appendChild(div);
        this.element = div;
    }

    update(renderer, gameStats = null) {
        this.frameCount++;
        const now = performance.now();
        const delta = now - this.metrics.timestamp;

        this.metrics.fps = Math.round(1000 / delta);
        this.metrics.frameTime = delta;

        if (gameStats?.deltaTime !== undefined) {
            this.metrics.deltaTime = gameStats.deltaTime * 1000;
        }

        const info = renderer.info;
        this.metrics.drawCalls = info.render.calls;
        this.metrics.triangles = info.render.triangles;
        this.metrics.geometries = info.memory.geometries;
        this.metrics.textures = info.memory.textures;
        this.metrics.programs = info.programs.length;

        if (gameStats) {
            this.metrics.chunks = gameStats.chunks || 0;
            this.metrics.pendingChunks = gameStats.pendingChunks || 0;
            this.metrics.mobs = gameStats.mobs || 0;
            this.metrics.entities = gameStats.entities || 0;
            this.metrics.arrows = gameStats.arrows || 0;
            this.metrics.workerStats = gameStats.workerStats || null;
        }

        if (performance.memory) {
            this.metrics.memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
        }

        this.history.fps.push(this.metrics.fps);
        this.history.frameTime.push(this.metrics.frameTime);
        this.history.deltaTime.push(this.metrics.deltaTime);
        this.history.drawCalls.push(this.metrics.drawCalls);

        if (this.history.fps.length > this.maxHistory) {
            this.history.fps.shift();
            this.history.frameTime.shift();
            this.history.deltaTime.shift();
            this.history.drawCalls.shift();
        }

        if (this.frameCount % 10 === 0) {
            this.render();
        }

        this.metrics.timestamp = now;
    }

    render() {
        const avgFps = Math.round(this.history.fps.reduce((a, b) => a + b, 0) / this.history.fps.length);
        const minFps = Math.min(...this.history.fps);
        const maxFrameTime = Math.max(...this.history.frameTime).toFixed(1);
        const avgDeltaTime = (this.history.deltaTime.reduce((a, b) => a + b, 0) / this.history.deltaTime.length).toFixed(1);

        const fpsColor = this.metrics.fps >= 50 ? '#0f0' : (this.metrics.fps >= 30 ? '#ff0' : '#f00');
        const deltaTimeColor = Math.abs(this.metrics.deltaTime - this.metrics.frameTime) > 5 ? '#ff0' : '#888';

        // Worker stats
        const ws = this.metrics.workerStats;
        const workerEnabled = ws?.workerEnabled ?? false;
        const workerStatus = workerEnabled ? '✓ Worker' : '✗ Sync';
        const workerColor = workerEnabled ? '#0f0' : '#ff0';

        const totalPending = workerEnabled 
            ? (ws.pendingCount + ws.processingCount) 
            : this.metrics.pendingChunks;
        const pendingColor = totalPending > 10 ? '#f00' : (totalPending > 5 ? '#ff0' : (totalPending > 0 ? '#888' : '#666'));

        let html = `
            <div style="color: ${fpsColor}; font-weight: bold;">FPS: ${this.metrics.fps} (avg: ${avgFps}, min: ${minFps})</div>
            <div>Frame: ${this.metrics.frameTime.toFixed(1)}ms (max: ${maxFrameTime}ms)</div>
            <div style="color: ${deltaTimeColor}">Delta: ${this.metrics.deltaTime.toFixed(1)}ms (avg: ${avgDeltaTime}ms)</div>
            <div style="margin-top: 4px; border-top: 1px solid #333; padding-top: 4px;"></div>
            <div>Draw calls: ${this.metrics.drawCalls}</div>
            <div>Triangles: ${(this.metrics.triangles / 1000).toFixed(1)}k</div>
            <div>Geometries: ${this.metrics.geometries}</div>
            <div style="margin-top: 4px; border-top: 1px solid #333; padding-top: 4px;"></div>
            <div>Chunks: ${this.metrics.chunks}</div>
            <div style="color: ${workerColor}; font-weight: bold;">${workerStatus}</div>
        `;

        if (workerEnabled && ws) {
            html += `
                <div>Queue: <span style="color: ${pendingColor}">${ws.pendingCount} pending</span></div>
                <div>Processing: ${ws.processingCount}</div>
                <div>Generated: ${ws.totalGenerated} <span style="color: #888">(${ws.totalCancelled} cancelled)</span></div>
                <div>Avg time: ${ws.avgGenTime}ms</div>
            `;
        } else {
            html += `<div>Queue: <span style="color: ${pendingColor}">${this.metrics.pendingChunks} pending</span></div>`;
        }

        html += `
            <div style="margin-top: 4px; border-top: 1px solid #333; padding-top: 4px;"></div>
            <div>Mobs: ${this.metrics.mobs}</div>
            <div>Entities: ${this.metrics.entities}</div>
            <div>Arrows: ${this.metrics.arrows}</div>
        `;

        if (this.metrics.memoryMB) {
            html += `<div style="margin-top: 4px; border-top: 1px solid #333; padding-top: 4px;">Memory: ${this.metrics.memoryMB} MB</div>`;
        }

        html += `<div style="margin-top: 4px; color: #666;">Frame #${this.frameCount}</div>`;

        this.element.innerHTML = html;
    }

    logSnapshot() {
        console.log('=== Performance Snapshot ===');
        console.log(`FPS: ${this.metrics.fps}`);
        console.log(`Chunks: ${this.metrics.chunks}`);
        if (this.metrics.workerStats?.workerEnabled) {
            const ws = this.metrics.workerStats;
            console.log(`Worker: pending=${ws.pendingCount}, processing=${ws.processingCount}`);
            console.log(`Worker: generated=${ws.totalGenerated}, avgTime=${ws.avgGenTime}ms`);
        }
        console.log('===========================');
    }

    destroy() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}
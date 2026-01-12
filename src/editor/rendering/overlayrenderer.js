/**
 * Template Editor - OverlayRenderer
 *
 * Renders vector overlays (rivers, spines, zones) on top of terrain tiles.
 * Listens to render events and draws overlays based on layer visibility.
 */

import { COLORS, EVENTS } from '../core/constants.js';
import { worldToCanvas, getVisibleWorldBounds, isWorldBoundsVisible } from '../utils/coordinates.js';
import { getZoneLevelColor } from '../../tools/mapvisualizer/colors.js';

export class OverlayRenderer {
    /**
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for communication
     */
    constructor(state, eventBus) {
        this.state = state;
        this.eventBus = eventBus;

        // Bind methods
        this._onRenderRequest = this._onRenderRequest.bind(this);

        // Subscribe to render events
        this.eventBus.on(EVENTS.RENDER_REQUEST, this._onRenderRequest);
    }

    /**
     * Handle render request from TileRenderer
     */
    _onRenderRequest({ width, height, ctx }) {
        const worldData = this.state.worldData;
        if (!worldData) return;

        // Render overlays in order
        if (this.state.isLayerVisible('spines')) {
            this._renderSpines(ctx, width, height, worldData.spines);
        }

        if (this.state.isLayerVisible('rivers')) {
            this._renderRivers(ctx, width, height, worldData.rivers);
        }

        if (this.state.isLayerVisible('zones')) {
            this._renderZones(ctx, width, height, worldData.zones);
        }

        // Roads placeholder
        if (this.state.isLayerVisible('roads')) {
            // TODO(design): Implement road rendering when road data is available
        }
    }

    // --- River Rendering ---

    _renderRivers(ctx, width, height, rivers) {
        if (!rivers || rivers.length === 0) return;

        const { viewX, viewZ, zoom } = this.state;
        const viewState = { viewX, viewZ, zoom };
        const viewBounds = getVisibleWorldBounds(viewState, width, height);

        for (const river of rivers) {
            const bounds = river.getBounds();
            if (!isWorldBoundsVisible(bounds, viewState, width, height)) continue;

            // Choose rendering method based on zoom
            if (zoom >= 0.5) {
                this._renderRiverPolygon(ctx, river, width, height);
            } else {
                this._renderRiverLine(ctx, river, width, height);
            }
        }
    }

    _renderRiverLine(ctx, river, width, height) {
        const path = river.path;
        if (path.length < 2) return;

        const { viewX, viewZ, zoom } = this.state;
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        ctx.beginPath();

        for (let i = 0; i < path.length; i++) {
            const p = path[i];
            const screenX = halfWidth + (p.x - viewX) * zoom;
            const screenY = halfHeight + (p.z - viewZ) * zoom;

            if (i === 0) {
                ctx.moveTo(screenX, screenY);
            } else {
                ctx.lineTo(screenX, screenY);
            }
        }

        const avgWidth = (river.getWidthAt(0) + river.getWidthAt(path.length - 1)) / 2;
        ctx.strokeStyle = COLORS.river;
        ctx.lineWidth = Math.max(1, avgWidth * zoom);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
    }

    _renderRiverPolygon(ctx, river, width, height) {
        const path = river.path;
        if (path.length < 2) return;

        const { viewX, viewZ, zoom } = this.state;
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        // Build left and right bank arrays
        const leftBank = [];
        const rightBank = [];

        for (let i = 0; i < path.length; i++) {
            const p = path[i];
            const riverWidth = river.getWidthAt(i);
            const normal = this._getRiverNormal(path, i);

            leftBank.push({
                x: p.x + normal.x * riverWidth / 2,
                z: p.z + normal.z * riverWidth / 2
            });
            rightBank.push({
                x: p.x - normal.x * riverWidth / 2,
                z: p.z - normal.z * riverWidth / 2
            });
        }

        // Draw filled polygon
        ctx.beginPath();

        for (let i = 0; i < leftBank.length; i++) {
            const p = leftBank[i];
            const screenX = halfWidth + (p.x - viewX) * zoom;
            const screenY = halfHeight + (p.z - viewZ) * zoom;

            if (i === 0) {
                ctx.moveTo(screenX, screenY);
            } else {
                ctx.lineTo(screenX, screenY);
            }
        }

        for (let i = rightBank.length - 1; i >= 0; i--) {
            const p = rightBank[i];
            const screenX = halfWidth + (p.x - viewX) * zoom;
            const screenY = halfHeight + (p.z - viewZ) * zoom;
            ctx.lineTo(screenX, screenY);
        }

        ctx.closePath();
        ctx.fillStyle = COLORS.river;
        ctx.fill();
    }

    _getRiverNormal(path, index) {
        let dx, dz;

        if (index === 0) {
            dx = path[1].x - path[0].x;
            dz = path[1].z - path[0].z;
        } else if (index === path.length - 1) {
            dx = path[index].x - path[index - 1].x;
            dz = path[index].z - path[index - 1].z;
        } else {
            dx = path[index + 1].x - path[index - 1].x;
            dz = path[index + 1].z - path[index - 1].z;
        }

        const len = Math.sqrt(dx * dx + dz * dz);
        if (len === 0) return { x: 0, z: 1 };

        return { x: -dz / len, z: dx / len };
    }

    // --- Spine Rendering ---

    _renderSpines(ctx, width, height, spines) {
        if (!spines || spines.length === 0) return;

        const { viewX, viewZ, zoom } = this.state;
        const viewState = { viewX, viewZ, zoom };

        for (const spine of spines) {
            const bounds = spine.getBounds();
            if (!isWorldBoundsVisible(bounds, viewState, width, height)) continue;

            this._renderSpinePath(ctx, spine, width, height);
        }
    }

    _renderSpinePath(ctx, spine, width, height) {
        const path = spine.path;
        if (path.length < 2) return;

        const { viewX, viewZ, zoom } = this.state;
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        const isPrimary = spine.properties.type === 'primary';

        ctx.beginPath();

        for (let i = 0; i < path.length; i++) {
            const p = path[i];
            const screenX = halfWidth + (p.x - viewX) * zoom;
            const screenY = halfHeight + (p.z - viewZ) * zoom;

            if (i === 0) {
                ctx.moveTo(screenX, screenY);
            } else {
                ctx.lineTo(screenX, screenY);
            }
        }

        if (isPrimary) {
            ctx.strokeStyle = COLORS.spinePrimary;
            ctx.lineWidth = Math.max(3, 6 * zoom);
        } else {
            ctx.strokeStyle = COLORS.spineSecondary;
            ctx.lineWidth = Math.max(2, 4 * zoom);
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Draw elevation markers when zoomed in
        if (zoom >= 1.0) {
            for (let i = 0; i < path.length; i++) {
                const p = path[i];
                const screenX = halfWidth + (p.x - viewX) * zoom;
                const screenY = halfHeight + (p.z - viewZ) * zoom;
                const radius = Math.max(2, p.elevation * 6 * zoom);

                ctx.beginPath();
                ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
                ctx.fillStyle = isPrimary ? '#FF3300' : '#FF8800';
                ctx.fill();
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        // Draw spine label when zoomed in
        if (zoom >= 0.5 && isPrimary && path.length > 0) {
            const centerIdx = Math.floor(path.length / 2);
            const centerPoint = path[centerIdx];
            const screenX = halfWidth + (centerPoint.x - viewX) * zoom;
            const screenY = halfHeight + (centerPoint.z - viewZ) * zoom;

            ctx.font = '12px sans-serif';
            ctx.fillStyle = '#FFF';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            const label = spine.properties.name || 'Spine';
            ctx.strokeText(label, screenX + 10, screenY - 10);
            ctx.fillText(label, screenX + 10, screenY - 10);
        }
    }

    // --- Zone Rendering ---

    _renderZones(ctx, width, height, zones) {
        if (!zones || zones.size === 0) return;

        const { viewX, viewZ, zoom } = this.state;
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        for (const [key, zone] of zones) {
            const screenX = halfWidth + (zone.center.x - viewX) * zoom;
            const screenY = halfHeight + (zone.center.z - viewZ) * zoom;
            const screenRadius = zone.radius * zoom;

            // Skip if off-screen
            if (screenX + screenRadius < 0 || screenX - screenRadius > width) continue;
            if (screenY + screenRadius < 0 || screenY - screenRadius > height) continue;

            const color = getZoneLevelColor(zone.levels);

            // Draw filled circle (20% opacity)
            ctx.beginPath();
            ctx.arc(screenX, screenY, screenRadius, 0, Math.PI * 2);
            ctx.fillStyle = color + '33';
            ctx.fill();

            // Draw border (67% opacity)
            ctx.strokeStyle = color + 'AA';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Draw labels if zoomed in
            if (zoom > 0.1) {
                this._renderZoneLabel(ctx, zone, screenX, screenY);
            }
        }
    }

    _renderZoneLabel(ctx, zone, screenX, screenY) {
        const { zoom } = this.state;
        const fontSize = Math.max(12, 14 * zoom);

        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.fillStyle = '#FFFFFF';

        ctx.strokeText(zone.name, screenX, screenY);
        ctx.fillText(zone.name, screenX, screenY);

        // Level range
        const levelText = `Lv ${zone.levels[0]}-${zone.levels[1]}`;
        const smallFontSize = Math.max(10, 12 * zoom);
        ctx.font = `${smallFontSize}px sans-serif`;

        const offsetY = 16 * Math.max(1, zoom);
        ctx.strokeText(levelText, screenX, screenY + offsetY);
        ctx.fillText(levelText, screenX, screenY + offsetY);
    }

    /**
     * Clean up event subscriptions
     */
    destroy() {
        this.eventBus.off(EVENTS.RENDER_REQUEST, this._onRenderRequest);
    }
}

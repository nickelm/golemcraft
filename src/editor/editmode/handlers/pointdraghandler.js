/**
 * PointDragHandler - Tool for selecting and dragging spine points
 *
 * Used in all stages for manipulating existing points.
 * Features:
 * - Click to select point
 * - Drag to move point
 * - Delete key to remove selected point
 * - Hover highlighting
 */

import { BaseToolHandler } from './basetoolhandler.js';
import { COLORS } from '../../core/constants.js';

// Hit testing and rendering
const HIT_RADIUS_PIXELS = 15;
const POINT_RADIUS = 8;
const POINT_SELECTED_RADIUS = 10;
const POINT_HOVER_RADIUS = 12;

export class PointDragHandler extends BaseToolHandler {
    constructor(canvas, state, eventBus) {
        super(canvas, state, eventBus);

        /** @type {{type: string, index: number, spineIndex?: number}|null} */
        this.hoveredPoint = null;

        /** @type {{type: string, index: number, spineIndex?: number}|null} */
        this.selectedPoint = null;

        /** @type {boolean} */
        this.isDragging = false;

        /** @type {{x: number, z: number}|null} Offset from point center when dragging */
        this.dragOffset = null;
    }

    onActivate() {
        this.hoveredPoint = null;
        this.selectedPoint = null;
        this.isDragging = false;
        console.log('PointDragHandler activated');
    }

    onDeactivate() {
        this.isDragging = false;
        this.selectedPoint = null;
        this.hoveredPoint = null;
    }

    onMouseDown(e) {
        const normalized = this._mouseToNormalized(e);
        const hit = this._hitTest(normalized);

        if (hit) {
            // Select the point
            this.selectedPoint = hit;
            this.state.setSelectedFeature(hit);
            this.state.setSelectedPointIndex(hit.index);

            // Start dragging
            this.isDragging = true;
            const pointPos = this._getPointPosition(hit);
            this.dragOffset = {
                x: normalized.x - pointPos.x,
                z: normalized.z - pointPos.z
            };

            this.eventBus.emit('render:schedule');
        } else {
            // Deselect
            this.selectedPoint = null;
            this.state.setSelectedFeature(null);
            this.state.setSelectedPointIndex(-1);
            this.eventBus.emit('render:schedule');
        }
    }

    onMouseMove(e) {
        const normalized = this._mouseToNormalized(e);

        if (this.isDragging && this.selectedPoint) {
            // Move the point
            const newPos = {
                x: Math.max(0, Math.min(1, normalized.x - this.dragOffset.x)),
                z: Math.max(0, Math.min(1, normalized.z - this.dragOffset.z))
            };

            this._setPointPosition(this.selectedPoint, newPos);
            this._markModified('drag');
        } else {
            // Update hover state
            const hit = this._hitTest(normalized);
            const prevHovered = this.hoveredPoint;
            this.hoveredPoint = hit;
            this.state.setHoveredPointIndex(hit ? hit.index : -1);

            if (hit !== prevHovered) {
                this.eventBus.emit('render:schedule');
            }
        }
    }

    onMouseUp(e) {
        if (this.isDragging) {
            this.isDragging = false;
            this.dragOffset = null;
            this._pushHistory();
        }
    }

    onKeyDown(e) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.selectedPoint) {
                this._deleteSelectedPoint();
                return true;
            }
        }

        return false;
    }

    /**
     * Hit test against all points
     * @private
     * @returns {{type: string, index: number, spineIndex?: number}|null}
     */
    _hitTest(normalized) {
        const editData = this._getEditData();
        if (!editData) return null;

        // Calculate hit radius in normalized space based on screen pixels
        const screenHitRadius = HIT_RADIUS_PIXELS;
        // Approximate conversion (will be more accurate when we hit test in screen space)

        // Test primary spine points
        const primarySpine = editData.stage1.spine;
        for (let i = 0; i < primarySpine.points.length; i++) {
            const point = primarySpine.points[i];
            const screenDist = this._screenDistanceToNormalized(normalized, point);
            if (screenDist < screenHitRadius) {
                return { type: 'primarySpine', index: i };
            }
        }

        // Test secondary spine points
        for (let si = 0; si < editData.stage2.secondarySpines.length; si++) {
            const spine = editData.stage2.secondarySpines[si];
            for (let pi = 0; pi < spine.points.length; pi++) {
                const point = spine.points[pi];
                const screenDist = this._screenDistanceToNormalized(normalized, point);
                if (screenDist < screenHitRadius) {
                    return { type: 'secondarySpine', index: pi, spineIndex: si };
                }
            }
        }

        // Test hills (Stage 2)
        for (let i = 0; i < editData.stage2.hills.length; i++) {
            const hill = editData.stage2.hills[i];
            const screenDist = this._screenDistanceToNormalized(normalized, hill);
            if (screenDist < screenHitRadius) {
                return { type: 'hill', index: i };
            }
        }

        // Test depressions (Stage 2)
        for (let i = 0; i < editData.stage2.depressions.length; i++) {
            const dep = editData.stage2.depressions[i];
            const screenDist = this._screenDistanceToNormalized(normalized, dep);
            if (screenDist < screenHitRadius) {
                return { type: 'depression', index: i };
            }
        }

        // Test water sources (Stage 3)
        for (let i = 0; i < editData.stage3.waterSources.length; i++) {
            const source = editData.stage3.waterSources[i];
            const screenDist = this._screenDistanceToNormalized(normalized, source);
            if (screenDist < screenHitRadius) {
                return { type: 'waterSource', index: i };
            }
        }

        // Test lake regions (Stage 3)
        for (let i = 0; i < editData.stage3.lakeRegions.length; i++) {
            const lake = editData.stage3.lakeRegions[i];
            const center = lake.center || lake;
            const screenDist = this._screenDistanceToNormalized(normalized, center);
            if (screenDist < screenHitRadius) {
                return { type: 'lakeRegion', index: i };
            }
        }

        return null;
    }

    /**
     * Calculate screen distance between normalized position and a point
     * @private
     */
    _screenDistanceToNormalized(pos, point) {
        const posScreen = this._normalizedToCanvas(pos);
        const pointScreen = this._normalizedToCanvas(point);
        const dx = posScreen.x - pointScreen.x;
        const dy = posScreen.y - pointScreen.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Get the position of a point by its hit reference
     * @private
     */
    _getPointPosition(hit) {
        const editData = this._getEditData();
        if (!editData) return { x: 0, z: 0 };

        switch (hit.type) {
            case 'primarySpine':
                return editData.stage1.spine.points[hit.index];
            case 'secondarySpine':
                return editData.stage2.secondarySpines[hit.spineIndex].points[hit.index];
            case 'hill':
                return editData.stage2.hills[hit.index];
            case 'depression':
                return editData.stage2.depressions[hit.index];
            case 'waterSource':
                return editData.stage3.waterSources[hit.index];
            case 'lakeRegion':
                const lake = editData.stage3.lakeRegions[hit.index];
                return lake.center || lake;
            default:
                return { x: 0, z: 0 };
        }
    }

    /**
     * Set the position of a point by its hit reference
     * @private
     */
    _setPointPosition(hit, pos) {
        const editData = this._getEditData();
        if (!editData) return;

        switch (hit.type) {
            case 'primarySpine':
                editData.stage1.spine.points[hit.index] = { x: pos.x, z: pos.z };
                break;
            case 'secondarySpine':
                editData.stage2.secondarySpines[hit.spineIndex].points[hit.index] = { x: pos.x, z: pos.z };
                break;
            case 'hill':
                editData.stage2.hills[hit.index].x = pos.x;
                editData.stage2.hills[hit.index].z = pos.z;
                break;
            case 'depression':
                editData.stage2.depressions[hit.index].x = pos.x;
                editData.stage2.depressions[hit.index].z = pos.z;
                break;
            case 'waterSource':
                editData.stage3.waterSources[hit.index].x = pos.x;
                editData.stage3.waterSources[hit.index].z = pos.z;
                break;
            case 'lakeRegion':
                if (editData.stage3.lakeRegions[hit.index].center) {
                    editData.stage3.lakeRegions[hit.index].center = { x: pos.x, z: pos.z };
                } else {
                    editData.stage3.lakeRegions[hit.index].x = pos.x;
                    editData.stage3.lakeRegions[hit.index].z = pos.z;
                }
                break;
        }
    }

    /**
     * Delete the currently selected point
     * @private
     */
    _deleteSelectedPoint() {
        const editData = this._getEditData();
        if (!editData || !this.selectedPoint) return;

        const hit = this.selectedPoint;

        switch (hit.type) {
            case 'primarySpine':
                editData.stage1.spine.points.splice(hit.index, 1);
                break;
            case 'secondarySpine':
                const spine = editData.stage2.secondarySpines[hit.spineIndex];
                spine.points.splice(hit.index, 1);
                // Remove spine if no points left
                if (spine.points.length === 0) {
                    editData.stage2.secondarySpines.splice(hit.spineIndex, 1);
                }
                break;
            case 'hill':
                editData.stage2.hills.splice(hit.index, 1);
                break;
            case 'depression':
                editData.stage2.depressions.splice(hit.index, 1);
                break;
            case 'waterSource':
                editData.stage3.waterSources.splice(hit.index, 1);
                break;
            case 'lakeRegion':
                editData.stage3.lakeRegions.splice(hit.index, 1);
                break;
        }

        console.log(`PointDragHandler: Deleted ${hit.type} at index ${hit.index}`);

        this.selectedPoint = null;
        this.state.setSelectedFeature(null);
        this.state.setSelectedPointIndex(-1);

        this._markModified('delete');
        this._pushHistory();
    }

    /**
     * Render the selection overlay
     */
    render(ctx, width, height) {
        const editData = this._getEditData();
        if (!editData) return;

        // Render all points with hover/selection states
        this._renderSpinePoints(ctx, editData.stage1.spine.points, 'primarySpine', null);

        for (let si = 0; si < editData.stage2.secondarySpines.length; si++) {
            const spine = editData.stage2.secondarySpines[si];
            this._renderSpinePoints(ctx, spine.points, 'secondarySpine', si);
        }

        // Render hills
        for (let i = 0; i < editData.stage2.hills.length; i++) {
            this._renderFeaturePoint(ctx, editData.stage2.hills[i], 'hill', i, '#00FF00');
        }

        // Render depressions
        for (let i = 0; i < editData.stage2.depressions.length; i++) {
            this._renderFeaturePoint(ctx, editData.stage2.depressions[i], 'depression', i, '#FF0000');
        }

        // Render water sources
        for (let i = 0; i < editData.stage3.waterSources.length; i++) {
            this._renderFeaturePoint(ctx, editData.stage3.waterSources[i], 'waterSource', i, '#00BFFF');
        }

        // Render lake regions
        for (let i = 0; i < editData.stage3.lakeRegions.length; i++) {
            const lake = editData.stage3.lakeRegions[i];
            const center = lake.center || lake;
            this._renderFeaturePoint(ctx, center, 'lakeRegion', i, '#1E90FF');
        }
    }

    /**
     * Render spine points with selection/hover states
     * @private
     */
    _renderSpinePoints(ctx, points, type, spineIndex) {
        const isPrimary = (type === 'primarySpine');
        const baseColor = isPrimary ? COLORS.spinePrimary : COLORS.spineSecondary;

        // Draw connecting lines first
        if (points.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = baseColor;
            ctx.lineWidth = isPrimary ? 3 : 2;

            for (let i = 0; i < points.length; i++) {
                const screen = this._normalizedToCanvas(points[i]);
                if (i === 0) {
                    ctx.moveTo(screen.x, screen.y);
                } else {
                    ctx.lineTo(screen.x, screen.y);
                }
            }
            ctx.stroke();
        }

        // Draw points
        for (let i = 0; i < points.length; i++) {
            const isHovered = this._isPointHovered(type, i, spineIndex);
            const isSelected = this._isPointSelected(type, i, spineIndex);

            let radius = POINT_RADIUS;
            if (isSelected) radius = POINT_SELECTED_RADIUS;
            else if (isHovered) radius = POINT_HOVER_RADIUS;

            const screen = this._normalizedToCanvas(points[i]);

            // Selection ring
            if (isSelected) {
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
                ctx.strokeStyle = '#FFF';
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            // Hover ring
            if (isHovered && !isSelected) {
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, radius + 2, 0, Math.PI * 2);
                ctx.strokeStyle = '#FFF';
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.7;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // Point fill
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = baseColor;
            ctx.fill();

            // Center dot
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#FFF';
            ctx.fill();
        }
    }

    /**
     * Render a generic feature point
     * @private
     */
    _renderFeaturePoint(ctx, point, type, index, color) {
        const isHovered = this._isPointHovered(type, index, null);
        const isSelected = this._isPointSelected(type, index, null);

        let radius = POINT_RADIUS;
        if (isSelected) radius = POINT_SELECTED_RADIUS;
        else if (isHovered) radius = POINT_HOVER_RADIUS;

        const screen = this._normalizedToCanvas(point);

        // Selection ring
        if (isSelected) {
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
            ctx.strokeStyle = '#FFF';
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        // Hover ring
        if (isHovered && !isSelected) {
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, radius + 2, 0, Math.PI * 2);
            ctx.strokeStyle = '#FFF';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.7;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Point fill
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Border
        ctx.strokeStyle = '#FFF';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    _isPointHovered(type, index, spineIndex) {
        if (!this.hoveredPoint) return false;
        return this.hoveredPoint.type === type &&
               this.hoveredPoint.index === index &&
               this.hoveredPoint.spineIndex === spineIndex;
    }

    _isPointSelected(type, index, spineIndex) {
        if (!this.selectedPoint) return false;
        return this.selectedPoint.type === type &&
               this.selectedPoint.index === index &&
               this.selectedPoint.spineIndex === spineIndex;
    }
}

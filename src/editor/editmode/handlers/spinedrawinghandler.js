/**
 * SpineDrawingHandler - Tool for drawing polyline spines
 *
 * Used in Stage 1 (primary spine) and Stage 2 (secondary spines).
 * Features:
 * - Click to add points
 * - Double-click or Enter to finish
 * - Escape to cancel
 * - Backspace to remove last point
 * - Preview line to cursor while drawing
 */

import { BaseToolHandler } from './basetoolhandler.js';
import { COLORS } from '../../core/constants.js';

// Point radius for rendering
const POINT_RADIUS = 8;
const POINT_HOVER_RADIUS = 10;

// Double-click detection
const DOUBLE_CLICK_TIME = 300; // ms
const DOUBLE_CLICK_DISTANCE = 0.02; // normalized

export class SpineDrawingHandler extends BaseToolHandler {
    constructor(canvas, state, eventBus) {
        super(canvas, state, eventBus);

        /** @type {Array<{x: number, z: number}>} Points being drawn */
        this.currentPoints = [];

        /** @type {{x: number, z: number}|null} Preview point at cursor */
        this.previewPoint = null;

        /** @type {boolean} Whether we're actively drawing */
        this.isDrawing = false;

        /** @type {boolean} True = primary spine (Stage 1), false = secondary (Stage 2) */
        this.isPrimary = true;

        /** @type {number} Timestamp of last click for double-click detection */
        this._lastClickTime = 0;

        /** @type {{x: number, z: number}|null} Position of last click */
        this._lastClickPos = null;
    }

    onActivate() {
        this.currentPoints = [];
        this.previewPoint = null;
        this.isDrawing = false;

        // Determine if we're drawing primary or secondary spine based on stage
        this.isPrimary = (this.state.editStage === 1);

        console.log(`SpineDrawingHandler activated (${this.isPrimary ? 'primary' : 'secondary'} spine)`);
    }

    onDeactivate() {
        // If we have points but haven't finished, cancel
        if (this.isDrawing && this.currentPoints.length > 0) {
            this._cancelDrawing();
        }
        this.previewPoint = null;
    }

    onMouseDown(e) {
        const normalized = this._mouseToNormalized(e);

        // Check for double-click to finish
        const now = Date.now();
        if (this._lastClickPos && this._lastClickTime) {
            const timeDelta = now - this._lastClickTime;
            const dist = this._normalizedDistance(normalized, this._lastClickPos);

            if (timeDelta < DOUBLE_CLICK_TIME && dist < DOUBLE_CLICK_DISTANCE) {
                if (this.currentPoints.length >= 2) {
                    this._finishDrawing();
                    return;
                }
            }
        }

        this._lastClickTime = now;
        this._lastClickPos = { ...normalized };

        // Add point
        this.currentPoints.push({ x: normalized.x, z: normalized.z });
        this.isDrawing = true;

        this.eventBus.emit('render:schedule');
    }

    onMouseMove(e) {
        // Update preview point
        this.previewPoint = this._mouseToNormalized(e);
        this.eventBus.emit('render:schedule');
    }

    onRightClick(e) {
        // Right-click finishes drawing if we have enough points, otherwise cancels
        if (this.isDrawing) {
            if (this.currentPoints.length >= 2) {
                this._finishDrawing();
            } else {
                this._cancelDrawing();
            }
        }
    }

    onKeyDown(e) {
        switch (e.key) {
            case 'Enter':
                if (this.currentPoints.length >= 2) {
                    this._finishDrawing();
                    return true;
                }
                break;

            case 'Escape':
                this._cancelDrawing();
                return true;

            case 'Backspace':
                if (this.currentPoints.length > 0) {
                    this.currentPoints.pop();
                    if (this.currentPoints.length === 0) {
                        this.isDrawing = false;
                    }
                    this.eventBus.emit('render:schedule');
                    return true;
                }
                break;
        }

        return false;
    }

    /**
     * Finish drawing and save the spine to edit data
     * @private
     */
    _finishDrawing() {
        if (this.currentPoints.length < 2) {
            console.log('SpineDrawingHandler: Need at least 2 points');
            return;
        }

        const editData = this._getEditData();
        if (!editData) {
            console.error('SpineDrawingHandler: No edit data available');
            return;
        }

        const spineData = {
            points: this.currentPoints.map(p => ({ x: p.x, z: p.z })),
            elevation: this.isPrimary
                ? editData.stage1.spine.elevation
                : 0.6 // Default secondary spine elevation
        };

        if (this.isPrimary) {
            // Replace primary spine
            editData.stage1.spine.points = spineData.points;
            console.log(`SpineDrawingHandler: Primary spine set with ${spineData.points.length} points`);
        } else {
            // Add secondary spine
            editData.stage2.secondarySpines.push(spineData);
            console.log(`SpineDrawingHandler: Added secondary spine (${editData.stage2.secondarySpines.length} total)`);
        }

        // Clear drawing state
        this.currentPoints = [];
        this.isDrawing = false;
        this.previewPoint = null;

        // Notify changes
        this._markModified('spine-draw');
        this._pushHistory();
    }

    /**
     * Cancel current drawing without saving
     * @private
     */
    _cancelDrawing() {
        this.currentPoints = [];
        this.isDrawing = false;
        this.previewPoint = null;
        console.log('SpineDrawingHandler: Drawing cancelled');
        this.eventBus.emit('render:schedule');
    }

    /**
     * Render the drawing overlay
     */
    render(ctx, width, height) {
        // Get edit data to show existing spines
        const editData = this._getEditData();

        // Render existing spine points (for reference)
        if (editData) {
            this._renderExistingSpine(ctx, editData.stage1.spine, true);

            for (const spine of editData.stage2.secondarySpines) {
                this._renderExistingSpine(ctx, spine, false);
            }
        }

        // Render current drawing
        if (this.currentPoints.length > 0) {
            this._renderCurrentDrawing(ctx);
        }
    }

    /**
     * Render an existing spine (semi-transparent for reference)
     * @private
     */
    _renderExistingSpine(ctx, spine, isPrimary) {
        if (!spine.points || spine.points.length === 0) return;

        const color = isPrimary ? COLORS.spinePrimary : COLORS.spineSecondary;

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = isPrimary ? 4 : 3;
        ctx.globalAlpha = 0.4;

        for (let i = 0; i < spine.points.length; i++) {
            const screen = this._normalizedToCanvas(spine.points[i]);
            if (i === 0) {
                ctx.moveTo(screen.x, screen.y);
            } else {
                ctx.lineTo(screen.x, screen.y);
            }
        }
        ctx.stroke();

        // Draw arrowhead at the end for primary spine (shows direction)
        if (isPrimary && spine.points.length >= 2) {
            this._drawArrowhead(ctx, spine.points, color);
        }

        // Draw points
        for (let i = 0; i < spine.points.length; i++) {
            const screen = this._normalizedToCanvas(spine.points[i]);
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, POINT_RADIUS - 2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        }

        ctx.globalAlpha = 1.0;
    }

    /**
     * Draw an arrowhead at the end of the spine
     * @private
     */
    _drawArrowhead(ctx, points, color) {
        const lastIdx = points.length - 1;
        const p1 = this._normalizedToCanvas(points[lastIdx - 1]);
        const p2 = this._normalizedToCanvas(points[lastIdx]);

        // Calculate direction angle
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        // Arrowhead size
        const headLen = 15;
        const headAngle = Math.PI / 6; // 30 degrees

        ctx.beginPath();
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(
            p2.x - headLen * Math.cos(angle - headAngle),
            p2.y - headLen * Math.sin(angle - headAngle)
        );
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(
            p2.x - headLen * Math.cos(angle + headAngle),
            p2.y - headLen * Math.sin(angle + headAngle)
        );
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    /**
     * Render the current drawing in progress
     * @private
     */
    _renderCurrentDrawing(ctx) {
        const color = this.isPrimary ? COLORS.spinePrimary : COLORS.spineSecondary;

        // Draw line connecting points
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = this.isPrimary ? 4 : 3;

        for (let i = 0; i < this.currentPoints.length; i++) {
            const screen = this._normalizedToCanvas(this.currentPoints[i]);
            if (i === 0) {
                ctx.moveTo(screen.x, screen.y);
            } else {
                ctx.lineTo(screen.x, screen.y);
            }
        }

        // Draw preview line to cursor
        if (this.previewPoint && this.currentPoints.length > 0) {
            const preview = this._normalizedToCanvas(this.previewPoint);
            ctx.lineTo(preview.x, preview.y);
            ctx.setLineDash([8, 8]);
        }

        ctx.stroke();
        ctx.setLineDash([]);

        // Draw points
        for (let i = 0; i < this.currentPoints.length; i++) {
            const screen = this._normalizedToCanvas(this.currentPoints[i]);

            // Outer ring
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, POINT_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();

            // Inner dot
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#FFF';
            ctx.fill();

            // Point number label
            ctx.fillStyle = '#FFF';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((i + 1).toString(), screen.x, screen.y + POINT_RADIUS + 10);
        }

        // Draw instructions
        this._renderInstructions(ctx);
    }

    /**
     * Render drawing instructions overlay
     * @private
     */
    _renderInstructions(ctx) {
        const instructions = this.currentPoints.length < 2
            ? 'Click to add points (min 2 required)'
            : 'Right-click or Enter to finish, Esc to cancel';

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, 10, ctx.measureText(instructions).width + 20, 30);

        ctx.fillStyle = '#FFF';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(instructions, 20, 25);
    }
}

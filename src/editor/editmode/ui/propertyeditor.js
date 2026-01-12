/**
 * PropertyEditor - UI component for editing stage-specific properties
 *
 * Dynamically renders property controls based on the current stage:
 * - Stage 1: Spine elevation, land extent
 * - Stage 2: Brush settings, selected feature properties
 * - Stage 3: River density, meandering
 * - Stage 4: Climate gradient, humidity, biome exclusions
 */

import { EVENTS, COLORS } from '../../core/constants.js';

export class PropertyEditor {
    /**
     * @param {HTMLElement} container - Container element for the editor
     * @param {EditorState} state - Editor state instance
     * @param {EventBus} eventBus - Event bus for notifications
     */
    constructor(container, state, eventBus) {
        this.container = container;
        this.state = state;
        this.eventBus = eventBus;

        this.element = null;

        this._createPanel();
        this._setupEventListeners();
    }

    _createPanel() {
        this.element = document.createElement('div');
        this.element.className = 'property-editor';
        this._applyStyles();
        this._renderForStage(this.state.editStage);
        this.container.appendChild(this.element);
    }

    _applyStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .property-editor {
                background: ${COLORS.panelBackground};
                border: 1px solid ${COLORS.panelBorder};
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 12px;
            }

            .property-editor h4 {
                margin: 0 0 12px 0;
                color: ${COLORS.text};
                font-size: 13px;
            }

            .property-group {
                margin-bottom: 16px;
            }

            .property-group:last-child {
                margin-bottom: 0;
            }

            .property-group label {
                display: block;
                color: ${COLORS.textMuted};
                font-size: 11px;
                margin-bottom: 4px;
            }

            .property-row {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 8px;
            }

            .property-row input[type="range"] {
                flex: 1;
                height: 4px;
                -webkit-appearance: none;
                background: ${COLORS.panelBorder};
                border-radius: 2px;
                outline: none;
            }

            .property-row input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 14px;
                height: 14px;
                background: ${COLORS.accent};
                border-radius: 50%;
                cursor: pointer;
            }

            .property-row .value-display {
                min-width: 40px;
                text-align: right;
                color: ${COLORS.text};
                font-size: 12px;
                font-family: monospace;
            }

            .property-checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 6px;
            }

            .property-checkbox input[type="checkbox"] {
                width: 16px;
                height: 16px;
                accent-color: ${COLORS.accent};
            }

            .property-checkbox span {
                color: ${COLORS.text};
                font-size: 12px;
            }

            .property-info {
                color: ${COLORS.textMuted};
                font-size: 11px;
                font-style: italic;
                margin-top: 8px;
            }

            .gradient-widget {
                width: 100%;
                height: 80px;
                background: linear-gradient(to right, #4a9eff, #ff6b4a);
                border-radius: 4px;
                position: relative;
                cursor: crosshair;
                margin-bottom: 8px;
            }

            .gradient-arrow {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 60px;
                height: 4px;
                background: white;
                transform-origin: center;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            }

            .gradient-arrow::after {
                content: '';
                position: absolute;
                right: -8px;
                top: -6px;
                border: 8px solid transparent;
                border-left: 12px solid white;
            }

            .spine-chip-container {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin-top: 4px;
            }

            .spine-chip {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: rgba(255, 102, 0, 0.2);
                border: 1px solid ${COLORS.spinePrimary};
                border-radius: 16px;
                padding: 4px 8px 4px 12px;
                font-size: 11px;
                color: ${COLORS.text};
                cursor: pointer;
                transition: all 0.15s ease;
            }

            .spine-chip:hover {
                background: rgba(255, 102, 0, 0.3);
            }

            .spine-chip-label {
                white-space: nowrap;
            }

            .spine-chip-delete {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 18px;
                height: 18px;
                background: transparent;
                border: none;
                border-radius: 50%;
                color: ${COLORS.textMuted};
                font-size: 14px;
                cursor: pointer;
                transition: all 0.15s ease;
            }

            .spine-chip-delete:hover {
                background: rgba(255, 100, 100, 0.3);
                color: #ff6666;
            }
        `;
        document.head.appendChild(style);
    }

    _renderForStage(stage) {
        switch (stage) {
            case 1:
                this._renderStage1();
                break;
            case 2:
                this._renderStage2();
                break;
            case 3:
                this._renderStage3();
                break;
            case 4:
                this._renderStage4();
                break;
        }
    }

    _renderStage1() {
        const editData = this.state.editData;
        if (!editData) return;

        const hasSpine = editData.stage1.spine.points.length >= 2;

        // Initialize left/right from inner/outer if not set
        if (editData.stage1.landExtent.left === undefined) {
            editData.stage1.landExtent.left = editData.stage1.landExtent.inner;
        }
        if (editData.stage1.landExtent.right === undefined) {
            editData.stage1.landExtent.right = editData.stage1.landExtent.outer;
        }

        this.element.innerHTML = `
            <h4>Primary Spine</h4>

            <div class="property-group">
                <label>Drawn Spine</label>
                <div class="spine-chip-container">
                    ${hasSpine ? `
                        <div class="spine-chip" data-spine-index="0">
                            <span class="spine-chip-label">Spine (${editData.stage1.spine.points.length} pts)</span>
                            <button class="spine-chip-delete" data-spine-index="0" title="Delete spine">×</button>
                        </div>
                    ` : `
                        <p class="property-info" style="margin: 0;">Draw a spine to define the mountain ridge</p>
                    `}
                </div>
            </div>

            ${hasSpine ? `
            <div class="property-group">
                <label>Peak Elevation</label>
                <div class="property-row">
                    <input type="range" id="spine-elevation"
                           min="0.3" max="1.0" step="0.05"
                           value="${editData.stage1.spine.elevation}">
                    <span class="value-display">${editData.stage1.spine.elevation.toFixed(2)}</span>
                </div>
            </div>

            <div class="property-group">
                <label>Left Land Extent</label>
                <div class="property-row">
                    <input type="range" id="land-extent-left"
                           min="0.05" max="0.40" step="0.01"
                           value="${editData.stage1.landExtent.left}">
                    <span class="value-display">${editData.stage1.landExtent.left.toFixed(2)}</span>
                </div>
                <span style="color: ${COLORS.textMuted}; font-size: 10px;">Looking along spine direction</span>
            </div>

            <div class="property-group">
                <label>Right Land Extent</label>
                <div class="property-row">
                    <input type="range" id="land-extent-right"
                           min="0.05" max="0.40" step="0.01"
                           value="${editData.stage1.landExtent.right}">
                    <span class="value-display">${editData.stage1.landExtent.right.toFixed(2)}</span>
                </div>
            </div>
            ` : ''}
        `;

        // Bind spine chip delete button
        const deleteBtn = this.element.querySelector('.spine-chip-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._deletePrimarySpine();
            });
        }

        // Bind spine chip hover for highlighting
        const spineChip = this.element.querySelector('.spine-chip');
        if (spineChip) {
            spineChip.addEventListener('mouseenter', () => {
                this.state.setHoveredPointIndex(0);
                this.eventBus.emit(EVENTS.RENDER_SCHEDULE);
            });
            spineChip.addEventListener('mouseleave', () => {
                this.state.setHoveredPointIndex(-1);
                this.eventBus.emit(EVENTS.RENDER_SCHEDULE);
            });
        }

        if (hasSpine) {
            this._bindSlider('spine-elevation', (value) => {
                editData.stage1.spine.elevation = value;
            });

            this._bindSlider('land-extent-left', (value) => {
                editData.stage1.landExtent.left = value;
                editData.stage1.landExtent.inner = value; // backwards compat
            });

            this._bindSlider('land-extent-right', (value) => {
                editData.stage1.landExtent.right = value;
                editData.stage1.landExtent.outer = value; // backwards compat
            });
        }
    }

    _deletePrimarySpine() {
        const editData = this.state.editData;
        if (!editData) return;

        // Clear the primary spine
        editData.stage1.spine.points = [];

        this.state.markEditDataModified('spine-delete');
        this.eventBus.emit(EVENTS.HISTORY_PUSH);
    }

    _renderStage2() {
        const editData = this.state.editData;
        if (!editData) return;

        this.element.innerHTML = `
            <h4>Secondary Terrain Properties</h4>

            <div class="property-group">
                <label>Secondary Spines</label>
                <p class="property-info">
                    ${editData.stage2.secondarySpines.length} spine(s)
                </p>
            </div>

            <div class="property-group">
                <label>Hills</label>
                <p class="property-info">
                    ${editData.stage2.hills.length} hill region(s)
                </p>
            </div>

            <div class="property-group">
                <label>Depressions</label>
                <p class="property-info">
                    ${editData.stage2.depressions.length} depression(s)
                </p>
            </div>

            <p class="property-info">
                Use the tools above to add secondary ridges, hills, and depressions.
            </p>
        `;
    }

    _renderStage3() {
        const editData = this.state.editData;
        if (!editData) return;

        this.element.innerHTML = `
            <h4>Hydrology Properties</h4>

            <div class="property-group">
                <label>River Density</label>
                <div class="property-row">
                    <input type="range" id="river-density"
                           min="0" max="1" step="0.1"
                           value="${editData.stage3.riverDensity}">
                    <span class="value-display">${editData.stage3.riverDensity.toFixed(1)}</span>
                </div>
            </div>

            <div class="property-group">
                <label>River Meandering</label>
                <div class="property-row">
                    <input type="range" id="river-meandering"
                           min="0" max="1" step="0.1"
                           value="${editData.stage3.riverMeandering}">
                    <span class="value-display">${editData.stage3.riverMeandering.toFixed(1)}</span>
                </div>
            </div>

            <p class="property-info">
                Water sources: ${editData.stage3.waterSources.length}<br>
                Lake regions: ${editData.stage3.lakeRegions.length}
            </p>
        `;

        this._bindSlider('river-density', (value) => {
            editData.stage3.riverDensity = value;
        });

        this._bindSlider('river-meandering', (value) => {
            editData.stage3.riverMeandering = value;
        });
    }

    _renderStage4() {
        const editData = this.state.editData;
        if (!editData) return;

        const gradient = editData.stage4.temperatureGradient;
        const angle = Math.atan2(gradient.direction.z, gradient.direction.x) * (180 / Math.PI);

        this.element.innerHTML = `
            <h4>Climate Properties</h4>

            <div class="property-group">
                <label>Temperature Gradient Direction</label>
                <div class="gradient-widget" id="gradient-widget">
                    <div class="gradient-arrow" id="gradient-arrow"
                         style="transform: translate(-50%, -50%) rotate(${angle}deg)"></div>
                </div>
                <div class="property-row">
                    <span style="color: ${COLORS.textMuted}; font-size: 11px;">
                        Click and drag to set direction (cold → hot)
                    </span>
                </div>
            </div>

            <div class="property-group">
                <label>Gradient Strength</label>
                <div class="property-row">
                    <input type="range" id="gradient-strength"
                           min="0" max="1" step="0.1"
                           value="${gradient.strength}">
                    <span class="value-display">${gradient.strength.toFixed(1)}</span>
                </div>
            </div>

            <div class="property-group">
                <label>Base Humidity</label>
                <div class="property-row">
                    <input type="range" id="base-humidity"
                           min="0" max="1" step="0.1"
                           value="${editData.stage4.baseHumidity}">
                    <span class="value-display">${editData.stage4.baseHumidity.toFixed(1)}</span>
                </div>
            </div>

            <div class="property-group">
                <label>Excluded Biomes</label>
                ${this._renderBiomeCheckboxes(editData.stage4.excludedBiomes)}
            </div>
        `;

        this._bindSlider('gradient-strength', (value) => {
            editData.stage4.temperatureGradient.strength = value;
        });

        this._bindSlider('base-humidity', (value) => {
            editData.stage4.baseHumidity = value;
        });

        this._bindGradientWidget(editData);
        this._bindBiomeCheckboxes(editData);
    }

    _renderBiomeCheckboxes(excludedBiomes) {
        const biomes = ['desert', 'jungle', 'glacier', 'volcanic', 'swamp', 'tundra'];

        return biomes.map(biome => `
            <div class="property-checkbox">
                <input type="checkbox" id="exclude-${biome}"
                       ${excludedBiomes.includes(biome) ? 'checked' : ''}>
                <span>${biome.charAt(0).toUpperCase() + biome.slice(1)}</span>
            </div>
        `).join('');
    }

    _bindSlider(id, onChange) {
        const slider = this.element.querySelector(`#${id}`);
        if (!slider) return;

        const valueDisplay = slider.parentElement.querySelector('.value-display');

        slider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (valueDisplay) {
                valueDisplay.textContent = value.toFixed(value < 1 ? 2 : 1);
            }
            onChange(value);
            this.state.markEditDataModified('property');
        });

        slider.addEventListener('change', () => {
            this.eventBus.emit(EVENTS.HISTORY_PUSH);
        });
    }

    _bindGradientWidget(editData) {
        const widget = this.element.querySelector('#gradient-widget');
        const arrow = this.element.querySelector('#gradient-arrow');
        if (!widget || !arrow) return;

        let isDragging = false;

        const updateGradient = (e) => {
            const rect = widget.getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            const x = e.clientX - rect.left - centerX;
            const y = e.clientY - rect.top - centerY;

            const len = Math.sqrt(x * x + y * y);
            if (len > 5) {
                const direction = { x: x / len, z: y / len };
                editData.stage4.temperatureGradient.direction = direction;

                const angle = Math.atan2(y, x) * (180 / Math.PI);
                arrow.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;

                this.state.markEditDataModified('gradient');
            }
        };

        widget.addEventListener('mousedown', (e) => {
            isDragging = true;
            updateGradient(e);
        });

        window.addEventListener('mousemove', (e) => {
            if (isDragging) {
                updateGradient(e);
            }
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                this.eventBus.emit(EVENTS.HISTORY_PUSH);
            }
        });
    }

    _bindBiomeCheckboxes(editData) {
        const biomes = ['desert', 'jungle', 'glacier', 'volcanic', 'swamp', 'tundra'];

        biomes.forEach(biome => {
            const checkbox = this.element.querySelector(`#exclude-${biome}`);
            if (!checkbox) return;

            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    if (!editData.stage4.excludedBiomes.includes(biome)) {
                        editData.stage4.excludedBiomes.push(biome);
                    }
                } else {
                    const index = editData.stage4.excludedBiomes.indexOf(biome);
                    if (index > -1) {
                        editData.stage4.excludedBiomes.splice(index, 1);
                    }
                }
                this.state.markEditDataModified('biome-exclusion');
                this.eventBus.emit(EVENTS.HISTORY_PUSH);
            });
        });
    }

    _setupEventListeners() {
        this.eventBus.on(EVENTS.EDIT_STAGE_CHANGE, ({ stage }) => {
            this._renderForStage(stage);
        });

        this.eventBus.on(EVENTS.EDIT_DATA_CHANGE, () => {
            // Refresh property info (point counts, etc.)
            this._renderForStage(this.state.editStage);
        });
    }

    /**
     * Show or hide the editor
     * @param {boolean} visible
     */
    setVisible(visible) {
        this.element.style.display = visible ? 'block' : 'none';
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

/**
 * StagePanel - UI component for stage navigation in Edit Mode
 *
 * Shows the four stages with visual indicators for:
 * - Current stage (highlighted)
 * - Stage validity (checkmark if valid)
 * - Stage availability (disabled if prerequisites not met)
 */

import { EVENTS, EDIT_STAGES, EDIT_TOOLS, COLORS } from '../../core/constants.js';

export class StagePanel {
    /**
     * @param {HTMLElement} container - Container element for the panel
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
        this.element.className = 'stage-panel';
        this.element.innerHTML = `
            <div class="stage-panel-header">
                <h3>Edit Mode</h3>
                <button class="exit-edit-btn" title="Exit Edit Mode">Exit</button>
            </div>
            <div class="stage-tabs"></div>
            <div class="stage-description"></div>
            <div class="stage-tools"></div>
            <div class="stage-validation"></div>
        `;

        this._applyStyles();
        this._renderStageTabs();
        this._updateUI();

        this.container.appendChild(this.element);

        // Wire up exit button
        this.element.querySelector('.exit-edit-btn').addEventListener('click', () => {
            this.state.setEditMode(false);
        });
    }

    _applyStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .stage-panel {
                background: ${COLORS.panelBackground};
                border: 1px solid ${COLORS.panelBorder};
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 12px;
            }

            .stage-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
            }

            .stage-panel-header h3 {
                margin: 0;
                color: ${COLORS.text};
                font-size: 14px;
            }

            .exit-edit-btn {
                background: transparent;
                border: 1px solid ${COLORS.panelBorder};
                color: ${COLORS.textMuted};
                padding: 4px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
            }

            .exit-edit-btn:hover {
                border-color: ${COLORS.accent};
                color: ${COLORS.text};
            }

            .stage-tabs {
                display: flex;
                gap: 4px;
                margin-bottom: 12px;
                overflow-x: auto;
            }

            .stage-tab {
                flex: 1;
                min-width: 0;
                background: transparent;
                border: 1px solid ${COLORS.panelBorder};
                border-radius: 4px;
                padding: 6px 2px;
                cursor: pointer;
                text-align: center;
                color: ${COLORS.textMuted};
                font-size: 10px;
                transition: all 0.15s ease;
                white-space: nowrap;
                overflow: hidden;
            }

            .stage-tab:hover:not(:disabled) {
                border-color: ${COLORS.accent};
                color: ${COLORS.text};
            }

            .stage-tab.active {
                background: ${COLORS.accent};
                border-color: ${COLORS.accent};
                color: #fff;
            }

            .stage-tab:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }

            .stage-tab .stage-number {
                display: block;
                font-size: 14px;
                font-weight: bold;
                margin-bottom: 1px;
            }

            .stage-tab .stage-name {
                display: block;
                font-size: 9px;
                text-overflow: ellipsis;
                overflow: hidden;
            }

            .stage-tab .stage-check {
                color: #4CAF50;
                margin-left: 4px;
            }

            .stage-description {
                color: ${COLORS.textMuted};
                font-size: 12px;
                margin-bottom: 12px;
                padding: 8px;
                background: rgba(255,255,255,0.05);
                border-radius: 4px;
            }

            .stage-tools {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin-bottom: 12px;
            }

            .tool-btn {
                background: transparent;
                border: 1px solid ${COLORS.panelBorder};
                border-radius: 4px;
                padding: 6px 10px;
                cursor: pointer;
                color: ${COLORS.textMuted};
                font-size: 11px;
                display: flex;
                align-items: center;
                gap: 4px;
                transition: all 0.15s ease;
            }

            .tool-btn:hover {
                border-color: ${COLORS.accent};
                color: ${COLORS.text};
            }

            .tool-btn.active {
                background: ${COLORS.accent};
                border-color: ${COLORS.accent};
                color: #fff;
            }

            .tool-btn .tool-icon {
                font-size: 14px;
            }

            .stage-validation {
                font-size: 11px;
                padding: 6px 8px;
                border-radius: 4px;
            }

            .stage-validation.valid {
                background: rgba(76, 175, 80, 0.2);
                color: #81C784;
            }

            .stage-validation.incomplete {
                background: rgba(255, 152, 0, 0.2);
                color: #FFB74D;
            }
        `;
        document.head.appendChild(style);
    }

    _renderStageTabs() {
        const tabsContainer = this.element.querySelector('.stage-tabs');
        tabsContainer.innerHTML = '';

        for (let stage = 1; stage <= 4; stage++) {
            const config = EDIT_STAGES[stage];
            const btn = document.createElement('button');
            btn.className = 'stage-tab';
            btn.dataset.stage = stage;
            btn.innerHTML = `
                <span class="stage-number">${stage}</span>
                <span class="stage-name">${config.name}</span>
            `;

            btn.addEventListener('click', () => {
                if (this.state.canAdvanceToStage(stage)) {
                    this.state.setEditStage(stage);
                }
            });

            tabsContainer.appendChild(btn);
        }
    }

    _updateUI() {
        const currentStage = this.state.editStage;
        const config = EDIT_STAGES[currentStage];

        // Update stage tabs
        this.element.querySelectorAll('.stage-tab').forEach(btn => {
            const stage = parseInt(btn.dataset.stage);
            const canAdvance = this.state.canAdvanceToStage(stage);
            const isValid = this.state.isStageValid(stage);

            btn.classList.toggle('active', stage === currentStage);
            btn.disabled = !canAdvance;

            // Show checkmark for valid stages
            const existingCheck = btn.querySelector('.stage-check');
            if (existingCheck) existingCheck.remove();

            if (isValid && stage !== currentStage) {
                const check = document.createElement('span');
                check.className = 'stage-check';
                check.textContent = ' ✓';
                btn.querySelector('.stage-number').appendChild(check);
            }
        });

        // Update description
        this.element.querySelector('.stage-description').textContent = config.description;

        // Update tools
        this._renderTools(config.tools);

        // Update validation message
        this._updateValidation();
    }

    _renderTools(tools) {
        const toolsContainer = this.element.querySelector('.stage-tools');
        toolsContainer.innerHTML = '';

        const currentTool = this.state.selectedTool;

        tools.forEach((toolId, index) => {
            const toolConfig = EDIT_TOOLS[toolId];
            const btn = document.createElement('button');
            btn.className = 'tool-btn';
            if (toolId === currentTool) btn.classList.add('active');

            btn.innerHTML = `
                <span class="tool-icon">${toolConfig.icon}</span>
                <span class="tool-name">${toolConfig.name}</span>
            `;
            btn.title = `${toolConfig.name} (${index + 1}) - Click again to deselect`;

            btn.addEventListener('click', () => {
                // Toggle off if clicking active tool, otherwise select new tool
                if (toolId === currentTool) {
                    this.state.setSelectedTool(null);  // Deselect tool
                } else {
                    this.state.setSelectedTool(toolId);
                }
            });

            toolsContainer.appendChild(btn);
        });
    }

    _updateValidation() {
        const validation = this.element.querySelector('.stage-validation');
        const stage = this.state.editStage;
        const isValid = this.state.isStageValid(stage);

        if (isValid) {
            validation.className = 'stage-validation valid';
            validation.textContent = stage < 4
                ? '✓ Stage complete - next stage available'
                : '✓ All stages complete - ready to export';
        } else {
            validation.className = 'stage-validation incomplete';
            switch (stage) {
                case 1:
                    validation.textContent = 'Draw a spine with at least 2 points';
                    break;
                case 2:
                    validation.textContent = 'Add secondary terrain features (optional)';
                    break;
                case 3:
                    validation.textContent = 'Configure hydrology (optional)';
                    break;
                case 4:
                    validation.textContent = 'Configure climate settings';
                    break;
            }
        }
    }

    _setupEventListeners() {
        this.eventBus.on(EVENTS.EDIT_STAGE_CHANGE, () => this._updateUI());
        this.eventBus.on(EVENTS.EDIT_DATA_CHANGE, () => this._updateValidation());
        this.eventBus.on(EVENTS.EDIT_TOOL_CHANGE, () => this._updateToolSelection());
    }

    _updateToolSelection() {
        const currentTool = this.state.selectedTool;
        this.element.querySelectorAll('.tool-btn').forEach(btn => {
            const toolId = btn.querySelector('.tool-name').textContent;
            const isActive = Object.entries(EDIT_TOOLS).find(([id, config]) =>
                config.name === toolId && id === currentTool
            );
            btn.classList.toggle('active', !!isActive);
        });

        // Re-render tools to update active state properly
        const config = EDIT_STAGES[this.state.editStage];
        this._renderTools(config.tools);
    }

    /**
     * Show or hide the panel
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

// Touch controls for mobile devices
// Provides virtual buttons and joystick for iPad/mobile gameplay

export class TouchControls {
    constructor(game) {
        this.game = game;
        this.active = false;
        this.buttons = {};
        this.joystick = null;

        // Camera look state (right-side drag)
        this.cameraLook = {
            active: false,
            touchId: null,
            lastX: 0,
            lastY: 0
        };

        // Only enable on touch devices
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
            this.createControls();
            this.setupEventListeners();
            this.active = true;
        }
    }

    createControls() {
        // Container for all touch controls
        const container = document.createElement('div');
        container.id = 'touch-controls';
        container.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: 250px;
            pointer-events: none;
            z-index: 1000;
        `;
        document.body.appendChild(container);

        // Left side: Movement joystick
        this.createJoystick(container);

        // Right side: Action buttons
        this.createActionButtons(container);
    }

    createJoystick(container) {
        // Joystick base
        const base = document.createElement('div');
        base.style.cssText = `
            position: absolute;
            bottom: 30px;
            left: 30px;
            width: 120px;
            height: 120px;
            background: rgba(255, 255, 255, 0.2);
            border: 3px solid rgba(255, 255, 255, 0.4);
            border-radius: 50%;
            pointer-events: auto;
            touch-action: none;
        `;

        // Joystick stick
        const stick = document.createElement('div');
        stick.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            width: 50px;
            height: 50px;
            background: rgba(255, 255, 255, 0.6);
            border: 2px solid rgba(255, 255, 255, 0.8);
            border-radius: 50%;
            transform: translate(-50%, -50%);
            transition: all 0.1s;
        `;

        base.appendChild(stick);
        container.appendChild(base);

        this.joystick = {
            base,
            stick,
            active: false,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0
        };

        // Touch events for joystick
        base.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = base.getBoundingClientRect();
            this.joystick.startX = rect.left + rect.width / 2;
            this.joystick.startY = rect.top + rect.height / 2;
            this.joystick.active = true;
            this.updateJoystick(touch.clientX, touch.clientY);
        });

        base.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (this.joystick.active) {
                const touch = e.touches[0];
                this.updateJoystick(touch.clientX, touch.clientY);
            }
        });

        base.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.joystick.active = false;
            this.joystick.currentX = 0;
            this.joystick.currentY = 0;
            stick.style.transform = 'translate(-50%, -50%)';
        });
    }

    updateJoystick(touchX, touchY) {
        const deltaX = touchX - this.joystick.startX;
        const deltaY = touchY - this.joystick.startY;
        
        // Limit to circle radius (50px from center)
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const maxDistance = 35;
        
        let x = deltaX;
        let y = deltaY;
        
        if (distance > maxDistance) {
            x = (deltaX / distance) * maxDistance;
            y = (deltaY / distance) * maxDistance;
        }
        
        // Update stick position
        this.joystick.stick.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
        
        // Normalize for game input (-1 to 1)
        this.joystick.currentX = x / maxDistance;
        this.joystick.currentY = y / maxDistance;
    }

    createActionButtons(container) {
        // Jump button
        const jumpBtn = this.createButton('JUMP', 'right: 30px; bottom: 140px;');
        jumpBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.game.keys[' '] = true;
        });
        jumpBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.game.keys[' '] = false;
        });
        container.appendChild(jumpBtn);
        this.buttons.jump = jumpBtn;

        // Attack/Command button
        const attackBtn = this.createButton('CMD', 'right: 30px; bottom: 30px;');
        attackBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            // Trigger click at center of screen for commanding golems
            this.game.handleClick();
        });
        container.appendChild(attackBtn);
        this.buttons.attack = attackBtn;

        // Mount/Dismount button (left side, above joystick)
        const mountBtn = this.createButton('DISMOUNT', 'left: 30px; bottom: 170px;');
        mountBtn.style.width = '70px';
        mountBtn.style.height = '50px';
        mountBtn.style.borderRadius = '25px';
        mountBtn.style.fontSize = '11px';
        mountBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.game.hero) {
                this.game.hero.toggleMount();
            }
        });
        container.appendChild(mountBtn);
        this.buttons.mount = mountBtn;

        // Weapon swap button (right side, between jump and attack)
        const weaponBtn = this.createButton('BOW', 'right: 120px; bottom: 85px;');
        weaponBtn.style.width = '60px';
        weaponBtn.style.height = '60px';
        weaponBtn.style.fontSize = '12px';
        weaponBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.game.hero) {
                this.game.hero.switchWeapon();
            }
        });
        container.appendChild(weaponBtn);
        this.buttons.weapon = weaponBtn;
    }

    createButton(label, position) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = `
            position: absolute;
            ${position}
            width: 80px;
            height: 80px;
            background: rgba(255, 255, 255, 0.3);
            border: 3px solid rgba(255, 255, 255, 0.5);
            border-radius: 50%;
            color: white;
            font-size: 14px;
            font-weight: bold;
            pointer-events: auto;
            touch-action: none;
            -webkit-tap-highlight-color: transparent;
        `;
        return btn;
    }

    setupEventListeners() {
        // Touch handling on canvas:
        // - Right half of screen (above buttons): camera look drag
        // - Tap anywhere (above bottom controls): shoot/attack
        const canvas = document.querySelector('canvas');
        if (canvas) {
            // Track tap state for shoot detection
            const tapState = {
                startPos: null,
                startTime: 0,
                touchId: null
            };

            canvas.addEventListener('touchstart', (e) => {
                e.preventDefault();

                for (const touch of e.changedTouches) {
                    const screenWidth = window.innerWidth;
                    const screenHeight = window.innerHeight;

                    // Check if touch is in camera look zone (right half, above bottom controls)
                    const isRightSide = touch.clientX > screenWidth / 2;
                    const isAboveControls = touch.clientY < screenHeight - 250;

                    if (isRightSide && isAboveControls && !this.cameraLook.active) {
                        // Start camera look
                        this.cameraLook.active = true;
                        this.cameraLook.touchId = touch.identifier;
                        this.cameraLook.lastX = touch.clientX;
                        this.cameraLook.lastY = touch.clientY;

                        // Notify camera controller that orbit started (for follow mode)
                        if (this.game.cameraController) {
                            this.game.cameraController.startOrbit();
                        }
                    }

                    // Also track for tap detection (any touch can become a tap)
                    if (!tapState.startPos) {
                        tapState.startPos = { x: touch.clientX, y: touch.clientY };
                        tapState.startTime = performance.now();
                        tapState.touchId = touch.identifier;
                    }
                }
            }, { passive: false });

            canvas.addEventListener('touchmove', (e) => {
                e.preventDefault();

                for (const touch of e.changedTouches) {
                    // Handle camera look drag
                    if (this.cameraLook.active && touch.identifier === this.cameraLook.touchId) {
                        const deltaX = touch.clientX - this.cameraLook.lastX;
                        const deltaY = touch.clientY - this.cameraLook.lastY;

                        // Send to camera controller
                        if (this.game.cameraController) {
                            // Scale sensitivity for touch (larger movements needed)
                            this.game.cameraController.handleLook(deltaX * 1.5, deltaY * 1.5);
                        }

                        this.cameraLook.lastX = touch.clientX;
                        this.cameraLook.lastY = touch.clientY;
                    }

                    // Invalidate tap if moved too much
                    if (tapState.touchId === touch.identifier && tapState.startPos) {
                        const dx = touch.clientX - tapState.startPos.x;
                        const dy = touch.clientY - tapState.startPos.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        if (distance > 15) {
                            tapState.startPos = null; // Invalidate tap
                        }
                    }
                }
            }, { passive: false });

            canvas.addEventListener('touchend', (e) => {
                e.preventDefault();

                for (const touch of e.changedTouches) {
                    // End camera look
                    if (this.cameraLook.active && touch.identifier === this.cameraLook.touchId) {
                        this.cameraLook.active = false;
                        this.cameraLook.touchId = null;

                        // Notify camera controller that orbit ended
                        if (this.game.cameraController) {
                            this.game.cameraController.stopOrbit();
                        }
                    }

                    // Check for tap (short duration, minimal movement)
                    if (tapState.touchId === touch.identifier && tapState.startPos) {
                        const touchEndPos = { x: touch.clientX, y: touch.clientY };
                        const touchDuration = performance.now() - tapState.startTime;

                        const dx = touchEndPos.x - tapState.startPos.x;
                        const dy = touchEndPos.y - tapState.startPos.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);

                        // If touch was brief (<300ms) and didn't move much (<15px), treat as tap
                        if (touchDuration < 300 && distance < 15) {
                            const screenHeight = window.innerHeight;
                            // Only shoot if above bottom control area
                            if (touchEndPos.y < screenHeight - 250) {
                                this.handleTapShoot(touchEndPos.x, touchEndPos.y);
                            }
                        }

                        tapState.startPos = null;
                        tapState.touchId = null;
                    }
                }
            }, { passive: false });

            // Handle touch cancel
            canvas.addEventListener('touchcancel', (e) => {
                for (const touch of e.changedTouches) {
                    if (this.cameraLook.active && touch.identifier === this.cameraLook.touchId) {
                        this.cameraLook.active = false;
                        this.cameraLook.touchId = null;
                        if (this.game.cameraController) {
                            this.game.cameraController.stopOrbit();
                        }
                    }
                    if (tapState.touchId === touch.identifier) {
                        tapState.startPos = null;
                        tapState.touchId = null;
                    }
                }
            }, { passive: false });
        }
    }
    
    /**
     * Handle tap-to-attack (routes to ranged or melee based on active weapon)
     */
    handleTapShoot(screenX, screenY) {
        // For melee attacks, just trigger the attack (no target needed)
        if (this.game.hero && this.game.hero.activeWeapon === 'sword') {
            this.game.handleMeleeAttack();
            return;
        }

        // For ranged attacks, convert screen coordinates to world target
        const mouse = {
            x: (screenX / window.innerWidth) * 2 - 1,
            y: -(screenY / window.innerHeight) * 2 + 1
        };

        // Use game's raycaster to find world position
        this.game.raycaster.setFromCamera(mouse, this.game.camera);
        const intersects = this.game.raycaster.intersectObjects(this.game.scene.children);

        if (intersects.length > 0) {
            const point = intersects[0].point;

            // Import Arrow class
            const arrowData = this.game.hero.shootArrow(point);
            if (arrowData) {
                // Dynamically import Arrow to avoid circular dependency
                import('../../combat.js').then(({ Arrow }) => {
                    const arrow = new Arrow(
                        this.game.scene,
                        arrowData.start,
                        arrowData.target,
                        arrowData.damage
                    );
                    this.game.arrows.push(arrow);
                });
            }
        }
    }

    // Call this in game update loop to apply joystick input
    update(deltaTime) {
        if (!this.active) return;

        // Update button labels based on hero state
        this.updateMountButton();
        this.updateWeaponButton();

        if (!this.joystick.active) return;

        const { currentX, currentY } = this.joystick;

        // Forward/backward based on Y axis
        if (currentY < -0.2) {
            this.game.hero.moveForward(8 * deltaTime * Math.abs(currentY));
        } else if (currentY > 0.2) {
            this.game.hero.moveBackward(6 * deltaTime * Math.abs(currentY));
        }

        // Turn based on X axis
        if (currentX < -0.2) {
            this.game.hero.turn(1, deltaTime * Math.abs(currentX));
        } else if (currentX > 0.2) {
            this.game.hero.turn(-1, deltaTime * Math.abs(currentX));
        }
    }

    /**
     * Update the mount button label based on hero state
     */
    updateMountButton() {
        if (!this.buttons.mount || !this.game.hero) return;

        const hero = this.game.hero;
        if (hero.isMounting) {
            this.buttons.mount.textContent = 'CANCEL';
        } else if (hero.mounted) {
            this.buttons.mount.textContent = 'DISMOUNT';
        } else {
            this.buttons.mount.textContent = 'MOUNT';
        }
    }

    /**
     * Update the weapon button label based on active weapon
     */
    updateWeaponButton() {
        if (!this.buttons.weapon || !this.game.hero) return;

        const hero = this.game.hero;
        // Show the name of the CURRENT weapon
        this.buttons.weapon.textContent = hero.activeWeapon === 'bow' ? 'BOW' : 'SWORD';
    }

    destroy() {
        const container = document.getElementById('touch-controls');
        if (container) {
            container.remove();
        }
    }
}
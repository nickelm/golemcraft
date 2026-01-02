// Touch controls for mobile devices
// Provides virtual buttons and joystick for iPad/mobile gameplay

export class TouchControls {
    constructor(game) {
        this.game = game;
        this.active = false;
        this.buttons = {};
        this.joystick = null;
        
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
        // Tap-to-shoot on canvas (avoiding control areas)
        const canvas = document.querySelector('canvas');
        if (canvas) {
            let touchStartPos = null;
            let touchStartTime = 0;
            
            canvas.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const touch = e.touches[0];
                touchStartPos = { x: touch.clientX, y: touch.clientY };
                touchStartTime = performance.now();
            }, { passive: false });
            
            canvas.addEventListener('touchmove', (e) => {
                e.preventDefault();
            }, { passive: false });
            
            canvas.addEventListener('touchend', (e) => {
                e.preventDefault();
                
                if (!touchStartPos) return;
                
                const touch = e.changedTouches[0];
                const touchEndPos = { x: touch.clientX, y: touch.clientY };
                const touchDuration = performance.now() - touchStartTime;
                
                // Calculate distance moved
                const dx = touchEndPos.x - touchStartPos.x;
                const dy = touchEndPos.y - touchStartPos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // If touch was brief (<300ms) and didn't move much (<10px), treat as tap
                if (touchDuration < 300 && distance < 10) {
                    // Check if tap is not on control areas (bottom 250px)
                    const screenHeight = window.innerHeight;
                    if (touchEndPos.y < screenHeight - 250) {
                        // Shoot at tap position
                        this.handleTapShoot(touchEndPos.x, touchEndPos.y);
                    }
                }
                
                touchStartPos = null;
            }, { passive: false });
        }
    }
    
    /**
     * Handle tap-to-shoot
     */
    handleTapShoot(screenX, screenY) {
        // Convert screen coordinates to normalized device coordinates
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
        if (!this.active || !this.joystick.active) return;

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

    destroy() {
        const container = document.getElementById('touch-controls');
        if (container) {
            container.remove();
        }
    }
}
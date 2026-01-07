/**
 * LandmarkDebugRenderer - Debug visualization for landmark and terrain data
 *
 * Renders:
 * - Point markers (spheres at world positions)
 * - Direction arrows (lines showing orientations/normals)
 * - Wireframe boxes (AABBs)
 * - Coordinate frames (RGB axis indicators)
 *
 * Follows CollisionDebug patterns: object pooling, depthTest: false, renderOrder: 999
 */

import * as THREE from 'three';

export class LandmarkDebugRenderer {
    constructor(scene) {
        this.scene = scene;
        this.enabled = false;  // Disabled by default

        // Object pools
        this.pointMarkers = [];
        this.arrows = [];
        this.wireframeBoxes = [];
        this.coordinateFrames = [];

        // Pool sizes
        this.maxPoints = 50;
        this.maxArrows = 50;
        this.maxBoxes = 20;
        this.maxFrames = 10;

        // Active marker counts
        this.activePoints = 0;
        this.activeArrows = 0;
        this.activeBoxes = 0;
        this.activeFrames = 0;

        // HTML overlay for info display
        this.overlay = null;

        this.init();
    }

    init() {
        this.createPointMarkerPool();
        this.createArrowPool();
        this.createWireframeBoxPool();
        this.createCoordinateFramePool();
        this.createOverlay();
    }

    createPointMarkerPool() {
        // Unit sphere, scaled per use
        const geometry = new THREE.SphereGeometry(1, 8, 6);

        for (let i = 0; i < this.maxPoints; i++) {
            const material = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                transparent: true,
                opacity: 0.8,
                depthTest: false
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.renderOrder = 999;
            this.scene.add(mesh);
            this.pointMarkers.push(mesh);
        }
    }

    createArrowPool() {
        // Create arrow as group: line shaft + cone head
        const coneGeometry = new THREE.ConeGeometry(0.15, 0.4, 6);
        // Rotate cone so it points along +Y by default, we'll orient it in drawArrow
        coneGeometry.rotateX(Math.PI / 2);
        // Move cone origin to its base
        coneGeometry.translate(0, 0, 0.2);

        for (let i = 0; i < this.maxArrows; i++) {
            const group = new THREE.Group();
            group.visible = false;
            group.renderOrder = 999;
            group.frustumCulled = false;  // Prevent disappearing at angles

            // Line shaft
            const lineGeometry = new THREE.BufferGeometry();
            const positions = new Float32Array(6);  // 2 points x 3 coords
            lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

            const lineMaterial = new THREE.LineBasicMaterial({
                color: 0x00ff00,
                depthTest: false
            });
            const line = new THREE.Line(lineGeometry, lineMaterial);
            line.renderOrder = 999;
            line.frustumCulled = false;
            group.add(line);

            // Cone head
            const coneMaterial = new THREE.MeshBasicMaterial({
                color: 0x00ff00,
                depthTest: false
            });
            const cone = new THREE.Mesh(coneGeometry, coneMaterial);
            cone.renderOrder = 999;
            cone.frustumCulled = false;
            group.add(cone);

            this.scene.add(group);
            this.arrows.push(group);
        }
    }

    createWireframeBoxPool() {
        const unitBox = new THREE.BoxGeometry(1, 1, 1);
        const edges = new THREE.EdgesGeometry(unitBox);

        for (let i = 0; i < this.maxBoxes; i++) {
            const material = new THREE.LineBasicMaterial({
                color: 0xffff00,
                depthTest: false
            });
            const wireframe = new THREE.LineSegments(edges.clone(), material);
            wireframe.visible = false;
            wireframe.renderOrder = 999;
            this.scene.add(wireframe);
            this.wireframeBoxes.push(wireframe);
        }
    }

    createCoordinateFramePool() {
        // Each frame is 3 lines (X, Y, Z axes) with small cone heads
        const coneGeometry = new THREE.ConeGeometry(0.1, 0.25, 6);
        coneGeometry.rotateX(Math.PI / 2);
        coneGeometry.translate(0, 0, 0.125);

        for (let i = 0; i < this.maxFrames; i++) {
            const group = new THREE.Group();
            group.visible = false;
            group.renderOrder = 999;
            group.frustumCulled = false;

            const colors = [0xff0000, 0x00ff00, 0x0000ff];  // R, G, B
            const directions = [
                [1, 0, 0], [0, 1, 0], [0, 0, 1]
            ];

            for (let j = 0; j < 3; j++) {
                // Line shaft
                const geometry = new THREE.BufferGeometry();
                const positions = new Float32Array([
                    0, 0, 0,
                    directions[j][0] * 0.85, directions[j][1] * 0.85, directions[j][2] * 0.85
                ]);
                geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

                const material = new THREE.LineBasicMaterial({
                    color: colors[j],
                    depthTest: false
                });
                const line = new THREE.Line(geometry, material);
                line.renderOrder = 999;
                line.frustumCulled = false;
                group.add(line);

                // Cone head
                const coneMaterial = new THREE.MeshBasicMaterial({
                    color: colors[j],
                    depthTest: false
                });
                const cone = new THREE.Mesh(coneGeometry, coneMaterial);
                cone.position.set(
                    directions[j][0] * 0.85,
                    directions[j][1] * 0.85,
                    directions[j][2] * 0.85
                );
                cone.lookAt(directions[j][0], directions[j][1], directions[j][2]);
                cone.renderOrder = 999;
                cone.frustumCulled = false;
                group.add(cone);
            }

            this.scene.add(group);
            this.coordinateFrames.push(group);
        }
    }

    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'landmark-debug';
        this.overlay.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.85);
            color: #0ff;
            font-family: monospace;
            font-size: 12px;
            padding: 10px;
            border-radius: 4px;
            z-index: 10000;
            min-width: 200px;
            pointer-events: none;
            display: none;
        `;
        document.body.appendChild(this.overlay);
    }

    /**
     * Clear all active markers for this frame
     */
    beginFrame() {
        // Hide all previously used markers
        for (let i = 0; i < this.activePoints; i++) {
            this.pointMarkers[i].visible = false;
        }
        for (let i = 0; i < this.activeArrows; i++) {
            this.arrows[i].visible = false;
        }
        for (let i = 0; i < this.activeBoxes; i++) {
            this.wireframeBoxes[i].visible = false;
        }
        for (let i = 0; i < this.activeFrames; i++) {
            this.coordinateFrames[i].visible = false;
        }

        // Reset counts
        this.activePoints = 0;
        this.activeArrows = 0;
        this.activeBoxes = 0;
        this.activeFrames = 0;
    }

    /**
     * Draw a point marker at world position
     * @param {number} x - World X coordinate
     * @param {number} y - World Y coordinate
     * @param {number} z - World Z coordinate
     * @param {number} color - Hex color (default: 0xff0000)
     * @param {number} size - Sphere radius (default: 0.2)
     */
    drawPoint(x, y, z, color = 0xff0000, size = 0.2) {
        if (!this.enabled) return;
        if (this.activePoints >= this.maxPoints) return;

        const marker = this.pointMarkers[this.activePoints++];
        marker.position.set(x, y, z);
        marker.scale.setScalar(size);
        marker.material.color.setHex(color);
        marker.visible = true;
    }

    /**
     * Draw a direction arrow
     * @param {number} x - Origin X position
     * @param {number} y - Origin Y position
     * @param {number} z - Origin Z position
     * @param {number} dx - Direction X component
     * @param {number} dy - Direction Y component
     * @param {number} dz - Direction Z component
     * @param {number} color - Hex color (default: 0x00ff00)
     * @param {number} length - Arrow length (default: 2)
     */
    drawArrow(x, y, z, dx, dy, dz, color = 0x00ff00, length = 2) {
        if (!this.enabled) return;
        if (this.activeArrows >= this.maxArrows) return;

        // Normalize direction
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 0.001) return;

        const ndx = dx / len;
        const ndy = dy / len;
        const ndz = dz / len;

        const arrowGroup = this.arrows[this.activeArrows++];
        const line = arrowGroup.children[0];
        const cone = arrowGroup.children[1];

        // Update line shaft (from origin to near end, leaving room for cone)
        const shaftLength = length - 0.3;  // Leave space for cone head
        const positions = line.geometry.attributes.position.array;

        // Start point
        positions[0] = x;
        positions[1] = y;
        positions[2] = z;

        // End point (shaft only)
        positions[3] = x + ndx * shaftLength;
        positions[4] = y + ndy * shaftLength;
        positions[5] = z + ndz * shaftLength;

        line.geometry.attributes.position.needsUpdate = true;
        line.material.color.setHex(color);

        // Position and orient cone at arrow tip
        cone.position.set(x + ndx * shaftLength, y + ndy * shaftLength, z + ndz * shaftLength);

        // Orient cone to point in direction (lookAt from base toward tip)
        const tipX = x + ndx * length;
        const tipY = y + ndy * length;
        const tipZ = z + ndz * length;
        cone.lookAt(tipX, tipY, tipZ);

        cone.material.color.setHex(color);

        arrowGroup.visible = true;
    }

    /**
     * Draw a wireframe AABB
     * @param {Object} bounds - { minX, minY, minZ, maxX, maxY, maxZ }
     * @param {number} color - Hex color (default: 0xffff00)
     */
    drawBox(bounds, color = 0xffff00) {
        if (!this.enabled) return;
        if (this.activeBoxes >= this.maxBoxes) return;

        const box = this.wireframeBoxes[this.activeBoxes++];

        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        const cz = (bounds.minZ + bounds.maxZ) / 2;

        const sx = bounds.maxX - bounds.minX;
        const sy = bounds.maxY - bounds.minY;
        const sz = bounds.maxZ - bounds.minZ;

        box.position.set(cx, cy, cz);
        box.scale.set(sx, sy, sz);
        box.material.color.setHex(color);
        box.visible = true;
    }

    /**
     * Draw RGB coordinate frame (X=red, Y=green, Z=blue)
     * @param {number} x - Origin X position
     * @param {number} y - Origin Y position
     * @param {number} z - Origin Z position
     * @param {number} scale - Axis length (default: 1)
     */
    drawCoordinateFrame(x, y, z, scale = 1) {
        if (!this.enabled) return;
        if (this.activeFrames >= this.maxFrames) return;

        const frame = this.coordinateFrames[this.activeFrames++];
        frame.position.set(x, y, z);
        frame.scale.setScalar(scale);
        frame.visible = true;
    }

    /**
     * Draw terrain normal at position
     * @param {TerrainProbe} probe - Terrain probe instance
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     */
    drawTerrainNormal(probe, x, z) {
        const height = probe.sampleHeight(x, z);
        const normal = probe.sampleNormal(x, z);

        // Draw point at surface
        this.drawPoint(x, height, z, 0xffffff, 0.15);

        // Draw normal arrow (cyan for normals)
        this.drawArrow(x, height, z, normal.x, normal.y, normal.z, 0x00ffff, 2);
    }

    /**
     * Draw gradient direction at position
     * @param {TerrainProbe} probe - Terrain probe instance
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     */
    drawGradient(probe, x, z) {
        const height = probe.sampleHeight(x, z);
        const gradient = probe.sampleGradient(x, z);

        // Skip if flat terrain
        if (gradient.magnitude < 0.01) return;

        // Draw descent direction (magenta, following terrain surface downhill)
        // The descent vector in 3D: horizontal components from gradient,
        // vertical component is negative (going down) proportional to slope
        // Descent direction: (dx, -magnitude, dz) then normalize
        const descentX = gradient.dx;
        const descentY = -gradient.magnitude;  // Negative = going down
        const descentZ = gradient.dz;

        // Normalize the 3D descent vector
        const len = Math.sqrt(descentX * descentX + descentY * descentY + descentZ * descentZ);
        const ndx = descentX / len;
        const ndy = descentY / len;
        const ndz = descentZ / len;

        // Arrow length proportional to slope magnitude
        const arrowLength = Math.min(3, 0.5 + gradient.magnitude * 2);
        this.drawArrow(
            x, height + 0.1, z,
            ndx, ndy, ndz,
            0xff00ff,
            arrowLength
        );
    }

    /**
     * Draw landmarks from the landmark system
     * @param {LandmarkSystem} landmarkSystem - The landmark system instance
     * @param {number} playerX - Player X position
     * @param {number} playerZ - Player Z position
     * @param {number} radius - Search radius in chunks (default: 3)
     */
    drawLandmarks(landmarkSystem, playerX, playerZ, radius = 3) {
        if (!this.enabled || !landmarkSystem) return;

        const CHUNK_SIZE = 16;
        const playerChunkX = Math.floor(playerX / CHUNK_SIZE);
        const playerChunkZ = Math.floor(playerZ / CHUNK_SIZE);

        // Collect unique landmarks from nearby chunks
        const seenLandmarks = new Set();
        const landmarks = [];

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const chunkLandmarks = landmarkSystem.getLandmarksForChunk(
                    playerChunkX + dx,
                    playerChunkZ + dz
                );
                for (const landmark of chunkLandmarks) {
                    // Use bounds as unique key
                    const key = `${landmark.bounds.minX},${landmark.bounds.minZ}`;
                    if (!seenLandmarks.has(key)) {
                        seenLandmarks.add(key);
                        landmarks.push(landmark);
                    }
                }
            }
        }

        // Draw each landmark
        for (const landmark of landmarks) {
            // Draw main bounds (yellow wireframe)
            this.drawBox(landmark.bounds, 0xffff00);

            // Draw center point (orange)
            const centerX = (landmark.bounds.minX + landmark.bounds.maxX) / 2;
            const centerY = (landmark.bounds.minY + landmark.bounds.maxY) / 2;
            const centerZ = (landmark.bounds.minZ + landmark.bounds.maxZ) / 2;
            this.drawPoint(centerX, centerY, centerZ, 0xff8800, 0.3);

            // Draw chambers (cyan wireframes for interior volumes)
            if (landmark.chambers) {
                for (const chamber of landmark.chambers) {
                    this.drawBox(chamber, 0x00ffff);
                }
            }

            // Draw voxel bounds if different from main bounds (green)
            if (landmark.voxelBounds) {
                this.drawBox(landmark.voxelBounds, 0x00ff00);
            }
        }

        return landmarks;  // Return for overlay info
    }

    /**
     * Update overlay with terrain/landmark info
     * @param {Object} info - Display information
     */
    updateOverlay(info) {
        if (!this.enabled || !this.overlay) return;

        let html = '<div style="color: #ff0; font-weight: bold; margin-bottom: 8px;">LANDMARK DEBUG</div>';

        if (info.position) {
            html += `<div>Position: ${info.position.x.toFixed(1)}, ${info.position.z.toFixed(1)}</div>`;
        }
        if (info.height !== undefined) {
            html += `<div>Height: ${info.height.toFixed(2)}</div>`;
        }
        if (info.gradient) {
            html += `<div>Slope: ${(info.gradient.magnitude * 100).toFixed(1)}%</div>`;
        }
        if (info.normal) {
            html += `<div>Normal: (${info.normal.x.toFixed(2)}, ${info.normal.y.toFixed(2)}, ${info.normal.z.toFixed(2)})</div>`;
        }
        if (info.biome) {
            html += `<div>Biome: ${info.biome}</div>`;
        }

        // Landmark info
        if (info.landmarks && info.landmarks.length > 0) {
            html += '<div style="border-top: 1px solid #444; margin-top: 6px; padding-top: 6px;">';
            html += `<div style="color: #ff0;">Landmarks nearby: ${info.landmarks.length}</div>`;
            html += '<div style="color: #f80; font-size: 10px;">(main thread cache - may differ from worker)</div>';

            for (const landmark of info.landmarks.slice(0, 3)) {  // Show max 3
                const type = landmark.type || 'unknown';
                const dist = info.playerPos ? Math.sqrt(
                    Math.pow((landmark.bounds.minX + landmark.bounds.maxX) / 2 - info.playerPos.x, 2) +
                    Math.pow((landmark.bounds.minZ + landmark.bounds.maxZ) / 2 - info.playerPos.z, 2)
                ).toFixed(0) : '?';
                html += `<div style="color: #aaa; font-size: 11px;">- ${type} (${dist}m)</div>`;
            }
            html += '</div>';
        }

        // Inside landmark check
        if (info.insideLandmark !== undefined) {
            const color = info.insideLandmark ? '#0f0' : '#888';
            html += `<div style="color: ${color};">Inside landmark: ${info.insideLandmark ? 'YES' : 'no'}</div>`;
        }

        this.overlay.innerHTML = html;
    }

    /**
     * Toggle debug visibility
     * @returns {boolean} New visibility state
     */
    toggle() {
        this.enabled = !this.enabled;
        this.overlay.style.display = this.enabled ? 'block' : 'none';

        if (!this.enabled) {
            // Hide all markers when disabled
            this.pointMarkers.forEach(m => m.visible = false);
            this.arrows.forEach(a => a.visible = false);
            this.wireframeBoxes.forEach(b => b.visible = false);
            this.coordinateFrames.forEach(f => f.visible = false);
        }

        return this.enabled;
    }

    /**
     * Set visibility directly
     * @param {boolean} visible
     */
    setVisible(visible) {
        if (this.enabled !== visible) {
            this.toggle();
        }
    }

    /**
     * Clean up all resources
     */
    dispose() {
        // Remove overlay
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }

        // Dispose point markers
        if (this.pointMarkers.length > 0) {
            // Shared geometry - dispose once
            this.pointMarkers[0].geometry.dispose();
        }
        this.pointMarkers.forEach(m => {
            this.scene.remove(m);
            m.material.dispose();
        });

        // Dispose arrows (groups with line + cone)
        this.arrows.forEach(group => {
            this.scene.remove(group);
            group.children.forEach(child => {
                child.geometry.dispose();
                child.material.dispose();
            });
        });

        // Dispose wireframe boxes
        this.wireframeBoxes.forEach(b => {
            this.scene.remove(b);
            b.geometry.dispose();
            b.material.dispose();
        });

        // Dispose coordinate frames
        this.coordinateFrames.forEach(f => {
            this.scene.remove(f);
            f.children.forEach(line => {
                line.geometry.dispose();
                line.material.dispose();
            });
        });

        // Clear arrays
        this.pointMarkers = [];
        this.arrows = [];
        this.wireframeBoxes = [];
        this.coordinateFrames = [];
    }
}

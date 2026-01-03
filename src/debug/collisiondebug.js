/**
 * CollisionDebug - Visual debugging for collision/terrain mismatch
 * 
 * Shows:
 * - Player world position
 * - Block type queries at feet and below
 * - Expected terrain height vs actual collision
 * - Visual markers in 3D space
 */

import * as THREE from 'three';

export class CollisionDebug {
    constructor(scene, terrain) {
        this.scene = scene;
        this.terrain = terrain;
        this.enabled = true;
        
        // Create HTML overlay
        this.createOverlay();
        
        // 3D debug markers
        this.markers = [];
        this.markerPool = [];
        this.createMarkerPool();
        
        // Sampling points relative to entity feet
        this.sampleOffsets = [
            { x: 0, y: 0, z: 0, label: 'feet' },
            { x: 0, y: -1, z: 0, label: 'below' },
            { x: 0, y: -0.5, z: 0, label: 'half' },
            { x: 0, y: 1, z: 0, label: 'above' },
        ];
    }
    
    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'collision-debug';
        this.overlay.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.85);
            color: #0f0;
            font-family: monospace;
            font-size: 12px;
            padding: 10px;
            border-radius: 4px;
            z-index: 10000;
            min-width: 320px;
            pointer-events: none;
        `;
        document.body.appendChild(this.overlay);
    }
    
    createMarkerPool() {
        // Pre-create marker meshes
        const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        
        for (let i = 0; i < 20; i++) {
            const material = new THREE.MeshBasicMaterial({ 
                color: 0xff0000,
                transparent: true,
                opacity: 0.7,
                depthTest: false
            });
            const marker = new THREE.Mesh(geometry, material);
            marker.visible = false;
            marker.renderOrder = 999;
            this.scene.add(marker);
            this.markerPool.push(marker);
        }
        
        // Create ground plane marker (shows expected terrain height)
        const planeGeometry = new THREE.PlaneGeometry(2, 2);
        const planeMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            depthTest: false
        });
        this.groundPlane = new THREE.Mesh(planeGeometry, planeMaterial);
        this.groundPlane.rotation.x = -Math.PI / 2;
        this.groundPlane.renderOrder = 998;
        this.scene.add(this.groundPlane);
        
        // Create AABB wireframe visualization
        const aabbGeometry = new THREE.BoxGeometry(1, 1, 1);
        const aabbEdges = new THREE.EdgesGeometry(aabbGeometry);
        const aabbMaterial = new THREE.LineBasicMaterial({ color: 0xffff00 });
        this.aabbWireframe = new THREE.LineSegments(aabbEdges, aabbMaterial);
        this.aabbWireframe.renderOrder = 999;
        this.scene.add(this.aabbWireframe);
    }
    
    update(entity) {
        if (!this.enabled || !entity) return;
        
        const pos = entity.position;
        const px = pos.x;
        const py = pos.y;
        const pz = pos.z;
        
        // Integer block coordinates
        const blockX = Math.floor(px);
        const blockY = Math.floor(py);
        const blockZ = Math.floor(pz);
        
        // Get terrain height at player position
        const terrainHeight = this.terrain.getHeight(blockX, blockZ);
        
        // Check if this was cached (by checking if cache has this key)
        const heightCacheKey = `${blockX},${blockZ}`;
        const wasInCache = this.terrain.heightCache ? this.terrain.heightCache.has(heightCacheKey) : 'N/A';
        
        // Get biome for debugging
        const biome = this.terrain.getBiome ? this.terrain.getBiome(blockX, blockZ) : 'N/A';
        
        // Check what block type is at the surface (terrain height)
        const surfaceBlockType = this.terrain.getBlockType(blockX, terrainHeight, blockZ);
        // Check block ABOVE surface (should be air)  
        const aboveSurfaceType = this.terrain.getBlockType(blockX, terrainHeight + 1, blockZ);
        
        // Sample block types at various points
        const samples = this.sampleOffsets.map(offset => {
            const sx = Math.floor(px + offset.x);
            const sy = Math.floor(py + offset.y);
            const sz = Math.floor(pz + offset.z);
            const blockType = this.terrain.getBlockType(sx, sy, sz);
            return {
                label: offset.label,
                x: sx, y: sy, z: sz,
                type: blockType
            };
        });
        
        // Check blocks in a column below player
        const columnSamples = [];
        for (let dy = 2; dy >= -3; dy--) {
            const sy = blockY + dy;
            const blockType = this.terrain.getBlockType(blockX, sy, blockZ);
            columnSamples.push({
                y: sy,
                type: blockType,
                isSolid: blockType !== null && blockType !== 'water' && blockType !== 'water_full'
            });
        }
        
        // Find first solid block below feet
        let firstSolidBelow = null;
        for (let dy = 0; dy >= -5; dy--) {
            const sy = Math.floor(py) + dy;
            const blockType = this.terrain.getBlockType(blockX, sy, blockZ);
            if (blockType !== null && blockType !== 'water' && blockType !== 'water_full') {
                firstSolidBelow = { y: sy, type: blockType };
                break;
            }
        }
        
        // Calculate expected ground position
        // Player feet should be at terrainHeight + 1 (standing ON the surface block)
        const expectedY = terrainHeight + 1;
        const heightDiff = py - expectedY;
        
        // Chunk info
        const chunkX = Math.floor(px / 16);
        const chunkZ = Math.floor(pz / 16);
        const localX = ((px % 16) + 16) % 16;
        const localZ = ((pz % 16) + 16) % 16;
        
        // Update overlay
        this.overlay.innerHTML = `
            <div style="color: #ff0; font-weight: bold; margin-bottom: 8px;">COLLISION DEBUG</div>
            <div style="border-bottom: 1px solid #444; padding-bottom: 4px; margin-bottom: 4px;">
                <b>Position:</b> ${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}<br>
                <b>Block coords:</b> ${blockX}, ${blockY}, ${blockZ}<br>
                <b>Chunk:</b> ${chunkX}, ${chunkZ} (local: ${localX.toFixed(1)}, ${localZ.toFixed(1)})<br>
                <b>Velocity Y:</b> ${entity.velocity.y.toFixed(2)}<br>
                <b>On ground:</b> ${entity.onGround}
            </div>
            <div style="border-bottom: 1px solid #444; padding-bottom: 4px; margin-bottom: 4px;">
                <b>Terrain height:</b> ${terrainHeight} (cached: ${wasInCache})<br>
                <b>Biome:</b> ${biome}<br>
                <b>Surface block (Y=${terrainHeight}):</b> <span style="color: ${surfaceBlockType ? '#0f0' : '#f00'}">${surfaceBlockType || 'NULL/AIR!'}</span><br>
                <b>Above surface (Y=${terrainHeight + 1}):</b> ${aboveSurfaceType || 'air'}<br>
                <b>Expected Y:</b> ${expectedY.toFixed(2)}<br>
                <b>Height diff:</b> <span style="color: ${Math.abs(heightDiff) > 0.5 ? '#f00' : '#0f0'}">${heightDiff.toFixed(2)}</span><br>
                <b>First solid below:</b> ${firstSolidBelow ? `Y=${firstSolidBelow.y} (${firstSolidBelow.type})` : 'NONE!'}
            </div>
            <div style="border-bottom: 1px solid #444; padding-bottom: 4px; margin-bottom: 4px;">
                <b>Block column at (${blockX}, ${blockZ}):</b><br>
                ${columnSamples.map(s => 
                    `  Y=${s.y}: ${s.type || 'air'} ${s.isSolid ? '■' : '·'}`
                ).join('<br>')}
            </div>
            <div>
                <b>Sample points:</b><br>
                ${samples.map(s => 
                    `  ${s.label}: (${s.x},${s.y},${s.z}) = ${s.type || 'air'}`
                ).join('<br>')}
            </div>
            ${entity.aabb ? `
            <div style="border-top: 1px solid #444; padding-top: 4px; margin-top: 4px;">
                <b>AABB:</b> ${entity.aabb.width.toFixed(1)} × ${entity.aabb.height.toFixed(1)} × ${entity.aabb.depth.toFixed(1)}<br>
                <b>Base:</b> ${entity.aabb.base.map(v => v.toFixed(2)).join(', ')}<br>
                <b>Max:</b> ${entity.aabb.max.map(v => v.toFixed(2)).join(', ')}
            </div>
            ` : ''}
        `;
        
        // Update 3D markers
        this.updateMarkers(entity, samples, terrainHeight);
    }
    
    updateMarkers(entity, samples, terrainHeight) {
        const pos = entity.position;
        
        // Reset all markers
        this.markerPool.forEach(m => m.visible = false);
        
        let markerIndex = 0;
        
        // Place markers at sample points
        samples.forEach(sample => {
            if (markerIndex >= this.markerPool.length) return;
            
            const marker = this.markerPool[markerIndex++];
            marker.position.set(sample.x + 0.5, sample.y + 0.5, sample.z + 0.5);
            marker.visible = true;
            
            // Color by block type
            if (sample.type === null) {
                marker.material.color.setHex(0xff0000); // Red for air
            } else if (sample.type === 'water' || sample.type === 'water_full') {
                marker.material.color.setHex(0x0000ff); // Blue for water
            } else {
                marker.material.color.setHex(0x00ff00); // Green for solid
            }
        });
        
        // Update ground plane (shows expected terrain height)
        this.groundPlane.position.set(pos.x, terrainHeight + 1.01, pos.z);
        
        // Update AABB wireframe
        if (entity.aabb) {
            const aabb = entity.aabb;
            this.aabbWireframe.position.set(
                (aabb.base[0] + aabb.max[0]) / 2,
                (aabb.base[1] + aabb.max[1]) / 2,
                (aabb.base[2] + aabb.max[2]) / 2
            );
            this.aabbWireframe.scale.set(
                aabb.max[0] - aabb.base[0],
                aabb.max[1] - aabb.base[1],
                aabb.max[2] - aabb.base[2]
            );
        }
    }
    
    toggle() {
        this.enabled = !this.enabled;
        this.overlay.style.display = this.enabled ? 'block' : 'none';
        this.groundPlane.visible = this.enabled;
        this.aabbWireframe.visible = this.enabled;
        this.markerPool.forEach(m => m.visible = false);
        return this.enabled;
    }
    
    dispose() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.markerPool.forEach(m => {
            this.scene.remove(m);
            m.geometry.dispose();
            m.material.dispose();
        });
        this.scene.remove(this.groundPlane);
        this.groundPlane.geometry.dispose();
        this.groundPlane.material.dispose();
        this.scene.remove(this.aabbWireframe);
        this.aabbWireframe.geometry.dispose();
        this.aabbWireframe.material.dispose();
    }
}
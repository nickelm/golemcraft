import * as THREE from 'three';

/**
 * DroppedTorch - Simple torch entity with visual mesh + PointLight
 * Used for testing point light support on terrain
 */
export class DroppedTorch {
    constructor(scene, position) {
        this.scene = scene;
        this.position = position.clone();

        // Create torch mesh (cylinder + emissive "flame" box on top)
        this.mesh = this.createMesh();
        this.mesh.position.copy(this.position);
        this.scene.add(this.mesh);

        // Create point light
        this.light = new THREE.PointLight(0xffa040, 3, 15, 2);
        this.light.position.copy(this.position);
        this.light.position.y += 0.7; // Light at flame height
        this.scene.add(this.light);

        // Flicker animation state
        this.flickerTime = Math.random() * Math.PI * 2;
    }

    createMesh() {
        const group = new THREE.Group();

        // Wooden stick (brown cylinder)
        const stickGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.8, 8);
        const stickMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const stick = new THREE.Mesh(stickGeo, stickMat);
        stick.position.y = 0.4;
        group.add(stick);

        // Flame (emissive orange box)
        const flameGeo = new THREE.BoxGeometry(0.2, 0.3, 0.2);
        const flameMat = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 0.9
        });
        const flame = new THREE.Mesh(flameGeo, flameMat);
        flame.position.y = 0.9;
        this.flameMesh = flame;
        group.add(flame);

        return group;
    }

    update(deltaTime) {
        // Flicker effect
        this.flickerTime += deltaTime * 10;
        const flicker = 0.8 + Math.sin(this.flickerTime) * 0.2
                            + Math.sin(this.flickerTime * 2.3) * 0.1;
        this.light.intensity = 3 * flicker;

        // Slight flame scale pulse
        if (this.flameMesh) {
            const scale = 0.9 + Math.sin(this.flickerTime * 1.5) * 0.1;
            this.flameMesh.scale.y = scale;
        }

        return true;
    }

    destroy() {
        this.scene.remove(this.mesh);
        this.scene.remove(this.light);

        // Dispose geometry and materials
        this.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }
}

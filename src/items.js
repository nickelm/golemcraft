import * as THREE from 'three';

/**
 * Resource types with visual properties and values
 * Values are ranges - actual value randomized per item
 */
export const RESOURCE_TYPES = {
    gold: { 
        name: 'Gold', 
        color: 0xFFD700, 
        emissive: 0xFFAA00,
        minValue: 1,
        maxValue: 10,
        shape: 'coin' 
    },
    wood: { 
        name: 'Wood', 
        color: 0x8B4513,
        emissive: 0x654321,
        minValue: 1,
        maxValue: 5,
        shape: 'log' 
    },
    diamond: { 
        name: 'Diamond', 
        color: 0x00FFFF,
        emissive: 0x00AAFF,
        minValue: 5,
        maxValue: 10,
        shape: 'gem' 
    },
    iron: { 
        name: 'Iron', 
        color: 0xA0A0A0,
        emissive: 0x606060,
        minValue: 1,
        maxValue: 5,
        shape: 'ore' 
    },
    coal: { 
        name: 'Coal', 
        color: 0x2a2a2a,
        emissive: 0x1a1a1a,
        minValue: 1,
        maxValue: 5,
        shape: 'ore' 
    },
    food: { 
        name: 'Food', 
        color: 0xFF0000,
        emissive: 0xFF6666,
        minValue: 10,
        maxValue: 30,  // HP restored
        shape: 'apple' 
    }
};

/**
 * Item - Collectible resource that floats and bobs
 */
export class Item {
    constructor(scene, position, type) {
        this.scene = scene;
        this.type = type;
        this.config = RESOURCE_TYPES[type];
        this.position = position.clone();
        
        // Randomize value within range
        this.value = Math.floor(
            this.config.minValue + 
            Math.random() * (this.config.maxValue - this.config.minValue + 1)
        );
        
        // Animation
        this.bobTime = Math.random() * Math.PI * 2;  // Random phase
        this.bobHeight = 0.4;  // More pronounced bob
        this.bobSpeed = 2.5;
        this.rotationSpeed = 3;  // Faster rotation
        this.pulseSpeed = 4;
        
        // Gameplay
        this.collectionRadius = 2.0;  // Slightly larger collection radius
        this.lifeTime = 90;  // Longer lifetime (90 seconds)
        this.age = 0;
        this.collected = false;
        
        this.mesh = this.createMesh();
        this.scene.add(this.mesh);
        
        // Create glow ring effect
        this.glowRing = this.createGlowRing();
        this.scene.add(this.glowRing);
    }
    
    createMesh() {
        const config = this.config;
        let geometry;
        
        switch (config.shape) {
            case 'coin':
                // Flat cylinder (coin) - rotated to face sideways initially
                geometry = new THREE.CylinderGeometry(0.35, 0.35, 0.12, 12);
                // Rotate 90 degrees around X so it spins around Y axis sideways
                geometry.rotateX(Math.PI / 2);
                break;
                
            case 'log':
                // Small cylinder on side
                geometry = new THREE.CylinderGeometry(0.18, 0.18, 0.6, 8);
                geometry.rotateZ(Math.PI / 2);
                break;
                
            case 'gem':
                // Octahedron (diamond shape) - larger
                geometry = new THREE.OctahedronGeometry(0.35);
                break;
                
            case 'ore':
                // Small dodecahedron (rough rock)
                geometry = new THREE.DodecahedronGeometry(0.28);
                break;
                
            case 'apple':
                // Sphere (apple/food)
                geometry = new THREE.SphereGeometry(0.28, 10, 10);
                break;
                
            default:
                geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        }
        
        const material = new THREE.MeshLambertMaterial({ 
            color: config.color,
            emissive: config.emissive,
            emissiveIntensity: 0.5  // Brighter emissive
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(this.position);
        mesh.castShadow = true;
        
        return mesh;
    }
    
    /**
     * Create a rotating glow ring around the item for visibility
     */
    createGlowRing() {
        const geometry = new THREE.RingGeometry(0.6, 0.8, 16);
        const material = new THREE.MeshBasicMaterial({
            color: this.config.emissive,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide
        });
        
        const ring = new THREE.Mesh(geometry, material);
        ring.position.copy(this.position);
        ring.rotation.x = -Math.PI / 2;  // Lay flat on ground
        
        return ring;
    }
    
    update(deltaTime) {
        if (this.collected) return false;
        
        this.age += deltaTime;
        this.bobTime += deltaTime * this.bobSpeed;
        
        // Bob up and down
        const bobOffset = Math.sin(this.bobTime) * this.bobHeight;
        this.mesh.position.y = this.position.y + bobOffset;
        
        // Rotate around Y axis (vertical spin)
        this.mesh.rotation.y += deltaTime * this.rotationSpeed;
        
        // Pulse glow effect - more dramatic
        const pulse = 0.5 + Math.sin(this.bobTime * this.pulseSpeed) * 0.4;
        this.mesh.material.emissiveIntensity = pulse;
        
        // Rotate and pulse the glow ring
        if (this.glowRing) {
            this.glowRing.position.y = this.position.y + bobOffset * 0.3;
            this.glowRing.rotation.z += deltaTime * 1.5;
            this.glowRing.material.opacity = 0.3 + Math.sin(this.bobTime * this.pulseSpeed) * 0.2;
        }
        
        // Fade out near end of life
        if (this.age > this.lifeTime - 5) {
            const fadeTime = this.lifeTime - this.age;
            const fadeRatio = fadeTime / 5;
            this.mesh.material.opacity = fadeRatio;
            this.mesh.material.transparent = true;
            if (this.glowRing) {
                this.glowRing.material.opacity *= fadeRatio;
            }
        }
        
        // Check if should despawn
        if (this.age >= this.lifeTime) {
            this.destroy();
            return false;  // Remove from array
        }
        
        return true;  // Keep in array
    }
    
    /**
     * Check if entity is close enough to collect
     */
    canCollect(entityPosition) {
        return this.position.distanceTo(entityPosition) < this.collectionRadius;
    }
    
    /**
     * Collect this item
     */
    collect() {
        this.collected = true;
        this.destroy();
    }
    
    destroy() {
        this.scene.remove(this.mesh);
        if (this.glowRing) this.scene.remove(this.glowRing);
        
        if (this.mesh.geometry) this.mesh.geometry.dispose();
        if (this.mesh.material) this.mesh.material.dispose();
        if (this.glowRing && this.glowRing.geometry) this.glowRing.geometry.dispose();
        if (this.glowRing && this.glowRing.material) this.glowRing.material.dispose();
    }
}

/**
 * FloatingNumber - Billboard sprite for damage/healing/xp/resource feedback
 */
export class FloatingNumber {
    constructor(scene, camera, position, text, color = '#FFD700') {
        this.scene = scene;
        this.camera = camera;
        
        // Create canvas texture with text - wider for longer item names
        const canvas = document.createElement('canvas');
        canvas.width = 384;  // Wider (was 256)
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // Draw text with outline for visibility
        ctx.font = 'bold 56px Arial';  // Slightly smaller font to fit
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Outline
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 8;
        ctx.strokeText(text, 192, 64);  // Centered in wider canvas
        
        // Fill
        ctx.fillStyle = color;
        ctx.fillText(text, 192, 64);
        
        // Create sprite (always faces camera)
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        
        const material = new THREE.SpriteMaterial({ 
            map: texture,
            transparent: true
        });
        
        this.sprite = new THREE.Sprite(material);
        this.sprite.scale.set(3, 1, 1);  // Wider scale (was 2, 1, 1)
        this.sprite.position.copy(position);
        this.sprite.position.y += 2;  // Above entity
        
        this.scene.add(this.sprite);
        
        // Animation
        this.velocity = new THREE.Vector3(0, 2, 0);  // Float upward
        this.lifeTime = 1.5;
        this.age = 0;
    }
    
    update(deltaTime) {
        this.age += deltaTime;
        
        // Float upward
        this.sprite.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        
        // Fade out
        this.sprite.material.opacity = 1 - (this.age / this.lifeTime);
        
        // Remove when expired
        if (this.age >= this.lifeTime) {
            this.destroy();
            return false;
        }
        
        return true;
    }
    
    destroy() {
        this.scene.remove(this.sprite);
        if (this.sprite.material.map) this.sprite.material.map.dispose();
        if (this.sprite.material) this.sprite.material.dispose();
    }
}

/**
 * ItemSpawner - Manages item spawning across the world
 */
export class ItemSpawner {
    constructor(scene, terrain, camera) {
        this.scene = scene;
        this.terrain = terrain;
        this.camera = camera;
        this.items = [];
        this.floatingNumbers = [];
        
        // Spawn settings - 10x more items!
        this.spawnInterval = 0.5;  // Spawn every 0.5 seconds
        this.timeSinceSpawn = 0;
        this.maxItems = 200;  // Many more items
        this.minHeight = 10;  // Spawn on hills (lowered from 12)
        this.spawnRadius = 100;  // Spawn within 100 blocks of player
        
        // Resource weights (higher = more common)
        this.spawnWeights = {
            gold: 40,
            wood: 30,
            coal: 15,
            iron: 10,
            food: 10,
            diamond: 2
        };
    }
    
    /**
     * Update all items and spawn new ones
     */
    update(deltaTime, playerPosition = null) {
        // Update existing items
        this.items = this.items.filter(item => item.update(deltaTime));
        
        // Update floating numbers
        this.floatingNumbers = this.floatingNumbers.filter(num => num.update(deltaTime));
        
        // Spawn new items periodically
        this.timeSinceSpawn += deltaTime;
        if (this.timeSinceSpawn >= this.spawnInterval && this.items.length < this.maxItems) {
            this.spawnRandomItem(playerPosition);
            this.timeSinceSpawn = 0;
        }
    }
    
    /**
     * Spawn a random item on elevated terrain
     */
    spawnRandomItem(playerPosition = null) {
        // Try to find a good spawn position
        for (let attempts = 0; attempts < 10; attempts++) {
            // Random position within spawn radius
            const angle = Math.random() * Math.PI * 2;
            const distance = 20 + Math.random() * (this.spawnRadius - 20);  // Min 20 blocks away
            
            const centerX = playerPosition ? playerPosition.x : 0;
            const centerZ = playerPosition ? playerPosition.z : 0;
            
            const x = Math.floor(centerX + Math.cos(angle) * distance);
            const z = Math.floor(centerZ + Math.sin(angle) * distance);
            
            const height = this.terrain.getHeight(x, z);
            
            // Only spawn on elevated terrain (mountains/hills for platforming)
            if (height >= this.minHeight) {
                const type = this.getRandomResourceType();
                const position = new THREE.Vector3(x + 0.5, height + 2.0, z + 0.5);
                const item = new Item(this.scene, position, type);
                this.items.push(item);
                return item;
            }
        }
        
        return null;
    }
    
    /**
     * Get random resource type based on weights
     */
    getRandomResourceType() {
        const totalWeight = Object.values(this.spawnWeights).reduce((a, b) => a + b, 0);
        let random = Math.random() * totalWeight;
        
        for (const [type, weight] of Object.entries(this.spawnWeights)) {
            random -= weight;
            if (random <= 0) {
                return type;
            }
        }
        
        return 'gold';  // Fallback
    }
    
    /**
     * Check if entity can collect any nearby items
     * Returns collected items
     */
    checkCollection(entity) {
        const collected = [];
        
        this.items.forEach(item => {
            if (item.canCollect(entity.position)) {
                collected.push(item);
                item.collect();
            }
        });
        
        // Remove collected items
        this.items = this.items.filter(item => !item.collected);
        
        return collected;
    }
    
    /**
     * Show floating number at position
     */
    showFloatingNumber(position, value, type = 'gold', itemName = null) {
        let text, color;
        
        switch (type) {
            case 'gold':
            case 'resource':
                // Color based on item name
                if (itemName === 'Diamond') {
                    text = `+${value} ${itemName}`;
                    color = '#00FFFF';  // Cyan
                } else if (itemName === 'Gold') {
                    text = `+${value} ${itemName}`;
                    color = '#FFD700';  // Yellow
                } else if (itemName === 'Wood') {
                    text = `+${value} ${itemName}`;
                    color = '#8B4513';  // Brown
                } else if (itemName === 'Iron') {
                    text = `+${value} ${itemName}`;
                    color = '#A0A0A0';  // Gray
                } else if (itemName === 'Coal') {
                    text = `+${value} ${itemName}`;
                    color = '#FFFFFF';  // White (black text won't show)
                } else {
                    text = itemName ? `+${value} ${itemName}` : `+${value}`;
                    color = '#FFD700';
                }
                break;
            case 'xp':
                text = `+${value} XP`;
                color = '#00FF00';
                break;
            case 'damage':
                text = `-${value}`;
                color = '#FF0000';
                break;
            case 'heal':
                // Food - show just HP, no item name
                text = `+${value} HP`;
                color = '#00FF00';
                break;
            default:
                text = `${value}`;
                color = '#FFFFFF';
        }
        
        const floatingNum = new FloatingNumber(this.scene, this.camera, position, text, color);
        this.floatingNumbers.push(floatingNum);
    }
    
    /**
     * Spawn item at specific location (for mob drops, mining, etc.)
     */
    spawnItemAt(position, type) {
        const item = new Item(this.scene, position, type);
        this.items.push(item);
        return item;
    }
    
    /**
     * Clear all items
     */
    clearAll() {
        this.items.forEach(item => item.destroy());
        this.items = [];
        this.floatingNumbers.forEach(num => num.destroy());
        this.floatingNumbers = [];
    }
}
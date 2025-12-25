# Development Guide

Quick reference for common development tasks.

## Project Commands

```bash
# Install dependencies
npm install

# Start development server (http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Architecture

### Game Loop (src/game.js)

```javascript
animate() {
    requestAnimationFrame(() => this.animate());
    this.fpsCounter.update();           // Update FPS display
    const deltaTime = 0.016;            // Fixed timestep (60 FPS target)
    this.update(deltaTime);             // Update game state
    this.renderer.render(scene, camera); // Render frame
}
```

### Terrain Generation (src/terrain.js)

1. **Noise generation** - Perlin-like noise for natural terrain
2. **Biome selection** - Based on noise values and temperature
3. **Height calculation** - Per-biome base height + noise variation
4. **Block placement** - Surface blocks, subsurface, and stone

### Entity System (src/entities.js)

- **Entity** - Base class with physics, health, collision
- **Hero** - Player-controlled unit with tank controls
- **Golem** - AI units commanded by hero
- **EnemyUnit** - Hostile AI with targeting behavior

## Common Tasks

### Adding a New Biome

1. **Define biome in `src/terrain.js`:**
   ```javascript
   export const BIOMES = {
       // ... existing biomes ...
       jungle: { 
           name: 'Jungle', 
           baseHeight: 10, 
           heightScale: 8, 
           surface: 'grass', 
           subsurface: 'dirt' 
       }
   };
   ```

2. **Add biome logic in `getBiome()` method:**
   ```javascript
   } else if (remappedNoise < 0.XX) {
       biome = 'jungle';
   }
   ```

3. **Add biome-specific objects in `src/objects.js`:**
   ```javascript
   jungleTree: {
       name: 'Jungle Tree',
       biomes: ['jungle'],
       density: 0.04,
       hasCollision: true
   }
   ```

### Adding a New Block Type

1. **Add to `BLOCK_TYPES` in `src/terrain.js`:**
   ```javascript
   export const BLOCK_TYPES = {
       // ... existing types ...
       clay: { 
           name: 'Clay',
           tile: [x, y]  // Texture atlas coordinates
       }
   };
   ```

2. **Use in terrain generation:**
   ```javascript
   getBlockType(x, y, z) {
       // ... existing logic ...
       if (someCondition) {
           return 'clay';
       }
   }
   ```

### Adding Hero Abilities

1. **Add ability to Hero class in `src/entities.js`:**
   ```javascript
   class Hero extends Entity {
       constructor(scene, position) {
           super(scene, position, 0x0066cc, 1.2);
           this.abilities = {
               charge: { cooldown: 5, ready: true }
           };
       }
       
       useCharge() {
           if (!this.abilities.charge.ready) return;
           
           // Ability implementation
           const direction = new THREE.Vector3(
               Math.sin(this.rotation),
               0,
               Math.cos(this.rotation)
           );
           this.velocity.add(direction.multiplyScalar(20));
           
           // Start cooldown
           this.abilities.charge.ready = false;
           setTimeout(() => {
               this.abilities.charge.ready = true;
           }, this.abilities.charge.cooldown * 1000);
       }
   }
   ```

2. **Bind to key in `src/game.js`:**
   ```javascript
   handleInput(deltaTime) {
       // ... existing controls ...
       if (this.keys['q']) {
           this.hero.useCharge();
       }
   }
   ```

### Optimizing Performance

1. **Use the FPS counter** to identify performance issues
2. **Check the console** for terrain generation statistics
3. **Profile in browser DevTools:**
   - Chrome: Performance tab
   - Firefox: Performance tab
   - Look for long frames (>16ms for 60 FPS)

Common bottlenecks:
- Too many draw calls → Use more instancing
- Too many vertices → Reduce geometry detail
- Too many entities → Implement spatial culling
- Heavy computations in update() → Cache or optimize

### Adding New Entity Types

1. **Create class in `src/entities.js`:**
   ```javascript
   export class MyNewUnit extends Entity {
       constructor(scene, position) {
           super(scene, position, 0xFFFFFF, 1.0);
           this.team = 'neutral';
           // Custom properties
       }
       
       update(deltaTime, terrain, objectGenerator) {
           super.update(deltaTime, terrain, objectGenerator);
           // Custom behavior
       }
   }
   ```

2. **Spawn in `src/game.js`:**
   ```javascript
   init() {
       // ... after terrain generation ...
       const myUnit = new MyNewUnit(this.scene, spawnPosition);
       this.entities.push(myUnit);
   }
   ```

## Debugging Tips

### Enable Three.js Debug Helpers

```javascript
// In src/game.js init() method
const axesHelper = new THREE.AxesHelper(5);
this.scene.add(axesHelper);

const gridHelper = new THREE.GridHelper(100, 100);
this.scene.add(gridHelper);
```

### Log Entity Positions

```javascript
update(deltaTime) {
    // ... existing code ...
    console.log('Hero position:', this.hero.position);
    console.log('Golem count:', this.hero.commandedGolems.length);
}
```

### Visualize Collision Boxes

```javascript
// Add to entity createMesh()
const boxHelper = new THREE.BoxHelper(this.mesh, 0xff0000);
this.scene.add(boxHelper);
```

## Testing Checklist

Before committing changes:

- [ ] Game loads without console errors
- [ ] FPS is 30+ on target hardware
- [ ] All controls work as expected
- [ ] Entities spawn correctly
- [ ] Collision detection works
- [ ] Build succeeds (`npm run build`)
- [ ] Production build works (`npm run preview`)

## Hot Reload

Vite provides instant hot module replacement (HMR):
- Save any file in `src/`
- Browser updates automatically
- Game state is preserved when possible

## Browser Compatibility

Target browsers:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Features used:
- ES6 modules
- WebGL 1.0
- JavaScript ES2020

## Performance Targets

- **Desktop**: 60 FPS
- **Laptop**: 30-60 FPS  
- **Mobile**: 30 FPS (future)

Current optimizations:
- Surface-only block rendering (40-60% reduction)
- Instanced mesh rendering
- Fog-based draw distance
- Cached terrain noise calculations

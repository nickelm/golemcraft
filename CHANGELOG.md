# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Hero ability system (charge, heal, summon)
- Rally/banner mechanic for commanding golems
- Three hero archetypes (tank, assassin, summoner)
- Match phase system (early/mid/late game)
- Additional biomes and terrain features
- Mobile device support and touch controls

## [0.1.0] - 2024-12-25

### Added
- Initial game implementation
- Procedural terrain generation with 5 biomes (plains, desert, snow, mountains, ocean)
- Hero character with tank-style movement controls
- Golem units commanded by clicking
- Enemy AI units with targeting behavior
- Environmental objects (trees, rocks, cacti, grass)
- Surface-only block rendering optimization (40-60% performance improvement)
- FPS counter for performance monitoring
- Voxel-based rendering with Minecraft-style textures
- Physics system with gravity and collision detection
- Professional project structure with Vite build system

### Performance
- Desktop: 60 FPS (improved from 30 FPS)
- Laptop: 60 FPS (improved from 11 FPS)
- Optimized rendering reduces blocks by 40-60%

### Technical
- Three.js 0.160.0 for 3D rendering
- Instanced mesh rendering for efficient GPU usage
- Perlin-like noise for natural terrain generation
- Tank-style controls (WASD + mouse camera)
- OrbitControls for camera manipulation

## [0.0.1] - 2024-12-24

### Added
- Basic proof of concept
- Simple terrain generation
- Basic entity movement
- Initial game loop structure

---

## Version History Notes

### [0.1.0] Highlights

This release represents the first fully playable version of the game with significant performance optimizations. The surface-only block rendering optimization was crucial for making the game playable on lower-end hardware, improving laptop FPS from 11 to 60 - a 5x improvement.

Key architectural decisions:
- **Vite** chosen over webpack for faster development iteration
- **ES6 modules** for clean code organization
- **Instanced rendering** over individual meshes for performance
- **Procedural generation** to avoid large asset files

### Development Process

This project follows an iterative development approach:
1. Build core systems first (terrain, rendering, physics)
2. Add complexity progressively
3. Optimize based on performance measurements
4. Maintain code simplicity over feature complexity

The collaborative nature with my 8-year-old child influences design decisions toward accessibility and straightforward mechanics.

---

## Versioning Scheme

- **Major (X.0.0)**: Significant gameplay changes or architectural rewrites
- **Minor (0.X.0)**: New features, biomes, units, or substantial improvements
- **Patch (0.0.X)**: Bug fixes, small optimizations, documentation updates

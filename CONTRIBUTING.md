# Contributing to Minecraft MOBA Game

Thank you for your interest in contributing! This is primarily a personal learning project developed with my child, but we welcome suggestions and improvements.

## Development Setup

1. **Fork the repository** on GitHub

2. **Clone your fork:**
   ```bash
   git clone https://github.com/yourusername/minecraft-moba-game.git
   cd minecraft-moba-game
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

5. **Make your changes** and test thoroughly

6. **Build for production:**
   ```bash
   npm run build
   ```

## Code Structure

```
src/
├── main.js           # Entry point, game initialization
├── game.js           # Main game loop, scene management, input handling
├── terrain.js        # Procedural terrain generation, biomes, blocks
├── objects.js        # Environmental objects (trees, rocks, etc.)
├── entities.js       # Hero, Golem, Enemy classes and AI
└── utils/
    └── fps-counter.js # Performance monitoring
```

## Coding Guidelines

### Style

- Use ES6+ features (const/let, arrow functions, template literals)
- 4-space indentation
- Descriptive variable names
- Comments for complex algorithms

### Performance

- This project prioritizes performance for browser-based 3D
- Test changes on both desktop and laptop
- Use the FPS counter to verify performance impact
- Prefer instanced rendering over individual meshes
- Cache expensive calculations

### Three.js Best Practices

- Clean up geometries and materials when no longer needed
- Use `InstancedMesh` for repeated objects
- Implement frustum culling for large scenes
- Optimize draw calls

## Project Philosophy

This game balances:
- **Accessibility** - Playable by younger users (8+)
- **Strategic depth** - Interesting gameplay through emergent mechanics
- **Performance** - Runs well in browsers on modest hardware
- **Simplicity** - Clean code over feature complexity

## Areas for Contribution

### High Priority

- Hero ability system implementation
- Rally/banner mechanic for commanding golems
- Additional biome types
- Performance optimizations

### Medium Priority

- UI/UX improvements
- Sound effects and music
- Mobile touch controls
- Match progression system

### Low Priority (Future)

- Multiplayer networking
- Advanced graphics (shaders, particles)
- Map editor
- Campaign mode

## Submitting Changes

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Commit your changes:**
   ```bash
   git commit -m "Add feature: brief description"
   ```

3. **Push to your fork:**
   ```bash
   git push origin feature/your-feature-name
   ```

4. **Open a Pull Request** on GitHub

### Pull Request Guidelines

- Describe what your changes do and why
- Include before/after performance metrics if relevant
- Test on both desktop and laptop if possible
- Keep PRs focused - one feature per PR
- Update README.md if adding user-facing features

## Reporting Issues

When reporting bugs:

1. **Check existing issues** to avoid duplicates
2. **Provide context:**
   - Browser and version
   - Operating system
   - FPS measurement (if performance-related)
3. **Steps to reproduce** the issue
4. **Expected vs actual behavior**
5. **Screenshots or videos** if helpful

## Questions?

Feel free to open an issue for:
- Feature suggestions
- Design discussions
- Technical questions
- General feedback

## Code of Conduct

Be respectful and constructive. This is a learning project - we all start somewhere!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

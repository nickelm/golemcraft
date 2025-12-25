# Public Assets

This directory contains static assets served by Vite.

## terrain3.png

The Minecraft-style texture atlas used for block rendering.

### Specifications
- Format: PNG
- Dimensions: 770x616 pixels
- Tile grid: 10 columns × 8 rows
- Tile size: 74×74 pixels (with 3px border)
- Total tile size: 77×77 pixels

### Tile Mapping

The texture atlas uses a coordinate system where `[col, row]` maps to specific block types:

| Block Type | Coordinates |
|------------|-------------|
| Grass      | [5, 0]      |
| Dirt       | [9, 7]      |
| Stone      | [4, 3]      |
| Snow       | [5, 2]      |
| Sand       | [4, 7]      |
| Water      | [9, 1]      |
| Ice        | [6, 2]      |

### Usage

Place your `terrain3.png` file in this directory. The game will load it at runtime.

If you don't have a texture atlas, you can:
1. Use Minecraft texture packs (ensure license compatibility)
2. Create your own pixel art textures
3. Use placeholder solid colors for testing

### Creating Custom Textures

To add new block types:

1. Add a 74×74 pixel tile to the atlas
2. Update the coordinates in `src/terrain.js` in the `BLOCK_TYPES` object
3. Reference the new block type in terrain generation

Example:
```javascript
export const BLOCK_TYPES = {
    // ... existing types ...
    myNewBlock: { 
        name: 'My New Block',
        tile: [x, y]  // Your tile coordinates
    }
};
```

## Adding More Assets

For additional game assets:
- Images: Place in `/public/images/`
- Sounds: Place in `/public/sounds/`
- Models: Place in `/public/models/`

Reference them with absolute paths from root: `/images/myimage.png`

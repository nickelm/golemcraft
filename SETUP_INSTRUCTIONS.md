# Quick Setup Instructions

Get the game running in under 5 minutes!

## Prerequisites

- Node.js 18 or higher ([download here](https://nodejs.org/))
- npm (comes with Node.js)
- A modern web browser (Chrome, Firefox, Safari, or Edge)

## Quick Start

```bash
# 1. Clone or download this repository
git clone https://github.com/yourusername/golemcraft.git
cd golemcraft

# 2. Install dependencies
npm install

# 3. Add texture file
# Place your terrain3.png file in the public/ folder
# (See public/README.md for texture specifications)

# 4. Start the development server
npm run dev

# 5. Open your browser to http://localhost:5173
```

That's it! The game should now be running.

## First Time Setup Checklist

- [ ] Node.js installed (check with `node --version`)
- [ ] Repository cloned/downloaded
- [ ] Dependencies installed (`npm install` succeeded)
- [ ] Texture file in `public/terrain3.png`
- [ ] Dev server running (`npm run dev`)
- [ ] Browser opened to http://localhost:5173
- [ ] Game loads without errors (check browser console)
- [ ] FPS counter shows in top-right corner

## Troubleshooting

### "npm: command not found"
- Install Node.js from nodejs.org
- Restart your terminal after installation

### "Cannot find module 'vite'"
- Run `npm install` in the project directory
- Make sure you're in the `golemcraft` folder

### Black screen or white screen
- Check browser console (F12) for errors
- Verify `terrain3.png` exists in `public/` folder
- Try hard refresh (Ctrl+Shift+R or Cmd+Shift+R)

### Texture not loading
- Confirm file is named exactly `terrain3.png`
- File must be in `public/` folder (not `src/`)
- Check browser network tab for 404 errors

### Low FPS (< 30)
- This is normal during initial terrain generation
- Wait 2-3 seconds for generation to complete
- Check console for "Generated terrain" message
- If FPS stays low, try reducing terrain size in `src/game.js`:
  ```javascript
  this.generateTerrain(100, 100); // Smaller = faster
  ```

## Next Steps

Once the game is running:

1. **Learn the controls** - See the on-screen control panel
2. **Explore the code** - Read `DEVELOPMENT.md` for architecture
3. **Make changes** - Edit files in `src/` and see instant updates
4. **Read documentation:**
   - `README.md` - Project overview
   - `DEVELOPMENT.md` - Development guide
   - `DEPLOYMENT.md` - How to deploy online
   - `CONTRIBUTING.md` - How to contribute

## Common Questions

**Q: Do I need a texture file to run the game?**
A: Yes, the game expects `terrain3.png` in the `public/` folder. You can create your own or use existing textures.

**Q: Can I change the terrain size?**
A: Yes! In `src/game.js`, find `this.generateTerrain(500, 500)` and change the numbers to make it smaller (faster) or larger (more exploration).

**Q: How do I deploy this online?**
A: See `DEPLOYMENT.md` for detailed instructions on deploying to GitHub Pages, Netlify, Vercel, or other platforms.

**Q: Can I add new features?**
A: Absolutely! See `DEVELOPMENT.md` for guides on adding biomes, blocks, entities, and abilities.

**Q: Why is my laptop slower than desktop?**
A: This is normal. The game uses 3D graphics which are GPU-intensive. The optimizations we've implemented should still give you 30-60 FPS on modern laptops.

## Support

- **Bug reports**: Open an issue on GitHub
- **Questions**: Check existing issues or open a new one
- **Improvements**: See `CONTRIBUTING.md` for contribution guidelines

Happy gaming!

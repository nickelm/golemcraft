# Deployment Guide

This guide covers deploying your Minecraft MOBA game to various hosting platforms.

## GitHub Pages

GitHub Pages offers free static site hosting directly from your repository.

### Setup

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Create a `gh-pages` branch:**
   ```bash
   git checkout -b gh-pages
   ```

3. **Copy dist contents to root:**
   ```bash
   cp -r dist/* .
   git add .
   git commit -m "Deploy to GitHub Pages"
   git push origin gh-pages
   ```

4. **Enable GitHub Pages:**
   - Go to repository Settings → Pages
   - Source: Deploy from branch `gh-pages`
   - Click Save

Your game will be available at: `https://yourusername.github.io/minecraft-moba-game/`

### Automated Deployment with GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm install
        
      - name: Build
        run: npm run build
        
      - name: Deploy
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

## Netlify

Netlify provides continuous deployment with automatic builds.

### Setup

1. **Connect your repository:**
   - Go to [netlify.com](https://netlify.com)
   - Click "Add new site" → "Import an existing project"
   - Connect your GitHub repository

2. **Configure build settings:**
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Click "Deploy site"

Your site will be available at a Netlify URL like: `https://your-site-name.netlify.app`

### Custom Domain

In Netlify dashboard:
- Go to Domain settings
- Add custom domain
- Follow DNS configuration instructions

## Vercel

Vercel offers zero-config deployment for Vite projects.

### Setup

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel
   ```

3. **For production:**
   ```bash
   vercel --prod
   ```

### Via Dashboard

- Go to [vercel.com](https://vercel.com)
- Import your GitHub repository
- Vercel auto-detects Vite configuration
- Click Deploy

## itch.io

itch.io is popular for indie game hosting.

### Setup

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Create a ZIP file:**
   ```bash
   cd dist
   zip -r ../minecraft-moba-game.zip *
   cd ..
   ```

3. **Upload to itch.io:**
   - Create a new project at [itch.io](https://itch.io/game/new)
   - Upload the ZIP file
   - Set "Kind of project" to "HTML"
   - Check "This file will be played in the browser"
   - Set index.html as the entry point
   - Publish!

## Self-Hosting

For hosting on your own server:

1. **Build:**
   ```bash
   npm run build
   ```

2. **Upload `dist/` folder** to your web server

3. **Configure server** to serve `index.html` for all routes

### Nginx Configuration

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /path/to/dist;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Apache Configuration

Create `.htaccess` in the `dist` folder:

```apache
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteBase /
    RewriteRule ^index\.html$ - [L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule . /index.html [L]
</IfModule>
```

## Performance Optimization

Before deployment, ensure optimal performance:

1. **Check texture file size:**
   - Compress `terrain3.png` if > 500KB
   - Use tools like TinyPNG or ImageOptim

2. **Enable gzip compression:**
   - Most hosting platforms enable this by default
   - For self-hosting, configure your web server

3. **Set cache headers:**
   - Cache static assets for 1 year
   - Vite automatically adds content hashes to filenames

4. **Test on target devices:**
   - Desktop browsers
   - Mobile devices (if supporting)
   - Different screen sizes

## Troubleshooting

### White screen on deployment
- Check browser console for errors
- Verify all asset paths are correct
- Ensure `base: './'` in `vite.config.js` for GitHub Pages

### Texture not loading
- Confirm `terrain3.png` is in the `public/` folder
- Check network tab for 404 errors
- Verify path is `/terrain3.png` (absolute)

### Performance issues
- Run `npm run build` to create optimized production bundle
- Never deploy the dev server (`npm run dev`) to production
- Check FPS counter - should show 30+ FPS on target hardware

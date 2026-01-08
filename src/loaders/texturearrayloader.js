/**
 * TextureArrayLoader
 *
 * Loads images into WebGL2 DataArrayTexture (texture array) objects.
 * Supports parallel loading via ImageBitmapLoader with strict dimension validation.
 *
 * Usage:
 *   const loader = new TextureArrayLoader();
 *   const diffuseArray = await loader.loadDiffuseArray(paths);
 *   const normalArray = await loader.loadNormalArray(paths);
 */

import * as THREE from 'three';

export class TextureArrayLoader {
    /**
     * @param {THREE.LoadingManager} manager - Optional loading manager
     */
    constructor(manager) {
        this.manager = manager !== undefined ? manager : THREE.DefaultLoadingManager;
    }

    /**
     * Load diffuse texture array (sRGB color space)
     *
     * @param {string[]} paths - Array of image paths relative to public/ directory
     * @param {Function} onProgress - Optional progress callback
     * @returns {Promise<THREE.DataArrayTexture>} 1024×1024×N sRGB texture array
     */
    async loadDiffuseArray(paths, onProgress) {
        const imageBitmaps = await this._loadImagesInParallel(paths, onProgress);
        if (onProgress) onProgress({ loaded: paths.length, total: paths.length });
        return this._createTextureArray(imageBitmaps, 1024, 1024, THREE.SRGBColorSpace);
    }

    /**
     * Load normal map texture array (linear color space)
     *
     * @param {string[]} paths - Array of image paths relative to public/ directory
     * @param {Function} onProgress - Optional progress callback
     * @returns {Promise<THREE.DataArrayTexture>} 512×512×N linear texture array
     */
    async loadNormalArray(paths, onProgress) {
        const imageBitmaps = await this._loadImagesInParallel(paths, onProgress);
        if (onProgress) onProgress({ loaded: paths.length, total: paths.length });
        return this._createTextureArray(imageBitmaps, 512, 512, THREE.LinearSRGBColorSpace);
    }

    /**
     * Load all images in parallel using ImageBitmapLoader
     *
     * @param {string[]} paths - Array of image paths
     * @param {Function} onProgress - Optional progress callback
     * @returns {Promise<ImageBitmap[]>} Array of ImageBitmap objects
     * @private
     */
    async _loadImagesInParallel(paths, onProgress) {
        const loader = new THREE.ImageBitmapLoader(this.manager);

        // Load all images in parallel
        const promises = paths.map((path, index) => {
            return loader.loadAsync(path).then(bitmap => {
                // Report individual image progress if callback provided
                if (onProgress) {
                    onProgress({ loaded: index + 1, total: paths.length, path });
                }
                return bitmap;
            });
        });

        return Promise.all(promises);
    }

    /**
     * Validate that all images have expected dimensions
     *
     * @param {ImageBitmap[]} imageBitmaps - Array of loaded images
     * @param {number} expectedWidth - Expected width in pixels
     * @param {number} expectedHeight - Expected height in pixels
     * @throws {Error} If any image doesn't match expected dimensions
     * @private
     */
    _validateDimensions(imageBitmaps, expectedWidth, expectedHeight) {
        for (let i = 0; i < imageBitmaps.length; i++) {
            const bitmap = imageBitmaps[i];
            if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) {
                throw new Error(
                    `TextureArrayLoader: Image ${i} has dimensions ${bitmap.width}×${bitmap.height}, ` +
                    `expected ${expectedWidth}×${expectedHeight}`
                );
            }
        }
    }

    /**
     * Extract pixel data from ImageBitmap using canvas
     *
     * @param {ImageBitmap} imageBitmap - Source image
     * @returns {Uint8ClampedArray} RGBA pixel data
     * @private
     */
    _extractPixelData(imageBitmap) {
        const canvas = document.createElement('canvas');
        canvas.width = imageBitmap.width;
        canvas.height = imageBitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageBitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return imageData.data;  // Uint8ClampedArray is compatible with Uint8Array
    }

    /**
     * Create DataArrayTexture from loaded images
     *
     * @param {ImageBitmap[]} imageBitmaps - Array of loaded images
     * @param {number} width - Texture width (must match all images)
     * @param {number} height - Texture height (must match all images)
     * @param {number} colorSpace - THREE.SRGBColorSpace or THREE.LinearSRGBColorSpace
     * @returns {THREE.DataArrayTexture} Configured texture array
     * @private
     */
    _createTextureArray(imageBitmaps, width, height, colorSpace) {
        // Strict dimension validation
        this._validateDimensions(imageBitmaps, width, height);

        const layerCount = imageBitmaps.length;
        const data = new Uint8Array(width * height * layerCount * 4);

        // Pack each layer into the data array
        for (let i = 0; i < layerCount; i++) {
            const layerData = this._extractPixelData(imageBitmaps[i]);
            const offset = i * width * height * 4;
            data.set(layerData, offset);
        }

        // Create DataArrayTexture (proper WebGL2 texture array - not Data3DTexture!)
        // DataArrayTexture uses TEXTURE_2D_ARRAY target, Data3DTexture uses TEXTURE_3D
        const texture = new THREE.DataArrayTexture(data, width, height, layerCount);

        // Configure texture format
        texture.format = THREE.RGBAFormat;
        texture.type = THREE.UnsignedByteType;
        texture.colorSpace = colorSpace;

        // Configure texture wrapping (repeat for tiling)
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;

        // Configure texture filtering (trilinear)
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;

        // Enable mipmap generation
        texture.generateMipmaps = true;

        // Mark texture as needing GPU upload
        texture.needsUpdate = true;

        return texture;
    }
}

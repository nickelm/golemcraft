/**
 * UI feedback utilities for visual effects
 * Pure DOM effects with no game state dependencies
 */

/**
 * Flash the screen with a color overlay
 * @param {string} color - CSS color value
 * @param {number} opacity - Opacity value (0-1), default 0.3
 */
export function flashScreen(color, opacity = 0.3) {
    const flash = document.createElement('div');
    flash.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: ${color};
        opacity: ${opacity};
        pointer-events: none;
        z-index: 9999;
        transition: opacity 0.3s;
    `;
    document.body.appendChild(flash);

    setTimeout(() => {
        flash.style.opacity = '0';
        setTimeout(() => flash.remove(), 300);
    }, 100);
}

/**
 * Pulse the resource UI to indicate a resource was collected
 * @param {string} resourceType - Type of resource (currently unused, for future per-resource styling)
 */
export function pulseResourceUI(resourceType) {
    const stats = document.getElementById('stats');
    if (!stats) return;

    stats.classList.add('resource-pulse');
    setTimeout(() => stats.classList.remove('resource-pulse'), 500);
}

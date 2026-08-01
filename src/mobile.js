// Mobile support - touch controls, auto UI scaling, landscape mode
import { WORLD_W, WORLD_H } from './utils.js';
import { input } from './input.js';

let isMobile = false;
let joystick = null;
let dashButton = null;
let boostButton = null;

// Detect mobile device
export function detectMobile() {
  isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
             (window.innerWidth <= 800 && 'ontouchstart' in window);
  return isMobile;
}

// Create virtual joystick
export function createJoystick(container) {
  if (!isMobile) return null;
  
  joystick = document.createElement('div');
  joystick.id = 'joystick';
  joystick.style.cssText = `
    position: fixed;
    bottom: 40px;
    left: 40px;
    width: 120px;
    height: 120px;
    border: 4px solid rgba(255,255,255,0.3);
    border-radius: 50%;
    background: rgba(0,0,0,0.2);
    touch-action: none;
    z-index: 1000;
  `;
  
  const stick = document.createElement('div');
  stick.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    width: 60px;
    height: 60px;
    margin: -30px;
    background: rgba(255,255,255,0.5);
    border-radius: 50%;
    transition: all 0.1s;
  `;
  joystick.appendChild(stick);
  
  let touchId = null;
  const center = { x: 60, y: 60 };
  
  joystick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touchId = e.changedTouches[0].identifier;
    stick.style.background = 'rgba(255,255,255,0.8)';
  }, { passive: false });
  
  joystick.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        const touch = e.changedTouches[i];
        const rect = joystick.getBoundingClientRect();
        let dx = touch.clientX - rect.left - center.x;
        let dy = touch.clientY - rect.top - center.y;
        
        // Limit to circle
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = 50;
        if (dist > maxDist) {
          dx = (dx / dist) * maxDist;
          dy = (dy / dist) * maxDist;
        }
        
        stick.style.transform = `translate(${dx}px, ${dy}px)`;
        
        // Update input
        input.mouseCanvas.x = WORLD_W / 2 + (dx / maxDist) * 200;
        input.mouseCanvas.y = WORLD_H / 2 + (dy / maxDist) * 200;
      }
    }
  }, { passive: false });
  
  joystick.addEventListener('touchend', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        touchId = null;
        stick.style.transform = 'translate(0, 0)';
        stick.style.background = 'rgba(255,255,255,0.5)';
        input.mouseCanvas.x = WORLD_W / 2;
        input.mouseCanvas.y = WORLD_H / 2;
      }
    }
  });
  
  container.appendChild(joystick);
  return joystick;
}

// Create action buttons
export function createActionButtons(container) {
  if (!isMobile) return;
  
  // Dash button (right side)
  dashButton = document.createElement('button');
  dashButton.textContent = 'DASH';
  dashButton.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 160px;
    width: 80px;
    height: 80px;
    border: 4px solid rgba(100,200,255,0.6);
    border-radius: 50%;
    background: rgba(0,100,200,0.3);
    color: white;
    font-size: 14px;
    font-weight: bold;
    touch-action: none;
    z-index: 1000;
  `;
  
  dashButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    input.dashQueued = true;
    dashButton.style.background = 'rgba(100,200,255,0.6)';
  }, { passive: false });
  
  dashButton.addEventListener('touchend', () => {
    dashButton.style.background = 'rgba(0,100,200,0.3)';
  });
  
  container.appendChild(dashButton);
  
  // Boost button (right side, above dash)
  boostButton = document.createElement('button');
  boostButton.textContent = 'BOOST';
  boostButton.style.cssText = `
    position: fixed;
    bottom: 180px;
    right: 60px;
    width: 100px;
    height: 100px;
    border: 4px solid rgba(255,200,100,0.6);
    border-radius: 50%;
    background: rgba(200,100,0,0.3);
    color: white;
    font-size: 16px;
    font-weight: bold;
    touch-action: none;
    z-index: 1000;
  `;
  
  boostButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    input.boosting = true;
    boostButton.style.background = 'rgba(255,200,100,0.6)';
  }, { passive: false });
  
  boostButton.addEventListener('touchend', () => {
    input.boosting = false;
    boostButton.style.background = 'rgba(200,100,0,0.3)';
  });
  
  container.appendChild(boostButton);
}

// Setup viewport for mobile
export function setupMobileViewport() {
  if (!isMobile) return;
  
  // Add viewport meta tag if not present
  let viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    document.head.appendChild(viewport);
  }
  viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
  
  // Lock to landscape if supported
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(err => {
      console.log('Orientation lock failed:', err);
    });
  }
  
  // Prevent default touch behaviors
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('gesturechange', e => e.preventDefault());
  document.addEventListener('gestureend', e => e.preventDefault());
  
  // Auto-scale canvas
  autoScaleCanvas();
  window.addEventListener('resize', autoScaleCanvas);
  window.addEventListener('orientationchange', autoScaleCanvas);
}

// Auto-scale canvas to fit screen
function autoScaleCanvas() {
  const canvas = document.querySelector('canvas');
  if (!canvas) return;
  
  const windowW = window.innerWidth;
  const windowH = window.innerHeight;
  const gameRatio = WORLD_W / WORLD_H;
  const windowRatio = windowW / windowH;
  
  let newW, newH;
  if (windowRatio > gameRatio) {
    newH = windowH;
    newW = newH * gameRatio;
  } else {
    newW = windowW;
    newH = newW / gameRatio;
  }
  
  canvas.style.width = newW + 'px';
  canvas.style.height = newH + 'px';
  canvas.style.position = 'absolute';
  canvas.style.left = (windowW - newW) / 2 + 'px';
  canvas.style.top = (windowH - newH) / 2 + 'px';
}

// Initialize mobile support
export function initMobile() {
  if (!detectMobile()) return false;
  
  setupMobileViewport();
  createJoystick(document.body);
  createActionButtons(document.body);
  
  return true;
}

export function isMobileDevice() {
  return isMobile;
}
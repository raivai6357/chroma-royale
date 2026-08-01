import { WORLD_W, WORLD_H } from './utils.js';
import { DashCommand, BoostCommand } from './events.js';

// The input intent object — systems read this rather than input mutating entities
// directly. `dashQueued` is a one-shot flag the game consumes each step and clears,
// so dash still fires on the same frame the key/click was pressed.
export const input = {
  mouseCanvas: { x: WORLD_W/2, y: WORLD_H/2 },
  boosting: false,
  dashQueued: false
};

// Command generator for multiplayer sync.
// When a game instance is provided, input actions also queue commands.
let _gameRef = null;
export function setInputGame(game) {
  _gameRef = game;
}

// Generate a dash command from current input state
export function createDashCommand(entityId, tick, facingX, facingY) {
  return new DashCommand(entityId, tick, facingX, facingY);
}

// Generate a boost command from current input state
export function createBoostCommand(entityId, tick, active) {
  return new BoostCommand(entityId, tick, active);
}

// consume the queued dash (returns true once per press, then resets)
export function consumeDash(){
  if(input.dashQueued){ input.dashQueued = false; return true; }
  return false;
}

function toCanvasCoords(canvas, clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (WORLD_W/rect.width),
    y: (clientY - rect.top) * (WORLD_H/rect.height)
  };
}

// Wire all listeners once. `canvas` is the game canvas element.
export function setupInput(canvas){
  canvas.addEventListener('mousemove', e=>{
    input.mouseCanvas = toCanvasCoords(canvas, e.clientX, e.clientY);
  });
  canvas.addEventListener('mousedown', e=>{
    if(e.button===0) input.boosting = true;
    if(e.button===2) input.dashQueued = true;
  });
  canvas.addEventListener('contextmenu', e=>e.preventDefault());
  window.addEventListener('mouseup', e=>{ if(e.button===0) input.boosting = false; });

  // --- touch: single touch steers, double tap boosts ---
  // A plain touch (or drag) only moves the aim point, so the blob walks toward the
  // finger at base speed and costs no HP. Boost — which drains BOOST_DRAIN hp/sec —
  // is opt-in: tap twice quickly and hold, and boost stays on until the finger lifts.
  const DOUBLE_TAP_MS = 280;
  let lastTapT = -Infinity;
  let touchBoost = false;   // true while a double-tap-and-hold is active

  canvas.addEventListener('touchstart', e=>{
    const t = e.touches[0];
    if(!t) return;
    input.mouseCanvas = toCanvasCoords(canvas, t.clientX, t.clientY);
    const now = performance.now();
    if(now - lastTapT < DOUBLE_TAP_MS){
      touchBoost = true;
      input.boosting = true;
      lastTapT = -Infinity;   // don't let a third tap chain off this one
    } else {
      lastTapT = now;
    }
  }, {passive:true});

  canvas.addEventListener('touchmove', e=>{
    const t = e.touches[0];
    if(!t) return;
    input.mouseCanvas = toCanvasCoords(canvas, t.clientX, t.clientY);
  }, {passive:true});

  // boost only ends once every finger is off the screen, so a multi-touch slip
  // doesn't silently cut it mid-sprint
  const endTouch = e=>{
    if(e.touches && e.touches.length) return;
    if(touchBoost){ touchBoost = false; input.boosting = false; }
  };
  window.addEventListener('touchend', endTouch);
  window.addEventListener('touchcancel', endTouch);

  window.addEventListener('keydown', e=>{
    if(e.code==='Tab' || e.code==='Space'){
      e.preventDefault();
      input.boosting = true;
    }
    if((e.code==='ShiftLeft' || e.code==='ShiftRight' || e.code==='KeyE') && !e.repeat){
      input.dashQueued = true;
    }
  });
  window.addEventListener('keyup', e=>{
    if(e.code==='Tab' || e.code==='Space'){
      input.boosting = false;
    }
  });

  // mobile dash button
  const dashBtn = document.getElementById('dashBtn');
  if(dashBtn){
    dashBtn.addEventListener('touchstart', e=>{ e.preventDefault(); input.dashQueued = true; }, {passive:false});
    dashBtn.addEventListener('click', ()=>{ input.dashQueued = true; });
  }
}

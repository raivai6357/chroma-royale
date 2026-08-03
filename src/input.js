import { WORLD_W, WORLD_H } from './utils.js';

// The input intent object — systems read this rather than input mutating entities
// directly. `dashQueued` is a one-shot flag the game consumes each step and clears,
// so dash still fires on the same frame the key/click was pressed.
//
// Two steering schemes feed the same intent:
//   mouseCanvas — an aim *point* in world coords (mouse / tablet tap-to-aim)
//   stickX/Y    — an aim *vector* from the on-screen joystick, magnitude <= 1
// `stickMode` records which one the player last touched, so a stale mouse
// position can't fight the stick (and vice versa). aimDir() resolves the two.
export const input = {
  mouseCanvas: { x: WORLD_W/2, y: WORLD_H/2 },
  boosting: false,
  dashQueued: false,
  stickX: 0,
  stickY: 0,
  stickActive: false,  // finger is currently down on the pad
  stickMode: false     // the joystick is the steering source
};

// consume the queued dash (returns true once per press, then resets)
export function consumeDash(){
  if(input.dashQueued){ input.dashQueued = false; return true; }
  return false;
}

// The one place steering intent is resolved, so local prediction, the input we
// send the server, and the eye's gaze can't disagree about where you're headed.
// Returns a direction whose magnitude is 0..1 — partial on a half-pushed stick,
// which reads as analog speed control because acceleration scales with it.
export function aimDir(px, py){
  if(input.stickMode){
    // Released stick means "stop", not "keep going": without this the blob would
    // coast on toward wherever the finger last was.
    if(!input.stickActive) return { x: 0, y: 0 };
    return { x: input.stickX, y: input.stickY };
  }
  const dx = input.mouseCanvas.x - px;
  const dy = input.mouseCanvas.y - py;
  const d = Math.hypot(dx, dy);
  // Dead zone: don't jitter when the cursor is basically on top of the blob.
  return d > 4 ? { x: dx/d, y: dy/d } : { x: 0, y: 0 };
}

function toCanvasCoords(canvas, clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (WORLD_W/rect.width),
    y: (clientY - rect.top) * (WORLD_H/rect.height)
  };
}

// ---------- on-screen joystick ----------
// Fixed pad in the bottom-left gutter. The knob tracks the finger out to
// STICK_R, and the normalized offset becomes the steering vector — so pushing
// halfway really does move at roughly half speed.
const STICK_R = 52;        // px of travel from centre to the rim
const STICK_DEADZONE = 0.16; // below this the stick reads as neutral

// Which finger is holding BOOST. Module-scoped so releaseInputs() can forget it:
// a pause with the finger still down would otherwise leave a stale id behind that
// some later, unrelated touchend could match.
let boostTouch = null;

function setupStick(){
  const pad = document.getElementById('stick');
  const knob = document.getElementById('stickKnob');
  if(!pad || !knob) return;

  let touchId = null;

  const reset = () => {
    touchId = null;
    input.stickActive = false;
    input.stickX = 0;
    input.stickY = 0;
    knob.style.transform = 'translate(-50%,-50%)';
  };

  // Offsets are measured from the pad's own centre rather than from wherever the
  // finger first landed, so the knob can't drift away from the ring it's drawn in.
  const track = (t) => {
    const r = pad.getBoundingClientRect();
    const cx = r.left + r.width/2;
    const cy = r.top + r.height/2;
    const rawX = t.clientX - cx;
    const rawY = t.clientY - cy;
    const d = Math.hypot(rawX, rawY);

    // Direction comes off the *unclamped* offset, magnitude off the clamped one.
    // Deriving both from a clamped vector divided by the raw distance would make
    // a hard shove past the rim read as *less* deflection the further it went.
    const mag = Math.min(1, d/STICK_R);
    if(mag < STICK_DEADZONE || d === 0){
      input.stickX = 0;
      input.stickY = 0;
    } else {
      // Rescale past the dead zone so the first responsive pixel of travel isn't
      // already a hard shove — otherwise fine adjustment is impossible.
      const want = (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE);
      input.stickX = (rawX/d) * want;
      input.stickY = (rawY/d) * want;
    }
    // The knob itself stops at the rim even when the finger runs past it.
    const kx = d > STICK_R ? rawX/d*STICK_R : rawX;
    const ky = d > STICK_R ? rawY/d*STICK_R : rawY;
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  };

  pad.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    if(!t) return;
    touchId = t.identifier;
    input.stickActive = true;
    input.stickMode = true;
    pad.classList.add('active');
    track(t);
  }, {passive:false});

  pad.addEventListener('touchmove', e => {
    e.preventDefault();
    for(const t of e.changedTouches){
      if(t.identifier === touchId){ track(t); return; }
    }
  }, {passive:false});

  // Bound to the window, not the pad: a finger that slides off the pad still
  // fires its touchend on the pad, but one lifted after the element re-layouts
  // (orientation change) may not — and a stuck stick is worse than a dropped one.
  const end = e => {
    if(touchId === null) return;
    for(const t of e.changedTouches){
      if(t.identifier === touchId){
        pad.classList.remove('active');
        reset();
        return;
      }
    }
  };
  window.addEventListener('touchend', end, {passive:true});
  window.addEventListener('touchcancel', end, {passive:true});

  // Mouse support so the pad is testable in a desktop browser without touch
  // emulation; the pad is display:none there, so players never see it.
  pad.addEventListener('mousedown', e => {
    e.preventDefault();
    touchId = -1;
    input.stickActive = true;
    input.stickMode = true;
    track(e);
    const move = ev => track(ev);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      reset();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

// Wire all listeners once. `canvas` is the game canvas element.
export function setupInput(canvas){
  canvas.addEventListener('mousemove', e=>{
    input.mouseCanvas = toCanvasCoords(canvas, e.clientX, e.clientY);
    input.stickMode = false;   // last input wins: back to mouse steering
  });
  canvas.addEventListener('mousedown', e=>{
    if(e.button===0) input.boosting = true;
    if(e.button===2) input.dashQueued = true;
  });
  canvas.addEventListener('contextmenu', e=>e.preventDefault());
  window.addEventListener('mouseup', e=>{ if(e.button===0) input.boosting = false; });

  // --- touch on the arena itself: drag to aim ---
  // Kept for tablets, where reaching the whole arena is natural. It's aim-only:
  // boost is the BOOST button now, so a stray tap can't start draining HP.
  // Touching the canvas hands steering back from the stick to the aim point.
  canvas.addEventListener('touchstart', e=>{
    const t = e.touches[0];
    if(!t) return;
    input.mouseCanvas = toCanvasCoords(canvas, t.clientX, t.clientY);
    input.stickMode = false;
  }, {passive:true});

  canvas.addEventListener('touchmove', e=>{
    const t = e.touches[0];
    if(!t) return;
    input.mouseCanvas = toCanvasCoords(canvas, t.clientX, t.clientY);
    input.stickMode = false;
  }, {passive:true});

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

  setupStick();

  // mobile dash button
  const dashBtn = document.getElementById('dashBtn');
  if(dashBtn){
    dashBtn.addEventListener('touchstart', e=>{ e.preventDefault(); input.dashQueued = true; }, {passive:false});
    dashBtn.addEventListener('click', ()=>{ input.dashQueued = true; });
  }

  // Boost button — held, not toggled, mirroring Space on a keyboard. Boost
  // drains HP, so releasing it has to be immediate and unmissable: every exit
  // path (lift, cancel, or the finger sliding off) clears it.
  const boostBtn = document.getElementById('boostBtn');
  if(boostBtn){
    // Track the specific finger. With two thumbs down (stick + boost) the
    // touchend for the *stick* also bubbles to window, so releasing on any
    // touchend would cut boost the moment the other thumb lifted.
    const on = e => {
      e.preventDefault();
      const t = e.changedTouches ? e.changedTouches[0] : null;
      if(t) boostTouch = t.identifier;
      input.boosting = true;
      boostBtn.classList.add('active');
    };
    const off = () => { boostTouch = null; input.boosting = false; boostBtn.classList.remove('active'); };
    // Release is bound to window, not the button: if the finger slides off the
    // button before lifting, the button never sees the touchend and boost would
    // stay latched on, draining HP with nothing held down.
    const endIfOurs = e => {
      if(boostTouch === null) return;
      for(const t of e.changedTouches){
        if(t.identifier === boostTouch){ off(); return; }
      }
    };
    boostBtn.addEventListener('touchstart', on, {passive:false});
    window.addEventListener('touchend', endIfOurs, {passive:true});
    window.addEventListener('touchcancel', endIfOurs, {passive:true});
    boostBtn.addEventListener('mousedown', on);
    window.addEventListener('mouseup', off);
  }
}

// Drop every held input. Called when a round ends or a menu opens, so boost
// can't stay latched on across a state change and quietly drain HP.
export function releaseInputs(){
  input.boosting = false;
  input.stickActive = false;
  input.stickX = 0;
  input.stickY = 0;
  input.dashQueued = false;
  boostTouch = null;
  const knob = document.getElementById('stickKnob');
  if(knob) knob.style.transform = 'translate(-50%,-50%)';
  const pad = document.getElementById('stick');
  if(pad) pad.classList.remove('active');
  const boostBtn = document.getElementById('boostBtn');
  if(boostBtn) boostBtn.classList.remove('active');
}

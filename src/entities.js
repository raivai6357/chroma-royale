import {
  WORLD_W, WORLD_H, COLOR_KEYS, rand, radiusForHp, DASH_STATE,
  TRAIL_LENGTH, TRAIL_LIFETIME
} from './utils.js';

// spawn positions: one player per corner
export const SPAWN_MARGIN = 60;
export const CORNERS = [
  {x: SPAWN_MARGIN,           y: SPAWN_MARGIN},           // top-left
  {x: WORLD_W - SPAWN_MARGIN, y: SPAWN_MARGIN},           // top-right
  {x: SPAWN_MARGIN,           y: WORLD_H - SPAWN_MARGIN}, // bottom-left
  {x: WORLD_W - SPAWN_MARGIN, y: WORLD_H - SPAWN_MARGIN}  // bottom-right
];

// EntityManager owns the single entities array and hands out stable ids.
// Networking depends on every entity having a unique id, so id assignment is
// funnelled through add() — nothing enters the world without one.
export class EntityManager {
  constructor(){
    this.entities = [];
    this._nextId = 1;
  }
  nextId(){ return this._nextId++; }
  add(e){
    e.id = this.nextId();
    this.entities.push(e);
    return e;
  }
  // convenience views
  actors(){ return this.entities.filter(e => e.kind === 'player' || e.kind === 'bot'); }
  boxes(){ return this.entities.filter(e => e.kind === 'box'); }
}

// player + bots. `kind` distinguishes them; boxes use makeBox below.
// `difficulty` only affects bots: 'easy' | 'medium' | 'hard'
export function makeEntity(isPlayer, name, spawnIndex, difficulty = 'medium'){
  const corner = CORNERS[spawnIndex % CORNERS.length];
  return {
    kind: isPlayer ? 'player' : 'bot',
    isPlayer,
    name,
    x: corner.x,
    y: corner.y,
    vx: 0, vy: 0,
    facingX: 1, facingY: 0,
    color: COLOR_KEYS[Math.floor(rand(0,3))],
    hp: 100,
    alive: true,
    radius: radiusForHp(100),
    boosting:false,
    dashCooldown: 0,
    dashFlash: 0,
    // Dash state machine: Ready → Windup → Active → Recovery → Ready
    dashState: DASH_STATE.READY,
    dashStateTimer: 0,        // countdown for current state
    isDashing: false,         // kept for backward compat (true when dashState === ACTIVE)
    dashTime: 0,              // kept for backward compat
    dashDirX: 1, dashDirY: 0, // frozen dash heading so mid-dash aiming can't curve it
    readyPulse: 0,            // brief pulse when the dash comes off cooldown
    // Combat improvements
    combo: 0,                 // current combo count
    comboTimer: 0,            // time remaining to chain combo
    stagger: 0,               // >0 = stunned/staggered
    lastCrit: 0,              // >0 = just landed a crit (for effects)
    // Movement trail
    trail: [],                // array of {x, y, life} for movement trail
    trailTimer: 0,            // timer for adding trail points
    iframes: 0,
    lastAttacker: null,
    wanderAngle: rand(0,Math.PI*2),
    wanderTimer: 0,
    fleeUntil: 0,
    difficulty,              // AI difficulty: 'easy' | 'medium' | 'hard'
    reactionTimer: 0,        // for AI reaction time delay
    hitFlash: 0,
    deathT: 0,
    // amoeba: each blob gets its own membrane phase, wobble seeds and pulse rate
    blobPhase: rand(0,Math.PI*2),
    blobSeed: rand(0,1000),
    blobRate: rand(0.8,1.3),
    // eye: emotion is derived from the timers below (highest priority wins)
    emAttack: 0,   // >0 = angry/aggressive (just landed or launched an attack)
    emHit: 0,      // >0 = hurt/shocked (just took damage)
    blink: 0,      // >0 = eye is mid-blink (lid closed)
    blinkTimer: rand(1.5,4), // countdown to the next idle blink
    pupilX: 0, pupilY: 0     // smoothed pupil offset so the gaze eases toward its target
  };
}

// pickups are entities too (kind:'box'). The colour is passed in rather than
// rolled here: the spawn cycle owns which colour comes next (see BOX_CYCLE), so
// choosing one locally would defeat the per-window guarantee.
export function makeBox(color){
  return {
    kind: 'box',
    x: rand(40, WORLD_W-40),
    y: rand(40, WORLD_H-40),
    color: color || COLOR_KEYS[Math.floor(rand(0,3))],
    spin: rand(0,Math.PI*2)
  };
}

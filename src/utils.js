// ---------- constants ----------
export const COLORS = {
  cyan:    "#2be8ff",
  magenta: "#ff2fc9",
  yellow:  "#ffd23f"
};
// per-color passive abilities — a color is more than its matchup now
export const PASSIVES = {
  cyan:    { speedMult: 1.15, dmgMult: 1.0,  dashCdMult: 1.0,  label: "+15% SPEED" },
  magenta: { speedMult: 1.0,  dmgMult: 1.2,  dashCdMult: 1.0,  label: "+20% DAMAGE" },
  yellow:  { speedMult: 1.0,  dmgMult: 1.0,  dashCdMult: 0.7,  label: "-30% DASH CD" }
};
export const BEATS = { cyan:"magenta", magenta:"yellow", yellow:"cyan" };
export const COLOR_KEYS = Object.keys(COLORS);

export const GAME_DURATION = 45; // seconds — shorter for a small 4-player arena
export const SAFE_R0 = 460;
export const SAFE_R1 = 90;
export const SHRINK_START = 6; // seconds before shrink begins
export const BOT_COUNT = 3; // + the player = 4 total
export const BOX_COUNT = 10;
export const MAX_SPEED = 120; // px/sec cruising speed cap — slow by default
export const ACCEL = 1250; // px/sec^2 — how fast you build up to max speed
export const DRAG = 2.6; // higher = less drift, lower = more momentum/slide
export const BOOST_MULT = 2.2; // boost is the only way to move fast (~390 px/sec)
export const BOOST_ACCEL_MULT = 1.7;
export const BOOST_DRAIN = 34; // hp/sec while boosting
export const DASH_SPEED = 1100; // px/sec — held constant for the whole dash (true dash state)
export const DASH_DURATION = 0.18; // seconds the dash lasts before physics takes over again
export const DASH_COOLDOWN = 3.2; // seconds — longer so a dash feels like a committed decision
export const DASH_HP_COST = 6;
export const DASH_MIN_HP = 12; // can't dash below this
export const DASH_DMG_MULT = 1.8; // extra damage when you smash into an enemy mid-dash
export const DASH_KNOCK_MULT = 2.5; // extra knockback on a dash impact
export const DASH_HIT_FREEZE = 0.05; // seconds of hitstop when a dash connects
export const DASH_SHAKE = 12; // camera shake kick on dash launch
export const DASH_IMPACT_SHAKE = 18; // camera shake kick on dash impact

// ---------- dash state machine ----------
// Dash progresses through discrete states for network sync.
// Ready → Windup → Active → Recovery → Ready
export const DASH_STATE = {
  READY:    'ready',
  WINDUP:   'windup',    // brief charge before launch (visible to opponents)
  ACTIVE:   'active',    // the dash itself
  RECOVERY: 'recovery'   // cooldown before next dash allowed
};
export const DASH_WINDUP_TIME = 0.12;   // seconds of windup animation
export const DASH_RECOVERY_TIME = 0.15; // seconds of recovery after dash ends
export const KNOCKBACK_BOUNCE = 240; // same-color collision push
export const HIT_DMG_ADV = 28; // damage dealt by the color that wins the matchup
export const HIT_DMG_DISADV = 10; // damage dealt back by the losing color — still costs you to trade
export const HIT_IFRAMES = 0.45; // brief invulnerability after being hit so one overlap = one hit
export const HIT_LIFESTEAL_RATIO = 0.35; // fraction of damage dealt that heals the attacker
export const HIT_KNOCK_TARGET = 300; // push on the entity that got hit
export const HIT_KNOCK_ATTACKER = 110; // recoil on the one landing the hit
export const DEATH_KNOCK_TARGET = 560; // extra fling on the finishing blow
export const DEATH_KNOCK_ATTACKER = 150;
export const DARK_DRAIN = 16; // hp/sec while outside safe zone
export const CRIT_HP = 25;

// ---------- AI difficulty ----------
// Bot behavior parameters per difficulty level
export const AI_DIFFICULTY = {
  easy: {
    reactionTime: 0.8,      // slower reaction (seconds)
    aimAccuracy: 0.6,       // how accurately they target (0-1)
    dashFrequency: 0.005,   // chance per frame to dash (0-1)
    dashRange: 160,         // max distance to attempt dash
    threatRange: 280,       // how far they detect threats
    preyRange: 200,         // how far they detect prey
    boostThreshold: 40,     // HP above which they'll boost
    wanderSpeed: 150,       // wander target distance
  },
  medium: {
    reactionTime: 0.4,
    aimAccuracy: 0.8,
    dashFrequency: 0.02,
    dashRange: 220,
    threatRange: 340,
    preyRange: 280,
    boostThreshold: 25,
    wanderSpeed: 200,
  },
  hard: {
    reactionTime: 0.15,
    aimAccuracy: 0.95,
    dashFrequency: 0.05,
    dashRange: 280,
    threatRange: 400,
    preyRange: 340,
    boostThreshold: 15,
    wanderSpeed: 250,
  }
};

// ---------- movement polish ----------
export const ACCEL_CURVE = 0.85;       // non-linear acceleration factor (0-1, higher = snappier)
export const TURN_SPEED = 8;           // how fast you can change direction (radians/sec)
export const TRAIL_LENGTH = 12;        // number of trail segments
export const TRAIL_LIFETIME = 0.4;     // seconds before trail fades
export const HITSTOP_LIGHT = 0.03;     // hitstop on light hits
export const HITSTOP_HEAVY = 0.08;     // hitstop on heavy hits
export const SHAKE_DECAY = 0.85;       // camera shake decay per frame

// ---------- combat improvements ----------
export const COMBO_WINDOW = 1.5;       // seconds to chain a combo
export const COMBO_MULT = 1.25;        // damage multiplier per combo hit
export const MAX_COMBO = 5;            // max combo hits before reset
export const STAGGER_DURATION = 0.25;  // seconds of stagger on heavy hit
export const STAGGER_THRESHOLD = 15;   // damage needed to cause stagger
// Was hardcoded as a bare 0.3 in physics.js while the server read it from its own
// constants file. Same number, but two literals with no link between them is
// exactly how prediction and simulation drift apart — see server/constants.js.
export const STAGGER_ACCEL_MULT = 0.3; // acceleration multiplier while staggered
export const CRIT_CHANCE = 0.15;       // base critical hit chance
export const CRIT_MULT = 2.0;          // critical hit damage multiplier
export const KNOCKBACK_SCALING = 0.015;// HP-based knockback scaling

// ---------- zone improvements ----------
export const ZONE_WARN_TIME = 3;       // seconds before zone shrinks to show warning
export const ZONE_WARN_PULSE = 0.5;    // pulse frequency during warning
export const ZONE_FINAL_SPEED = 2.5;   // speed multiplier for final circle
export const ZONE_DAMAGE_SCALING = 0.1;// damage increase per second in zone

// ---------- roaming final zone ----------
// Once the zone reaches SAFE_R1 it stops shrinking and starts wandering, so the
// endgame isn't a static circle in the middle of the map that everyone can camp.
// The path is a Lissajous curve: two sines at different frequencies, which gives
// smooth, non-repeating-looking drift from a pure function of elapsed time (no
// integrated state, so the server and a reconnecting client agree exactly).
export const ZONE_ROAM_RADIUS = 150;    // px of drift allowed from the arena centre
export const ZONE_ROAM_SPEED = 0.16;    // base angular rate — a full loop is ~40s
export const ZONE_ROAM_RAMP = 2.5;      // seconds to ease drift in from standstill
export const ZONE_ROAM_MARGIN = 12;     // keep this much safe zone inside the walls

// ---------- sudden death ----------
// The clock no longer decides the round: if blobs are still alive when it runs
// out, the zone keeps closing past SAFE_R1 until it can't sustain anyone. This
// is what guarantees the match terminates — without it two same-colour blobs
// bounce off each other for 0 damage forever and the round never resolves.
export const SUDDEN_DEATH_SHRINK = 14;  // px/sec the zone keeps closing after time
export const SUDDEN_DEATH_MIN_R = 0;    // it really does go to nothing

// Where the safe zone's centre sits, given how long it has been roaming and how
// big it currently is. Pure function of (roamT, safeR) — no accumulated state —
// so the server, the local sim and a client that just reconnected all land on
// the same point for the same inputs.
//
// The radius clamp is what keeps the circle honest: drift is capped so the zone
// never hangs off the edge of the arena, which would make part of it unreachable
// and hand a free win to whoever happened to be on the right side.
export function zoneCenterAt(roamT, safeR, worldW, worldH){
  const cx = worldW / 2, cy = worldH / 2;
  if (roamT <= 0) return { x: cx, y: cy };

  // Ease the drift in so the zone doesn't visibly jerk the instant it starts.
  const ramp = Math.min(1, roamT / ZONE_ROAM_RAMP);

  // Two different frequencies => the centre traces a figure-eight-ish path
  // rather than a circle, so players can't just orbit at a fixed offset.
  const t = roamT * ZONE_ROAM_SPEED;
  let ox = Math.sin(t * Math.PI * 2) * ZONE_ROAM_RADIUS * ramp;
  let oy = Math.sin(t * Math.PI * 2 * 0.618 + 1.1) * ZONE_ROAM_RADIUS * ramp;

  // Never let the circle leave the arena.
  const maxX = Math.max(0, worldW / 2 - safeR - ZONE_ROAM_MARGIN);
  const maxY = Math.max(0, worldH / 2 - safeR - ZONE_ROAM_MARGIN);
  ox = clamp(ox, -maxX, maxX);
  oy = clamp(oy, -maxY, maxY);

  return { x: cx + ox, y: cy + oy };
}

// ---------- fixed timestep ----------
// Physics runs at a constant 60 Hz regardless of display refresh rate.
// This ensures deterministic simulation for multiplayer sync.
export const FIXED_DT = 1/60;           // 16.666ms per tick
export const MAX_FRAME_DT = 0.25;       // cap to avoid spiral of death
export const PLAYER_R = 16;      // radius at full (100) HP
export const PLAYER_R_MIN = 9;   // radius when nearly dead — body shrinks as HP drains
export const PLAYER_R_MAX = 26;  // radius ceiling (HP can't exceed 100, this is the cap at 100)
export const BOX_R = 10;
export const NAME_POOL = ["VEX","KIRA","NULL","ZEPH","ORYX","JINX","MOTH","RAZE","IVY","SKULK","FANG","DUSK","NOVA","PIP","GRIM","LUNE"];

// The map is a fixed 800x600 arena, and the canvas is exactly that size.
export const WORLD_W = 800;
export const WORLD_H = 600;

// ---------- math helpers ----------
export function rand(a,b){ return a + Math.random()*(b-a); }
export function dist2(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }
export function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
// body radius scales with HP: bigger when healthy, smaller as it drains
export function radiusForHp(hp){
  const t = clamp(hp/100, 0, 1);
  return PLAYER_R_MIN + (PLAYER_R_MAX-PLAYER_R_MIN)*t;
}
export function easeInOut(x){ return x<0.5 ? 2*x*x : 1-Math.pow(-2*x+2,2)/2; }

// ---------- audio ----------
// Tiny synthesized SFX — no assets. Created lazily on first user gesture.
let audioCtx = null;
export function ensureAudio(){
  if(audioCtx) return audioCtx;
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if(AC) audioCtx = new AC();
  }catch(_){ audioCtx = null; }
  return audioCtx;
}
export function getAudioCtx(){ return audioCtx; }

// Descending filtered-noise burst = a "whoosh".
export function playWhoosh(){
  const ac = ensureAudio(); if(!ac) return;
  if(ac.state==='suspended') ac.resume();
  const dur = 0.28;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate*dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for(let i=0;i<data.length;i++){
    const white = Math.random()*2-1;
    last = last*0.6 + white*0.4;           // low-passed noise
    const env = Math.pow(1 - i/data.length, 1.6); // fast fade-out
    data[i] = last*env;
  }
  const src = ac.createBufferSource(); src.buffer = buf;
  const bp = ac.createBiquadFilter(); bp.type='bandpass';
  bp.frequency.setValueAtTime(1600, ac.currentTime);
  bp.frequency.exponentialRampToValueAtTime(240, ac.currentTime+dur);
  bp.Q.value = 0.8;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.5, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime+dur);
  src.connect(bp); bp.connect(g); g.connect(ac.destination);
  src.start();
}
// Short punchy thump for a dash landing.
export function playImpact(){
  const ac = ensureAudio(); if(!ac) return;
  if(ac.state==='suspended') ac.resume();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type='sine';
  o.frequency.setValueAtTime(220, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(50, ac.currentTime+0.14);
  g.gain.setValueAtTime(0.6, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime+0.16);
  o.connect(g); g.connect(ac.destination);
  o.start(); o.stop(ac.currentTime+0.18);
}

// Critical hit sound — sharp metallic ping
export function playCritHit(){
  const ac = ensureAudio(); if(!ac) return;
  if(ac.state==='suspended') ac.resume();
  const o = ac.createOscillator();
  const o2 = ac.createOscillator();
  const g = ac.createGain();
  o.type='square';
  o.frequency.setValueAtTime(880, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(1760, ac.currentTime+0.05);
  o2.type='sawtooth';
  o2.frequency.setValueAtTime(440, ac.currentTime);
  g.gain.setValueAtTime(0.4, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime+0.12);
  o.connect(g); o2.connect(g); g.connect(ac.destination);
  o.start(); o2.start(); o.stop(ac.currentTime+0.15); o2.stop(ac.currentTime+0.15);
}

// Combo hit sound — ascending tone
export function playComboHit(comboCount){
  const ac = ensureAudio(); if(!ac) return;
  if(ac.state==='suspended') ac.resume();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type='triangle';
  const baseFreq = 440 + comboCount * 110; // pitch increases with combo
  o.frequency.setValueAtTime(baseFreq, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, ac.currentTime+0.08);
  g.gain.setValueAtTime(0.3, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime+0.1);
  o.connect(g); g.connect(ac.destination);
  o.start(); o.stop(ac.currentTime+0.12);
}

// Zone warning sound — ominous low pulse
export function playZoneWarning(){
  const ac = ensureAudio(); if(!ac) return;
  if(ac.state==='suspended') ac.resume();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type='sine';
  o.frequency.setValueAtTime(60, ac.currentTime);
  o.frequency.linearRampToValueAtTime(40, ac.currentTime+0.5);
  g.gain.setValueAtTime(0.25, ac.currentTime);
  g.gain.linearRampToValueAtTime(0, ac.currentTime+0.5);
  o.connect(g); g.connect(ac.destination);
  o.start(); o.stop(ac.currentTime+0.55);
}

// Pre-match countdown blip. `isGo` swaps the short tick for a brighter, longer
// two-note stab so "GO" reads as a release rather than another tick.
export function playCountdownTick(isGo = false){
  const ac = ensureAudio(); if(!ac) return;
  if(ac.state==='suspended') ac.resume();
  const t0 = ac.currentTime;
  const dur = isGo ? 0.34 : 0.12;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = isGo ? 'triangle' : 'sine';
  o.frequency.setValueAtTime(isGo ? 660 : 520, t0);
  o.frequency.exponentialRampToValueAtTime(isGo ? 1320 : 780, t0 + dur*0.6);
  g.gain.setValueAtTime(isGo ? 0.34 : 0.22, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
  if(isGo){
    // a fifth above, slightly delayed — turns the stab into a chord
    const o2 = ac.createOscillator();
    const g2 = ac.createGain();
    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(990, t0 + 0.04);
    g2.gain.setValueAtTime(0.14, t0 + 0.04);
    g2.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o2.connect(g2); g2.connect(ac.destination);
    o2.start(t0 + 0.04); o2.stop(t0 + dur + 0.02);
  }
}

// Stagger hit sound — heavy thud
export function playStaggerHit(){
  const ac = ensureAudio(); if(!ac) return;
  if(ac.state==='suspended') ac.resume();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type='sine';
  o.frequency.setValueAtTime(120, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(30, ac.currentTime+0.2);
  g.gain.setValueAtTime(0.7, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime+0.25);
  o.connect(g); g.connect(ac.destination);
  o.start(); o.stop(ac.currentTime+0.3);
}

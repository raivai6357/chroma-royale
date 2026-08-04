// Shared constants between server and client
// These must match src/utils.js values for client prediction to work correctly

// Server tick rate - must match client FIXED_DT
const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE; // ~16.67ms

// World dimensions
const WORLD_W = 800;
const WORLD_H = 600;

// Game settings
const GAME_DURATION = 45;
const SHRINK_START = 6;
const SAFE_R0 = 460;
const SAFE_R1 = 90;
const MAX_PLAYERS = 4;
const BOX_COUNT = 10;
const BOX_CYCLE = 5.0; // seconds; one box per colour per cycle — keep in sync with src/utils.js
const BOX_R = 10;

// Physics constants
const MAX_SPEED = 120;
const ACCEL = 1250;
const DRAG = 2.6;
const BOOST_MULT = 2.2;
const BOOST_ACCEL_MULT = 1.7;
const BOOST_DRAIN = 34;

// Dash constants
const DASH_SPEED = 1100;
const DASH_DURATION = 0.18;
const DASH_COOLDOWN = 4.0; // keep in sync with src/utils.js
const DASH_HP_COST = 6;
const DASH_MIN_HP = 12;
const DASH_WINDUP_TIME = 0.12;
const DASH_RECOVERY_TIME = 0.15;

// Combat constants
const KNOCKBACK_BOUNCE = 240;
const HIT_DMG_ADV = 28;
const HIT_DMG_DISADV = 10;
const HIT_IFRAMES = 0.45;
const HIT_LIFESTEAL_RATIO = 0.35;
const HIT_KNOCK_TARGET = 300;
const HIT_KNOCK_ATTACKER = 110;
const DEATH_KNOCK_TARGET = 560;
const DEATH_KNOCK_ATTACKER = 150;
const DASH_DMG_MULT = 1.8;
const DASH_KNOCK_MULT = 2.5;
const DARK_DRAIN = 16;
const CRIT_HP = 25;

// Stagger — must match src/utils.js, which the client's movement/combat reads.
const STAGGER_DURATION = 0.25;  // seconds of stagger on heavy hit
const STAGGER_THRESHOLD = 15;   // damage needed to cause stagger
const STAGGER_ACCEL_MULT = 0.3; // acceleration while staggered

// Player size
const PLAYER_R = 16;
const PLAYER_R_MIN = 9;
const PLAYER_R_MAX = 26;

// Color matchup
const BEATS = { cyan: 'magenta', magenta: 'yellow', yellow: 'cyan' };
const COLORS = {
  cyan: '#2be8ff',
  magenta: '#ff2fc9',
  yellow: '#ffd23f'
};
const COLOR_KEYS = Object.keys(COLORS);

// Per-color passives. These MUST stay numerically identical to PASSIVES in
// src/utils.js — the client predicts movement and dash cooldown with its own
// copy, so any drift here shows up as constant rubber-banding.
const PASSIVES = {
  cyan:    { speedMult: 1.15, dmgMult: 1.0, dashCdMult: 1.0, label: '+15% SPEED' },
  magenta: { speedMult: 1.0,  dmgMult: 1.2, dashCdMult: 1.0, label: '+20% DAMAGE' },
  yellow:  { speedMult: 1.0,  dmgMult: 1.0, dashCdMult: 0.7, label: '-30% DASH CD' }
};

// Dash states
const DASH_STATE = {
  READY: 'ready',
  WINDUP: 'windup',
  ACTIVE: 'active',
  RECOVERY: 'recovery'
};

// Spawn positions
const SPAWN_MARGIN = 60;
const CORNERS = [
  { x: SPAWN_MARGIN, y: SPAWN_MARGIN },
  { x: WORLD_W - SPAWN_MARGIN, y: SPAWN_MARGIN },
  { x: SPAWN_MARGIN, y: WORLD_H - SPAWN_MARGIN },
  { x: WORLD_W - SPAWN_MARGIN, y: WORLD_H - SPAWN_MARGIN }
];

// Network settings
const SNAPSHOT_RATE = 20; // Send snapshots at 20 Hz (every 3 ticks)
const INTERPOLATION_DELAY = 100; // 100ms buffer for interpolation
const RECONCILIATION_THRESHOLD = 5; // pixels before position correction

// Roaming final zone — mirrors src/utils.js. Once the zone is fully shrunk it
// wanders instead of sitting in the middle of the arena.
const ZONE_ROAM_RADIUS = 150;
const ZONE_ROAM_SPEED = 0.16;
const ZONE_ROAM_RAMP = 2.5;
const ZONE_ROAM_MARGIN = 12;

// Sudden death — the clock doesn't end the round any more, so the zone keeps
// closing past SAFE_R1 until only one blob can survive. Mirrors src/utils.js.
const SUDDEN_DEATH_SHRINK = 14;
const SUDDEN_DEATH_MIN_R = 0;
// Safety net only: at 14 px/sec a 90px zone is gone in ~6.4s, and everyone left
// is taking escalating void damage well before that. If a room somehow hasn't
// resolved this long after the clock, end it rather than tick forever.
const SUDDEN_DEATH_TIMEOUT = 45;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Must stay identical to zoneCenterAt() in src/utils.js — the client renders the
// zone from its own copy between snapshots, so any divergence shows up as the
// circle visibly snapping every time a snapshot lands.
function zoneCenterAt(roamT, safeR, worldW, worldH) {
  const cx = worldW / 2, cy = worldH / 2;
  if (roamT <= 0) return { x: cx, y: cy };

  const ramp = Math.min(1, roamT / ZONE_ROAM_RAMP);
  const t = roamT * ZONE_ROAM_SPEED;
  let ox = Math.sin(t * Math.PI * 2) * ZONE_ROAM_RADIUS * ramp;
  let oy = Math.sin(t * Math.PI * 2 * 0.618 + 1.1) * ZONE_ROAM_RADIUS * ramp;

  const maxX = Math.max(0, worldW / 2 - safeR - ZONE_ROAM_MARGIN);
  const maxY = Math.max(0, worldH / 2 - safeR - ZONE_ROAM_MARGIN);
  ox = clamp(ox, -maxX, maxX);
  oy = clamp(oy, -maxY, maxY);

  return { x: cx + ox, y: cy + oy };
}

module.exports = {
  TICK_RATE,
  TICK_INTERVAL,
  WORLD_W,
  WORLD_H,
  GAME_DURATION,
  SHRINK_START,
  SAFE_R0,
  SAFE_R1,
  MAX_PLAYERS,
  BOX_COUNT,
  BOX_CYCLE,
  BOX_R,
  MAX_SPEED,
  ACCEL,
  DRAG,
  BOOST_MULT,
  BOOST_ACCEL_MULT,
  BOOST_DRAIN,
  DASH_SPEED,
  DASH_DURATION,
  DASH_COOLDOWN,
  DASH_HP_COST,
  DASH_MIN_HP,
  DASH_WINDUP_TIME,
  DASH_RECOVERY_TIME,
  KNOCKBACK_BOUNCE,
  HIT_DMG_ADV,
  HIT_DMG_DISADV,
  HIT_IFRAMES,
  STAGGER_DURATION,
  STAGGER_THRESHOLD,
  STAGGER_ACCEL_MULT,
  HIT_LIFESTEAL_RATIO,
  HIT_KNOCK_TARGET,
  HIT_KNOCK_ATTACKER,
  DEATH_KNOCK_TARGET,
  DEATH_KNOCK_ATTACKER,
  DASH_DMG_MULT,
  DASH_KNOCK_MULT,
  DARK_DRAIN,
  CRIT_HP,
  PLAYER_R,
  PLAYER_R_MIN,
  PLAYER_R_MAX,
  BEATS,
  COLORS,
  COLOR_KEYS,
  PASSIVES,
  DASH_STATE,
  SPAWN_MARGIN,
  CORNERS,
  SNAPSHOT_RATE,
  INTERPOLATION_DELAY,
  RECONCILIATION_THRESHOLD,
  ZONE_ROAM_RADIUS,
  ZONE_ROAM_SPEED,
  ZONE_ROAM_RAMP,
  ZONE_ROAM_MARGIN,
  SUDDEN_DEATH_SHRINK,
  SUDDEN_DEATH_MIN_R,
  SUDDEN_DEATH_TIMEOUT,
  zoneCenterAt
};
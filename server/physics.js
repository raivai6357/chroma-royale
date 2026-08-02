// Server-authoritative physics simulation
// This is the source of truth for all game state

const {
  WORLD_W, WORLD_H,
  MAX_SPEED, ACCEL, DRAG, BOOST_MULT, BOOST_ACCEL_MULT, BOOST_DRAIN,
  DASH_SPEED, DASH_DURATION, DASH_COOLDOWN, DASH_HP_COST, DASH_MIN_HP,
  DASH_WINDUP_TIME, DASH_RECOVERY_TIME, DASH_STATE,
  KNOCKBACK_BOUNCE, HIT_DMG_ADV, HIT_DMG_DISADV, HIT_IFRAMES, HIT_LIFESTEAL_RATIO,
  HIT_KNOCK_TARGET, HIT_KNOCK_ATTACKER, DEATH_KNOCK_TARGET, DEATH_KNOCK_ATTACKER,
  DASH_DMG_MULT, DASH_KNOCK_MULT,
  DARK_DRAIN, CRIT_HP,
  STAGGER_DURATION, STAGGER_THRESHOLD, STAGGER_ACCEL_MULT,
  PLAYER_R_MIN, PLAYER_R_MAX,
  BEATS, COLOR_KEYS, PASSIVES,
  CORNERS, BOX_COUNT, BOX_R,
  SAFE_R0, SAFE_R1, SHRINK_START, GAME_DURATION,
  SUDDEN_DEATH_SHRINK, SUDDEN_DEATH_MIN_R, zoneCenterAt
} = require('./constants.js');

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
function radiusForHp(hp) {
  const t = clamp(hp / 100, 0, 1);
  return PLAYER_R_MIN + (PLAYER_R_MAX - PLAYER_R_MIN) * t;
}
function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

class ServerEntity {
  constructor(id, playerId, isPlayer, name, spawnIndex) {
    this.id = id;
    this.playerId = playerId;
    this.kind = isPlayer ? 'player' : 'bot';
    this.isPlayer = isPlayer;
    this.name = name;
    
    const corner = CORNERS[spawnIndex % CORNERS.length];
    this.x = corner.x;
    this.y = corner.y;
    this.vx = 0;
    this.vy = 0;
    this.facingX = 1;
    this.facingY = 0;
    this.color = COLOR_KEYS[Math.floor(Math.random() * 3)];
    this.hp = 100;
    this.alive = true;
    this.radius = radiusForHp(100);
    
    this.boosting = false;
    this.dashCooldown = 0;
    this.dashState = DASH_STATE.READY;
    this.dashStateTimer = 0;
    this.isDashing = false;
    this.dashTime = 0;
    this.dashDirX = 1;
    this.dashDirY = 0;
    
    this.iframes = 0;
    this.stagger = 0;
    this.hitFlash = 0;
    this.lastAttacker = null;
    
    // Bot AI
    this.wanderAngle = rand(0, Math.PI * 2);
    this.wanderTimer = 0;
  }
}

class ServerPhysics {
  constructor(room) {
    this.room = room;
    this.entities = new Map();
    this.boxes = [];
    this.safeR = SAFE_R0;
    this.center = { x: WORLD_W / 2, y: WORLD_H / 2 };
    this.zoneRoamT = 0;   // seconds the fully-shrunk zone has been wandering
    this.elapsed = 0;
    this.tick = 0;
    this.events = [];
    
    // Stats tracking
    this.stats = new Map(); // playerId -> { kills, damageDealt, damageTaken }
    
    this._initializeEntities();
    this._initializeBoxes();
  }
  
  _initializeEntities() {
    // Shuffle spawn corners
    const spawnOrder = [0, 1, 2, 3];
    for (let i = spawnOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spawnOrder[i], spawnOrder[j]] = [spawnOrder[j], spawnOrder[i]];
    }
    
    let spawnIndex = 0;
    const usedNames = new Set();
    const namePool = ['VEX', 'KIRA', 'NULL', 'ZEPH', 'ORYX', 'JINX', 'MOTH', 'RAZE', 'IVY', 'SKULK'];
    
    for (const [playerId, player] of this.room.players) {
      // Prefer the name the player actually set. Only fall back to the pool when
      // there's nothing to use, and skip pool picks that are already taken.
      let name = (player.displayName || '').trim();
      if (!name || name === 'Player' || usedNames.has(name)) {
        const free = namePool.filter(n => !usedNames.has(n));
        name = free.length
          ? free[Math.floor(Math.random() * free.length)]
          : `P${this.entities.size + 1}`;
      }
      usedNames.add(name);

      const entity = new ServerEntity(this.entities.size + 1, playerId, true, name, spawnOrder[spawnIndex++]);
      this.entities.set(entity.id, entity);
      this.stats.set(playerId, { kills: 0, damageDealt: 0, damageTaken: 0 });
    }
  }
  
  _initializeBoxes() {
    this.boxes = [];
    for (let i = 0; i < BOX_COUNT; i++) {
      this.boxes.push({
        x: rand(40, WORLD_W - 40),
        y: rand(40, WORLD_H - 40),
        color: COLOR_KEYS[Math.floor(Math.random() * 3)]
      });
    }
  }
  
  getSpawnPositions() {
    const positions = {};
    for (const [id, entity] of this.entities) {
      positions[entity.playerId] = { x: entity.x, y: entity.y, color: entity.color, name: entity.name };
    }
    return positions;
  }
  
  update(dt) {
    this.tick++;
    this.elapsed += dt;
    this.events = [];
    
    // Update zone
    this._updateZone(dt);
    
    // Process player inputs
    this._processInputs(dt);
    
    // Update physics
    this._updatePhysics(dt);
    
    // Check collisions
    this._checkCollisions();
    
    // Update boxes/pickups
    this._updateBoxes(dt);
    
    // Respawn boxes
    this._respawnBoxes();
    
    // Update timers
    this._updateTimers(dt);
  }
  
  _updateZone(dt) {
    if (this.elapsed < SHRINK_START) return;

    const shrinkDuration = GAME_DURATION - SHRINK_START;
    const shrinkElapsed = this.elapsed - SHRINK_START;
    const prog = clamp(shrinkElapsed / shrinkDuration, 0, 1);

    if (prog < 1) {
      this.safeR = SAFE_R0 + (SAFE_R1 - SAFE_R0) * easeInOut(prog);
      return;
    }

    // Fully shrunk. The clock no longer ends the round, so once it expires the
    // zone keeps closing past SAFE_R1 — sudden death, and the thing that
    // guarantees the match actually terminates.
    if (this.elapsed >= GAME_DURATION) {
      const overtime = this.elapsed - GAME_DURATION;
      this.safeR = Math.max(SUDDEN_DEATH_MIN_R, SAFE_R1 - overtime * SUDDEN_DEATH_SHRINK);
    } else {
      this.safeR = SAFE_R1;
    }

    // ...and it wanders, so the endgame can't be camped from a fixed spot.
    this.zoneRoamT += dt;
    this.center = zoneCenterAt(this.zoneRoamT, this.safeR, WORLD_W, WORLD_H);
  }
  
  _processInputs(dt) {
    for (const [playerId, player] of this.room.players) {
      const entity = this._getEntityByPlayerId(playerId);
      if (!entity || !entity.alive) continue;
      
      // Skip if dashing
      if (entity.dashState === DASH_STATE.ACTIVE || entity.dashState === DASH_STATE.WINDUP) continue;
      
      const input = player.input;
      const dirX = input.dirX || 0;
      const dirY = input.dirY || 0;
      const canBoost = input.boosting && entity.hp > CRIT_HP;
      
      entity.boosting = canBoost;
      
      // Apply movement
      this._applyMovement(entity, dirX, dirY, dt, canBoost);
      
      // Boost drain
      if (canBoost) {
        entity.hp = clamp(entity.hp - BOOST_DRAIN * dt, 0, 100);
      }
      
      // Handle dash input
      if (input.dash && this._canDash(entity)) {
        this._requestDash(entity, dirX || entity.facingX, dirY || entity.facingY);
        player.input.dash = false; // Consume dash input
      }
    }
  }
  
  _applyMovement(e, dirX, dirY, dt, boosted) {
    // Mirrors src/physics.js:257 — the client applies the same multiplier when
    // predicting, so leaving this at 1.0 made cyan rubber-band constantly.
    const speedMult = PASSIVES[e.color].speedMult;
    // Mirrors src/physics.js:255 too. The client cuts acceleration while
    // staggered; with no stagger here at all, a staggered player predicted
    // themselves slow while the server kept them fast, so every heavy hit was
    // followed by a burst of rubber-banding.
    const staggerMult = e.stagger > 0 ? STAGGER_ACCEL_MULT : 1;

    if (dirX || dirY) {
      const accel = ACCEL * (boosted ? BOOST_ACCEL_MULT : 1) * speedMult * staggerMult;
      e.vx += dirX * accel * dt;
      e.vy += dirY * accel * dt;
      e.facingX = dirX;
      e.facingY = dirY;
    }
    
    const dragF = Math.exp(-DRAG * dt);
    e.vx *= dragF;
    e.vy *= dragF;
    
    const maxSpd = MAX_SPEED * (boosted ? BOOST_MULT : 1) * speedMult;
    const spd = Math.hypot(e.vx, e.vy);
    if (spd > maxSpd) {
      const s = maxSpd / spd;
      e.vx *= s;
      e.vy *= s;
    }
    
    e.x += e.vx * dt;
    e.y += e.vy * dt;
  }
  
  _canDash(e) {
    if (!e.alive) return false;
    if (e.dashState !== DASH_STATE.READY) return false;
    if (e.dashCooldown > 0) return false;
    if (e.hp <= DASH_MIN_HP) return false;
    return true;
  }
  
  _requestDash(e, dirX, dirY) {
    if (!this._canDash(e)) return false;
    
    e.dashDirX = dirX;
    e.dashDirY = dirY;
    const len = Math.hypot(e.dashDirX, e.dashDirY);
    if (len > 0) {
      e.dashDirX /= len;
      e.dashDirY /= len;
    }
    
    e.dashState = DASH_STATE.WINDUP;
    e.dashStateTimer = DASH_WINDUP_TIME;
    
    this.events.push({ type: 'dash_windup', entityId: e.id, x: e.x, y: e.y });
    return true;
  }
  
  _updatePhysics(dt) {
    for (const [id, e] of this.entities) {
      if (!e.alive) {
        if (e.deathT > 0) {
          e.deathT -= dt;
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          e.vx *= Math.exp(-3 * dt);
          e.vy *= Math.exp(-3 * dt);
        }
        continue;
      }
      
      // Update dash state machine
      this._updateDashState(e, dt);
      
      // Apply radius changes
      const targetR = radiusForHp(e.hp);
      e.radius += (targetR - e.radius) * Math.min(1, 10 * dt);
      
      // Wall bounce
      if (e.x < e.radius || e.x > WORLD_W - e.radius) e.vx *= -0.3;
      if (e.y < e.radius || e.y > WORLD_H - e.radius) e.vy *= -0.3;
      e.x = clamp(e.x, e.radius, WORLD_W - e.radius);
      e.y = clamp(e.y, e.radius, WORLD_H - e.radius);
      
      // Zone damage
      const dToCenter = Math.sqrt(dist2(e.x, e.y, this.center.x, this.center.y));
      if (dToCenter > this.safeR) {
        e.hp -= DARK_DRAIN * dt;
      }
      
      // Death check
      if (e.hp <= 0 && e.alive) {
        e.alive = false;
        e.deathT = 0.5;
        this.events.push({ type: 'death', entityId: e.id, x: e.x, y: e.y, color: e.color });
      }
    }
  }
  
  _updateDashState(e, dt) {
    switch (e.dashState) {
      case DASH_STATE.WINDUP:
        e.dashStateTimer -= dt;
        e.vx *= Math.exp(-DRAG * 2 * dt);
        e.vy *= Math.exp(-DRAG * 2 * dt);
        if (e.dashStateTimer <= 0) {
          this._enterDashActive(e);
        }
        break;
        
      case DASH_STATE.ACTIVE:
        e.facingX = e.dashDirX;
        e.facingY = e.dashDirY;
        e.vx = e.dashDirX * DASH_SPEED;
        e.vy = e.dashDirY * DASH_SPEED;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.dashTime -= dt;
        if (e.dashTime <= 0) {
          this._enterDashRecovery(e);
        }
        break;
        
      case DASH_STATE.RECOVERY:
        e.dashStateTimer -= dt;
        const dragF = Math.exp(-DRAG * dt);
        e.vx *= dragF;
        e.vy *= dragF;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.dashStateTimer <= 0) {
          e.dashState = DASH_STATE.READY;
        }
        break;
    }
    
    if (e.dashCooldown > 0) e.dashCooldown = Math.max(0, e.dashCooldown - dt);
    if (e.iframes > 0) e.iframes = Math.max(0, e.iframes - dt);
    if (e.stagger > 0) e.stagger = Math.max(0, e.stagger - dt);
    if (e.hitFlash > 0) e.hitFlash -= dt;
  }
  
  _enterDashActive(e) {
    e.dashState = DASH_STATE.ACTIVE;
    e.isDashing = true;
    e.dashTime = DASH_DURATION;
    e.hp = clamp(e.hp - DASH_HP_COST, 0, 100);
    e.dashCooldown = DASH_COOLDOWN * PASSIVES[e.color].dashCdMult; // yellow recharges faster
    this.events.push({ type: 'dash_start', entityId: e.id, x: e.x, y: e.y });
  }
  
  _enterDashRecovery(e) {
    e.dashState = DASH_STATE.RECOVERY;
    e.isDashing = false;
    e.dashStateTimer = DASH_RECOVERY_TIME;
    e.vx *= 0.5;
    e.vy *= 0.5;
    this.events.push({ type: 'dash_end', entityId: e.id, x: e.x, y: e.y });
  }
  
  _checkCollisions() {
    const alive = Array.from(this.entities.values()).filter(e => e.alive);
    
    // Entity-entity collisions
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const rr = (a.radius + b.radius) * (a.radius + b.radius);
        if (dist2(a.x, a.y, b.x, b.y) < rr) {
          this._resolveCombat(a, b);
        }
      }
    }
  }
  
  _resolveCombat(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / d, ny = dy / d;
    
    if (a.color === b.color) {
      // Same color: bounce
      const overlap = (a.radius + b.radius) - d;
      a.x += nx * overlap * 0.5;
      a.y += ny * overlap * 0.5;
      b.x -= nx * overlap * 0.5;
      b.y -= ny * overlap * 0.5;
      a.vx += nx * KNOCKBACK_BOUNCE;
      a.vy += ny * KNOCKBACK_BOUNCE;
      b.vx -= nx * KNOCKBACK_BOUNCE;
      b.vy -= ny * KNOCKBACK_BOUNCE;
      return;
    }
    
    let winner, loser;
    if (BEATS[a.color] === b.color) { winner = a; loser = b; }
    else if (BEATS[b.color] === a.color) { winner = b; loser = a; }
    else return;
    
    const away = (loser === a) ? 1 : -1;
    const overlap = (a.radius + b.radius) - d;
    a.x += nx * overlap * 0.5;
    a.y += ny * overlap * 0.5;
    b.x -= nx * overlap * 0.5;
    b.y -= ny * overlap * 0.5;
    
    const dashSmash = winner.dashState === DASH_STATE.ACTIVE;
    // A staggered attacker can't land its advantage hit — src/combat.js:52,88.
    const attackerStaggered = winner.stagger > 0;
    // Mirrors src/combat.js:55-56 exactly, including the rounding — the client
    // shows these numbers in its hit feedback, so any drift reads as a desync.
    let dmgAdv = Math.round(HIT_DMG_ADV * (dashSmash ? DASH_DMG_MULT : 1) * PASSIVES[winner.color].dmgMult);
    const dmgDisadv = Math.round(HIT_DMG_DISADV * PASSIVES[loser.color].dmgMult);

    const knockMult = dashSmash ? DASH_KNOCK_MULT : 1;

    if (loser.iframes <= 0 && !attackerStaggered) {
      loser.hp = clamp(loser.hp - dmgAdv, 0, 100);
      loser.hitFlash = 0.18;
      loser.iframes = HIT_IFRAMES;
      loser.lastAttacker = winner.name;

      // Heavy hits stagger, cutting the victim's acceleration — src/combat.js:93.
      if (dmgAdv >= STAGGER_THRESHOLD || dashSmash) {
        loser.stagger = STAGGER_DURATION;
      }
      
      // Track stats
      if (winner.playerId) {
        const stats = this.stats.get(winner.playerId);
        if (stats) stats.damageDealt += dmgAdv;
      }
      if (loser.playerId) {
        const stats = this.stats.get(loser.playerId);
        if (stats) stats.damageTaken += dmgAdv;
      }
      
      // Lifesteal
      const heal = Math.round(dmgAdv * HIT_LIFESTEAL_RATIO);
      winner.hp = clamp(winner.hp + heal, 0, 100);
      
      this.events.push({ type: 'hit', attacker: winner.id, defender: loser.id, damage: dmgAdv });
      
      if (dashSmash) {
        winner.dashState = DASH_STATE.RECOVERY;
        winner.isDashing = false;
        winner.dashStateTimer = DASH_RECOVERY_TIME;
      }
    }
    
    if (winner.iframes <= 0) {
      winner.hp = clamp(winner.hp - dmgDisadv, 0, 100);
      winner.hitFlash = 0.18;
      winner.iframes = HIT_IFRAMES;
    }
    
    loser.vx = nx * away * HIT_KNOCK_TARGET * knockMult;
    loser.vy = ny * away * HIT_KNOCK_TARGET * knockMult;
    winner.vx = -nx * away * HIT_KNOCK_ATTACKER;
    winner.vy = -ny * away * HIT_KNOCK_ATTACKER;
    
    // Check death
    if (loser.hp <= 0 && loser.alive) {
      loser.alive = false;
      loser.deathT = 0.5;
      loser.vx = (dx / d) * DEATH_KNOCK_TARGET;
      loser.vy = (dy / d) * DEATH_KNOCK_TARGET;
      
      if (winner.playerId) {
        const stats = this.stats.get(winner.playerId);
        if (stats) stats.kills++;
      }
      
      this.events.push({ type: 'kill', killer: winner.id, victim: loser.id, x: loser.x, y: loser.y });
    }
  }
  
  _updateBoxes(dt) {
    for (const box of this.boxes) {
      for (const [id, e] of this.entities) {
        if (!e.alive) continue;
        const rr = (e.radius + BOX_R) * (e.radius + BOX_R);
        if (dist2(e.x, e.y, box.x, box.y) < rr) {
          e.color = box.color;
          e.hp = clamp(e.hp + 18, 0, 100);
          box._dead = true;
          this.events.push({ type: 'pickup', entityId: e.id, x: box.x, y: box.y, color: box.color });
          break;
        }
      }
    }
    this.boxes = this.boxes.filter(b => !b._dead);
  }
  
  _respawnBoxes() {
    while (this.boxes.length < BOX_COUNT) {
      this.boxes.push({
        x: rand(40, WORLD_W - 40),
        y: rand(40, WORLD_H - 40),
        color: COLOR_KEYS[Math.floor(Math.random() * 3)]
      });
    }
  }
  
  _updateTimers(dt) {
    // Timers are handled inline
  }
  
  _getEntityByPlayerId(playerId) {
    for (const [id, entity] of this.entities) {
      if (entity.playerId === playerId) return entity;
    }
    return null;
  }

  // Drop a departed player's blob out of the sim entirely. Called when someone
  // disconnects or leaves mid-round; without it the entity stays alive, keeps
  // colliding, and holds the round open forever.
  removePlayerEntity(playerId) {
    const entity = this._getEntityByPlayerId(playerId);
    if (!entity) return false;
    this.entities.delete(entity.id);
    return true;
  }
  
  getAlivePlayers() {
    const alive = [];
    for (const [id, entity] of this.entities) {
      if (entity.alive) alive.push(entity);
    }
    return alive;
  }
  
  getGameStats() {
    const stats = {};
    for (const [playerId, data] of this.stats) {
      stats[playerId] = { ...data };
    }
    return stats;
  }
  
  createSnapshot(tick) {
    const entities = [];
    for (const [id, e] of this.entities) {
      entities.push({
        id: e.id,
        playerId: e.playerId,
        kind: e.kind,
        x: e.x,
        y: e.y,
        vx: e.vx,
        vy: e.vy,
        color: e.color,
        hp: e.hp,
        radius: e.radius,
        alive: e.alive,
        boosting: e.boosting,
        dashState: e.dashState,
        isDashing: e.isDashing,
        dashDirX: e.dashDirX,
        dashDirY: e.dashDirY,
        iframes: e.iframes,
        stagger: e.stagger,
        hitFlash: e.hitFlash
      });
    }
    
    return {
      tick,
      entities,
      boxes: this.boxes.map(b => ({ x: b.x, y: b.y, color: b.color })),
      zone: { safeR: this.safeR, center: this.center },
      events: [...this.events]
    };
  }
}

module.exports = { ServerPhysics };
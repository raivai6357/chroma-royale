import {
  COLORS, PASSIVES, BEATS, MAX_SPEED, ACCEL, DRAG, BOOST_MULT, BOOST_ACCEL_MULT,
  BOOST_DRAIN, DASH_SPEED, DASH_DURATION, DASH_COOLDOWN, DASH_HP_COST, DASH_MIN_HP,
  DASH_SHAKE, CRIT_HP, DASH_STATE, DASH_WINDUP_TIME, DASH_RECOVERY_TIME,
  TRAIL_LENGTH, TRAIL_LIFETIME, AI_DIFFICULTY, STAGGER_ACCEL_MULT,
  rand, dist2, clamp, playWhoosh
} from './utils.js';
import { EventType } from './events.js';

// ---------- Dash State Machine ----------
// States: READY → WINDUP → ACTIVE → RECOVERY → READY
// Each transition emits an event for network/UI/particles.

// Check if entity can initiate a dash
export function canDash(e) {
  if (!e || !e.alive) return false;
  if (e.dashState !== DASH_STATE.READY) return false;
  if (e.dashCooldown > 0) return false;
  if (e.hp <= DASH_MIN_HP) return false;
  return true;
}

// Request a dash — transitions from READY to WINDUP
// Returns true if dash was initiated
export function requestDash(game, e, dirX, dirY) {
  if (!canDash(e)) return false;
  
  // Store the intended dash direction
  e.dashDirX = dirX || e.facingX;
  e.dashDirY = dirY || e.facingY;
  
  // Normalize direction
  const len = Math.hypot(e.dashDirX, e.dashDirY);
  if (len > 0) {
    e.dashDirX /= len;
    e.dashDirY /= len;
  }
  
  // Transition to WINDUP state
  e.dashState = DASH_STATE.WINDUP;
  e.dashStateTimer = DASH_WINDUP_TIME;
  
  // Emit event
  if (game.events) {
    game.events.emit(EventType.DASH_WINDUP, {
      entityId: e.id,
      x: e.x, y: e.y,
      dirX: e.dashDirX, dirY: e.dashDirY,
      color: e.color
    });
  }
  
  return true;
}

// Update dash state machine for an entity
export function updateDashState(game, e, dt) {
  switch (e.dashState) {
    case DASH_STATE.WINDUP:
      e.dashStateTimer -= dt;
      // Slow down during windup (charging)
      e.vx *= Math.exp(-DRAG * 2 * dt);
      e.vy *= Math.exp(-DRAG * 2 * dt);
      
      if (e.dashStateTimer <= 0) {
        // Transition to ACTIVE
        enterDashActive(game, e);
      }
      break;
      
    case DASH_STATE.ACTIVE:
      // Travel at constant high speed on locked heading
      e.facingX = e.dashDirX;
      e.facingY = e.dashDirY;
      e.vx = e.dashDirX * DASH_SPEED;
      e.vy = e.dashDirY * DASH_SPEED;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      
      // Drop afterimage ghosts
      game.dashGhosts.push({
        x: e.x, y: e.y, color: e.color, radius: e.radius,
        life: 0.25, max: 0.25, phase: e.blobPhase, seed: e.blobSeed
      });
      
      e.dashTime -= dt;
      if (e.dashTime <= 0) {
        // Transition to RECOVERY
        enterDashRecovery(game, e);
      }
      break;
      
    case DASH_STATE.RECOVERY:
      e.dashStateTimer -= dt;
      // Apply normal physics during recovery
      const dragF = Math.exp(-DRAG * dt);
      e.vx *= dragF;
      e.vy *= dragF;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      
      if (e.dashStateTimer <= 0) {
        // Transition back to READY
        enterDashReady(game, e);
      }
      break;
      
    case DASH_STATE.READY:
    default:
      // Cooldown ticking handled elsewhere
      break;
  }
  
  // Update common timers
  if (e.dashCooldown > 0) e.dashCooldown = Math.max(0, e.dashCooldown - dt);
  if (e.dashFlash > 0) e.dashFlash -= dt;
  if (e.iframes > 0) e.iframes = Math.max(0, e.iframes - dt);
  
  // Update stagger
  if (e.stagger > 0) e.stagger = Math.max(0, e.stagger - dt);
  
  // Update combo timer
  if (e.comboTimer > 0) {
    e.comboTimer -= dt;
    if (e.comboTimer <= 0) {
      e.combo = 0; // reset combo when window expires
    }
  }
  
  // Update lastCrit flash
  if (e.lastCrit > 0) e.lastCrit -= dt;
}

// Transition: WINDUP → ACTIVE
function enterDashActive(game, e) {
  e.dashState = DASH_STATE.ACTIVE;
  e.isDashing = true;  // backward compat
  e.dashTime = DASH_DURATION;
  e.dashFlash = 0.22;
  e.emAttack = Math.max(e.emAttack, 0.45);
  
  // HP cost
  e.hp = clamp(e.hp - DASH_HP_COST, 0, 100);
  
  // Cooldown (yellow recharges faster)
  e.dashCooldown = DASH_COOLDOWN * PASSIVES[e.color].dashCdMult;
  
  // Launch feedback
  if (e.isPlayer) {
    game.cameraShake = Math.max(game.cameraShake, DASH_SHAKE);
    game.flashes.push({ x: e.x, y: e.y, r: 50, life: 0.08, max: 0.08 });
  }
  game.shockwaves.push({ x: e.x, y: e.y, r: 0, life: 0.3, max: 0.3, color: e.color });
  
  // Particle burst
  for (let i = 0; i < 30; i++) {
    const jitterAng = rand(-0.9, 0.9);
    const bx = e.dashDirX, by = e.dashDirY;
    const cos = Math.cos(jitterAng), sin = Math.sin(jitterAng);
    const dxr = (bx * cos - by * sin) * -1;
    const dyr = (bx * sin + by * cos) * -1;
    const spd = rand(80, 260);
    game.particles.push({
      x: e.x - e.dashDirX * e.radius,
      y: e.y - e.dashDirY * e.radius,
      vx: dxr * spd + rand(-40, 40),
      vy: dyr * spd + rand(-40, 40),
      life: rand(0.3, 0.7), maxLife: 0.7,
      size: rand(2, 8), alpha: rand(0.5, 1),
      color: COLORS[e.color]
    });
  }
  
  if (e.isPlayer) playWhoosh();
  
  // Emit event
  if (game.events) {
    game.events.emit(EventType.DASH_START, {
      entityId: e.id,
      x: e.x, y: e.y,
      dirX: e.dashDirX, dirY: e.dashDirY,
      color: e.color
    });
  }
}

// Transition: ACTIVE → RECOVERY
function enterDashRecovery(game, e) {
  e.dashState = DASH_STATE.RECOVERY;
  e.isDashing = false;  // backward compat
  e.dashStateTimer = DASH_RECOVERY_TIME;
  
  // Hand momentum back to physics, slightly tamed
  e.vx *= 0.5;
  e.vy *= 0.5;
  
  // Emit event
  if (game.events) {
    game.events.emit(EventType.DASH_END, {
      entityId: e.id,
      x: e.x, y: e.y,
      color: e.color
    });
  }
}

// Transition: RECOVERY → READY
function enterDashReady(game, e) {
  e.dashState = DASH_STATE.READY;
  e.dashStateTimer = 0;
  
  // Ready pulse for UI feedback
  if (e.dashCooldown <= 0 && e.hp > DASH_MIN_HP) {
    e.readyPulse = 0.4;
  }
}

// ---------- Movement Physics ----------

// Apply movement with acceleration and drag
export function applyMovement(game, e, dirX, dirY, dt, boosted) {
  // If in active dash state, dash system handles movement
  if (e.dashState === DASH_STATE.ACTIVE) {
    // Dash is handled by updateDashState
    return;
  }
  
  // Windup state: minimal movement (handled by updateDashState drag)
  if (e.dashState === DASH_STATE.WINDUP) {
    return;
  }
  
  // Staggered entities have reduced control. Shared with the server via
  // utils.js/constants.js so prediction and simulation can't drift.
  const staggerMult = e.stagger > 0 ? STAGGER_ACCEL_MULT : 1;
  
  const speedMult = PASSIVES[e.color].speedMult;
  if (dirX || dirY) {
    const accel = ACCEL * (boosted ? BOOST_ACCEL_MULT : 1) * speedMult * staggerMult;
    e.vx += dirX * accel * dt;
    e.vy += dirY * accel * dt;
    e.facingX = dirX;
    e.facingY = dirY;
  }
  
  // Drag / friction
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
  
  // Ready pulse decay
  const wasCooling = e.dashCooldown > 0;
  if (wasCooling && e.dashCooldown <= 0 && e.hp > DASH_MIN_HP) {
    e.readyPulse = 0.4;
  }
  if (e.readyPulse > 0) e.readyPulse -= dt;
  
  // Update movement trail
  updateTrail(e, dt);
}

// Update the movement trail for an entity
export function updateTrail(e, dt) {
  // Add new trail point if moving fast enough
  const spd = Math.hypot(e.vx, e.vy);
  e.trailTimer -= dt;
  
  if (spd > 50 && e.trailTimer <= 0) {
    e.trail.push({
      x: e.x,
      y: e.y,
      life: TRAIL_LIFETIME,
      radius: e.radius * 0.6
    });
    e.trailTimer = 0.03; // add point every 30ms
    
    // Keep trail length limited
    if (e.trail.length > TRAIL_LENGTH) {
      e.trail.shift();
    }
  }
  
  // Update existing trail points
  for (let i = e.trail.length - 1; i >= 0; i--) {
    e.trail[i].life -= dt;
    if (e.trail[i].life <= 0) {
      e.trail.splice(i, 1);
    }
  }
}

// Update player movement from input
export function updatePlayer(game, e, dt) {
  const input = game.input;
  const dx = input.mouseCanvas.x - e.x;
  const dy = input.mouseCanvas.y - e.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const canBoost = input.boosting && e.hp > CRIT_HP;
  
  // Track boost state changes for events
  if (canBoost && !e.boosting && game.events) {
    game.events.emit(EventType.BOOST_START, { entityId: e.id });
  } else if (!canBoost && e.boosting && game.events) {
    game.events.emit(EventType.BOOST_END, { entityId: e.id });
  }
  
  e.boosting = canBoost;
  const dirX = d > 4 ? dx / d : 0;
  const dirY = d > 4 ? dy / d : 0;
  applyMovement(game, e, dirX, dirY, dt, canBoost);
  
  if (canBoost) e.hp = clamp(e.hp - BOOST_DRAIN * dt, 0, 100);
  
  // Emit move event for network sync
  if (game.events && (dirX || dirY)) {
    game.events.emit(EventType.MOVE, {
      entityId: e.id,
      x: e.x, y: e.y,
      dirX, dirY,
      boosting: canBoost
    });
  }
}

// Update bot AI movement
export function updateBot(game, e, dt) {
  const entities = game.em.actors();
  const boxes = game.em.boxes();
  const center = game.center, safeR = game.safeR;
  
  // Get AI difficulty settings
  const ai = AI_DIFFICULTY[e.difficulty || 'medium'];
  
  // Update reaction timer (simulates delayed responses for easier bots)
  if (e.reactionTimer > 0) {
    e.reactionTimer -= dt;
    return; // Skip AI decision during reaction time
  }
  
  // Determine safe-zone pull
  const dToCenter = Math.sqrt(dist2(e.x, e.y, center.x, center.y));
  let targetX = null, targetY = null;
  let wantBoost = false;
  
  if (dToCenter > safeR - 60) {
    targetX = center.x;
    targetY = center.y;
  } else {
    // Look for nearby threat / prey / box
    let bestPrey = null, bestPreyD = Infinity;
    let bestThreat = null, bestThreatD = Infinity;
    for (const o of entities) {
      if (o === e || !o.alive) continue;
      const d = dist2(e.x, e.y, o.x, o.y);
      if (d > ai.threatRange * ai.threatRange) continue;
      if (BEATS[e.color] === o.color && d < bestPreyD) { bestPreyD = d; bestPrey = o; }
      if (BEATS[o.color] === e.color && d < bestThreatD) { bestThreatD = d; bestThreat = o; }
    }
    if (bestThreat && bestThreatD < 200 * 200) {
      targetX = e.x + (e.x - bestThreat.x);
      targetY = e.y + (e.y - bestThreat.y);
      wantBoost = e.hp > ai.boostThreshold;
    } else if (bestPrey && bestPreyD < ai.preyRange * ai.preyRange) {
      targetX = bestPrey.x;
      targetY = bestPrey.y;
      wantBoost = e.hp > ai.boostThreshold && bestPreyD < 180 * 180;
    } else if (e.hp < 70) {
      let bestBox = null, bestBoxD = Infinity;
      for (const bx of boxes) {
        const d = dist2(e.x, e.y, bx.x, bx.y);
        if (d < bestBoxD) { bestBoxD = d; bestBox = bx; }
      }
      if (bestBox) { targetX = bestBox.x; targetY = bestBox.y; }
    }
  }
  
  if (targetX === null) {
    e.wanderTimer -= dt;
    if (e.wanderTimer <= 0) {
      e.wanderAngle = rand(0, Math.PI * 2);
      e.wanderTimer = rand(1.2, 2.6);
    }
    targetX = e.x + Math.cos(e.wanderAngle) * ai.wanderSpeed;
    targetY = e.y + Math.sin(e.wanderAngle) * ai.wanderSpeed;
  }
  
  const dx = targetX - e.x, dy = targetY - e.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  
  // Apply aim accuracy (easier bots have less precise aiming)
  let dirX = dx / d, dirY = dy / d;
  if (ai.aimAccuracy < 1) {
    const noise = (1 - ai.aimAccuracy) * 0.5;
    dirX += rand(-noise, noise);
    dirY += rand(-noise, noise);
    const len = Math.hypot(dirX, dirY);
    if (len > 0) { dirX /= len; dirY /= len; }
  }
  
  const canBoost = wantBoost && e.hp > CRIT_HP;
  
  // Track boost state changes
  if (canBoost && !e.boosting && game.events) {
    game.events.emit(EventType.BOOST_START, { entityId: e.id });
  } else if (!canBoost && e.boosting && game.events) {
    game.events.emit(EventType.BOOST_END, { entityId: e.id });
  }
  
  e.boosting = canBoost;
  applyMovement(game, e, dirX, dirY, dt, canBoost);
  if (canBoost) e.hp = clamp(e.hp - BOOST_DRAIN * dt, 0, 100);
  
  // Bots dash opportunistically based on difficulty
  if (canDash(e) && e.hp > DASH_MIN_HP + 10 && d < ai.dashRange && wantBoost && Math.random() < ai.dashFrequency) {
    requestDash(game, e, dirX, dirY);
    e.reactionTimer = ai.reactionTime; // Add reaction delay after dash
  }
}

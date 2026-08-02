import {
  WORLD_W, WORLD_H, SAFE_R0, SAFE_R1, SHRINK_START, GAME_DURATION, clamp, easeInOut,
  ZONE_WARN_TIME, ZONE_WARN_PULSE, ZONE_FINAL_SPEED, ZONE_DAMAGE_SCALING,
  SUDDEN_DEATH_SHRINK, SUDDEN_DEATH_MIN_R, zoneCenterAt,
  playZoneWarning
} from './utils.js';
import { EventType } from './events.js';

// ZoneSystem — advance the safe radius as the round progresses.
// Enhanced with warning phases, sound effects, and faster final circle.
export function updateZone(game, dt){
  const elapsed = game.elapsed;
  const totalDuration = GAME_DURATION;
  const shrinkDuration = totalDuration - SHRINK_START;
  
  // Calculate current progress through the shrink phase
  const shrinkElapsed = Math.max(0, elapsed - SHRINK_START);
  const prog = clamp(shrinkElapsed / shrinkDuration, 0, 1);
  
  // Determine zone phase
  let newPhase = 'idle';
  if (prog >= 1) {
    newPhase = 'final';
  } else if (prog > 0.7) {
    newPhase = 'shrinking';
  } else if (elapsed >= SHRINK_START - ZONE_WARN_TIME && elapsed < SHRINK_START) {
    newPhase = 'warning';
  } else if (elapsed >= SHRINK_START) {
    newPhase = 'shrinking';
  }
  
  // Phase transitions
  if (newPhase !== game.zonePhase) {
    const oldPhase = game.zonePhase;
    game.zonePhase = newPhase;
    
    // Emit zone event on phase change
    if (game.events) {
      game.events.emit(EventType.ZONE_SHRINK, {
        phase: newPhase,
        safeR: game.safeR,
        progress: prog
      });
    }
    
    // Play warning sound when entering warning phase
    if (newPhase === 'warning' && !game.zoneWarningPlayed) {
      playZoneWarning();
      game.zoneWarningPlayed = true;
    }
    
    // Reset warning flag when leaving warning phase
    if (oldPhase === 'warning') {
      game.zoneWarningPlayed = false;
    }
  }
  
  // Update shrink pulse for visual effects
  game.shrinkPulse = (game.shrinkPulse || 0) + dt * ZONE_WARN_PULSE * Math.PI * 2;
  
  // Apply zone shrinking based on phase
  if (elapsed >= SHRINK_START) {
    // Calculate target radius
    let targetR;

    if (prog >= 1) {
      // Fully shrunk. Normally it holds at SAFE_R1 and roams (below), but once
      // the clock has run out the round is in sudden death and the zone keeps
      // closing — that's what forces a resolution instead of letting survivors
      // circle each other indefinitely.
      if (elapsed >= GAME_DURATION) {
        const overtime = elapsed - GAME_DURATION;
        targetR = Math.max(SUDDEN_DEATH_MIN_R, SAFE_R1 - overtime * SUDDEN_DEATH_SHRINK);
      } else {
        targetR = SAFE_R1;
      }
    } else {
      // Normal shrink with easeInOut
      // Apply faster speed for final 30% (when less than 3 players might remain)
      let adjustedProg = prog;
      if (prog > 0.7) {
        // Accelerate the final portion
        const finalProg = (prog - 0.7) / 0.3;
        adjustedProg = 0.7 + 0.3 * Math.min(1, finalProg * ZONE_FINAL_SPEED);
      }
      targetR = SAFE_R0 + (SAFE_R1 - SAFE_R0) * easeInOut(adjustedProg);
    }
    
    // Smoothly interpolate to target
    game.safeR = targetR;

    // Once the zone is fully closed it stops being a fixed circle in the middle
    // and starts wandering, so the endgame can't be camped from one spot. The
    // path is derived from how long it has been roaming (not integrated), which
    // keeps it identical to the server's copy in online play.
    if (prog >= 1) {
      game.zoneRoamT = (game.zoneRoamT || 0) + dt;
      game.center = zoneCenterAt(game.zoneRoamT, game.safeR, WORLD_W, WORLD_H);
    }
  } else if (elapsed >= SHRINK_START - ZONE_WARN_TIME) {
    // Warning phase - pulse the zone edge visually (handled in renderer)
    // but don't actually shrink yet
    game.safeR = SAFE_R0;
  }
  
  // Periodic warning sounds during warning phase
  if (game.zonePhase === 'warning') {
    const warnInterval = 1.0; // play sound every second during warning
    const warnCount = Math.floor((elapsed - (SHRINK_START - ZONE_WARN_TIME)) / warnInterval);
    if (warnCount > (game._lastWarnCount || 0)) {
      game._lastWarnCount = warnCount;
      playZoneWarning();
    }
  }
}

// Get zone damage multiplier based on time spent outside
// Damage increases the longer you've been in the void
export function getZoneDamageMultiplier(timeInVoid) {
  return 1 + timeInVoid * ZONE_DAMAGE_SCALING;
}

// Check if an entity is taking zone damage and apply scaling
export function applyZoneDamage(game, entity, dt) {
  const dx = entity.x - game.center.x;
  const dy = entity.y - game.center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  if (dist > game.safeR) {
    // Calculate how far outside the zone
    const outsideAmount = dist - game.safeR;
    const maxOutside = WORLD_W / 2; // approximate max distance
    const outsideRatio = clamp(outsideAmount / maxOutside, 0, 1);
    
    // Base damage + scaling based on time in void and distance outside
    const baseDamage = 16; // DARK_DRAIN from utils
    const timeMultiplier = getZoneDamageMultiplier(entity._timeInVoid || 0);
    const distanceMultiplier = 1 + outsideRatio;
    
    const damage = baseDamage * timeMultiplier * distanceMultiplier * dt;
    entity.hp = Math.max(0, entity.hp - damage);
    
    // Track time in void for scaling
    entity._timeInVoid = (entity._timeInVoid || 0) + dt;
    
    // Emit zone damage event periodically
    if (game.events && Math.random() < 0.1) {
      game.events.emit(EventType.ZONE_DAMAGE, {
        entityId: entity.id,
        x: entity.x,
        y: entity.y,
        damage: damage,
        outsideAmount: outsideAmount
      });
    }
    
    return damage;
  } else {
    // Reset void timer when in safe zone
    entity._timeInVoid = 0;
    return 0;
  }
}
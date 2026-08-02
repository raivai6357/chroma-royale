import {
  WORLD_W, WORLD_H, SAFE_R0, SAFE_R1, SHRINK_START, GAME_DURATION, clamp, easeInOut,
  ZONE_WARN_TIME, ZONE_WARN_PULSE, ZONE_FINAL_SPEED, ZONE_DAMAGE_SCALING,
  SUDDEN_DEATH_SHRINK, SUDDEN_DEATH_MIN_R, zoneCenterAt,
  playZoneWarning
} from './utils.js';
import { EventType } from './events.js';

// ZoneSystem — advance the safe radius as the round progresses.
// Phases drive the audio cue and the renderer's warning pulse; the radius
// itself is a pure function of elapsed time.
export function updateZone(game, dt){
  const elapsed = game.elapsed;
  const totalDuration = GAME_DURATION;
  const shrinkDuration = totalDuration - SHRINK_START;

  const shrinkElapsed = Math.max(0, elapsed - SHRINK_START);
  const prog = clamp(shrinkElapsed / shrinkDuration, 0, 1);

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

  if (newPhase !== game.zonePhase) {
    const oldPhase = game.zonePhase;
    game.zonePhase = newPhase;

    if (game.events) {
      game.events.emit(EventType.ZONE_SHRINK, {
        phase: newPhase,
        safeR: game.safeR,
        progress: prog
      });
    }

    if (newPhase === 'warning' && !game.zoneWarningPlayed) {
      playZoneWarning();
      game.zoneWarningPlayed = true;
    }

    // Re-arm the cue so a repeat warning phase sounds again.
    if (oldPhase === 'warning') {
      game.zoneWarningPlayed = false;
    }
  }

  game.shrinkPulse = (game.shrinkPulse || 0) + dt * ZONE_WARN_PULSE * Math.PI * 2;

  if (elapsed >= SHRINK_START) {
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
      // The last 30% closes faster than the eased curve alone would give, to
      // stop the endgame dragging once the field is thin.
      let adjustedProg = prog;
      if (prog > 0.7) {
        const finalProg = (prog - 0.7) / 0.3;
        adjustedProg = 0.7 + 0.3 * Math.min(1, finalProg * ZONE_FINAL_SPEED);
      }
      targetR = SAFE_R0 + (SAFE_R1 - SAFE_R0) * easeInOut(adjustedProg);
    }

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
    // Warning phase: the renderer pulses the edge, but the radius holds.
    game.safeR = SAFE_R0;
  }

  if (game.zonePhase === 'warning') {
    const warnInterval = 1.0; // play sound every second during warning
    const warnCount = Math.floor((elapsed - (SHRINK_START - ZONE_WARN_TIME)) / warnInterval);
    if (warnCount > (game._lastWarnCount || 0)) {
      game._lastWarnCount = warnCount;
      playZoneWarning();
    }
  }
}

// Void damage ramps with time outside, so lingering is progressively worse
// than a brief clip past the edge.
export function getZoneDamageMultiplier(timeInVoid) {
  return 1 + timeInVoid * ZONE_DAMAGE_SCALING;
}

export function applyZoneDamage(game, entity, dt) {
  const dx = entity.x - game.center.x;
  const dy = entity.y - game.center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > game.safeR) {
    const outsideAmount = dist - game.safeR;
    const maxOutside = WORLD_W / 2; // approximate max distance
    const outsideRatio = clamp(outsideAmount / maxOutside, 0, 1);

    // Scales on both axes: how long you've been out, and how far out you are.
    const baseDamage = 16; // must match DARK_DRAIN in utils.js
    const timeMultiplier = getZoneDamageMultiplier(entity._timeInVoid || 0);
    const distanceMultiplier = 1 + outsideRatio;

    const damage = baseDamage * timeMultiplier * distanceMultiplier * dt;
    entity.hp = Math.max(0, entity.hp - damage);

    entity._timeInVoid = (entity._timeInVoid || 0) + dt;

    // Sampled, not every frame — this only drives a visual cue.
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
    entity._timeInVoid = 0;
    return 0;
  }
}
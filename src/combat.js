import {
  COLORS, BEATS, PASSIVES, KNOCKBACK_BOUNCE, HIT_DMG_ADV, HIT_DMG_DISADV,
  HIT_IFRAMES, HIT_LIFESTEAL_RATIO, HIT_KNOCK_TARGET, HIT_KNOCK_ATTACKER,
  DEATH_KNOCK_TARGET, DEATH_KNOCK_ATTACKER, DASH_DMG_MULT, DASH_KNOCK_MULT,
  DASH_HIT_FREEZE, DASH_IMPACT_SHAKE, DASH_STATE,
  COMBO_WINDOW, COMBO_MULT, MAX_COMBO, STAGGER_DURATION, STAGGER_THRESHOLD,
  CRIT_CHANCE, CRIT_MULT, KNOCKBACK_SCALING,
  HITSTOP_LIGHT, HITSTOP_HEAVY, SHAKE_DECAY,
  rand, clamp, playImpact, playCritHit, playComboHit, playStaggerHit
} from './utils.js';
import { EventType } from './events.js';

export function resolveCombat(game, a, b){
  const dx=a.x-b.x, dy=a.y-b.y;
  const d = Math.sqrt(dx*dx+dy*dy) || 1;
  const nx=dx/d, ny=dy/d;

  if(a.color === b.color){
    // same color: no damage, but a solid mutual knockback so contact always shoves both apart
    const overlap = (a.radius+b.radius) - d;
    a.x += nx*overlap*0.5; a.y += ny*overlap*0.5;
    b.x -= nx*overlap*0.5; b.y -= ny*overlap*0.5;
    a.vx += nx*KNOCKBACK_BOUNCE; a.vy += ny*KNOCKBACK_BOUNCE;
    b.vx -= nx*KNOCKBACK_BOUNCE; b.vy -= ny*KNOCKBACK_BOUNCE;
    return;
  }

  let winner,loser; // winner = favored by the color matchup, not an instant kill anymore
  if(BEATS[a.color]===b.color){ winner=a; loser=b; }
  else if(BEATS[b.color]===a.color){ winner=b; loser=a; }
  else {
    // neutral matchup (shouldn't happen with 3 colors, but stay safe): still bounce both
    const overlap = (a.radius+b.radius) - d;
    a.x += nx*overlap*0.5; a.y += ny*overlap*0.5;
    b.x -= nx*overlap*0.5; b.y -= ny*overlap*0.5;
    a.vx += nx*KNOCKBACK_BOUNCE; a.vy += ny*KNOCKBACK_BOUNCE;
    b.vx -= nx*KNOCKBACK_BOUNCE; b.vy -= ny*KNOCKBACK_BOUNCE;
    return;
  }

  // always separate them so a hit can be escaped rather than chain-stunned
  const away = (loser===a) ? 1 : -1;
  const overlap = (a.radius+b.radius) - d;
  a.x += nx*overlap*0.5; a.y += ny*overlap*0.5;
  b.x -= nx*overlap*0.5; b.y -= ny*overlap*0.5;

  let landedHit = false;
  // a dashing winner "smashes" — bonus damage, bonus knockback, hitstop + shake
  const dashSmash = winner.dashState === DASH_STATE.ACTIVE;

  // A staggered attacker lands nothing: no damage, no crit.
  const attackerStaggered = winner.stagger > 0;

  let dmgAdv = Math.round(HIT_DMG_ADV * (dashSmash ? DASH_DMG_MULT : 1) * PASSIVES[winner.color].dmgMult);
  const dmgDisadv = Math.round(HIT_DMG_DISADV * PASSIVES[loser.color].dmgMult);

  // Combo system: damage increases with consecutive hits
  let comboMult = 1;
  if (winner.comboTimer > 0 && winner.combo < MAX_COMBO) {
    winner.combo++;
    comboMult = Math.pow(COMBO_MULT, winner.combo - 1);
    if (winner.combo > 1) {
      playComboHit(winner.combo);
    }
  } else {
    winner.combo = 1;
  }
  winner.comboTimer = COMBO_WINDOW;

  dmgAdv = Math.round(dmgAdv * comboMult);

  let isCrit = false;
  if (Math.random() < CRIT_CHANCE && !attackerStaggered) {
    isCrit = true;
    dmgAdv = Math.round(dmgAdv * CRIT_MULT);
    winner.lastCrit = 0.3; // flash indicator
    playCritHit();
  }

  const knockMult = dashSmash ? DASH_KNOCK_MULT : 1;

  // Lighter (more hurt) targets fly further, so finishing blows read as decisive.
  const loserHpMult = 1 + (100 - loser.hp) * KNOCKBACK_SCALING;

  if(loser.iframes<=0 && !attackerStaggered){
    applyHit(game, loser, winner, dmgAdv, true, isCrit);
    landedHit = true;

    if (dmgAdv >= STAGGER_THRESHOLD || dashSmash) {
      loser.stagger = STAGGER_DURATION;
      playStaggerHit();
    }
  }
  if(winner.iframes<=0){
    applyHit(game, winner, loser, dmgDisadv, false, false);
  }

  if (game.events) {
    game.events.emit(EventType.HIT, {
      attackerId: winner.id,
      defenderId: loser.id,
      x: (winner.x + loser.x) / 2,
      y: (winner.y + loser.y) / 2,
      damage: landedHit ? dmgAdv : 0,
      dashSmash,
      isCrit,
      combo: winner.combo
    });
  }

  if(landedHit){
    // full damage-hit knockback: loser flung hard, winner recoils
    loser.vx = nx*away*HIT_KNOCK_TARGET*knockMult*loserHpMult; 
    loser.vy = ny*away*HIT_KNOCK_TARGET*knockMult*loserHpMult;
    winner.vx = -nx*away*HIT_KNOCK_ATTACKER; 
    winner.vy = -ny*away*HIT_KNOCK_ATTACKER;
    
    // Bigger hits freeze the world for longer — the main "weight" cue.
    const hitstop = isCrit ? HITSTOP_HEAVY : (dashSmash ? DASH_HIT_FREEZE : HITSTOP_LIGHT);
    game.hitFreeze = Math.max(game.hitFreeze, hitstop);

    if(dashSmash){
      // the dash connected — end it and sell the impact
      winner.dashState = DASH_STATE.RECOVERY;
      winner.isDashing = false;
      winner.dashTime = 0;
      if(winner.isPlayer || loser.isPlayer){
        game.cameraShake = Math.max(game.cameraShake, DASH_IMPACT_SHAKE * (isCrit ? 1.5 : 1));
        playImpact();
      }
      game.shockwaves.push({
        x:loser.x, y:loser.y,
        r:0, life: isCrit ? 0.5 : 0.3, max: isCrit ? 0.5 : 0.3,
        color: winner.color,
        isCrit
      });
      game.flashes.push({x:loser.x, y:loser.y, r: isCrit ? 60 : 40, life:0.08, max:0.08});
    } else if (isCrit) {
      // Crit without a dash gets a smaller version of the same feedback.
      game.cameraShake = Math.max(game.cameraShake, 8);
      game.shockwaves.push({
        x:loser.x, y:loser.y, r:0, life:0.3, max:0.3, color:winner.color, isCrit:true
      });
    }

    if (isCrit) {
      spawnCritSpark(game, (winner.x + loser.x)/2, (winner.y + loser.y)/2, COLORS[winner.color]);
    }
  } else {
    // loser was in i-frames so no damage landed — but contact should still shove both,
    // so overlapping never feels "sticky". Additive so it doesn't cancel existing motion.
    loser.vx += nx*away*KNOCKBACK_BOUNCE; loser.vy += ny*away*KNOCKBACK_BOUNCE;
    winner.vx -= nx*away*KNOCKBACK_BOUNCE; winner.vy -= ny*away*KNOCKBACK_BOUNCE;
  }
}

// apply damage from `attacker` to `target`, handling lifesteal, elimination and knockback
export function applyHit(game, target, attacker, dmg, attackerHasAdvantage, isCrit = false){
  target.hp = clamp(target.hp - dmg, 0, 100);
  target.hitFlash = isCrit ? 0.3 : 0.18;
  target.iframes = HIT_IFRAMES;
  target.lastAttacker = attacker.name;
  target.emHit = 0.55; // eye flinches — hurt/shocked
  if(attackerHasAdvantage) attacker.emAttack = Math.max(attacker.emAttack, 0.5); // eye snarls
  
  if (isCrit) {
    spawnCritSpark(game, (target.x+attacker.x)/2, (target.y+attacker.y)/2, COLORS[target.color]);
  } else {
    spawnSpark(game, (target.x+attacker.x)/2, (target.y+attacker.y)/2, COLORS[target.color]);
  }

  const critText = isCrit ? "CRIT!" : "";
  game.dmgTexts.push({
    x:target.x, y:target.y-target.radius-4, 
    text: (critText ? critText + " " : "") + "-"+dmg, 
    life: isCrit ? 1.0 : 0.7, 
    color: isCrit ? "#ffff00" : (attackerHasAdvantage ? "#ffffff" : "rgba(255,255,255,0.5)"),
    isCrit,
    size: isCrit ? 16 : 13
  });

  if(attackerHasAdvantage){
    const heal = Math.round(dmg*HIT_LIFESTEAL_RATIO);
    attacker.hp = clamp(attacker.hp + heal, 0, 100);
  }

  if(target.hp<=0 && target.alive){
    target.alive = false;
    target.deathT = 0.5;
    const dx=target.x-attacker.x, dy=target.y-attacker.y;
    const d = Math.sqrt(dx*dx+dy*dy)||1;
    target.vx = (dx/d)*DEATH_KNOCK_TARGET; target.vy = (dy/d)*DEATH_KNOCK_TARGET;
    attacker.vx = -(dx/d)*DEATH_KNOCK_ATTACKER; attacker.vy = -(dy/d)*DEATH_KNOCK_ATTACKER;
    spawnBurst(game, target.x, target.y, COLORS[target.color]);

    if (game.events) {
      game.events.emit(EventType.KILL, {
        killerId: attacker.id,
        victimId: target.id,
        x: target.x, y: target.y,
        color: target.color
      });
    }
    
    if(target.isPlayer) game.toast("ELIMINATED BY " + attacker.name);
    else if(attacker.isPlayer) {
      game.toast("ELIMINATED " + target.name);
      if (attacker.combo > 1) {
        game.toast(attacker.combo + "x COMBO!");
      }
    }
  } else {
    if(target.isPlayer) game.toast("-"+dmg+" HP");
    else if(attacker.isPlayer && attackerHasAdvantage) {
      game.toast(isCrit ? "CRIT! -"+dmg+" HP" : "HIT! -"+dmg+" HP");
    }
  }
}

export function spawnSpark(game, x, y, color){
  for(let i=0;i<6;i++){
    const ang = rand(0,Math.PI*2);
    const spd = rand(60,160);
    game.particles.push({
      x,y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
      life: rand(0.2,0.4), color
    });
  }
}

// Louder version of spawnSpark: more, bigger, longer-lived particles.
export function spawnCritSpark(game, x, y, color){
  for(let i=0;i<12;i++){
    const ang = rand(0,Math.PI*2);
    const spd = rand(100,280);
    game.particles.push({
      x,y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
      life: rand(0.3,0.6), color,
      size: rand(3,6)
    });
  }
  // A few white ones on top to read as a flash rather than just more colour.
  for(let i=0;i<6;i++){
    const ang = rand(0,Math.PI*2);
    const spd = rand(50,150);
    game.particles.push({
      x,y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
      life: rand(0.15,0.3), color: "#ffffff",
      size: rand(2,4)
    });
  }
}

export function spawnBurst(game, x, y, color){
  for(let i=0;i<16;i++){
    const ang = rand(0,Math.PI*2);
    const spd = rand(40,220);
    game.particles.push({
      x,y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
      life: rand(0.4,0.9), color
    });
  }
}
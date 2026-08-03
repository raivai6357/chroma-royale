import {
  COLORS, WORLD_W, WORLD_H, BOT_COUNT, BOX_COUNT, BOX_R,
  SAFE_R0, DARK_DRAIN, NAME_POOL, rand, dist2, clamp, radiusForHp,
  ensureAudio, getAudioCtx, FIXED_DT, MAX_FRAME_DT, playCountdownTick
} from './utils.js';
import { EntityManager, makeEntity, makeBox } from './entities.js';
import { EventBus, EventType } from './events.js';
import { updateZone, applyZoneDamage } from './world.js';
import { applyMovement, updatePlayer, updateBot, requestDash, updateDashState, canDash } from './physics.js';
import { resolveCombat, spawnBurst } from './combat.js';
import { render, resize, getCanvas } from './renderer.js';
import { input, consumeDash, setupInput, aimDir, releaseInputs } from './input.js';
import { ui, toast, updateHUD, resetHUD, showPrematch, setPrematchCount, hidePrematch,
         showSpectate, updateSpectate, hideSpectate, showPause, hidePause, showMainMenu,
         setHudVisible } from './ui.js';

// pre-match countdown: 3 · 2 · 1 · GO. The sim is frozen for all of it, so the
// arena renders (and the spawn marker is visible) before anyone can move.
const COUNTDOWN_STEPS = 3;      // how many numbered ticks
const COUNTDOWN_GO = 0.7;       // seconds the "GO" flash stays up
const SPAWN_MARK_TIME = 2.2;    // seconds the "YOU" spawn marker lingers after GO

export class Game {
  constructor(){
    this.aiDifficulty = 'medium'; // 'easy' | 'medium' | 'hard'

    // one source of truth: all mutable round state lives on the instance
    this.em = new EntityManager();
    this.events = new EventBus();
    this.particles = [];
    this.dmgTexts = [];
    this.dashGhosts = [];   // fading afterimages left behind while dashing
    this.shockwaves = [];   // expanding rings from dash launches / impacts
    this.flashes = [];      // brief white radial flashes
    this.hitFreeze = 0;     // >0 = game frozen for hitstop
    this.cameraShake = 0;   // decays each frame, offsets the whole render
    this.player = null;
    this.input = input;
    this.boosting = false;
    this.running = false;
    this.elapsed = 0;
    this.lastT = 0;
    this.safeR = SAFE_R0;
    this.center = {x:WORLD_W/2, y:WORLD_H/2};
    this.animId = null;

    // pre-match countdown + spawn marker
    this.countdown = 0;      // >0 = sim frozen, overlay counting down
    this.countLabel = '';    // what the overlay currently shows
    this.spawnMark = 0;      // >0 = draw the "YOU" marker on the local player

    this.spectating = false; // true once the player is out and the leave bar is up
    this.paused = false;     // Escape menu is up; rAF is stopped and the sim frozen

    // Fixed timestep accumulator
    this.accumulator = 0;
    this.tick = 0;  // simulation tick counter (for command timestamps)

    this.toast = toast; // combat/pickup code calls game.toast(...)
    this._step = this.step.bind(this);
    
    this._setupEventHandlers();

    resize();
    window.addEventListener('resize', resize);
    setupInput(getCanvas());
  }

  // Wires every event to its particle/sound/UI/camera feedback. The sim itself
  // never touches these — feedback is purely a subscriber, so muting or
  // removing a handler can't change how a round plays out.
  _setupEventHandlers() {
    this.events.on(EventType.DASH_WINDUP, (data) => {
      const e = this.em.entities.find(e => e.id === data.entityId);
      if (e) {
        for (let i = 0; i < 5; i++) {
          const ang = rand(0, Math.PI * 2);
          this.particles.push({
            x: e.x + Math.cos(ang) * e.radius,
            y: e.y + Math.sin(ang) * e.radius,
            vx: -Math.cos(ang) * 40,
            vy: -Math.sin(ang) * 40,
            life: 0.15, maxLife: 0.15,
            size: 3, alpha: 0.8,
            color: COLORS[e.color]
          });
        }
      }
    });
    
    this.events.on(EventType.DAMAGE, (data) => {
      this.dmgTexts.push({
        x: data.x, y: data.y - 20,
        text: "-" + data.amount,
        life: 0.7,
        color: data.advantage ? "#ffffff" : "rgba(255,255,255,0.5)"
      });
    });
    
    this.events.on(EventType.KILL, (data) => {
      spawnBurst(this, data.x, data.y, COLORS[data.color]);
    });
    
    this.events.on(EventType.PICKUP_COLLECT, (data) => {
      for (let i = 0; i < 8; i++) {
        const ang = rand(0, Math.PI * 2);
        this.particles.push({
          x: data.x, y: data.y,
          vx: Math.cos(ang) * 60, vy: Math.sin(ang) * 60,
          life: 0.3, color: COLORS[data.color]
        });
      }
    });
  }

  resetGame(){
    this.em = new EntityManager();
    this.events.clear();
    this._setupEventHandlers();
    this.particles = [];
    this.dmgTexts = [];
    this.dashGhosts = [];
    this.shockwaves = [];
    this.flashes = [];
    this.hitFreeze = 0;
    this.cameraShake = 0;
    this.countdown = 0;
    this.countLabel = '';
    this.spawnMark = 0;
    this.spectating = false;
    this.paused = false;
    hidePause();
    hideSpectate();
    this.elapsed = 0;
    this.safeR = SAFE_R0;
    this.center = {x:WORLD_W/2, y:WORLD_H/2};
    this.zoneRoamT = 0;
    this.accumulator = 0;
    this.tick = 0;
    resetHUD();

    // shuffle corner assignments so the player isn't always in the same corner
    const spawnOrder = [0,1,2,3];
    for(let i=spawnOrder.length-1;i>0;i--){
      const j = Math.floor(rand(0,i+1));
      [spawnOrder[i], spawnOrder[j]] = [spawnOrder[j], spawnOrder[i]];
    }

    // player id is allocated first (stable id 1 within a round), then bots, then boxes
    this.player = this.em.add(makeEntity(true, "YOU", spawnOrder[0]));

    const usedNames = new Set();
    for(let i=0;i<BOT_COUNT;i++){
      let nm;
      do{ nm = NAME_POOL[Math.floor(rand(0,NAME_POOL.length))]; } while(usedNames.has(nm));
      usedNames.add(nm);
      this.em.add(makeEntity(false, nm, spawnOrder[i+1], this.aiDifficulty));
    }
    for(let i=0;i<BOX_COUNT;i++) this.em.add(makeBox());
    
    this.events.emit(EventType.ROUND_RESET, {});
  }

  // ---------- systems ----------
  // MovementSystem — per living actor: intent → physics, size easing, walls,
  // void damage, and all the amoeba/eye timers. Boxes are skipped.
  movementSystem(dt){
    for(const e of this.em.entities){
      if(e.kind === 'box') continue;
      if(!e.alive){
        // let eliminated entities fling outward and fade before disappearing
        if(e.deathT>0){
          e.deathT -= dt;
          e.x += e.vx*dt; e.y += e.vy*dt;
          e.vx *= Math.exp(-3*dt); e.vy *= Math.exp(-3*dt);
        }
        continue;
      }
      
      // Dash state runs first: applyMovement bails out mid-dash, so the state
      // machine has to be the thing that decides whether it's still dashing.
      updateDashState(this, e, dt);
      if(e.isPlayer) updatePlayer(this, e, dt); else updateBot(this, e, dt);

      // body grows/shrinks toward its HP-based target size (eased so it's smooth)
      const targetR = radiusForHp(e.hp);
      e.radius += (targetR - e.radius) * Math.min(1, 10*dt);

      if(e.x < e.radius || e.x > WORLD_W-e.radius) e.vx *= -0.3;
      if(e.y < e.radius || e.y > WORLD_H-e.radius) e.vy *= -0.3;
      e.x = clamp(e.x, e.radius, WORLD_W-e.radius);
      e.y = clamp(e.y, e.radius, WORLD_H-e.radius);

      applyZoneDamage(this, e, dt);
      if(e.hitFlash>0) e.hitFlash -= dt;

      // amoeba membrane advances; eye emotion + blink timers decay
      e.blobPhase += dt * e.blobRate;
      if(e.emAttack>0) e.emAttack -= dt;
      if(e.emHit>0) e.emHit -= dt;
      if(e.blink>0){
        e.blink -= dt;
      } else {
        e.blinkTimer -= dt;
        if(e.blinkTimer<=0){ e.blink = 0.12; e.blinkTimer = rand(2,5); }
      }
      // gaze: the player eyes wherever they're steering, bots look where they're
      // headed. On a released joystick aimDir is zero, so fall back to velocity
      // and the blob keeps looking along its drift instead of snapping forward.
      let gdx, gdy;
      if(e.isPlayer){
        const aim = aimDir(e.x, e.y);
        if(aim.x || aim.y){ gdx = aim.x; gdy = aim.y; }
        else { gdx = e.vx; gdy = e.vy; }
      }
      else { gdx = e.vx; gdy = e.vy; }
      const gl = Math.hypot(gdx, gdy);
      const tgx = gl>1 ? gdx/gl : 0, tgy = gl>1 ? gdy/gl : 0;
      const gEase = Math.min(1, 12*dt);
      e.pupilX += (tgx - e.pupilX) * gEase;
      e.pupilY += (tgy - e.pupilY) * gEase;

      if(e.hp<=0 && e.alive){
        e.alive=false; e.deathT=0.5;
        spawnBurst(this, e.x, e.y, COLORS[e.color]);
        this.events.emit(EventType.KILL, { entityId: e.id, x: e.x, y: e.y, color: e.color });
        if(e.isPlayer) this.toast("CONSUMED BY THE VOID");
      }
    }
  }

  // PickupSystem — box overlap recolors + heals the actor, then removes the box.
  pickupSystem(){
    const boxes = this.em.boxes();
    for(const bx of boxes){
      for(const e of this.em.entities){
        if(e.kind === 'box' || !e.alive) continue;
        const rr = (e.radius+BOX_R)*(e.radius+BOX_R);
        if(dist2(e.x,e.y,bx.x,bx.y) < rr){
          e.color = bx.color;
          e.hp = clamp(e.hp+18,0,100);
          bx._dead = true;
          if(e.isPlayer) this.toast("SHIFTED "+bx.color.toUpperCase());
          this.events.emit(EventType.PICKUP_COLLECT, {
            entityId: e.id,
            x: bx.x, y: bx.y,
            color: bx.color,
            hpGained: 18
          });
        }
      }
    }
    if(boxes.some(b=>b._dead)){
      this.em.entities = this.em.entities.filter(e => !(e.kind==='box' && e._dead));
    }
  }

  // SpawnSystem — keep the arena topped up to BOX_COUNT pickups.
  spawnSystem(){
    let count = this.em.boxes().length;
    while(count < BOX_COUNT){ 
      const box = this.em.add(makeBox());
      count++;
      this.events.emit(EventType.PICKUP_SPAWN, { entityId: box.id, x: box.x, y: box.y, color: box.color });
    }
  }

  // CombatSystem — pairwise overlap of living actors.
  combatSystem(){
    const alive = this.em.actors().filter(e=>e.alive);
    for(let i=0;i<alive.length;i++){
      for(let j=i+1;j<alive.length;j++){
        const a=alive[i], b=alive[j];
        const rr = (a.radius+b.radius)*(a.radius+b.radius);
        if(dist2(a.x,a.y,b.x,b.y) < rr){
          resolveCombat(this, a, b);
        }
      }
    }
  }
  
  // Pre-match countdown — runs instead of the sim, so nothing moves, no zone
  // shrink, and the match clock stays at full. Returns true while it owns the frame.
  updateCountdown(dt){
    if(this.countdown <= 0) return false;
    const prev = this.countLabel;
    this.countdown -= dt;

    if(this.countdown <= 0){
      this.countdown = 0;
      this.countLabel = '';
      hidePrematch();
      this.spawnMark = SPAWN_MARK_TIME;
      consumeDash();              // drop any dash queued during the countdown
      return false;               // let this frame fall through into real play
    }

    this.countLabel = this.countdown > COUNTDOWN_GO
      ? String(Math.ceil(this.countdown - COUNTDOWN_GO))
      : 'GO';
    if(this.countLabel !== prev){
      setPrematchCount(this.countLabel);
      playCountdownTick(this.countLabel === 'GO');
      if(this.countLabel === 'GO') this.cameraShake = 5;
    }

    // keep the blobs breathing/blinking so the arena reads as alive, not paused
    for(const e of this.em.entities){
      if(e.kind === 'box' || !e.alive) continue;
      e.blobPhase += dt * e.blobRate;
      if(e.blink > 0){
        e.blink -= dt;
      } else {
        e.blinkTimer -= dt;
        if(e.blinkTimer <= 0){ e.blink = 0.12; e.blinkTimer = rand(2,5); }
      }
    }
    this.cameraShake *= 0.9;
    if(this.cameraShake < 0.2) this.cameraShake = 0;
    return true;
  }

  fixedUpdate(dt) {
    // pre-match countdown owns the frame until it hits GO
    if(this.updateCountdown(dt)) return;

    // hitstop — freeze simulation for a few ms on a dash impact
    if(this.hitFreeze > 0){
      this.hitFreeze -= dt;
      return;
    }
    
    // Consume queued player dash input
    if(consumeDash() && this.player && canDash(this.player)) {
      requestDash(this, this.player, this.player.facingX, this.player.facingY);
    }

    this.elapsed += dt;

    updateZone(this, dt);
    this.movementSystem(dt);
    this.pickupSystem();
    this.spawnSystem();
    this.combatSystem();

    // fx update
    for(const p of this.particles){
      p.x += p.vx*dt; p.y += p.vy*dt;
      p.vx *= 0.94; p.vy *= 0.94;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p=>p.life>0);

    for(const tx of this.dmgTexts){
      tx.y -= 40*dt;
      tx.life -= dt;
    }
    this.dmgTexts = this.dmgTexts.filter(tx=>tx.life>0);

    for(const g of this.dashGhosts) g.life -= dt;
    this.dashGhosts = this.dashGhosts.filter(g=>g.life>0);
    for(const s of this.shockwaves){ s.r += 600*dt; s.life -= dt; }
    this.shockwaves = this.shockwaves.filter(s=>s.life>0);
    for(const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter(f=>f.life>0);
    this.cameraShake *= 0.9;
    if(this.cameraShake < 0.2) this.cameraShake = 0;
    if(this.spawnMark > 0) this.spawnMark -= dt;

    this.tick++;
  }

  // ---------- main loop (fixed timestep) ----------
  step(t){
    if(!this.running || this.paused) return;
    
    // Cap the delta: a long stall (tab backgrounded, breakpoint) would otherwise
    // queue up hundreds of fixed steps and spiral into an unrecoverable backlog.
    const frameDt = Math.min(MAX_FRAME_DT, (t - this.lastT) / 1000 || 0);
    this.lastT = t;

    this.accumulator += frameDt;
    while (this.accumulator >= FIXED_DT) {
      this.fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    // Render runs once per frame at display rate, decoupled from the sim above.
    render(this);
    updateHUD(this);

    // The round ends when exactly one blob is left standing — never on the
    // clock. If time expires with 2, 3 or 4 alive the match continues into
    // sudden death (updateZone keeps closing the circle past SAFE_R1), so a
    // winner is always someone who actually outlasted the others rather than
    // whoever happened to be alive when the timer hit zero.
    const aliveNow = this.em.actors().filter(e=>e.alive).length;
    if(aliveNow<=1){
      this.endGame(aliveNow);
      return;
    }

    // Player's out but bots are still fighting — offer a way out instead of
    // locking them into spectating until the round resolves on its own.
    if(!this.player.alive){
      if(this.spectating) updateSpectate(aliveNow);
      else { this.spectating = true; showSpectate(aliveNow); }
    }

    this.animId = requestAnimationFrame(this._step);
  }

  setDifficulty(difficulty) {
    if (['easy', 'medium', 'hard'].includes(difficulty)) {
      this.aiDifficulty = difficulty;
    }
  }
  
  // ---------- game flow ----------
  startGame(){
    ensureAudio(); // unlock WebAudio on this user gesture
    const ac = getAudioCtx();
    if(ac && ac.state==='suspended') ac.resume();
    this.resetGame();
    ui.startScreen.classList.add('hidden');
    ui.endScreen.classList.add('hidden');
    setHudVisible(true);

    // freeze on the spawn layout for "3 · 2 · 1 · GO" before anyone can move
    this.countdown = COUNTDOWN_STEPS + COUNTDOWN_GO;
    this.countLabel = String(COUNTDOWN_STEPS);
    this.spawnMark = 0;
    showPrematch(this.player, this.countLabel);
    playCountdownTick(false);
    consumeDash(); // clear input buffered from the click that started the round

    this.running = true;
    this.lastT = performance.now();
    cancelAnimationFrame(this.animId);
    this.animId = requestAnimationFrame(this._step);
    this.events.emit(EventType.GAME_START, {});
  }

  endGame(aliveCount){
    this.running = false;
    cancelAnimationFrame(this.animId);
    this.countdown = 0;
    this.spawnMark = 0;
    this.spectating = false;
    hidePrematch();
    hideSpectate();
    setHudVisible(false);
    ui.endScreen.classList.remove('hidden');
    if(this.player.alive){
      ui.endEyebrow.textContent = "VICTORY";
      ui.endTitle.textContent = "YOU ARE THE LAST COLOR";
      ui.endSub.textContent = "Every rival has been consumed. Chroma Royale is yours.";
    } else {
      const survivors = this.em.actors().filter(e=>e.alive);
      ui.endEyebrow.textContent = "ROUND OVER";
      ui.endTitle.textContent = "ELIMINATED";
      ui.endSub.textContent = survivors.length
        ? survivors.length + " still standing. Drop back in and try again."
        : "Nobody made it out. The void takes all.";
    }
    this.events.emit(EventType.GAME_END, {
      winner: this.player.alive ? this.player.id : null,
      survivors: this.em.actors().filter(e=>e.alive).map(e => e.id)
    });
  }

  // Bail out of a round we've already been eliminated from. Ends the round for
  // the local player without touching the "victory" branch of endGame().
  leaveMatch(){
    if(!this.running || this.player.alive) return;
    const survivors = this.em.actors().filter(e=>e.alive);
    this.running = false;
    cancelAnimationFrame(this.animId);
    this.countdown = 0;
    this.spawnMark = 0;
    this.spectating = false;
    hidePrematch();
    hideSpectate();
    setHudVisible(false);
    ui.endScreen.classList.remove('hidden');
    ui.endEyebrow.textContent = "LEFT THE ARENA";
    ui.endTitle.textContent = "ELIMINATED";
    ui.endSub.textContent = survivors.length
      ? "You walked away with " + survivors.length + " still fighting."
      : "You walked away from the void.";
    this.events.emit(EventType.GAME_END, {
      winner: null,
      survivors: survivors.map(e => e.id)
    });
  }

  // ---------- pause ----------
  // Practice is a local sim, so Escape can genuinely stop it: we cancel the rAF
  // and the loop simply isn't running. `running` stays true so the round is still
  // considered live (endGame/leaveMatch guard on it) — `paused` is what gates the
  // loop, and resume() is the only thing that restarts it.
  pause(){
    if(!this.running || this.paused) return;
    this.paused = true;
    cancelAnimationFrame(this.animId);
    this.animId = null;
    // Boost is held down, so a keypress (or a finger leaving the boost button
    // under the menu) would otherwise leave it latched on and quietly drain HP
    // the moment we resume. Same for the joystick.
    releaseInputs();
    showPause(true);
  }

  resume(){
    if(!this.running || !this.paused) return;
    this.paused = false;
    hidePause();
    consumeDash();  // drop anything buffered while the menu was up
    // Re-stamp the clock: lastT is still sitting at the frame before the pause,
    // so without this the accumulator would swallow the whole paused duration
    // and fast-forward the sim to catch up.
    this.lastT = performance.now();
    this.accumulator = 0;
    cancelAnimationFrame(this.animId);
    this.animId = requestAnimationFrame(this._step);
  }

  togglePause(){
    if(this.paused) this.resume(); else this.pause();
  }

  // Abandon the round outright and go back to the start screen. Unlike
  // leaveMatch() this works while alive, and skips the end screen entirely —
  // quitting isn't a result, so there's nothing to report.
  quitToMenu(){
    this.running = false;
    this.paused = false;
    cancelAnimationFrame(this.animId);
    this.animId = null;
    this.countdown = 0;
    this.spawnMark = 0;
    this.spectating = false;
    releaseInputs();
    showMainMenu();
    this.events.emit(EventType.GAME_END, {
      winner: null,
      survivors: this.em.actors().filter(e => e.alive).map(e => e.id)
    });
  }
}
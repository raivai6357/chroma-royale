import {
  COLORS, WORLD_W, WORLD_H, SAFE_R0, CRIT_HP, DASH_STATE,
  FIXED_DT, MAX_FRAME_DT, rand, clamp, radiusForHp,
  ensureAudio, getAudioCtx, playImpact, playCountdownTick
} from './utils.js';
import { updatePlayer, updateDashState, canDash, requestDash } from './physics.js';
import { spawnSpark, spawnBurst } from './combat.js';
import { render } from './renderer.js';
import { input, consumeDash } from './input.js';
import { network } from './network.js';
import { ui, toast, updateHUD, resetHUD, showPrematch, setPrematchCount, hidePrematch,
         showSpectate, updateSpectate, hideSpectate } from './ui.js';

// The online round is server-authoritative: the server owns combat, the zone,
// pickups and every remote blob. This class is the *shadow* of Game — it wears
// the same surface (em/player/center/safeR/particles/...) so render() and
// updateHUD() can't tell the difference, but its fixedUpdate does something
// completely different: predict the local blob, interpolate everyone else, and
// turn snapshot events into particles and toasts.
//
// Rules that fall out of network.js and server/physics.js:
//   - getInterpolatedEntities() always filters the local player out, so the
//     local blob comes from prediction + applyReconciliation, never snapshots.
//   - _handleSnapshot doesn't store data.boxes, so boxes must be read off the
//     raw onSnapshot payload.
//   - network.clientTick only advances via network.tick(), and sendInput()
//     stamps pending inputs with it — skip the tick and reconciliation never
//     retires an input.
//   - Snapshot entities carry no name/cosmetics/AI fields and boxes carry no
//     spin, so all of that is synthesized once and cached per id.

// GO flash duration for the server-driven countdown (server sends whole seconds)
const COUNTDOWN_GO = 0.7;
const SPAWN_MARK_TIME = 2.2;

// Snapshot entities are this thin; everything else below is invented locally.
// { id, playerId, kind, x, y, vx, vy, color, hp, radius, alive, boosting,
//   dashState, isDashing, dashDirX, dashDirY, iframes, hitFlash }

export class OnlineGame {
  constructor(){
    // --- Game-compatible surface (renderer.js + ui.js read all of this) ---
    this.em = new OnlineEntityView();
    this.particles = [];
    this.dmgTexts = [];
    this.dashGhosts = [];
    this.shockwaves = [];
    this.flashes = [];
    this.hitFreeze = 0;      // never set online — the server owns hitstop timing
    this.cameraShake = 0;
    this.player = null;
    this.input = input;
    this.running = false;
    this.elapsed = 0;
    this.lastT = 0;
    this.safeR = SAFE_R0;
    this.center = { x: WORLD_W/2, y: WORLD_H/2 };
    this.animId = null;
    this.countdown = 0;
    this.countLabel = '';
    this.spawnMark = 0;
    this.spectating = false;
    this.accumulator = 0;
    this.tick = 0;
    this.toast = toast;
    // physics.js guards every emit with `if (game.events)` — we want none of
    // them online, so leaving this undefined is the cheapest correct answer.
    this.events = null;

    // --- online-only state ---
    this.myPlayerId = null;
    this.names = new Map();      // playerId -> display name (from game_start)
    this.cosmetics = new Map();  // playerId -> equipped cosmetics (from game_start)
    this.remotes = new Map();    // entity id -> synthesized remote entity
    this.boxCache = new Map();   // "x,y" key -> spin, so pickups don't strobe
    this.lastSnapshotTick = -1;
    this.ended = false;
    this.stalled = false;   // socket down, waiting on a reconnect

    this._step = this.step.bind(this);
    // `input` is a module singleton and Game's constructor already called
    // setupInput() on the same canvas — calling it again would double-register
    // every listener (two dashQueued per press). Nothing to wire here.
  }

  // ---------- lifecycle ----------

  // network.onGameStart — data: { tick, players, spawnPositions }
  start(data){
    ensureAudio();
    const ac = getAudioCtx();
    if(ac && ac.state === 'suspended') ac.resume();

    this.myPlayerId = network.playerId;
    this.names.clear();
    this.cosmetics.clear();
    this.remotes.clear();
    this.boxCache.clear();
    this.particles = [];
    this.dmgTexts = [];
    this.dashGhosts = [];
    this.shockwaves = [];
    this.flashes = [];
    this.cameraShake = 0;
    this.hitFreeze = 0;
    this.elapsed = 0;
    this.safeR = SAFE_R0;
    this.center = { x: WORLD_W/2, y: WORLD_H/2 };
    this.accumulator = 0;
    this.tick = 0;
    this.spectating = false;
    this.lastSnapshotTick = -1;
    this.ended = false;
    this.stalled = false;
    this.em.entities = [];
    this.em.boxList = [];
    resetHUD();
    hideSpectate();

    // spawnPositions is the *only* channel display names arrive on, so cache
    // them before the first snapshot (which carries ids but no names).
    const spawns = data.spawnPositions || {};
    for(const [playerId, sp] of Object.entries(spawns)){
      if(sp && sp.name) this.names.set(playerId, sp.name);
    }
    for(const p of (data.players || [])){
      if(p.name) this.names.set(p.id, p.name);
      if(p.cosmetics) this.cosmetics.set(p.id, p.cosmetics);
    }

    // Build the local blob from our own spawn position. Everything the server
    // never sends (cosmetic timers, trail, facing, dash cooldown) starts here
    // and is maintained by local prediction from now on.
    const mine = spawns[this.myPlayerId] || { x: WORLD_W/2, y: WORLD_H/2, color: 'cyan' };
    this.player = this._makeLocalEntity(mine);
    this.em.entities = [this.player];

    ui.startScreen.classList.add('hidden');
    ui.endScreen.classList.add('hidden');
    ui.hud.classList.remove('hidden');

    // The server runs its own countdown before game_start, so by the time we
    // get here the round is live. Keep a short GO flash + spawn marker so the
    // player can find their blob.
    this.countdown = 0;
    this.countLabel = '';
    this.spawnMark = SPAWN_MARK_TIME;
    hidePrematch();
    playCountdownTick(true);
    consumeDash(); // drop anything buffered from the lobby click

    this.running = true;
    this.lastT = performance.now();
    cancelAnimationFrame(this.animId);
    this.animId = requestAnimationFrame(this._step);
  }

  // network.onGameEnd — data: { winner, winnerPlayerId, survivors, stats }
  end(data){
    if(!this.running && this.ended) return;
    this.running = false;
    this.ended = true;
    cancelAnimationFrame(this.animId);
    this.countdown = 0;
    this.spawnMark = 0;
    this.spectating = false;
    hidePrematch();
    hideSpectate();
    ui.hud.classList.add('hidden');
    ui.endScreen.classList.remove('hidden');

    const won = data && data.winnerPlayerId && data.winnerPlayerId === this.myPlayerId;
    // The round also ends when the clock runs out (rooms.js checks
    // `elapsed >= gameDuration`), and then there's no sole survivor to crown.
    // survivors[] holds ENTITY ids, which is what this.player.id is once the
    // first snapshot resolves it — so it's the honest way to ask "did I live?"
    // rather than assuming everyone who isn't the winner died.
    const myEntityId = this.player ? this.player.id : -1;
    const survived = !!(data && Array.isArray(data.survivors)
      && myEntityId >= 0 && data.survivors.includes(myEntityId));
    if(won){
      ui.endEyebrow.textContent = "VICTORY";
      ui.endTitle.textContent = "YOU ARE THE LAST COLOR";
      ui.endSub.textContent = "Every rival has been consumed. Chroma Royale is yours.";
    } else if(survived){
      // Time expired with more than one blob standing. Telling a player who
      // never died that they were ELIMINATED is just wrong.
      ui.endEyebrow.textContent = "TIME UP";
      ui.endTitle.textContent = "STANDOFF";
      ui.endSub.textContent = "The clock beat you both. Nobody took the arena.";
    } else {
      const winnerName = data && data.winnerPlayerId
        ? (this.names.get(data.winnerPlayerId) || 'A RIVAL')
        : null;
      ui.endEyebrow.textContent = "ROUND OVER";
      ui.endTitle.textContent = "ELIMINATED";
      ui.endSub.textContent = winnerName
        ? winnerName + " took the arena. Back to the lobby for another run."
        : "Nobody made it out. The void takes all.";
    }
  }

  // Torn connection / left the room mid-round — stop the loop without pretending
  // the round resolved.
  abort(message){
    if(!this.running) return;
    this.running = false;
    this.ended = true;
    cancelAnimationFrame(this.animId);
    this.countdown = 0;
    this.spawnMark = 0;
    this.spectating = false;
    hidePrematch();
    hideSpectate();
    ui.hud.classList.add('hidden');
    ui.endScreen.classList.remove('hidden');
    ui.endEyebrow.textContent = "DISCONNECTED";
    ui.endTitle.textContent = "MATCH LOST";
    ui.endSub.textContent = message || "The connection to the arena dropped.";
  }

  isActive(){ return this.running; }

  // A drop we expect to recover from. The loop keeps running (so the arena stays
  // on screen and rAF stays warm) but we stop predicting off stale input — the
  // server is the only thing that can tell us what happened while we were gone.
  onReconnecting(info){
    if(!this.running) return;
    this.stalled = true;
    this.toast(info && info.attempt > 1
      ? `RECONNECTING… (${info.attempt}/${info.max})`
      : "RECONNECTING…");
  }

  // Back on the wire. We're not un-stalled yet: the socket is open but we still
  // hold no seat until the server answers our resume, so keep prediction off
  // and let onResumed/onResumeFailed decide. Un-stalling here would let us
  // predict against state the server may be about to overwrite.
  onReconnected(){
    this.toast("RECONNECTED");
  }

  // The server gave our seat back. Snapshots resume for the same entity id, so
  // the only thing to clear is the stale interpolation state — the next snapshot
  // re-seeds positions, zone and boxes from authority.
  onResumed(){
    if(!this.running) return;
    this.stalled = false;
    this.toast("BACK IN THE ARENA");
    // Snapshots from before the drop describe an older tick range; interpolating
    // across the gap would snap the arena backwards for a frame.
    this.lastSnapshotTick = 0;
  }

  // Seat is gone for good — grace expired, or the round ended while we were out.
  // Nothing to return to, so surface it instead of leaving a frozen arena up.
  onResumeFailed(){
    if(!this.running) return;
    this.abort("Your spot in the arena expired while you were disconnected.");
  }

  onReconnectFailed(){
    this.abort("Lost connection to the arena and couldn't get back in.");
  }

  // Someone else dropped or came back. Their blob stays in the sim during the
  // grace window, so say so rather than letting it look like a frozen opponent.
  // Fires for both directions — `away` distinguishes them.
  onPlayerAway(info){
    if(!this.running) return;
    const who = (info && info.name) ? info.name : "A player";
    this.toast((info && info.away === false)
      ? `${who} RECONNECTED`
      : `${who} DISCONNECTED…`);
  }

  // ---------- snapshots ----------

  // network.onSnapshot — fires *after* network._reconcile(data), so
  // network.lastServerPosition here already describes this snapshot.
  // We only consume presentation state (entities, boxes, zone, events); the
  // reconciliation itself is read off network in the fixed step.
  onSnapshot(data){
    if(!this.running) return;
    if(data.serverTick <= this.lastSnapshotTick) return; // out-of-order UDP-ish arrival
    this.lastSnapshotTick = data.serverTick;

    // The server owns entity ids and game_start doesn't include ours, so adopt
    // it from the first snapshot. Every event below is keyed by entity id, so
    // until this lands the local player matches nothing.
    if(this.player && this.player.id < 0){
      const mine = (data.entities || []).find(e => e.playerId === this.myPlayerId);
      if(mine) this.player.id = mine.id;
    }

    if(data.zone){
      this.safeR = data.zone.safeR;
      if(data.zone.center) this.center = data.zone.center;
    }

    this._syncBoxes(data.boxes || []);
    // Events reference entities by id, so translate them against the entity
    // list in the same snapshot rather than the interpolated (delayed) view.
    this._applyEvents(data.events || [], data.entities || []);
  }

  // Boxes arrive as bare {x,y,color} — no id, no spin. Key them by position so
  // a box that survives between snapshots keeps its rotation instead of
  // re-randomizing 20 times a second.
  _syncBoxes(boxes){
    const seen = new Set();
    const out = [];
    for(const b of boxes){
      const key = Math.round(b.x) + ',' + Math.round(b.y);
      seen.add(key);
      let spin = this.boxCache.get(key);
      if(spin === undefined){
        spin = rand(0, Math.PI * 2);
        this.boxCache.set(key, spin);
      }
      out.push({ kind: 'box', x: b.x, y: b.y, color: b.color, spin });
    }
    for(const key of this.boxCache.keys()){
      if(!seen.has(key)) this.boxCache.delete(key);
    }
    this.em.boxList = out;
  }

  // Server event shapes (server/physics.js):
  //   dash_windup {entityId,x,y}   dash_start {entityId,x,y}   dash_end {entityId,x,y}
  //   death {entityId,x,y,color}   hit {attacker,defender,damage}
  //   kill {killer,victim,x,y}     pickup {entityId,x,y,color}
  // `hit` carries ids only, so positions come from the snapshot entity list.
  _applyEvents(events, snapEntities){
    if(!events.length) return;
    const byId = new Map();
    for(const e of snapEntities) byId.set(e.id, e);
    const localId = this.player ? this.player.id : -1;

    for(const ev of events){
      switch(ev.type){
        case 'dash_windup': {
          const e = byId.get(ev.entityId);
          const color = COLORS[e ? e.color : 'cyan'];
          const r = e ? e.radius : 16;
          for(let i = 0; i < 5; i++){
            const ang = rand(0, Math.PI * 2);
            this.particles.push({
              x: ev.x + Math.cos(ang) * r,
              y: ev.y + Math.sin(ang) * r,
              vx: -Math.cos(ang) * 40, vy: -Math.sin(ang) * 40,
              life: 0.15, maxLife: 0.15, size: 3, alpha: 0.8, color
            });
          }
          break;
        }

        case 'dash_start': {
          const e = byId.get(ev.entityId);
          const color = e ? e.color : 'cyan';
          const dirX = e ? (e.dashDirX || 1) : 1;
          const dirY = e ? (e.dashDirY || 0) : 0;
          const r = e ? e.radius : 16;
          this.shockwaves.push({ x: ev.x, y: ev.y, r: 0, life: 0.3, max: 0.3, color });
          // Local dashes already got their launch fx from predicted physics —
          // only remote blobs need the backblast synthesized here.
          if(ev.entityId === localId) break;
          for(let i = 0; i < 30; i++){
            const jitterAng = rand(-0.9, 0.9);
            const cos = Math.cos(jitterAng), sin = Math.sin(jitterAng);
            const dxr = (dirX * cos - dirY * sin) * -1;
            const dyr = (dirX * sin + dirY * cos) * -1;
            const spd = rand(80, 260);
            this.particles.push({
              x: ev.x - dirX * r, y: ev.y - dirY * r,
              vx: dxr * spd + rand(-40, 40),
              vy: dyr * spd + rand(-40, 40),
              life: rand(0.3, 0.7), maxLife: 0.7,
              size: rand(2, 8), alpha: rand(0.5, 1),
              color: COLORS[color]
            });
          }
          break;
        }

        case 'dash_end':
          // Recovery has no fx of its own locally; nothing to draw.
          break;

        case 'hit': {
          const atk = byId.get(ev.attacker);
          const def = byId.get(ev.defender);
          if(!def) break;
          const x = atk ? (atk.x + def.x) / 2 : def.x;
          const y = atk ? (atk.y + def.y) / 2 : def.y;
          spawnSpark(this, x, y, COLORS[def.color]);
          const advantage = !!atk && ev.damage > 0;
          this.dmgTexts.push({
            x: def.x, y: def.y - def.radius - 4,
            text: "-" + ev.damage,
            life: 0.7, size: 13,
            color: advantage ? "#ffffff" : "rgba(255,255,255,0.5)"
          });
          const r = this._remote(def.id);
          if(r) r.emHit = 0.55;
          if(atk){
            const ra = this._remote(atk.id);
            if(ra) ra.emAttack = Math.max(ra.emAttack, 0.5);
          }
          if(def.id === localId){
            this.cameraShake = Math.max(this.cameraShake, 6);
            this.toast("-" + ev.damage + " HP");
            playImpact();
          } else if(atk && atk.id === localId){
            this.toast("HIT! -" + ev.damage + " HP");
            playImpact();
          }
          break;
        }

        case 'kill': {
          const victim = byId.get(ev.victim);
          const color = COLORS[victim ? victim.color : 'cyan'];
          spawnBurst(this, ev.x, ev.y, color);
          this.shockwaves.push({ x: ev.x, y: ev.y, r: 0, life: 0.4, max: 0.4, color: victim ? victim.color : 'cyan' });
          if(ev.victim === localId){
            this.toast("ELIMINATED BY " + this._nameForEntityId(ev.killer, snapEntities));
            this.cameraShake = Math.max(this.cameraShake, 14);
          } else if(ev.killer === localId){
            this.toast("ELIMINATED " + this._nameForEntityId(ev.victim, snapEntities));
          }
          break;
        }

        case 'death': {
          // Void death (no killer). `kill` already bursts on combat deaths, so
          // only self-inflicted eliminations land here.
          spawnBurst(this, ev.x, ev.y, COLORS[ev.color] || COLORS.cyan);
          if(ev.entityId === localId) this.toast("CONSUMED BY THE VOID");
          break;
        }

        case 'pickup': {
          for(let i = 0; i < 8; i++){
            const ang = rand(0, Math.PI * 2);
            this.particles.push({
              x: ev.x, y: ev.y,
              vx: Math.cos(ang) * 60, vy: Math.sin(ang) * 60,
              life: 0.3, color: COLORS[ev.color] || COLORS.cyan
            });
          }
          if(ev.entityId === localId) this.toast("SHIFTED " + String(ev.color).toUpperCase());
          break;
        }
      }
    }
  }

  _nameForEntityId(entityId, snapEntities){
    const e = snapEntities.find(x => x.id === entityId);
    if(e && e.playerId && this.names.has(e.playerId)) return this.names.get(e.playerId);
    const r = this.remotes.get(entityId);
    return (r && r.name) || 'A RIVAL';
  }

  _remote(id){ return this.remotes.get(id); }

  // ---------- entity synthesis ----------

  // Local blob: a full Game-shaped entity. Prediction owns x/y/vx/vy/dash state;
  // the server corrects it through applyReconciliation each snapshot.
  _makeLocalEntity(spawn){
    return {
      id: -1,                 // replaced by the server id on the first snapshot
      kind: 'player',
      isPlayer: true,
      playerId: this.myPlayerId,
      name: this.names.get(this.myPlayerId) || 'YOU',
      x: spawn.x, y: spawn.y,
      vx: 0, vy: 0,
      facingX: 1, facingY: 0,
      color: spawn.color || 'cyan',
      hp: 100,
      alive: true,
      radius: radiusForHp(100),
      boosting: false,
      dashCooldown: 0,
      dashFlash: 0,
      dashState: DASH_STATE.READY,
      dashStateTimer: 0,
      isDashing: false,
      dashTime: 0,
      dashDirX: 1, dashDirY: 0,
      readyPulse: 0,
      combo: 0, comboTimer: 0,
      stagger: 0, lastCrit: 0,
      trail: [], trailTimer: 0,
      iframes: 0,
      lastAttacker: null,
      hitFlash: 0,
      deathT: 0,
      blobPhase: rand(0, Math.PI*2),
      blobSeed: rand(0, 1000),
      blobRate: rand(0.8, 1.3),
      emAttack: 0, emHit: 0,
      blink: 0, blinkTimer: rand(1.5, 4),
      pupilX: 0, pupilY: 0
    };
  }

  // Remote blob: snapshot fields on top, invented cosmetics underneath. Created
  // once per entity id and mutated in place so the wobble/blink/trail state
  // survives across snapshots.
  _makeRemoteEntity(snap){
    return {
      id: snap.id,
      kind: 'bot',            // renderer only branches on 'box' vs not
      isPlayer: false,
      playerId: snap.playerId,
      name: this.names.get(snap.playerId) || 'RIVAL',
      x: snap.x, y: snap.y,
      vx: snap.vx || 0, vy: snap.vy || 0,
      facingX: snap.dashDirX || 1, facingY: snap.dashDirY || 0,
      color: snap.color,
      hp: snap.hp,
      alive: snap.alive,
      radius: snap.radius,
      boosting: !!snap.boosting,
      dashCooldown: 0,
      dashFlash: 0,
      dashState: snap.dashState,
      dashStateTimer: 0,
      isDashing: !!snap.isDashing,
      dashTime: 0,
      dashDirX: snap.dashDirX || 1, dashDirY: snap.dashDirY || 0,
      readyPulse: 0,
      combo: 0, comboTimer: 0,
      stagger: 0, lastCrit: 0,
      trail: [], trailTimer: 0,
      iframes: snap.iframes || 0,
      lastAttacker: null,
      hitFlash: snap.hitFlash || 0,
      deathT: 0,
      blobPhase: rand(0, Math.PI*2),
      blobSeed: rand(0, 1000),
      blobRate: rand(0.8, 1.3),
      emAttack: 0, emHit: 0,
      blink: 0, blinkTimer: rand(1.5, 4),
      pupilX: 0, pupilY: 0
    };
  }

  // ---------- fixed step ----------

  fixedUpdate(dt){
    this.elapsed += dt;

    // Socket is down and we're waiting on a reconnect. Keep the loop alive for
    // the visuals, but don't predict: with no snapshots coming back there's
    // nothing to reconcile against, so prediction would run away and the blob
    // would be somewhere completely wrong by the time the server answers.
    if(this.stalled){
      this._tickFx(dt);
      this.tick++;
      return;
    }

    // 1. Send this tick's intent. sendInput stamps it with network.clientTick,
    //    which only moves when we call network.tick() — so the tick has to come
    //    first or every pending input is stamped with the same value and
    //    reconciliation can never retire one.
    network.tick();
    const dashQueued = consumeDash();
    const intent = this._buildInput(dashQueued);
    network.sendInput(intent);

    // 2. Predict the local blob with the exact physics the server runs.
    if(this.player && this.player.alive){
      if(dashQueued && canDash(this.player)){
        requestDash(this, this.player, intent.dirX || this.player.facingX,
                                       intent.dirY || this.player.facingY);
      }
      updateDashState(this, this.player, dt);
      updatePlayer(this, this.player, dt);

      const targetR = radiusForHp(this.player.hp);
      this.player.radius += (targetR - this.player.radius) * Math.min(1, 10*dt);

      if(this.player.x < this.player.radius || this.player.x > WORLD_W - this.player.radius) this.player.vx *= -0.3;
      if(this.player.y < this.player.radius || this.player.y > WORLD_H - this.player.radius) this.player.vy *= -0.3;
      this.player.x = clamp(this.player.x, this.player.radius, WORLD_W - this.player.radius);
      this.player.y = clamp(this.player.y, this.player.radius, WORLD_H - this.player.radius);

      // 3. Nudge prediction back toward the server. Position eases; hp/dash
      //    state are hard-assigned by network.applyReconciliation.
      network.applyReconciliation(this.player);
    } else if(this.player && this.player.deathT > 0){
      this.player.deathT -= dt;
      this.player.x += this.player.vx*dt;
      this.player.y += this.player.vy*dt;
      this.player.vx *= Math.exp(-3*dt);
      this.player.vy *= Math.exp(-3*dt);
    }

    // 4. Rebuild remote blobs from the interpolated view (never includes us).
    this._syncRemotes(network.getInterpolatedEntities(), dt);

    // Local cosmetic timers — the same ones movementSystem drives offline.
    if(this.player) this._tickCosmetics(this.player, dt, true);

    this._tickFx(dt);
    this.tick++;
  }

  // Mirror updatePlayer's derivation exactly: mouseCanvas is an aim *point*, so
  // the direction is the normalized offset from the blob, with the same 4px
  // deadzone and the same hp > CRIT_HP boost gate the server applies.
  _buildInput(dashQueued){
    const p = this.player;
    if(!p) return { dirX: 0, dirY: 0, boosting: false, dash: false };
    const dx = this.input.mouseCanvas.x - p.x;
    const dy = this.input.mouseCanvas.y - p.y;
    const d = Math.sqrt(dx*dx + dy*dy);
    return {
      dirX: d > 4 ? dx / d : 0,
      dirY: d > 4 ? dy / d : 0,
      boosting: this.input.boosting && p.hp > CRIT_HP,
      dash: dashQueued
    };
  }

  _syncRemotes(interpolated, dt){
    const seen = new Set();
    for(const snap of interpolated){
      if(snap.kind === 'box') continue;
      seen.add(snap.id);
      let e = this.remotes.get(snap.id);
      if(!e){
        e = this._makeRemoteEntity(snap);
        this.remotes.set(snap.id, e);
      }
      const wasAlive = e.alive;
      // Authoritative fields straight off the wire.
      e.x = snap.x; e.y = snap.y;
      e.vx = snap.vx; e.vy = snap.vy;
      e.color = snap.color;
      e.hp = snap.hp;
      e.radius = snap.radius;
      e.alive = snap.alive;
      e.boosting = !!snap.boosting;
      e.dashState = snap.dashState;
      e.isDashing = !!snap.isDashing;
      e.dashDirX = snap.dashDirX;
      e.dashDirY = snap.dashDirY;
      e.iframes = snap.iframes;
      e.stagger = snap.stagger || 0;   // renderer draws a stagger tell off this
      e.hitFlash = snap.hitFlash;
      if(!e.name || e.name === 'RIVAL'){
        const n = this.names.get(snap.playerId);
        if(n) e.name = n;
      }
      if(wasAlive && !e.alive) e.deathT = 0.5;

      // Cosmetic state the server never sends.
      if(e.alive){
        this._tickCosmetics(e, dt, false);
        if(e.isDashing){
          this.dashGhosts.push({
            x: e.x, y: e.y, color: e.color, radius: e.radius,
            life: 0.25, max: 0.25, phase: e.blobPhase, seed: e.blobSeed
          });
        }
        this._tickTrail(e, dt);
      } else if(e.deathT > 0){
        e.deathT -= dt;
      }
    }
    for(const id of this.remotes.keys()){
      if(!seen.has(id)) this.remotes.delete(id);
    }
    // The local blob comes first so it keeps a stable draw order.
    this.em.entities = this.player
      ? [this.player, ...this.remotes.values()]
      : [...this.remotes.values()];
  }

  // Membrane wobble, eye emotion decay, blink cycle, gaze easing — pure
  // presentation, identical to Game.movementSystem's tail.
  _tickCosmetics(e, dt, isLocal){
    e.blobPhase += dt * e.blobRate;
    if(e.emAttack > 0) e.emAttack -= dt;
    if(e.emHit > 0) e.emHit -= dt;
    if(e.hitFlash > 0) e.hitFlash -= dt;
    if(e.blink > 0){
      e.blink -= dt;
    } else {
      e.blinkTimer -= dt;
      if(e.blinkTimer <= 0){ e.blink = 0.12; e.blinkTimer = rand(2,5); }
    }
    let gdx, gdy;
    if(isLocal){ gdx = this.input.mouseCanvas.x - e.x; gdy = this.input.mouseCanvas.y - e.y; }
    else { gdx = e.vx; gdy = e.vy; }
    const gl = Math.hypot(gdx, gdy);
    const tgx = gl > 1 ? gdx/gl : 0, tgy = gl > 1 ? gdy/gl : 0;
    const gEase = Math.min(1, 12*dt);
    e.pupilX += (tgx - e.pupilX) * gEase;
    e.pupilY += (tgy - e.pupilY) * gEase;
  }

  // Same shape as physics.updateTrail, but driven off interpolated positions
  // rather than integrated velocity.
  _tickTrail(e, dt){
    const spd = Math.hypot(e.vx, e.vy);
    e.trailTimer -= dt;
    if(spd > 50 && e.trailTimer <= 0){
      e.trail.push({ x: e.x, y: e.y, life: 0.4, radius: e.radius * 0.6 });
      e.trailTimer = 0.03;
      if(e.trail.length > 12) e.trail.shift();
    }
    for(let i = e.trail.length - 1; i >= 0; i--){
      e.trail[i].life -= dt;
      if(e.trail[i].life <= 0) e.trail.splice(i, 1);
    }
  }

  _tickFx(dt){
    for(const p of this.particles){
      p.x += p.vx*dt; p.y += p.vy*dt;
      p.vx *= 0.94; p.vy *= 0.94;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);

    for(const tx of this.dmgTexts){ tx.y -= 40*dt; tx.life -= dt; }
    this.dmgTexts = this.dmgTexts.filter(tx => tx.life > 0);

    for(const g of this.dashGhosts) g.life -= dt;
    this.dashGhosts = this.dashGhosts.filter(g => g.life > 0);

    for(const s of this.shockwaves){ s.r += 600*dt; s.life -= dt; }
    this.shockwaves = this.shockwaves.filter(s => s.life > 0);

    for(const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter(f => f.life > 0);

    this.cameraShake *= 0.9;
    if(this.cameraShake < 0.2) this.cameraShake = 0;
    if(this.spawnMark > 0) this.spawnMark -= dt;
  }

  // ---------- main loop ----------
  // Same fixed-timestep accumulator as Game.step, minus the local end-of-round
  // check: online, the round ends when the server says so (onGameEnd).
  step(t){
    if(!this.running) return;

    const frameDt = Math.min(MAX_FRAME_DT, (t - this.lastT) / 1000 || 0);
    this.lastT = t;
    this.accumulator += frameDt;
    while(this.accumulator >= FIXED_DT){
      this.fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    render(this);
    updateHUD(this);

    if(this.player && !this.player.alive){
      const aliveNow = this.em.actors().filter(e => e.alive).length;
      if(this.spectating) updateSpectate(aliveNow);
      else { this.spectating = true; showSpectate(aliveNow); }
    }

    this.animId = requestAnimationFrame(this._step);
  }

  // Bail out of a round we're already dead in — leaves the room so the server
  // stops holding a seat for us.
  leaveMatch(){
    if(!this.running || (this.player && this.player.alive)) return;
    network.leaveRoom();
    this.running = false;
    this.ended = true;
    cancelAnimationFrame(this.animId);
    this.countdown = 0;
    this.spawnMark = 0;
    this.spectating = false;
    hidePrematch();
    hideSpectate();
    ui.hud.classList.add('hidden');
    ui.endScreen.classList.remove('hidden');
    ui.endEyebrow.textContent = "LEFT THE ARENA";
    ui.endTitle.textContent = "ELIMINATED";
    ui.endSub.textContent = "You walked away from the arena.";
  }
}

// Duck-typed EntityManager. renderer.js and ui.js call entities/actors()/boxes()
// and nothing else — no id allocation is needed because the server owns ids.
class OnlineEntityView {
  constructor(){
    this.entities = [];
    this.boxList = [];
  }
  actors(){ return this.entities; }   // never holds boxes to begin with
  boxes(){ return this.boxList; }
}

export const onlineGame = new OnlineGame();

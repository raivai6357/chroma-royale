import { COLORS, PASSIVES, BEATS, WORLD_W, WORLD_H, BOX_R, CRIT_HP, MAX_SPEED, clamp, ZONE_WARN_TIME,
         LOW_FX, DPR_CAP, fxShadow } from './utils.js';

// ---------- canvas ----------
// The arena is a fixed 800x600 world, but the canvas is whatever size CSS gives
// it — full-bleed on a phone in landscape, a 4:3 card on desktop. So the backing
// store is sized from the *measured* element and the context is scaled to map
// world units onto it. Everything below still draws in 800x600 coordinates.
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');

// Measured in resize() and read by renderMinimap. Zero width means the minimap is
// display:none (it's hidden on touch, where the bottom corners hold the thumb
// controls) — the render is skipped entirely rather than drawn off-screen.
let miniW = 140, miniH = 105;

// The measured CSS width of the canvas, kept so draw code can tell how many real
// screen pixels a world unit is worth. Anything sized in world units shrinks with
// it, which is what makes the cycle guide unusable on a phone.
let cssScale = 1;

export function resize(){
  const dpr = Math.min(devicePixelRatio || 1, DPR_CAP);

  // Fall back to the world size before first layout, when the rect is still 0x0.
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width || WORLD_W;
  const cssH = rect.height || WORLD_H;

  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  cssScale = cssW / WORLD_W;
  // One transform does both jobs: DPR scaling and world→CSS-pixel scaling. The
  // stage keeps a 4:3 aspect-ratio so sx and sy stay equal and nothing distorts.
  ctx.setTransform(dpr * cssW / WORLD_W, 0, 0, dpr * cssH / WORLD_H, 0, 0);

  const mrect = mini.getBoundingClientRect();
  miniW = mrect.width;
  miniH = mrect.height;
  if(miniW > 0){
    mini.width = Math.round(miniW * dpr);
    mini.height = Math.round(miniH * dpr);
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

export function getCanvas(){ return canvas; }

// The stage resizes without the window doing so: the mobile toolbar collapsing,
// an orientation change, or the HUD appearing all change the measured box. A
// resize-only listener misses those and leaves the canvas at the wrong scale.
if(typeof ResizeObserver === 'function'){
  new ResizeObserver(() => resize()).observe(canvas);
}

// ---------- amoeba rendering ----------
// Trace a wobbling blob outline into the current path. Radius is modulated by
// a couple of sine waves that travel around the rim, so the membrane ripples.
// `wobble` scales how violent the waving is (0 = round, 1 = lively).
// Fewer segments on a phone: this path is stroked/filled two or three times per
// blob per frame, so the vertex count multiplies faster than it looks.
const BLOB_SEGS = LOW_FX ? 16 : 26;
function blobPath(c, r, phase, seed, wobble){
  c.beginPath();
  for(let i=0;i<=BLOB_SEGS;i++){
    const a = (i/BLOB_SEGS)*Math.PI*2;
    // two travelling waves at different frequencies + a slow breathing term
    const wob =
      Math.sin(a*3 + phase*1.7 + seed)*0.12 +
      Math.sin(a*5 - phase*1.1 + seed*1.3)*0.07 +
      Math.sin(a*2 + phase*0.6)*0.05;
    const rr = r * (1 + wob*wobble);
    const px = Math.cos(a)*rr, py = Math.sin(a)*rr;
    if(i===0) c.moveTo(px,py); else c.lineTo(px,py);
  }
  c.closePath();
}

// Draw the central eye. `emotion` is one of 'idle' | 'attack' | 'hit' | 'dead'.
// `gx,gy` is the unit gaze direction; `blink` in [0,0.12] closes the lid.
function drawEye(c, r, gx, gy, emotion, blink){
  const eyeR = Math.max(3, r*0.5);
  const pupilR = eyeR*0.5;

  // sclera (white of the eye)
  c.fillStyle = "#f6f4ff";
  c.beginPath();
  c.arc(0,0,eyeR,0,Math.PI*2);
  c.fill();

  // pupil position eases toward the gaze; clamped inside the sclera
  const reach = eyeR - pupilR - 1;
  const px = gx*reach, py = gy*reach;

  // pupil — color/shape shifts with emotion
  if(emotion==='dead'){
    // X_X — two crossed strokes instead of a pupil
    c.strokeStyle = "#1a1420";
    c.lineWidth = Math.max(1.5, eyeR*0.22);
    c.lineCap = "round";
    const s = eyeR*0.55;
    c.beginPath();
    c.moveTo(-s,-s); c.lineTo(s,s);
    c.moveTo(s,-s); c.lineTo(-s,s);
    c.stroke();
    return;
  }

  c.fillStyle = "#100b18";
  if(emotion==='hit'){
    // shocked: big constricted pupil, wide open
    c.beginPath();
    c.arc(px,py,pupilR*0.7,0,Math.PI*2);
    c.fill();
  } else {
    c.beginPath();
    c.arc(px,py,pupilR,0,Math.PI*2);
    c.fill();
  }

  // little glint
  c.fillStyle = "rgba(255,255,255,0.85)";
  c.beginPath();
  c.arc(px - pupilR*0.35, py - pupilR*0.35, Math.max(1,pupilR*0.28), 0, Math.PI*2);
  c.fill();

  // lids: an angry V for attack, an anxious high arc for hit, a soft cap for blink
  if(emotion==='attack'){
    c.strokeStyle = "#1a1420";
    c.lineWidth = Math.max(2, eyeR*0.32);
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(-eyeR*1.05, -eyeR*0.85);
    c.lineTo(-eyeR*0.1, -eyeR*0.25);
    c.moveTo( eyeR*1.05, -eyeR*0.85);
    c.lineTo( eyeR*0.1, -eyeR*0.25);
    c.stroke();
  }
  if(blink>0){
    // lid sweeping down over the eye, clipped to the sclera circle
    const t = 1 - Math.abs(blink-0.06)/0.06; // 0..1..0 across the blink
    c.save();
    c.beginPath();
    c.arc(0,0,eyeR,0,Math.PI*2);
    c.clip();
    c.fillStyle = "#100b18";
    c.fillRect(-eyeR-1, -eyeR-1, (eyeR+1)*2, (eyeR*2+2)*clamp(t,0,1));
    c.restore();
  }
}
// ---------- in-arena color-cycle guide ----------
// A small cyan -> magenta -> yellow -> cyan flow diagram plus the passive key,
// tucked into the arena's top-left corner. It's drawn early in the frame (under
// the void edge, boxes, blobs and every fx layer) and kept at low alpha, so it
// sits behind the action instead of covering it. It also dims out of the way
// when the shrinking safe zone or a blob reaches its corner.
const CYCLE_ORDER = ['cyan', 'magenta', 'yellow'];
const CYC = {
  x: 20, y: 22,      // top-left origin inside the arena
  w: 132,            // width of the whole block
  nodeR: 7,
  triH: 96,          // height reserved for the triangle
  baseAlpha: 0.92,   // fully readable by default
  dimAlpha: 0.1      // only while a blob is actually over it
};
// Node positions: cyan at the apex, magenta bottom-right, yellow bottom-left —
// matching BEATS (cyan->magenta->yellow->cyan) as a clockwise flow.
function cycleNodes(){
  const cx = CYC.x + CYC.w/2;
  const top = CYC.y + 12;                  // room for the CYAN label above
  const bottom = CYC.y + CYC.triH - 14;    // room for the bottom labels below
  const halfW = CYC.w/2 - 20;
  return {
    cyan:    { x: cx,         y: top },
    magenta: { x: cx + halfW, y: bottom },
    yellow:  { x: cx - halfW, y: bottom }
  };
}

// Eased so a blob skimming the panel edge can't strobe it between the two levels.
let cycAlpha = CYC.baseAlpha;

// Below this scale the guide is worse than nothing. Its labels are 8.5px and 6.5px
// in *world* units, so at the ~0.65 scale a phone gives the arena in landscape they
// render at 5.5px and 4.2px — unreadable — and the block lands under the HP readout,
// which landscape moves to the same top-left corner. The colour cycle is already
// spelled out in real DOM text on the start screen and in How to Play, so dropping
// it here costs no information. 0.75 clears both short phones (0.65) and the collision
// threshold while keeping it on tablets (1.0+) and desktops.
const CYC_MIN_SCALE = 0.75;

function drawCycleGuide(game){
  if(cssScale < CYC_MIN_SCALE) return;
  // The guide stays fully visible at all times. It only fades while the local player's
  // own blob is over its footprint — nothing else (zone, void, bots) dims it.
  const nodes = cycleNodes();
  // real footprint: the triangle plus the buff rows beneath it
  const bx0 = CYC.x, by0 = CYC.y;
  const bx1 = CYC.x + CYC.w, by1 = CYC.y + CYC.triH + 58;
  // Only your own blob fades it. Bots crossing the corner used to dim the guide even
  // though it was still the information you needed to fight them.
  const p = game.player;
  let covered = false;
  if(p && p.alive){
    // distance from the blob centre to the panel rect (0 when the centre is inside)
    const nx = clamp(p.x, bx0, bx1), ny = clamp(p.y, by0, by1);
    covered = Math.hypot(p.x - nx, p.y - ny) < p.radius;
  }
  const target = covered ? CYC.dimAlpha : CYC.baseAlpha;
  // dim fast (get out of the blob's way), restore gently (no flicker on a near-miss)
  const rate = covered ? 0.45 : 0.12;
  // between rounds, snap instead of easing so a new round never opens mid-fade
  cycAlpha = game.running ? cycAlpha + (target - cycAlpha) * rate : target;
  const alpha = cycAlpha;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";

  // --- edges + arrowheads, one per BEATS entry ---
  ctx.strokeStyle = "rgba(150,142,190,0.85)";
  ctx.fillStyle = "rgba(150,142,190,0.85)";
  ctx.lineWidth = 1.4;
  for(const from of CYCLE_ORDER){
    const a = nodes[from], b = nodes[BEATS[from]];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx/len, uy = dy/len;
    const gap = CYC.nodeR + 5;               // clear both circles
    const x1 = a.x + ux*gap, y1 = a.y + uy*gap;
    const x2 = b.x - ux*gap, y2 = b.y - uy*gap;
    // shaft stops short of the head so the two don't overlap
    const headLen = 7, headHalf = 3.6;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - ux*headLen, y2 - uy*headLen);
    ctx.stroke();
    // arrowhead pointing at the color this edge beats
    const px = -uy, py = ux;                 // edge normal
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux*headLen + px*headHalf, y2 - uy*headLen + py*headHalf);
    ctx.lineTo(x2 - ux*headLen - px*headHalf, y2 - uy*headLen - py*headHalf);
    ctx.closePath();
    ctx.fill();
  }

  // --- nodes ---
  for(const key of CYCLE_ORDER){
    const n = nodes[key];
    ctx.fillStyle = COLORS[key];
    fxShadow(ctx, COLORS[key], 8);
    ctx.beginPath();
    ctx.arc(n.x, n.y, CYC.nodeR, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // --- node labels: apex above, base nodes below ---
  ctx.font = "700 8.5px 'Syne', sans-serif";
  ctx.fillStyle = "rgba(240,238,255,0.9)";
  ctx.textAlign = "center";
  ctx.fillText("CYAN", nodes.cyan.x, nodes.cyan.y - CYC.nodeR - 5);
  ctx.fillText("MAGENTA", nodes.magenta.x, nodes.magenta.y + CYC.nodeR + 11);
  ctx.fillText("YELLOW", nodes.yellow.x, nodes.yellow.y + CYC.nodeR + 11);

  // --- "beats" tags at each edge midpoint, nudged outward along the normal ---
  ctx.font = "600 6.5px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(150,142,190,0.8)";
  const triCx = (nodes.cyan.x + nodes.magenta.x + nodes.yellow.x)/3;
  const triCy = (nodes.cyan.y + nodes.magenta.y + nodes.yellow.y)/3;
  for(const from of CYCLE_ORDER){
    const a = nodes[from], b = nodes[BEATS[from]];
    const mx = (a.x + b.x)/2, my = (a.y + b.y)/2;
    // push away from the triangle's centroid so the tag sits outside the edge
    const ox = mx - triCx, oy = my - triCy;
    const ol = Math.hypot(ox, oy) || 1;
    ctx.fillText("beats", mx + (ox/ol)*9, my + (oy/ol)*9 + 2.5);
  }

  // --- divider + passive key, straight from PASSIVES so tuning updates it ---
  let ly = CYC.y + CYC.triH + 12;
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CYC.x + 4, ly - 7);
  ctx.lineTo(CYC.x + CYC.w - 4, ly - 7);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.font = "600 8px 'JetBrains Mono', monospace";
  for(const key of CYCLE_ORDER){
    const sx = CYC.x + 8;
    ctx.fillStyle = COLORS[key];
    fxShadow(ctx, COLORS[key], 6);
    ctx.beginPath();
    ctx.arc(sx, ly, 3, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(225,222,245,0.85)";
    ctx.fillText(PASSIVES[key].label, sx + 8, ly + 3);
    ly += 12;
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------- render ----------
export function render(game){
  const w = WORLD_W, h = WORLD_H;
  const center = game.center, safeR = game.safeR, elapsed = game.elapsed;
  const entities = game.em.entities;
  const boxes = game.em.boxes();

  ctx.clearRect(0,0,w,h);
  ctx.save();

  // camera shake — jitter the whole scene; deterministic-ish offset from a decaying magnitude
  if(game.cameraShake > 0){
    const ox = rnd(-game.cameraShake, game.cameraShake);
    const oy = rnd(-game.cameraShake, game.cameraShake);
    ctx.translate(ox, oy);
  }

  ctx.fillStyle = "#05060a";
  // overdraw the margins so the shake translate never reveals bare canvas
  ctx.fillRect(-40,-40,w+80,h+80);

  // starfield grid
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  const gap = 80;
  for(let x=0; x<=w; x+=gap){
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
  }
  for(let y=0; y<=h; y+=gap){
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  }

  // world bounds
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 3;
  ctx.strokeRect(0,0,w,h);

  // darkness (outside safe circle)
  ctx.save();
  ctx.beginPath();
  ctx.rect(0,0,w,h);
  ctx.arc(center.x, center.y, safeR, 0, Math.PI*2, true);
  ctx.fillStyle = "rgba(6,3,14,0.86)";
  ctx.fill("evenodd");
  ctx.restore();

  // jagged void edge
  ctx.beginPath();
  const segs = 90;
  for(let i=0;i<=segs;i++){
    const a = (i/segs)*Math.PI*2;
    const jag = Math.sin(a*11 + elapsed*2)*6 + Math.sin(a*23 - elapsed*3)*3;
    const r = safeR + jag;
    const px = center.x + Math.cos(a)*r, py = center.y + Math.sin(a)*r;
    if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath();
  ctx.strokeStyle = "rgba(180,110,255,0.55)";
  ctx.lineWidth = 3;
  fxShadow(ctx, "rgba(150,80,255,0.6)", 18);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // boxes
  for(const bx of boxes){
    ctx.save();
    ctx.translate(bx.x,bx.y);
    ctx.rotate(bx.spin + elapsed*0.6);
    ctx.fillStyle = COLORS[bx.color];
    fxShadow(ctx, COLORS[bx.color], 12);
    ctx.fillRect(-BOX_R,-BOX_R,BOX_R*2,BOX_R*2);
    ctx.restore();
  }

  // movement trails — drawn under dash afterimages for layered effect
  for(const e of entities){
    if(e.kind === 'box' || !e.alive || !e.trail) continue;
    for(let i = 0; i < e.trail.length; i++){
      const t = e.trail[i];
      const alpha = clamp(t.life / 0.4, 0, 1) * 0.4;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLORS[e.color];
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.radius * (0.5 + alpha * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // dash afterimages — drawn under everything living so the player leads its own trail
  for(const g of game.dashGhosts){
    ctx.globalAlpha = clamp(g.life/g.max, 0, 1) * 0.6;
    ctx.fillStyle = COLORS[g.color];
    ctx.save();
    ctx.translate(g.x, g.y);
    blobPath(ctx, g.radius, g.phase||0, g.seed||0, 1);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // expanding shockwave rings
  for(const s of game.shockwaves){
    ctx.globalAlpha = clamp(s.life/s.max, 0, 1);
    ctx.strokeStyle = COLORS[s.color];
    ctx.lineWidth = s.isCrit ? 6 : 4;
    fxShadow(ctx, COLORS[s.color], s.isCrit ? 24 : 16);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
    ctx.stroke();
    // Double ring for crits
    if(s.isCrit && s.r > 10){
      ctx.globalAlpha *= 0.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 0.7, 0, Math.PI*2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // entities (player + bots only; boxes drawn above)
  for(const e of entities){
    if(e.kind === 'box') continue;
    if(!e.alive){
      if(e.deathT>0){
        ctx.save();
        ctx.globalAlpha = clamp(e.deathT/0.5, 0, 1);
        ctx.translate(e.x,e.y);
        const dr = e.radius*ctx.globalAlpha;
        ctx.fillStyle = COLORS[e.color];
        blobPath(ctx, dr, e.blobPhase, e.blobSeed, 1);
        ctx.fill();
        // dead eye (X_X) sits on the shrinking corpse
        drawEye(ctx, dr, 0, 0, 'dead', 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      continue;
    }
    // long neon dash trail — drawn in world space before the body
    if(e.isDashing){
      ctx.save();
      ctx.strokeStyle = COLORS[e.color];
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      fxShadow(ctx, COLORS[e.color], 30);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x - e.dashDirX*45, e.y - e.dashDirY*45);
      ctx.stroke();
      ctx.restore();
    }
    
    // stagger indicator — flashing red ring when stunned
    if(e.stagger > 0){
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(elapsed * 20);
      ctx.strokeStyle = "#ff3333";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    
    // critical hit flash — yellow ring when just landed a crit
    if(e.lastCrit > 0){
      ctx.save();
      ctx.globalAlpha = clamp(e.lastCrit / 0.3, 0, 1);
      ctx.strokeStyle = "#ffff00";
      ctx.lineWidth = 3;
      fxShadow(ctx, "#ffff00", 15);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(e.x,e.y);
    const crit = e.hp <= CRIT_HP;
    const col = COLORS[e.color];
    fxShadow(ctx, col, e.boosting ? 30 : (e.dashFlash>0 ? 40 : 16));
    // slight stretch along velocity when moving fast — sells the momentum.
    // dashing pins it much higher so the body reads as a streak.
    const spd = Math.hypot(e.vx,e.vy);
    const stretch = e.isDashing ? 2.5 : clamp(spd/MAX_SPEED, 0, 1.6);
    if(stretch > 0.15){
      const ang = e.isDashing ? Math.atan2(e.dashDirY,e.dashDirX) : Math.atan2(e.vy,e.vx);
      ctx.rotate(ang);
      ctx.scale(1 + stretch*0.22, 1 - stretch*0.12);
      ctx.rotate(-ang);
    }
    // wobbly amoeba membrane — waves harder when hurt or lunging
    const wobble = 1 + (e.emHit>0 ? 0.7 : 0) + (e.emAttack>0 ? 0.4 : 0);
    blobPath(ctx, e.radius, e.blobPhase, e.blobSeed, wobble);
    ctx.fillStyle = (e.hitFlash>0 || e.dashFlash>0) ? "#ffffff" : col;
    ctx.fill();
    // a translucent inner rim gives the blob some body/depth
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ffffff";
    blobPath(ctx, e.radius*0.72, e.blobPhase*1.2, e.blobSeed+5, wobble);
    ctx.fill();
    ctx.globalAlpha = 1;
    if(crit){
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,60,60,"+(0.5+0.5*Math.sin(elapsed*10))+")";
      blobPath(ctx, e.radius, e.blobPhase, e.blobSeed, wobble);
      ctx.stroke();
    }
    // "READY!" pulse ring when the dash just came off cooldown
    if(e.readyPulse>0){
      const p = e.readyPulse/0.4;
      ctx.globalAlpha = p;
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS[e.color];
      ctx.beginPath();
      ctx.arc(0,0,e.radius + (1-p)*14, 0, Math.PI*2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // the eye rides on top, un-stretched and upright, so it stays readable.
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.shadowBlur = 0;
    const emotion = e.emHit>0 ? 'hit' : (e.emAttack>0 ? 'attack' : 'idle');
    drawEye(ctx, e.radius, e.pupilX, e.pupilY, emotion, e.blink);
    ctx.restore();

    // name tag — suppressed on the local player while the spawn marker owns
    // that spot with its own "YOU" label
    const marked = e.isPlayer && (game.countdown > 0 || game.spawnMark > 0);
    if(!marked){
      ctx.font = "600 11px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.textAlign = "center";
      ctx.shadowBlur = 0;
      ctx.fillText(e.name, e.x, e.y - e.radius - 8);
    }
  }

  // spawn marker — makes it obvious which blob is yours at the start of a round.
  // Drawn over the blobs but under the fx layers so particles still read on top.
  drawSpawnMarker(game);

  // particles
  for(const p of game.particles){
    const baseA = p.alpha!==undefined ? p.alpha : 1;
    const lifeFrac = p.maxLife ? clamp(p.life/p.maxLife,0,1) : clamp(p.life,0,1);
    ctx.globalAlpha = clamp(lifeFrac*baseA, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.size!==undefined ? p.size : 3,0,Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // white dash flashes — bright radial pop, drawn over the action
  for(const f of game.flashes){
    ctx.globalAlpha = 0.4 * clamp(f.life/f.max, 0, 1);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // color-cycle guide, drawn last of the arena layers: the void overlay, blobs and fx
  // all paint underneath it, so the matchup reference is readable at every zone size.
  // Only floating damage numbers sit on top.
  drawCycleGuide(game);

  // floating damage numbers
  ctx.textAlign = "center";
  for(const t of game.dmgTexts){
    ctx.globalAlpha = clamp(t.life/(t.isCrit ? 1.0 : 0.7), 0, 1);
    ctx.font = `${t.isCrit ? '900' : '700'} ${t.size || 13}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = t.color;
    // Add glow for crits
    if(t.isCrit){
      fxShadow(ctx, "#ffff00", 10);
    }
    ctx.fillText(t.text, t.x, t.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  renderMinimap(game);
}

// "YOU" spawn marker. Full strength while the pre-match countdown is running,
// then fades out over game.spawnMark seconds once play begins. Spawn corners are
// shuffled every round, so without this you can't tell which blob you are.
function drawSpawnMarker(game){
  const p = game.player;
  if(!p || !p.alive) return;
  const counting = game.countdown > 0;
  const alpha = counting ? 1 : clamp(game.spawnMark / 0.8, 0, 1);
  if(alpha <= 0) return;

  const col = COLORS[p.color];
  // during the countdown the pulse is driven by a wall clock, since game.elapsed
  // is deliberately frozen until GO
  const t = counting ? (performance.now()/1000) : game.elapsed;
  const pulse = 0.5 + 0.5*Math.sin(t*4);

  ctx.save();
  ctx.globalAlpha = alpha;

  // two concentric rings, the outer one breathing outward
  ctx.strokeStyle = col;
  fxShadow(ctx, col, 14);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius + 12 + pulse*7, 0, Math.PI*2);
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.45;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius + 22 + pulse*10, 0, Math.PI*2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // bobbing chevron above the blob, pointing down at it
  const bob = Math.sin(t*3)*4;
  const tipY = p.y - p.radius - 20 + bob;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = col;
  fxShadow(ctx, col, 12);
  ctx.beginPath();
  ctx.moveTo(p.x, tipY + 10);
  ctx.lineTo(p.x - 9, tipY - 6);
  ctx.lineTo(p.x + 9, tipY - 6);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  // "YOU" label above the chevron, replacing the generic name tag position
  ctx.font = "800 12px 'Syne', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText("YOU", p.x, tipY - 12);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function renderMinimap(game){
  // Hidden by CSS on touch devices — the corner belongs to the thumb controls,
  // and the whole arena is on screen anyway, so there's nothing to skip drawing.
  if(miniW <= 0) return;
  const mw = miniW, mh = miniH;
  const center = game.center, safeR = game.safeR;
  mctx.clearRect(0,0,mw,mh);
  mctx.save();
  mctx.fillStyle = "rgba(10,7,20,0.4)";
  mctx.fillRect(0,0,mw,mh);
  const scale = mw/WORLD_W; // uniform scale so the safe-zone circle isn't distorted
  // safe zone
  mctx.beginPath();
  mctx.arc(center.x*scale, center.y*scale, safeR*scale, 0, Math.PI*2);
  mctx.strokeStyle = "rgba(180,110,255,0.7)";
  mctx.lineWidth = 2;
  mctx.stroke();
  for(const e of game.em.entities){
    if(e.kind === 'box' || !e.alive) continue;
    mctx.fillStyle = e.isPlayer ? "#ffffff" : COLORS[e.color];
    mctx.beginPath();
    mctx.arc(e.x*scale, e.y*scale, e.isPlayer?3.5:2.5, 0, Math.PI*2);
    mctx.fill();
  }
  // matching spawn highlight so the minimap agrees with the arena marker
  const p = game.player;
  if(p && p.alive && (game.countdown > 0 || game.spawnMark > 0)){
    const a = game.countdown > 0 ? 1 : clamp(game.spawnMark/0.8, 0, 1);
    const pulse = 0.5 + 0.5*Math.sin((game.countdown>0 ? performance.now()/1000 : game.elapsed)*4);
    mctx.globalAlpha = a;
    mctx.strokeStyle = COLORS[p.color];
    mctx.lineWidth = 1.5;
    mctx.beginPath();
    mctx.arc(p.x*scale, p.y*scale, 5 + pulse*3, 0, Math.PI*2);
    mctx.stroke();
    mctx.globalAlpha = 1;
  }
  mctx.restore();
}

// local rand — the camera-shake jitter used Math.random via utils.rand; keep it
// self-contained here so the renderer has no reason to reach into game logic.
function rnd(a,b){ return a + Math.random()*(b-a); }


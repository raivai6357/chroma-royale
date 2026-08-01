// Visual effects - screenshake, particles, trails, transitions
import { particlePool, trailPool } from './pool.js';

// ---------- Screen Shake ----------
let shakeIntensity = 0;
let shakeDuration = 0;
let shakeTime = 0;
let shakeOffsetX = 0;
let shakeOffsetY = 0;

export function triggerShake(intensity, duration) {
  shakeIntensity = Math.max(shakeIntensity, intensity);
  shakeDuration = Math.max(shakeDuration, duration);
  shakeTime = 0;
}

export function updateShake(dt) {
  if (shakeDuration <= 0) {
    shakeOffsetX = 0;
    shakeOffsetY = 0;
    return;
  }
  
  shakeTime += dt;
  if (shakeTime >= shakeDuration) {
    shakeDuration = 0;
    shakeIntensity = 0;
    shakeOffsetX = 0;
    shakeOffsetY = 0;
    return;
  }
  
  const progress = 1 - (shakeTime / shakeDuration);
  const currentIntensity = shakeIntensity * progress;
  
  shakeOffsetX = (Math.random() * 2 - 1) * currentIntensity;
  shakeOffsetY = (Math.random() * 2 - 1) * currentIntensity;
}

export function getShakeOffset() {
  return { x: shakeOffsetX, y: shakeOffsetY };
}

// ---------- Particles ----------
const particles = [];
const maxParticles = 500;

export function spawnParticle(x, y, vx, vy, life, size, color) {
  if (particles.length >= maxParticles) {
    // Remove oldest
    particlePool.release(particles.shift());
  }
  
  const p = particlePool.acquire();
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.life = 0;
  p.maxLife = life;
  p.size = size;
  p.color = color;
  p.alpha = 1;
  
  particles.push(p);
  return p;
}

export function spawnExplosion(x, y, count, color, speed = 200) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const spd = speed * (0.5 + Math.random() * 0.5);
    spawnParticle(
      x, y,
      Math.cos(angle) * spd,
      Math.sin(angle) * spd,
      0.5 + Math.random() * 0.5,
      3 + Math.random() * 4,
      color
    );
  }
}

export function spawnDashTrail(x, y, color) {
  for (let i = 0; i < 5; i++) {
    spawnParticle(
      x + (Math.random() - 0.5) * 20,
      y + (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 50,
      (Math.random() - 0.5) * 50,
      0.3 + Math.random() * 0.2,
      4 + Math.random() * 3,
      color
    );
  }
}

export function spawnDeathEffect(x, y, color) {
  spawnExplosion(x, y, 30, color, 300);
  // Add ring effect
  for (let i = 0; i < 20; i++) {
    const angle = (Math.PI * 2 * i) / 20;
    spawnParticle(
      x, y,
      Math.cos(angle) * 150,
      Math.sin(angle) * 150,
      0.8,
      2,
      '#ffffff'
    );
  }
}

export function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    
    if (p.life >= p.maxLife) {
      particlePool.release(p);
      particles.splice(i, 1);
      continue;
    }
    
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.alpha = 1 - (p.life / p.maxLife);
  }
}

export function renderParticles(ctx) {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function getParticleCount() {
  return particles.length;
}

// ---------- Trails ----------
const trails = new Map(); // entityId -> trail points

export function addTrailPoint(entityId, x, y, color) {
  if (!trails.has(entityId)) {
    trails.set(entityId, { points: [], color, maxLength: 20 });
  }
  
  const trail = trails.get(entityId);
  
  if (trail.points.length >= trail.maxLength) {
    trailPool.release(trail.points.shift());
  }
  
  const point = trailPool.acquire();
  point.x = x;
  point.y = y;
  point.alpha = 1;
  point.size = 8;
  
  trail.points.push(point);
}

export function updateTrails(dt) {
  for (const [id, trail] of trails) {
    for (let i = trail.points.length - 1; i >= 0; i--) {
      const point = trail.points[i];
      point.alpha -= dt * 3;
      point.size *= 0.98;
      
      if (point.alpha <= 0) {
        trailPool.release(point);
        trail.points.splice(i, 1);
      }
    }
    
    if (trail.points.length === 0) {
      trails.delete(id);
    }
  }
}

export function renderTrails(ctx) {
  for (const [id, trail] of trails) {
    if (trail.points.length < 2) continue;
    
    for (let i = 1; i < trail.points.length; i++) {
      const prev = trail.points[i - 1];
      const curr = trail.points[i];
      
      ctx.strokeStyle = trail.color;
      ctx.globalAlpha = curr.alpha * 0.5;
      ctx.lineWidth = curr.size;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

export function clearTrail(entityId) {
  const trail = trails.get(entityId);
  if (trail) {
    for (const point of trail.points) {
      trailPool.release(point);
    }
    trails.delete(entityId);
  }
}

// ---------- Damage Numbers ----------
const damageNumbers = [];

export function spawnDamageNumber(x, y, value, color = '#ff4444') {
  damageNumbers.push({
    x, y,
    value: Math.round(value),
    life: 0,
    vy: -100,
    color
  });
}

export function updateDamageNumbers(dt) {
  for (let i = damageNumbers.length - 1; i >= 0; i--) {
    const d = damageNumbers[i];
    d.life += dt;
    d.y += d.vy * dt;
    d.vy *= 0.95;
    
    if (d.life >= 1) {
      damageNumbers.splice(i, 1);
    }
  }
}

export function renderDamageNumbers(ctx) {
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  
  for (const d of damageNumbers) {
    const alpha = 1 - d.life;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = d.color;
    ctx.fillText(d.value, d.x, d.y);
  }
  ctx.globalAlpha = 1;
}

// ---------- Animations ----------
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function pulse(time, frequency = 1) {
  return 0.5 + 0.5 * Math.sin(time * frequency * Math.PI * 2);
}

// ---------- Flash Effects ----------
let flashAlpha = 0;
let flashColor = '#ffffff';

export function triggerFlash(color, duration = 0.1) {
  flashColor = color;
  flashAlpha = 1;
}

export function updateFlash(dt) {
  if (flashAlpha > 0) {
    flashAlpha -= dt * 10;
    if (flashAlpha < 0) flashAlpha = 0;
  }
}

export function renderFlash(ctx, width, height) {
  if (flashAlpha > 0) {
    ctx.fillStyle = flashColor;
    ctx.globalAlpha = flashAlpha * 0.3;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }
}
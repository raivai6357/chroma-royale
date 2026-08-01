// Object pooling system - reuse objects to minimize garbage collection
export class ObjectPool {
  constructor(factory, reset, initialSize = 32) {
    this.factory = factory;
    this.reset = reset;
    this.pool = [];
    this.active = [];
    
    // Pre-allocate
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
    }
  }
  
  acquire() {
    const obj = this.pool.length > 0 ? this.pool.pop() : this.factory();
    this.active.push(obj);
    return obj;
  }
  
  release(obj) {
    const idx = this.active.indexOf(obj);
    if (idx !== -1) {
      this.active.splice(idx, 1);
      this.reset(obj);
      this.pool.push(obj);
    }
  }
  
  releaseAll() {
    while (this.active.length > 0) {
      this.release(this.active[0]);
    }
  }
  
  getActiveCount() {
    return this.active.length;
  }
  
  getPoolSize() {
    return this.pool.length;
  }
}

// Particle pool
export const particlePool = new ObjectPool(
  () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 4, color: '#fff', alpha: 1 }),
  (p) => { p.x = 0; p.y = 0; p.vx = 0; p.vy = 0; p.life = 0; p.maxLife = 1; p.size = 4; p.alpha = 1; },
  200
);

// Trail point pool
export const trailPool = new ObjectPool(
  () => ({ x: 0, y: 0, alpha: 1, size: 8 }),
  (t) => { t.x = 0; t.y = 0; t.alpha = 1; t.size = 8; },
  500
);

// Damage number pool
export const damageNumberPool = new ObjectPool(
  () => ({ x: 0, y: 0, value: 0, life: 0, vy: 0 }),
  (d) => { d.x = 0; d.y = 0; d.value = 0; d.life = 0; d.vy = 0; },
  50
);

// Vector2 pool for calculations
export const vecPool = new ObjectPool(
  () => ({ x: 0, y: 0 }),
  (v) => { v.x = 0; v.y = 0; },
  100
);
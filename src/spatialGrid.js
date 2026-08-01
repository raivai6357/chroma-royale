// Spatial hash grid for efficient collision detection
// Divides world into cells and only checks entities in nearby cells

export class SpatialGrid {
  constructor(cellSize = 256) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this._tempCells = [];
  }
  
  clear() {
    this.cells.clear();
  }
  
  _hash(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }
  
  insert(entity) {
    if (!entity || !entity.alive) return;
    
    const key = this._hash(entity.x, entity.y);
    
    if (!this.cells.has(key)) {
      this.cells.set(key, []);
    }
    
    this.cells.get(key).push(entity);
  }
  
  // Query nearby entities (9-cell neighborhood)
  query(x, y, radius) {
    const results = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        const cell = this.cells.get(key);
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            results.push(cell[i]);
          }
        }
      }
    }
    
    return results;
  }
  
  // Optimized query for collision radius
  queryCircle(x, y, radius) {
    const results = [];
    const r2 = radius * radius;
    const neighbors = this.query(x, y, radius);
    
    for (let i = 0; i < neighbors.length; i++) {
      const entity = neighbors[i];
      const dx = entity.x - x;
      const dy = entity.y - y;
      const dist2 = dx * dx + dy * dy;
      
      if (dist2 <= r2) {
        results.push(entity);
      }
    }
    
    return results;
  }
  
  // Update entity position in grid
  update(entity) {
    // Remove from old cells
    this.remove(entity);
    // Re-insert at new position
    this.insert(entity);
  }
  
  remove(entity) {
    for (const [key, cell] of this.cells) {
      const idx = cell.indexOf(entity);
      if (idx !== -1) {
        cell.splice(idx, 1);
        if (cell.length === 0) {
          this.cells.delete(key);
        }
        break;
      }
    }
  }
  
  getStats() {
    let totalEntities = 0;
    for (const cell of this.cells.values()) {
      totalEntities += cell.length;
    }
    return {
      cells: this.cells.size,
      entities: totalEntities,
      avgPerCell: this.cells.size > 0 ? totalEntities / this.cells.size : 0
    };
  }
}

// Global spatial grid instance
export const spatialGrid = new SpatialGrid(256);
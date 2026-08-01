// ---------- Event System ----------
// All game actions emit events through this central bus.
// Events flow to: Combat, Particles, Sound, UI, and Network handlers.
// This decouples systems and makes multiplayer sync straightforward.

export const EventType = {
  // Movement / Input
  MOVE:           'move',
  BOOST_START:    'boost_start',
  BOOST_END:      'boost_end',
  
  // Dash state machine transitions
  DASH_REQUEST:   'dash_request',    // player/bot requests a dash
  DASH_WINDUP:    'dash_windup',     // entering windup state
  DASH_START:     'dash_start',      // entering active dash
  DASH_END:       'dash_end',        // dash completed (hit recovery)
  DASH_CANCEL:    'dash_cancel',     // dash interrupted (e.g. by hit)
  
  // Combat
  DAMAGE:         'damage',          // entity took damage
  KILL:           'kill',            // entity eliminated
  HIT:            'hit',             // combat collision occurred
  IFRAME_START:   'iframe_start',    // entity gained invincibility frames
  IFRAME_END:     'iframe_end',      // iframes expired
  
  // Pickups
  PICKUP_COLLECT: 'pickup_collect',  // box collected by entity
  PICKUP_SPAWN:   'pickup_spawn',    // new box spawned
  
  // Zone
  ZONE_SHRINK:    'zone_shrink',     // safe zone radius changed
  ZONE_DAMAGE:    'zone_damage',     // entity took zone damage
  
  // Game flow
  GAME_START:     'game_start',
  GAME_END:       'game_end',
  ROUND_RESET:    'round_reset'
};

// Simple pub/sub event bus.
// Systems subscribe to events they care about; actions emit events.
export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  // Register a handler for an event type. Returns an unsubscribe function.
  on(eventType, handler) {
    if (!this._listeners.has(eventType)) {
      this._listeners.set(eventType, []);
    }
    this._listeners.get(eventType).push(handler);
    return () => this.off(eventType, handler);
  }

  // Remove a specific handler
  off(eventType, handler) {
    const list = this._listeners.get(eventType);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }

  // Emit an event with payload data.
  // The payload should include entityId for network sync.
  emit(eventType, data = {}) {
    const list = this._listeners.get(eventType);
    if (!list) return;
    // Copy array to allow handlers to remove themselves during iteration
    for (const handler of [...list]) {
      handler(data);
    }
  }

  // Clear all listeners (useful for round reset)
  clear() {
    this._listeners.clear();
  }
}

// ---------- Command Classes ----------
// Commands represent player intents. They are serializable for network transmission.
// Each command has a type and the data needed to execute it.

export const CommandType = {
  MOVE:         'move',
  DASH:         'dash',
  BOOST:        'boost',
  CHANGE_COLOR: 'change_color'  // for future color-shift mechanics
};

// Base command structure
export class Command {
  constructor(type, entityId, tick) {
    this.type = type;
    this.entityId = entityId;
    this.tick = tick;  // simulation tick when command was issued
  }
  
  // Serialize for network transmission
  serialize() {
    return {
      type: this.type,
      entityId: this.entityId,
      tick: this.tick
    };
  }
}

// Move command: direction vector
export class MoveCommand extends Command {
  constructor(entityId, tick, dirX, dirY) {
    super(CommandType.MOVE, entityId, tick);
    this.dirX = dirX;
    this.dirY = dirY;
  }
  
  serialize() {
    return { ...super.serialize(), dirX: this.dirX, dirY: this.dirY };
  }
  
  static deserialize(data) {
    return new MoveCommand(data.entityId, data.tick, data.dirX, data.dirY);
  }
}

// Dash command: direction to dash
export class DashCommand extends Command {
  constructor(entityId, tick, dirX, dirY) {
    super(CommandType.DASH, entityId, tick);
    this.dirX = dirX;
    this.dirY = dirY;
  }
  
  serialize() {
    return { ...super.serialize(), dirX: this.dirX, dirY: this.dirY };
  }
  
  static deserialize(data) {
    return new DashCommand(data.entityId, data.tick, data.dirX, data.dirY);
  }
}

// Boost command: start or stop boosting
export class BoostCommand extends Command {
  constructor(entityId, tick, active) {
    super(CommandType.BOOST, entityId, tick);
    this.active = active;  // true = start boosting, false = stop
  }
  
  serialize() {
    return { ...super.serialize(), active: this.active };
  }
  
  static deserialize(data) {
    return new BoostCommand(data.entityId, data.tick, data.active);
  }
}

// Change color command (for future use with color-shift pickups)
export class ChangeColorCommand extends Command {
  constructor(entityId, tick, color) {
    super(CommandType.CHANGE_COLOR, entityId, tick);
    this.color = color;
  }
  
  serialize() {
    return { ...super.serialize(), color: this.color };
  }
  
  static deserialize(data) {
    return new ChangeColorCommand(data.entityId, data.tick, data.color);
  }
}

// ---------- Command Queue ----------
// Buffers commands for the current tick, then flushes them to the game.
// This ensures commands are processed at the right simulation tick.
export class CommandQueue {
  constructor() {
    this._queue = [];
  }
  
  // Add a command to the queue
  push(cmd) {
    this._queue.push(cmd);
  }
  
  // Get and clear all pending commands
  flush() {
    const cmds = this._queue;
    this._queue = [];
    return cmds;
  }
  
  // Peek at pending commands without clearing
  peek() {
    return [...this._queue];
  }
  
  // Clear without returning
  clear() {
    this._queue = [];
  }
}
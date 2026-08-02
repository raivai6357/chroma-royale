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
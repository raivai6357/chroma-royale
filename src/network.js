// Client-side networking for multiplayer
// Handles WebSocket connection, client prediction, snapshot interpolation, and reconciliation
// Phase 6: Matchmaking, Lobby, Cosmetics, Statistics integration

// The production game server. Portals like CrazyGames host ONLY the client files,
// from their own static CDN domain — so inheriting location.host (what this used to
// do) dials the CDN, which has no WebSocket server behind it and fails for every
// player. Point this at wherever the server is actually deployed.
//
// It must be wss://, not ws://: the embedded page is served over https and browsers
// block plaintext sockets from a secure page as mixed content.
//
// Points at the Render service. If you rename the service or move hosts, update
// this — online play fails for every player until it matches the real server.
const PRODUCTION_SERVER_URL = 'wss://chroma-royale.onrender.com';

// Hosts that really do serve the game and the socket off the same origin — the dev
// server in server/index.js does exactly that. Anything not in this list is assumed
// to be a static host, so we use PRODUCTION_SERVER_URL instead of guessing.
function isSameOriginServerHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
    // LAN testing from a phone against a laptop.
    || /^192\.168\.\d+\.\d+$/.test(hostname)
    || /^10\.\d+\.\d+\.\d+$/.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname);
}

// Where the game server lives. Resolved at connect() time, not module load, so one
// build works everywhere. An explicit ?server=host:port still overrides everything,
// which is what you want when testing against a server on another machine.
function resolveServerUrl() {
  if (typeof location === 'undefined') return PRODUCTION_SERVER_URL;

  let override = null;
  try {
    override = new URLSearchParams(location.search).get('server');
  } catch (e) { /* exotic location, fall through */ }
  if (override) {
    return /^wss?:\/\//.test(override) ? override : 'ws://' + override;
  }

  // file:// or a page with no host has nothing useful to inherit.
  if (!location.host) return 'ws://localhost:3000';

  if (isSameOriginServerHost(location.hostname)) {
    // The dev server serves the page and the socket together, so same host+port.
    // A separate static dev server (vite/live-server) means the game server is
    // still on :3000 alongside it.
    const devPorts = ['5173', '5500', '8080', '8000', '4200', '3001'];
    if (devPorts.includes(location.port)) return 'ws://' + location.hostname + ':3000';
    const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
    return scheme + location.host;
  }

  // Hosted somewhere we don't control (CrazyGames CDN, itch, a plain static host).
  return PRODUCTION_SERVER_URL;
}

// localStorage is not reliably reachable inside a third-party iframe. When storage
// is partitioned or blocked (Safari, Firefox strict mode, Chrome incognito) the
// object still EXISTS but touching it throws SecurityError — so a `typeof` check
// isn't enough, and an unguarded read in the constructor would stop the game from
// booting at all. Degrade to no persistence instead of dying.
// Exported for profile.js, which persists progression through the same guards.
// Deliberately not duplicated there: two copies of this invites one of them
// being fixed and the other quietly not.
export function storageGet(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

export function storageSet(key, value) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

export function storageRemove(key) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}

const INTERPOLATION_DELAY = 100;
// The server already samples its snapshots INTERPOLATION_DELAY in the past, so
// applying the full delay again here stacked into ~200ms of visual lag on every
// remote player. All the client actually needs is enough of a buffer to have two
// snapshots to interpolate between — one send interval (20Hz = 50ms), plus a
// little slack for jitter.
const SNAPSHOT_INTERVAL = 1000 / 20;
const CLIENT_INTERP_DELAY = SNAPSHOT_INTERVAL * 1.5;
const RECONCILIATION_THRESHOLD = 5;
// Past this, easing looks like the blob is being dragged; snap instead.
const RECONCILIATION_HARD_SNAP = 120;
const RECONCILIATION_SPEED = 0.2;
const PING_INTERVAL = 5000;

// Reconnect policy. A dropped socket used to end the session permanently: the
// player was left staring at a frozen arena with no way back short of a reload.
// Retry on an exponential backoff instead, capped so a server that is genuinely
// down doesn't get hammered.
const RECONNECT_BASE_DELAY = 500;
const RECONNECT_MAX_DELAY = 8000;
const RECONNECT_MAX_ATTEMPTS = 8;

export class NetworkClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.playerId = null;
    this.roomId = null;
    this.isHost = false;
    // Handed out by the server on connect and replayed on reconnect so we get our
    // own seat back instead of arriving as a brand-new player.
    this.resumeToken = null;
    this.serverTick = 0;
    this.clientTick = 0;
    this.latency = 0;
    
    // Input buffer for client prediction
    this.pendingInputs = [];
    this.maxPendingInputs = 10;
    
    // Snapshot history for interpolation
    this.snapshotBuffer = [];
    this.maxSnapshotBuffer = 20;
    
    // Remote player states
    this.remoteEntities = new Map();

    // Matchmaking state
    this.inQueue = false;
    this.queuePosition = 0;
    this.queueSize = 0;

    // Lobby state
    this.players = [];
    this.countdownSeconds = 0;
    this.isCountingDown = false;

    // Room browser state
    this.roomsList = [];

    // Profile
    // Only the display name lives here. Coins, xp, stats and cosmetics moved to
    // profile.js/localStorage — the server minted a fresh playerId per socket, so
    // everything it stored under one was orphaned the moment the tab closed.
    // The nickname is different: the server genuinely needs it, for the lobby
    // player list and the kill feed.
    this.playerName = storageGet('cr_nickname') || 'Player';

    // Latency tracking
    this._pingSentAt = 0;
    this._pingInterval = null;
    
    // Reconciliation state
    this.lastServerPosition = null;

    // Reconnect state
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._intentionalClose = false;
    this.reconnecting = false;
    
    // Event callbacks - core
    this.onConnect = null;
    this.onDisconnect = null;
    this.onRoomJoined = null;
    this.onPlayerJoined = null;
    this.onPlayerLeft = null;
    this.onGameStart = null;
    this.onGameEnd = null;
    this.onSnapshot = null;
    this.onError = null;
    // Seat resumption: the server holds a dropped player's blob for a grace
    // period, so a reconnect can land back in the round instead of the menu.
    this.onResumed = null;
    this.onResumeFailed = null;
    this.onPlayerAway = null;
    
    // Event callbacks - Phase 6
    this.onMatchFound = null;
    this.onPlayerReady = null;
    this.onCountdownStart = null;
    this.onCountdownTick = null;
    this.onReturnToLobby = null;
    this.onQueueUpdate = null;
    this.onPingUpdate = null;
    this.onRoomsList = null;
    this.onNameSet = null;
    this.onReconnecting = null;
    this.onReconnected = null;
    this.onReconnectFailed = null;
    this.onCountdownCancelled = null;
  }
  
  // ---------- Connection ----------
  
  connect() {
    // Already connected or mid-handshake: hand back the in-flight attempt rather
    // than opening a second socket the callbacks would fight over.
    if (this.connected) return Promise.resolve();
    if (this._connecting) return this._connecting;

    // A fresh connect() is always deliberate, so re-arm auto-reconnect and drop
    // any retry still pending from the previous socket.
    this._intentionalClose = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._connecting = new Promise((resolve, reject) => {
      try {
        this.serverUrl = resolveServerUrl();
        console.log('Connecting to', this.serverUrl);
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          console.log('Connected to server');
          this.connected = true;
          const wasReconnecting = this.reconnecting;
          this.reconnecting = false;
          this._reconnectAttempts = 0;
          this._startPing();

          // The server hands us a fresh identity unprompted, so we only speak first
          // when we want the *old* one back — i.e. after a drop we didn't ask for.
          // On a first connect there is no seat to reclaim and asking would just
          // earn a resume_failed.
          if (wasReconnecting && this.resumeToken) {
            this._send({ type: 'resume', resumeToken: this.resumeToken });
          }

          // Sync saved nickname to the server on connect
          const saved = storageGet('cr_nickname');
          if (saved) this._send({ type: 'set_name', name: saved });
          if (this.onConnect) this.onConnect();
          if (wasReconnecting && this.onReconnected) this.onReconnected();
          this._connecting = null;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            this._handleMessage(JSON.parse(event.data));
          } catch (err) {
            // A single malformed frame must not tear down the socket.
            console.error('Bad message from server:', err);
          }
        };

        this.ws.onclose = () => {
          console.log('Disconnected from server');
          this._stopPing();
          this.connected = false;
          this.inQueue = false;
          // The server drops us from the room the moment the socket closes, so
          // holding roomId would leave isInRoom() true forever — which is what
          // main.js routes the "play again" button on, stranding the player in
          // the online menu with no live room behind it.
          this.roomId = null;
          this.isHost = false;
          this.players = [];
          this.snapshotBuffer = [];
          this.pendingInputs = [];
          this.remoteEntities.clear();
          // Drop the cached attempt so a later connect() opens a fresh socket
          // instead of handing back this settled promise forever.
          this._connecting = null;
          if (this.onDisconnect) this.onDisconnect();
          if (!this._intentionalClose) this._scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this._connecting = null;
          if (this.onError) this.onError(error);
          reject(error);
        };
      } catch (error) {
        this._connecting = null;
        reject(error);
      }
    });

    // A failed attempt rejects; swallow it here so an un-awaited connect() does
    // not surface as an unhandled rejection. Callers still see their own copy.
    this._connecting.catch(() => {});
    return this._connecting;
  }

  // Queue another connect() on an exponential backoff. Only ever called from
  // onclose for a drop the player didn't ask for.
  _scheduleReconnect() {
    if (this._reconnectTimer) return;

    if (this._reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this.reconnecting = false;
      console.warn('Giving up reconnecting after', this._reconnectAttempts, 'attempts');
      if (this.onReconnectFailed) this.onReconnectFailed();
      return;
    }

    const attempt = this._reconnectAttempts++;
    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, attempt), RECONNECT_MAX_DELAY);
    this.reconnecting = true;
    if (this.onReconnecting) {
      this.onReconnecting({ attempt: attempt + 1, max: RECONNECT_MAX_ATTEMPTS, delay });
    }

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this.connected || this._intentionalClose) return;
      // connect() rejects on failure; onclose fires and schedules the next try.
      this.connect().catch(() => {});
    }, delay);
  }

  // Stop retrying without closing anything — used when the player deliberately
  // backs out of online play.
  cancelReconnect() {
    this._intentionalClose = true;
    this.reconnecting = false;
    this._reconnectAttempts = 0;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  disconnect() {
    // Mark it deliberate first: closing the socket fires onclose synchronously
    // in some browsers, and that path would otherwise start reconnecting to a
    // server the player just walked away from.
    this.cancelReconnect();
    this._stopPing();
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* already closing */ }
      this.ws = null;
    }
    this.connected = false;
    this.playerId = null;
    this.roomId = null;
    this.inQueue = false;
    this._connecting = null;
  }

  _send(msg) {
    if (this.connected && this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify(msg));
        return true;
      } catch (err) {
        // readyState can go stale between the check and the send.
        console.warn('Send failed:', err.message);
      }
    }
    return false;
  }
  
  _startPing() {
    if (this._pingInterval) clearInterval(this._pingInterval);
    this._pingInterval = setInterval(() => {
      if (this.connected) this.ping();
    }, PING_INTERVAL);
  }
  
  _stopPing() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }
  
  // ---------- Message Handling ----------
  
  _handleMessage(data) {
    switch (data.type) {
      // Core connection
      case 'connected':
        this.playerId = data.playerId;
        this.serverTick = data.serverTick;
        if (data.resumeToken) this.resumeToken = data.resumeToken;
        // data.playerData is deliberately ignored. The server generates a new
        // playerId for every socket, so getOrCreatePlayer always takes the
        // create path and hands back a zeroed profile — reading coins from it
        // wiped the real balance the instant the online menu was opened.
        break;

      // Our seat was still warm: we're back in the same room with the same id.
      case 'resumed': {
        this.playerId = data.playerId;
        this.roomId = data.roomId;
        // The token that got us here is spent. The server mints a replacement so a
        // second drop can resume too; without this we'd hold the throwaway token
        // from the 'connected' frame, which the server already discarded.
        if (data.resumeToken) this.resumeToken = data.resumeToken;
        const st = data.roomState || {};
        this.players = st.players || [];
        this.isHost = st.hostId === data.playerId;
        this.serverTick = st.tick || 0;
        // Stale frames from before the drop would interpolate against the wrong
        // tick range; start the buffer clean.
        this.snapshotBuffer = [];
        if (this.onResumed) this.onResumed(data);
        break;
      }

      // The seat is gone for good (grace expired, room ended, token spent). Keep
      // the identity the server just handed us and let the UI send us back to the
      // menu — silently doing nothing would strand the player on a dead room.
      case 'resume_failed':
        this.roomId = null;
        this.isHost = false;
        this.players = [];
        this.snapshotBuffer = [];
        this.pendingInputs = [];
        if (this.onResumeFailed) this.onResumeFailed(data);
        break;

      // Somebody else dropped or came back. `away` distinguishes the two so one
      // callback can drive both sides of the toast.
      case 'player_disconnected':
        this.players = data.players || this.players;
        if (this.onPlayerAway) this.onPlayerAway({ ...data, away: true });
        break;

      case 'player_reconnected':
        this.players = data.players || this.players;
        if (this.onPlayerAway) this.onPlayerAway({ ...data, away: false });
        break;
        
      // Room management
      case 'room_created':
      case 'room_joined':
        this.roomId = data.roomId;
        this.isHost = data.type === 'room_created';
        this.players = data.players || [];
        if (this.onRoomJoined) this.onRoomJoined(data);
        break;
        
      case 'player_joined':
        this.players = data.players || this.players;
        if (this.onPlayerJoined) this.onPlayerJoined(data);
        break;
        
      case 'player_left':
        this.players = data.players || this.players;
        if (this.onPlayerLeft) this.onPlayerLeft(data);
        break;
        
      case 'host_changed':
        this.isHost = data.hostId === this.playerId;
        break;
        
      // Game lifecycle
      case 'game_start':
        this.serverTick = data.tick;
        this.clientTick = data.tick;
        this.snapshotBuffer = [];
        this.pendingInputs = [];
        this.isCountingDown = false;
        if (this.onGameStart) this.onGameStart(data);
        break;
        
      case 'snapshot':
        this._handleSnapshot(data);
        break;
        
      case 'game_end':
        // The round is over: stale prediction/interp state must not leak into
        // the next one. game_start clears these too, but a player who sits on
        // the end screen would otherwise keep reconciling against dead data.
        this.snapshotBuffer = [];
        this.pendingInputs = [];
        this.remoteEntities.clear();
        this.lastServerPosition = null;
        this.isCountingDown = false;
        if (this.onGameEnd) this.onGameEnd(data);
        break;
        
      // Lobby
      case 'player_ready':
        this._updatePlayerReady(data.playerId, data.ready);
        if (this.onPlayerReady) this.onPlayerReady(data);
        break;
        
      case 'countdown_start':
        this.isCountingDown = true;
        this.countdownSeconds = data.seconds;
        if (this.onCountdownStart) this.onCountdownStart(data);
        break;
        
      case 'countdown_tick':
        this.countdownSeconds = data.seconds;
        if (this.onCountdownTick) this.onCountdownTick(data);
        if (data.seconds <= 0) this.isCountingDown = false;
        break;
        
      case 'countdown_cancelled':
        // Server aborted the start (someone left). Drop the countdown UI so the
        // lobby is usable again instead of frozen on a number that never ticks.
        this.isCountingDown = false;
        this.countdownSeconds = 0;
        if (this.onCountdownCancelled) this.onCountdownCancelled(data);
        break;

      case 'return_to_lobby':
        this.players = data.players || [];
        this.isCountingDown = false;
        this.countdownSeconds = 0;
        if (this.onReturnToLobby) this.onReturnToLobby(data);
        break;
        
      // Matchmaking
      case 'match_found':
        this.inQueue = false;
        this.roomId = data.roomId;
        this.players = data.players || [];
        if (this.onMatchFound) this.onMatchFound(data);
        break;
        
      case 'queue_joined':
        this.inQueue = true;
        this.queuePosition = data.position;
        this.queueSize = data.queueSize;
        if (this.onQueueUpdate) this.onQueueUpdate(data);
        break;
        
      // The cosmetics_list / purchase_success / purchase_failed / equip_success /
      // stats_response / leaderboard_response cases were removed with server-side
      // progression. The server still handles the requests; nothing sends them.

      // Latency
      case 'pong':
        if (this._pingSentAt > 0) {
          this.latency = Date.now() - this._pingSentAt;
          this._pingSentAt = 0;
          if (this.onPingUpdate) this.onPingUpdate({ latency: this.latency });
        }
        break;

      // Room browser
      case 'rooms_list':
        this.roomsList = data.rooms || [];
        if (this.onRoomsList) this.onRoomsList(this.roomsList);
        break;

      // Profile
      case 'name_set':
        this.playerName = data.name;
        storageSet('cr_nickname', data.name);
        if (this.onNameSet) this.onNameSet(data.name);
        break;

      // Error
      case 'error':
        if (this.onError) this.onError(data);
        break;
    }
  }
  
  _updatePlayerReady(playerId, ready) {
    const player = this.players.find(p => p.id === playerId);
    if (player) player.ready = ready;
  }
  
  _handleSnapshot(data) {
    // Snapshots can arrive out of order over a lossy link; an older one would
    // otherwise rewind the buffer and make remotes stutter backwards.
    if (data.serverTick <= this.serverTick && this.snapshotBuffer.length) return;
    this.serverTick = data.serverTick;

    this.snapshotBuffer.push({
      tick: data.serverTick,
      time: performance.now(),
      entities: data.entities,
      boxes: data.boxes,
      zone: data.zone,
      events: data.events
    });

    while (this.snapshotBuffer.length > this.maxSnapshotBuffer) {
      this.snapshotBuffer.shift();
    }

    // Reconcile before handing the snapshot up: the game's onSnapshot reads
    // lastServerPosition, and doing it in the other order served it a
    // one-snapshot-stale correction every frame.
    this._reconcile(data);
    if (this.onSnapshot) this.onSnapshot(data);
  }
  
  // The server's field is serverTick — reading snapshot.tick here gave undefined,
  // and `input.tick > undefined` is always false, so this used to throw away the
  // whole pending-input buffer on every snapshot and prediction never replayed.
  _reconcile(snapshot) {
    const tick = snapshot.serverTick;
    const myEntity = snapshot.entities.find(e => e.playerId === this.playerId);
    if (!myEntity) return;

    this.lastServerPosition = {
      x: myEntity.x, y: myEntity.y,
      vx: myEntity.vx, vy: myEntity.vy,
      hp: myEntity.hp,
      alive: myEntity.alive,
      stagger: myEntity.stagger,
      dashState: myEntity.dashState,
      isDashing: myEntity.isDashing,
      // Color is server-owned: it changes when the server resolves a box pickup.
      // Without carrying it here the local blob keeps its spawn color forever
      // while everyone else sees the new one.
      color: myEntity.color,
      tick
    };

    this.pendingInputs = this.pendingInputs.filter(input => input.tick > tick);
  }
  
  // ---------- Input ----------
  
  sendInput(input) {
    if (!this.connected) return;
    
    const inputWithTick = { ...input, tick: this.clientTick };
    this.pendingInputs.push(inputWithTick);
    while (this.pendingInputs.length > this.maxPendingInputs) {
      this.pendingInputs.shift();
    }
    
    this._send({ type: 'input', ...inputWithTick });
  }
  
  getInterpolatedEntities() {
    if (!this.snapshotBuffer.length) return [];
    // One snapshot is still enough to show remotes at a known position; bailing
    // with [] made every other blob vanish for the first frames of a round.
    if (this.snapshotBuffer.length < 2) {
      return this.snapshotBuffer[0].entities.filter(e => e.playerId !== this.playerId);
    }

    const targetTime = performance.now() - CLIENT_INTERP_DELAY;
    let older = null, newer = null;

    for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
      if (this.snapshotBuffer[i].time <= targetTime && this.snapshotBuffer[i + 1].time >= targetTime) {
        older = this.snapshotBuffer[i];
        newer = this.snapshotBuffer[i + 1];
        break;
      }
    }

    if (!older || !newer) {
      // Outside the buffered window — snapshots are late or we're ahead of them.
      // Dead-reckon the newest known state forward by its own velocity instead of
      // freezing remotes in place until the next packet lands.
      const latest = this.snapshotBuffer[this.snapshotBuffer.length - 1];
      const ahead = Math.min(Math.max(targetTime - latest.time, 0), SNAPSHOT_INTERVAL * 2) / 1000;
      return latest.entities
        .filter(e => e.playerId !== this.playerId)
        .map(e => ahead > 0 ? { ...e, x: e.x + e.vx * ahead, y: e.y + e.vy * ahead } : e);
    }
    
    const duration = newer.time - older.time;
    const t = duration > 0 ? (targetTime - older.time) / duration : 0;
    
    const interpolated = [];
    for (const newerEntity of newer.entities) {
      if (newerEntity.playerId === this.playerId) continue;
      
      const olderEntity = older.entities.find(e => e.id === newerEntity.id);
      if (!olderEntity) {
        interpolated.push(newerEntity);
        continue;
      }
      
      interpolated.push({
        ...newerEntity,
        x: olderEntity.x + (newerEntity.x - olderEntity.x) * t,
        y: olderEntity.y + (newerEntity.y - olderEntity.y) * t,
        radius: olderEntity.radius + (newerEntity.radius - olderEntity.radius) * t
      });
    }
    
    return interpolated;
  }
  
  applyReconciliation(localPlayer) {
    if (!this.lastServerPosition || !localPlayer) return;

    const dx = this.lastServerPosition.x - localPlayer.x;
    const dy = this.lastServerPosition.y - localPlayer.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > RECONCILIATION_HARD_SNAP) {
      // Way out of sync — a long stall, a tab that was backgrounded, or a
      // resumed connection. Easing at 0.2/frame from here would visibly drag the
      // blob across the arena, so take the server's word for it outright.
      localPlayer.x = this.lastServerPosition.x;
      localPlayer.y = this.lastServerPosition.y;
      localPlayer.vx = this.lastServerPosition.vx;
      localPlayer.vy = this.lastServerPosition.vy;
    } else if (dist > RECONCILIATION_THRESHOLD) {
      localPlayer.x += dx * RECONCILIATION_SPEED;
      localPlayer.y += dy * RECONCILIATION_SPEED;
      localPlayer.vx += (this.lastServerPosition.vx - localPlayer.vx) * RECONCILIATION_SPEED;
      localPlayer.vy += (this.lastServerPosition.vy - localPlayer.vy) * RECONCILIATION_SPEED;
    }

    localPlayer.hp = this.lastServerPosition.hp;
    localPlayer.dashState = this.lastServerPosition.dashState;
    localPlayer.isDashing = this.lastServerPosition.isDashing;
    // The server decides what color you are — it owns box-pickup resolution, and
    // color drives the rock-paper-scissors matchup, damage and passives. Nothing
    // sets this locally, so without it the local blob renders its spawn color for
    // the whole match while every other client already sees the real one.
    if (this.lastServerPosition.color) {
      localPlayer.color = this.lastServerPosition.color;
    }
    // Stagger is server-owned (nothing sets it locally in online play), and the
    // prediction step reads it to scale acceleration.
    if (this.lastServerPosition.stagger !== undefined) {
      localPlayer.stagger = this.lastServerPosition.stagger;
    }
    // The server decides who's dead. Without this the local blob kept playing
    // after being eliminated, since nothing else ever clears alive locally.
    if (this.lastServerPosition.alive !== undefined) {
      localPlayer.alive = this.lastServerPosition.alive;
    }
  }
  
  // ---------- Room Methods ----------
  
  createRoom(settings = {}) {
    this._send({ type: 'create_room', settings });
  }

  joinRoom(roomId, password = null) {
    this._send({ type: 'join_room', roomId, password });
  }

  listRooms() {
    this._send({ type: 'list_rooms' });
  }

  setName(name) {
    const clean = (name || '').toString().slice(0, 20).trim() || 'Player';
    this.playerName = clean;
    storageSet('cr_nickname', clean);
    this._send({ type: 'set_name', name: clean });
  }

  leaveRoom() {
    // Tell the server if we can, but clear local room state either way — a
    // player leaving a room over a dead socket must not stay "in" it.
    this._send({ type: 'leave_room' });
    this.roomId = null;
    this.isHost = false;
    this.players = [];
    this.snapshotBuffer = [];
    this.pendingInputs = [];
    this.remoteEntities.clear();
  }

  startGame() {
    if (!this.isHost) return;
    this._send({ type: 'start_game' });
  }

  // ---------- Lobby Methods ----------

  setReady(ready) {
    this._send({ type: 'set_ready', ready });
  }

  ping() {
    this._pingSentAt = Date.now();
    this._send({ type: 'ping', time: this._pingSentAt });
  }

  // ---------- Matchmaking Methods ----------

  joinQueue() {
    if (this.inQueue) return;
    this._send({ type: 'join_queue' });
  }

  leaveQueue() {
    if (!this.inQueue) return;
    this._send({ type: 'leave_queue' });
    this.inQueue = false;
  }

  // getCosmetics / purchaseCosmetic / equipCosmetic / getStats / getLeaderboard
  // were removed with server-side progression; see profile.js. Two of them never
  // worked anyway: `_send({ type: 'purchase_cosmetic', type, id })` had a
  // duplicate key, so the shorthand `type` (the category) overwrote the message
  // type and the server saw an unknown message.

  // ---------- Utility ----------

  tick() { this.clientTick++; }

  getLatency() { return this.latency || INTERPOLATION_DELAY / 2; }

  isInRoom() { return this.roomId !== null; }

  isInQueue() { return this.inQueue; }

  isReady() {
    const me = this.players.find(p => p.id === this.playerId);
    return me ? me.ready : false;
  }
}

export const network = new NetworkClient();
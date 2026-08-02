// Room management - handles game rooms, player connections, and game state

const { ServerPhysics } = require('./physics.js');
const {
  MAX_PLAYERS,
  TICK_RATE,
  SNAPSHOT_RATE,
  INTERPOLATION_DELAY,
  GAME_DURATION,
  SUDDEN_DEATH_TIMEOUT
} = require('./constants.js');

// Get database reference (set by index.js)
let db = null;
function setDatabase(database) {
  db = database;
}

class Room {
  constructor(id, hostId, settings = {}) {
    this.id = id;
    this.hostId = hostId;
    this.settings = {
      maxPlayers: settings.maxPlayers || MAX_PLAYERS,
      gameDuration: settings.gameDuration || GAME_DURATION,
      ...settings
    };

    // Room visibility / access
    this.isPublic = settings.isPublic !== false; // public by default
    this.password = settings.password || null;    // plaintext, in-memory only
    this.name = (settings.name || `Room ${id}`).toString().slice(0, 24);

    this.players = new Map(); // playerId -> { ws, state, input }
    this.state = 'lobby'; // 'lobby' | 'countdown' | 'playing' | 'ended'
    this.physics = null;
    this.tick = 0;
    this.elapsed = 0;
    this.snapshotHistory = [];
    this.maxSnapshotHistory = 120; // Keep 2 seconds of history
    this._lastEventTick = 0; // high-water mark so events are sent exactly once
    this.countdownTimer = null;
    this.countdownInterval = null;
    this.endTimeout = null;

    console.log(`Room ${id} created by ${hostId}`);
  }
  
  addPlayer(playerId, ws, displayName = 'Player') {
    if (this.players.size >= this.settings.maxPlayers) {
      return false;
    }

    this.players.set(playerId, {
      ws,
      displayName,
      state: { ready: false, alive: true },
      input: { dirX: 0, dirY: 0, boosting: false, dash: false },
      lastInputTick: 0,
      pendingInputs: []
    });
    
    console.log(`Player ${playerId} joined room ${this.id}`);
    return true;
  }
  
  removePlayer(playerId) {
    this.players.delete(playerId);

    // Pull their blob out of the live sim too. Left in, it stands there as a
    // free target with no input, and getAlivePlayers() keeps counting it — so a
    // 1v1 where somebody rage-quits never reaches the "last one standing" end
    // condition and the survivor is stuck in a round that cannot finish.
    if (this.physics) this.physics.removePlayerEntity(playerId);

    if (this.players.size === 0) {
      this.clearCountdown();
      if (this.endTimeout) { clearTimeout(this.endTimeout); this.endTimeout = null; }
      return true; // Room should be deleted
    }

    // Transfer host if needed
    if (this.hostId === playerId) {
      this.hostId = this.players.keys().next().value;
      this.broadcast({ type: 'host_changed', hostId: this.hostId });
    }

    this.broadcast({
      type: 'player_left',
      playerId: playerId,
      players: this.getPlayerList()
    });

    // Dropping below two mid-countdown means the pending start can't succeed;
    // hand the room back to the lobby now rather than after a dead countdown.
    if (this.state === 'countdown' && this.players.size < 2) {
      this.broadcast({ type: 'countdown_cancelled', reason: 'Not enough players' });
      this.cancelCountdown();
    }

    return false;
  }
  
  isHost(playerId) {
    return this.hostId === playerId;
  }
  
  getPlayerList() {
    const list = [];
    for (const [id, player] of this.players) {
      list.push({
        id,
        name: player.displayName || id,
        isHost: id === this.hostId,
        ready: player.state.ready,
        alive: player.state.alive,
        disconnected: !!player.state.disconnected
      });
    }
    return list;
  }
  
  // A socket can close between the readyState check and the send, and ws throws
  // on a send to a closing socket. Unguarded, that exception unwinds out of the
  // 60Hz tick loop and takes down the round for everyone else in the room.
  broadcast(message, excludeId = null) {
    const data = JSON.stringify(message);
    for (const [id, player] of this.players) {
      if (id === excludeId) continue;
      if (!player.ws || player.ws.readyState !== 1) continue;
      try {
        player.ws.send(data);
      } catch (err) {
        console.warn(`Room ${this.id}: send to ${id} failed: ${err.message}`);
      }
    }
  }

  sendTo(playerId, message) {
    const player = this.players.get(playerId);
    if (!player || !player.ws || player.ws.readyState !== 1) return;
    try {
      player.ws.send(JSON.stringify(message));
    } catch (err) {
      console.warn(`Room ${this.id}: send to ${playerId} failed: ${err.message}`);
    }
  }
  
  processInput(playerId, input) {
    const player = this.players.get(playerId);
    if (!player) return;
    
    // Latest input wins; the sim reads this on its next tick rather than
    // queueing, so a flood of packets can't buy a player extra actions.
    player.input = {
      dirX: input.dirX || 0,
      dirY: input.dirY || 0,
      boosting: input.boosting || false,
      dash: input.dash || false
    };
    player.lastInputTick = input.tick || this.tick;
    
    // Queue input for processing
    player.pendingInputs.push({
      tick: input.tick || this.tick,
      ...player.input
    });
    
    // Limit pending input queue
    if (player.pendingInputs.length > 10) {
      player.pendingInputs.shift();
    }
  }
  
  startGame() {
    // 'countdown' has to be allowed here: startCountdown() flips the state before
    // its interval fires, so a lobby-only guard made ready-up silently do nothing.
    if (this.state !== 'lobby' && this.state !== 'countdown') return;
    if (this.players.size < 2) {
      // Fall back to the lobby instead of leaving the room wedged. Reached when
      // somebody leaves mid-countdown; without the reset, state stays 'countdown'
      // forever and startCountdown()'s lobby guard means the room can never
      // start another match.
      this.broadcast({ type: 'error', message: 'Need at least 2 players' });
      this.cancelCountdown();
      return;
    }
    
    console.log(`Room ${this.id} starting game`);
    
    this.physics = new ServerPhysics(this);
    this.state = 'playing';
    this.tick = 0;
    this.elapsed = 0;
    this.snapshotHistory = [];
    this._lastEventTick = 0;

    this.broadcast({
      type: 'game_start',
      tick: 0,
      players: this.getPlayerList(),
      spawnPositions: this.physics.getSpawnPositions()
    });
  }
  
  update(dt) {
    if (this.state !== 'playing') return;
    // physics is the round; if it's gone the round is over. Guards against a
    // tick landing between endGame() and the state flip.
    if (!this.physics) { this.state = 'lobby'; return; }

    this.tick++;
    this.elapsed += dt;
    
    this.physics.update(dt);

    // Snapshot every tick — clients reconcile against a specific past tick, so
    // the history has to be dense even though we only transmit at SNAPSHOT_RATE.
    const snapshot = this.physics.createSnapshot(this.tick);
    this.snapshotHistory.push(snapshot);

    if (this.snapshotHistory.length > this.maxSnapshotHistory) {
      this.snapshotHistory.shift();
    }

    if (this.tick % (TICK_RATE / SNAPSHOT_RATE) === 0) {
      this.sendSnapshots();
    }
    
    // Check game end conditions.
    //
    // The clock does NOT end the round: if time expires with 2+ blobs alive the
    // match continues into sudden death, where _updateZone keeps closing the
    // circle past SAFE_R1 until only one can survive. A winner is always someone
    // who actually outlasted the others.
    //
    // The absolute cap below is a safety net, not game design. Once the zone
    // reaches 0 everyone still standing is taking escalating void damage, so a
    // real round resolves within seconds of the clock expiring; this only fires
    // if something is genuinely wedged, so a room can never spin forever.
    const alivePlayers = this.physics.getAlivePlayers();
    const overtime = this.elapsed - this.settings.gameDuration;
    if (alivePlayers.length <= 1 || overtime >= SUDDEN_DEATH_TIMEOUT) {
      this.endGame(alivePlayers);
    }
  }
  
  sendSnapshots() {
    // Position/zone state is sampled from one historical tick (the interpolation
    // delay), but events are one-shot: physics clears them every tick, so any
    // event on a tick we don't sample would be lost forever. Since we only send
    // every 3rd tick, that silently dropped ~2/3 of all hits, kills and pickups.
    // Drain the whole span since the last send instead.
    const delayedTick = this.tick - Math.floor(INTERPOLATION_DELAY / (1000 / TICK_RATE));
    const snapshot = this.snapshotHistory.find(s => s.tick === delayedTick) ||
                     this.snapshotHistory[this.snapshotHistory.length - 1];
    if (!snapshot) return;

    const events = [];
    for (const s of this.snapshotHistory) {
      if (s.tick > this._lastEventTick && s.tick <= snapshot.tick && s.events.length) {
        events.push(...s.events);
      }
    }
    this._lastEventTick = snapshot.tick;

    for (const [playerId, player] of this.players) {
      this.sendTo(playerId, {
        type: 'snapshot',
        tick: this.tick,
        serverTick: snapshot.tick,
        entities: snapshot.entities,
        boxes: snapshot.boxes,
        zone: snapshot.zone,
        events
      });
    }
  }
  
  startCountdown() {
    if (this.state !== 'lobby' || this.countdownInterval) return;

    this.state = 'countdown';
    this.countdownTimer = 5; // 5 second countdown

    this.broadcast({
      type: 'countdown_start',
      seconds: this.countdownTimer
    });

    // Kept on the room, not in a local, so cancelCountdown() and destroy() can
    // actually stop it. As a local it outlived every failure path and kept
    // firing at an empty room.
    this.countdownInterval = setInterval(() => {
      // A player can leave at any point during these 5 seconds. Bail early
      // rather than counting all the way down to a startGame() that can't run.
      if (this.players.size < 2) {
        this.broadcast({ type: 'countdown_cancelled', reason: 'Not enough players' });
        this.cancelCountdown();
        return;
      }

      this.countdownTimer--;
      this.broadcast({
        type: 'countdown_tick',
        seconds: this.countdownTimer
      });

      if (this.countdownTimer <= 0) {
        this.clearCountdown();
        this.startGame();
      }
    }, 1000);
  }

  // Stop the ticking without touching room state.
  clearCountdown() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.countdownTimer = null;
  }

  // Stop the ticking AND hand the room back to the lobby so it can be readied
  // up again. Everyone's ready flag is dropped, otherwise the players who were
  // still ready would re-trigger a countdown the moment anyone new joins.
  cancelCountdown() {
    this.clearCountdown();
    if (this.state === 'countdown') this.state = 'lobby';
    for (const [, player] of this.players) player.state.ready = false;
    this.broadcast({ type: 'return_to_lobby', players: this.getPlayerList() });
  }
  
  endGame(survivors) {
    // Guard re-entry: update() calls this whenever alive <= 1, and the physics
    // teardown below happens on a 5s delay, so without the guard a second call
    // could land while physics is already gone.
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.clearCountdown();

    const winner = survivors.length === 1 ? survivors[0] : null;
    const winnerId = winner ? winner.id : null;
    const winnerPlayerId = winner ? winner.playerId : null;

    // physics is nulled when the room returns to the lobby; never assume it.
    const gameStats = this.physics ? this.physics.getGameStats() : {};

    // Record results for each player
    if (db && this.physics) {
      for (const [playerId, player] of this.players) {
        const entity = this.physics._getEntityByPlayerId(playerId);
        if (!entity) continue;
        
        const playerStats = gameStats[playerId] || {};
        const result = {
          won: playerId === winnerPlayerId,
          kills: playerStats.kills || 0,
          deaths: entity.alive ? 0 : 1,
          damageDealt: playerStats.damageDealt || 0,
          damageTaken: playerStats.damageTaken || 0,
          playTime: this.elapsed
        };
        
        db.recordGameResult(playerId, result);
      }
    }
    
    this.broadcast({
      type: 'game_end',
      winner: winnerId,
      winnerPlayerId: winnerPlayerId,
      survivors: survivors.map(s => s.id),
      stats: gameStats
    });
    
    console.log(`Room ${this.id} game ended. Winner: ${winnerId || 'none'}`);
    
    // Reset to lobby after delay. Tracked on the room so a room destroyed
    // inside this window doesn't keep a timer alive that broadcasts to nobody.
    this.endTimeout = setTimeout(() => {
      this.endTimeout = null;
      if (this.state === 'ended') {
        this.state = 'lobby';
        this.physics = null;
        this.snapshotHistory = [];
        this._lastEventTick = 0;
        this.tick = 0;
        this.elapsed = 0;
        for (const [id, player] of this.players) {
          player.state.ready = false;
        }
        this.broadcast({
          type: 'return_to_lobby',
          players: this.getPlayerList()
        });
      }
    }, 5000);
  }
  
  getSnapshotForReconciliation(playerId, clientTick) {
    // Exact tick if we still have it; otherwise the client is further behind
    // than our history goes, so reconcile against the newest state instead.
    return this.snapshotHistory.find(s => s.tick === clientTick) ||
           this.snapshotHistory[this.snapshotHistory.length - 1];
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.playerRooms = new Map(); // playerId -> roomId
    this.nextRoomId = 1;
    this.nextPlayerId = 1;
    this.nextResumeToken = 1;
    this.resumeTokens = new Map(); // resumeToken -> playerId
    this.disconnectTimers = new Map(); // playerId -> timeout handle
  }

  generatePlayerId() {
    return `player_${this.nextPlayerId++}`;
  }

  generateResumeToken() {
    return `token_${this.nextResumeToken++}_${Date.now()}`;
  }

  registerResumeToken(token, playerId) {
    this.resumeTokens.set(token, playerId);
  }

  // Reconnect a client to an existing player slot. The client already has a new
  // socket but wants to resume as the playerId tied to the token it saved before
  // the drop. If the player is still in a room, rebind the socket and cancel the
  // grace timer; otherwise the resume fails and the caller treats it as a fresh connect.
  resumePlayer(resumeToken, ws) {
    const playerId = this.resumeTokens.get(resumeToken);
    // Distinct reasons so the client can tell "your seat expired" (rejoin the
    // lobby) from "this token was never valid" (a bug worth surfacing).
    if (!playerId) return { success: false, reason: 'unknown_token' };

    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return { success: false, reason: 'no_room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, reason: 'room_gone' };

    const player = room.players.get(playerId);
    if (!player) return { success: false, reason: 'seat_released' };

    // A live socket on the seat means someone is already playing as this player.
    // Handing the seat to a second socket would let one token drive two clients.
    if (player.ws && player.ws.readyState === 1 && player.ws !== ws) {
      return { success: false, reason: 'seat_occupied' };
    }

    // Cancel the grace timer if one is running
    if (this.disconnectTimers.has(playerId)) {
      clearTimeout(this.disconnectTimers.get(playerId));
      this.disconnectTimers.delete(playerId);
      console.log(`Player ${playerId} reconnected, grace timer cancelled`);
    }

    // Rebind the socket and clear the away flag
    player.ws = ws;
    player.state.disconnected = false;

    room.broadcast({
      type: 'player_reconnected',
      playerId,
      players: room.getPlayerList()
    }, playerId);

    // Send the client everything it needs to rebuild its view
    const roomState = {
      roomId,
      state: room.state,
      tick: room.tick,
      elapsed: room.elapsed,
      players: room.getPlayerList(),
      hostId: room.hostId,
      settings: room.settings
    };

    // If the round is live, also send spawn positions so the client can rebuild
    // its local shadow and start consuming snapshots.
    if (room.state === 'playing' && room.physics) {
      roomState.spawnPositions = room.physics.getSpawnPositions();
    }

    return { success: true, playerId, roomId, roomState };
  }

  // Socket closed. If the player is in an active round, give them a grace period
  // to reconnect before removing them; otherwise remove immediately.
  handleDisconnect(playerId) {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    // Grace period only applies during active gameplay
    if (room.state === 'playing' || room.state === 'countdown') {
      const GRACE_PERIOD_MS = 15000; // 15s to reconnect
      console.log(`Player ${playerId} disconnected during ${room.state}, grace period ${GRACE_PERIOD_MS}ms`);

      const player = room.players.get(playerId);
      if (player) {
        // Drop the socket so broadcast() skips them, and zero the input. Left as
        // it was, the last input repeats every tick for the whole grace period —
        // a player who dropped mid-boost would burn their HP to zero while gone.
        player.ws = null;
        player.input = { dirX: 0, dirY: 0, boosting: false, dash: false };
        player.pendingInputs = [];
        player.state.disconnected = true;
      }

      // Let the rest of the room know, so the UI can say "reconnecting" instead
      // of leaving a blob standing there for no visible reason.
      room.broadcast({
        type: 'player_disconnected',
        playerId,
        graceMs: GRACE_PERIOD_MS,
        players: room.getPlayerList()
      });

      const timer = setTimeout(() => {
        console.log(`Player ${playerId} did not reconnect, removing from room`);
        this.disconnectTimers.delete(playerId);
        this.removePlayer(playerId);
      }, GRACE_PERIOD_MS);

      this.disconnectTimers.set(playerId, timer);
    } else {
      // Lobby or ended: remove immediately
      this.removePlayer(playerId);
    }
  }
  
  createRoom(hostId, ws, settings = {}, displayName = 'Player') {
    const roomId = `room_${this.nextRoomId++}`;
    const room = new Room(roomId, hostId, settings);
    room.addPlayer(hostId, ws, displayName);
    this.rooms.set(roomId, room);
    this.playerRooms.set(hostId, roomId);
    return room;
  }

  // Seat a player in a room AND record the reverse mapping. Callers that reached
  // for room.addPlayer() directly (matchmaking did) left playerRooms empty, so
  // getPlayerRoom() returned null and every input from that player was dropped.
  attachPlayer(roomId, playerId, ws, displayName = 'Player') {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (!room.addPlayer(playerId, ws, displayName)) return false;
    this.playerRooms.set(playerId, roomId);
    return true;
  }

  // Tear down a room and clear the reverse mappings of everyone still seated in
  // it. Deleting from this.rooms alone would strand playerRooms entries pointing
  // at a room that no longer exists.
  destroyRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    // Stop anything still scheduled, or it fires against a room nobody can see.
    room.clearCountdown();
    if (room.endTimeout) { clearTimeout(room.endTimeout); room.endTimeout = null; }
    for (const playerId of room.players.keys()) {
      this.playerRooms.delete(playerId);
      // Clear grace timers too — if the room is gone, the timer should not fire.
      if (this.disconnectTimers.has(playerId)) {
        clearTimeout(this.disconnectTimers.get(playerId));
        this.disconnectTimers.delete(playerId);
      }
      this._dropTokensFor(playerId);
    }
    this.rooms.delete(roomId);
    console.log(`Room ${roomId} destroyed`);
    return true;
  }

  joinRoom(roomId, playerId, ws, password = null, displayName = 'Player') {
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'lobby') return { error: 'not_found' };
    if (room.password && room.password !== password) return { error: 'wrong_password' };

    if (this.attachPlayer(roomId, playerId, ws, displayName)) {
      return { room };
    }
    return { error: 'full' };
  }

  getRoomList() {
    const list = [];
    for (const [id, room] of this.rooms) {
      if (room.isPublic && room.state === 'lobby') {
        list.push({
          id,
          name: room.name,
          playerCount: room.players.size,
          maxPlayers: room.settings.maxPlayers,
          hasPassword: !!room.password
        });
      }
    }
    return list;
  }
  
  removePlayer(playerId) {
    // A pending grace timer would otherwise fire against a player who is already
    // gone, and keep the RoomManager alive holding the closure.
    if (this.disconnectTimers.has(playerId)) {
      clearTimeout(this.disconnectTimers.get(playerId));
      this.disconnectTimers.delete(playerId);
    }
    this._dropTokensFor(playerId);

    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (room) {
      const shouldDelete = room.removePlayer(playerId);
      if (shouldDelete) {
        // destroyRoom, not rooms.delete: it also clears the reverse mappings
        // and stops the room's timers.
        this.destroyRoom(roomId);
      }
    }

    this.playerRooms.delete(playerId);
  }

  // Resume tokens are per-player and single-purpose; once the player is gone the
  // token must not resolve, or a stale client could resume into a freed seat.
  _dropTokensFor(playerId) {
    for (const [token, id] of this.resumeTokens) {
      if (id === playerId) this.resumeTokens.delete(token);
    }
  }
  
  getPlayerRoom(playerId) {
    const roomId = this.playerRooms.get(playerId);
    return roomId ? this.rooms.get(roomId) : null;
  }
  
  updateAll(dt) {
    // Iterate a copy: a room can end and be destroyed inside its own update.
    // One room throwing must not stop every other room's simulation.
    for (const [id, room] of Array.from(this.rooms)) {
      try {
        room.update(dt);
      } catch (err) {
        console.error(`Room ${id} update failed:`, err);
      }
    }
  }
}

module.exports = { Room, RoomManager, setDatabase };

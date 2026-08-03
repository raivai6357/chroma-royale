// Chroma Royale - Multiplayer Server
// Server-authoritative architecture with WebSocket networking
// Phase 6: Matchmaking, Lobby, Cosmetics, Statistics

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { RoomManager } = require('./rooms.js');
const { TICK_RATE, TICK_INTERVAL } = require('./constants.js');
const { Database } = require('./database.js');
const { 
  getCosmeticList, getCosmeticCost, canPurchase, 
  checkAchievements, checkLevelRewards 
} = require('./cosmetics.js');

// HTTP server to serve static files (for development)
const server = http.createServer((req, res) => {
  const publicDir = path.join(__dirname, '..');

  // req.url arrives with the query string attached and still percent-encoded, so
  // joining it raw made "/src/main.js?v=2" look for a file literally named that.
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  // Health check for the host's uptime probe. Answers without touching the
  // filesystem so it still reports healthy if the client files are missing.
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()) }));
    return;
  }

  // No favicon ships with the game; answer it ourselves so every page load
  // doesn't log a 404 that looks like a real missing asset.
  if (urlPath === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  let filePath = path.join(publicDir, urlPath === '/' ? 'index.html' : urlPath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  const extname = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
  };
  
  const contentType = contentTypes[extname] || 'application/octet-stream';
  
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500);
      res.end(error.code === 'ENOENT' ? 'Not Found' : 'Server Error');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// WebSocket server for game networking
const wss = new WebSocketServer({ server });
const rooms = new RoomManager();
const db = new Database();

// Pass database to rooms for game end recording
const { setDatabase } = require('./rooms.js');
setDatabase(db);

console.log(`Chroma Royale Server starting...`);
console.log(`Tick rate: ${TICK_RATE} Hz (${TICK_INTERVAL}ms per tick)`);

// ---------- Connection Handling ----------
wss.on('connection', (ws) => {
  const playerId = rooms.generatePlayerId();
  ws.playerId = playerId;
  // Handed to the client so a later reconnect can ask for this seat back. A
  // successful 'resume' repoints ws.playerId, which is why everything below
  // reads ws.playerId rather than closing over the const.
  const resumeToken = rooms.generateResumeToken();
  rooms.registerResumeToken(resumeToken, playerId);
  console.log(`Player connected: ${playerId}`);

  const playerData = db.getOrCreatePlayer(playerId);

  ws.send(JSON.stringify({
    type: 'connected',
    playerId,
    resumeToken,
    serverTick: 0,
    playerData: {
      name: playerData.name,
      level: playerData.level,
      xp: playerData.xp,
      coins: playerData.coins,
      stats: playerData.stats,
      cosmetics: playerData.cosmetics
    }
  }));

  ws.on('message', (message) => {
    try {
      handleMessage(wss, rooms, ws, ws.playerId, JSON.parse(message));
    } catch (e) {
      console.error('Invalid message:', message, e);
    }
  });

  ws.on('close', () => {
    console.log(`Player disconnected: ${ws.playerId}`);
    db.removeFromQueue(ws.playerId);
    // Not removePlayer: mid-round this holds the seat open for a grace period so
    // a blip doesn't eliminate the player.
    rooms.handleDisconnect(ws.playerId);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for ${ws.playerId}:`, error);
  });
});

// ---------- Message Router ----------
function handleMessage(wss, rooms, ws, playerId, data) {
  switch (data.type) {
    // Session
    case 'resume':        handleResume(rooms, ws, data); break;

    // Room management
    case 'join_room':     handleJoinRoom(rooms, ws, playerId, data); break;
    case 'create_room':   handleCreateRoom(rooms, ws, playerId, data); break;
    case 'leave_room':    rooms.removePlayer(playerId); break;
    case 'start_game':    handleStartGame(rooms, playerId, data); break;
    case 'list_rooms':    handleListRooms(ws, rooms); break;

    // Profile
    case 'set_name':      handleSetName(ws, playerId, data); break;
    
    // Game input
    case 'input':         handleInput(rooms, playerId, data); break;
    
    // Lobby
    case 'set_ready':     handleSetReady(rooms, playerId, data); break;
    case 'ping':          handlePing(ws, data); break;
    
    // Matchmaking
    case 'join_queue':    handleJoinQueue(playerId, ws); break;
    case 'leave_queue':   handleLeaveQueue(playerId); break;
    
    // Cosmetics
    case 'get_cosmetics':     handleGetCosmetics(ws, playerId); break;
    case 'purchase_cosmetic': handlePurchaseCosmetic(ws, playerId, data); break;
    case 'equip_cosmetic':    handleEquipCosmetic(ws, playerId, data); break;
    
    // Statistics
    case 'get_stats':         handleGetStats(ws, playerId); break;
    case 'get_leaderboard':   handleGetLeaderboard(ws, data); break;
    
    default:
      console.log('Unknown message type:', data.type);
  }
}

// ---------- Room Handlers ----------
// The client reconnected and wants its old seat back. On success this socket
// takes over the previous identity, so the id minted at connect() is discarded.
function handleResume(rooms, ws, data) {
  const freshId = ws.playerId;
  const result = rooms.resumePlayer(data.resumeToken, ws);

  if (!result.success) {
    // Seat is gone (grace expired, room destroyed, bad token). Say so explicitly
    // rather than staying silent — the client falls back to a normal join.
    ws.send(JSON.stringify({ type: 'resume_failed', reason: result.reason || 'expired' }));
    return;
  }

  ws.playerId = result.playerId;
  // The throwaway identity must not linger: its token would still resolve and
  // db/queue entries would never be cleaned up by close().
  rooms._dropTokensFor(freshId);
  db.removeFromQueue(freshId);

  // Rotate the token. The one we just consumed is dropped along with every other
  // token for this player, so a replay of it can't resolve a second time, and the
  // client still holds a live token for the *next* drop.
  rooms._dropTokensFor(result.playerId);
  const nextToken = rooms.generateResumeToken();
  rooms.registerResumeToken(nextToken, result.playerId);

  console.log(`Player resumed: ${result.playerId} (was ${freshId})`);

  ws.send(JSON.stringify({
    type: 'resumed',
    playerId: result.playerId,
    resumeToken: nextToken,
    roomId: result.roomId,
    roomState: result.roomState
  }));
}

function handleJoinRoom(rooms, ws, playerId, data) {
  const playerData = db.getOrCreatePlayer(playerId);
  const result = rooms.joinRoom(data.roomId, playerId, ws, data.password || null, playerData.name);

  if (result.error) {
    const message = result.error === 'wrong_password'
      ? 'Wrong password'
      : result.error === 'full'
        ? 'Room is full'
        : 'Room not found';
    ws.send(JSON.stringify({ type: 'error', code: result.error, message }));
    return;
  }

  const room = result.room;
  ws.send(JSON.stringify({
    type: 'room_joined',
    roomId: room.id,
    players: room.getPlayerList(),
    state: room.state
  }));
  room.broadcast({
    type: 'player_joined',
    playerId,
    players: room.getPlayerList()
  }, playerId);
}

function handleCreateRoom(rooms, ws, playerId, data) {
  const playerData = db.getOrCreatePlayer(playerId);
  const room = rooms.createRoom(playerId, ws, data.settings || {}, playerData.name);
  ws.send(JSON.stringify({
    type: 'room_created',
    roomId: room.id,
    players: room.getPlayerList(),
    state: room.state
  }));
}

function handleListRooms(ws, rooms) {
  ws.send(JSON.stringify({
    type: 'rooms_list',
    rooms: rooms.getRoomList()
  }));
}

function handleSetName(ws, playerId, data) {
  const name = db.setPlayerName(playerId, data.name);
  ws.send(JSON.stringify({ type: 'name_set', name }));
}

function handleInput(rooms, playerId, data) {
  const room = rooms.getPlayerRoom(playerId);
  if (room && room.state === 'playing') {
    room.processInput(playerId, data);
  }
}

function handleStartGame(rooms, playerId, data) {
  const room = rooms.getPlayerRoom(playerId);
  if (room && room.isHost(playerId)) {
    room.startGame();
  }
}

// ---------- Lobby Handlers ----------
function handleSetReady(rooms, playerId, data) {
  const room = rooms.getPlayerRoom(playerId);
  if (room && room.state === 'lobby') {
    const player = room.players.get(playerId);
    if (player) {
      player.state.ready = data.ready;
      room.broadcast({
        type: 'player_ready',
        playerId,
        ready: data.ready
      });
      
      // Check if all players ready and enough players
      const allReady = Array.from(room.players.values()).every(p => p.state.ready);
      if (allReady && room.players.size >= 2) {
        room.startCountdown();
      }
    }
  }
}

function handlePing(ws, data) {
  ws.send(JSON.stringify({
    type: 'pong',
    clientTime: data.time,
    serverTime: Date.now()
  }));
}

// ---------- Matchmaking Handlers ----------
function handleJoinQueue(playerId, ws) {
  if (db.addToQueue(playerId)) {
    ws.send(JSON.stringify({
      type: 'queue_joined',
      position: db.getQueuePosition(playerId),
      queueSize: db.getQueueSize()
    }));
  }
}

function handleLeaveQueue(playerId) {
  db.removeFromQueue(playerId);
}

// ---------- Cosmetics Handlers ----------
function handleGetCosmetics(ws, playerId) {
  const player = db.getOrCreatePlayer(playerId);
  ws.send(JSON.stringify({
    type: 'cosmetics_list',
    cosmetics: getCosmeticList(),
    owned: player.cosmetics.owned,
    equipped: player.cosmetics.equipped,
    coins: player.coins
  }));
}

function handlePurchaseCosmetic(ws, playerId, data) {
  const player = db.getOrCreatePlayer(playerId);
  const { type, id } = data;
  
  if (canPurchase(player, type, id)) {
    const cost = getCosmeticCost(type, id);
    player.coins -= cost;
    db.unlockCosmetic(playerId, id);
    
    ws.send(JSON.stringify({
      type: 'purchase_success',
      itemId: id,
      coins: player.coins,
      owned: player.cosmetics.owned
    }));
  } else {
    ws.send(JSON.stringify({
      type: 'purchase_failed',
      reason: 'Insufficient coins or already owned'
    }));
  }
}

function handleEquipCosmetic(ws, playerId, data) {
  const { type, id } = data;
  if (db.equipCosmetic(playerId, type, id)) {
    const player = db.getOrCreatePlayer(playerId);
    ws.send(JSON.stringify({
      type: 'equip_success',
      equipped: player.cosmetics.equipped
    }));
  }
}

// ---------- Statistics Handlers ----------
function handleGetStats(ws, playerId) {
  const player = db.getOrCreatePlayer(playerId);
  ws.send(JSON.stringify({
    type: 'stats_response',
    stats: player.stats,
    level: player.level,
    xp: player.xp,
    coins: player.coins
  }));
}

function handleGetLeaderboard(ws, data) {
  const leaderboard = db.getLeaderboard(data.stat || 'wins', data.limit || 10);
  ws.send(JSON.stringify({
    type: 'leaderboard_response',
    stat: data.stat,
    leaderboard
  }));
}

// ---------- Game Loop ----------
// This used to re-arm with setImmediate every pass, which pins a full CPU core at
// ~100% even with zero players connected — measured. On a shared/free host that
// either gets the process throttled or eats a whole month's CPU allowance idling.
//
// Sleep until the next tick is actually due instead. `nextTick` is an absolute
// timeline rather than "now + interval", so Node's timer rounding (which reliably
// overshoots at 60Hz and silently cost ~45% of ticks when I tried the naive
// version) can't accumulate drift. Sleeping 1ms short and letting the catch-up
// loop land the tick holds a measured 179/180 ticks at ~0% idle CPU.
let nextTickAt = Date.now() + TICK_INTERVAL;
function gameLoop() {
  const now = Date.now();

  // Catch up if we were descheduled, but cap it: without a bound, a long pause
  // (host suspend, GC) would try to replay every missed tick at once and stall.
  let caught = 0;
  while (now >= nextTickAt && caught < 5) {
    rooms.updateAll(TICK_INTERVAL / 1000);
    nextTickAt += TICK_INTERVAL;
    caught++;
  }
  if (caught >= 5) nextTickAt = now + TICK_INTERVAL; // too far behind; resync

  setTimeout(gameLoop, Math.max(0, nextTickAt - Date.now() - 1));
}

// ---------- Matchmaking Loop ----------
// Check queue every 5 seconds and create matches. A full 4-player lobby starts
// at once; 2-3 players start after MATCH_WAIT_MS so a duo isn't stuck waiting
// for a fourth that may never queue.
const MATCH_TARGET_SIZE = 4;
const MATCH_WAIT_MS = 8000;
const MATCH_MIN_SIZE = 2;

setInterval(() => {
  const matched = db.findMatch(MATCH_TARGET_SIZE, MATCH_WAIT_MS, MATCH_MIN_SIZE);
  if (!matched || matched.length < MATCH_MIN_SIZE) return;

  // findMatch() already popped these players off the queue, so from here on every
  // early return has to put the survivors back or they wait in limbo forever.
  const socketFor = (id) => Array.from(wss.clients).find(c => c.playerId === id && c.readyState === 1);

  const firstWs = socketFor(matched[0]);
  if (!firstWs) {
    for (let i = 1; i < matched.length; i++) {
      if (socketFor(matched[i])) db.addToQueue(matched[i]);
    }
    return;
  }

  // listed:false — a queue-built room isn't something to browse into; the only
  // way in is being matched, and it starts as soon as everyone is seated.
  const room = rooms.createRoom(matched[0], firstWs, { listed: false }, db.getOrCreatePlayer(matched[0]).name);

  for (let i = 1; i < matched.length; i++) {
    const playerWs = socketFor(matched[i]);
    if (playerWs) {
      // attachPlayer, not room.addPlayer: the latter skips playerRooms, which is
      // what getPlayerRoom() reads, so matched players' inputs went nowhere.
      rooms.attachPlayer(room.id, matched[i], playerWs, db.getOrCreatePlayer(matched[i]).name);
    }
  }

  // Sockets can drop between findMatch() and now. A 1-player room can never
  // start (startGame needs 2), so recycle it instead of leaking it into the list.
  if (room.players.size < 2) {
    for (const playerId of room.players.keys()) db.addToQueue(playerId);
    rooms.destroyRoom(room.id);
    return;
  }

  room.broadcast({
    type: 'match_found',
    roomId: room.id,
    players: room.getPlayerList()
  });

  console.log(`Match created: ${Array.from(room.players.keys()).join(', ')}`);
}, 5000);

// ---------- Start Server ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play`);
  gameLoop();
});

// Export db for game end recording
module.exports = { db, rooms };
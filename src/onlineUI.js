// Online menu UI - Matchmaking, Lobby, Cosmetics, Statistics
// Dynamically creates DOM elements for multiplayer features

import { network } from './network.js';

// RARITY_COLORS from cosmetics
const RARITY_COLORS = {
  common: '#ffffff',
  rare: '#4dabf7',
  epic: '#be4bdb',
  legendary: '#ffd43b'
};

let onlineMenu = null;
let lobbyPanel = null;
let cosmeticsPanel = null;
let statsPanel = null;
let matchmakingPanel = null;

// ---------- Initialization ----------

export function initOnlineUI() {
  // Create main online menu container
  onlineMenu = document.createElement('div');
  onlineMenu.id = 'online-menu';
  onlineMenu.className = 'online-menu hidden';
  onlineMenu.innerHTML = `
    <div class="online-menu-inner">
      <div class="online-header">
        <h2 class="online-title">ONLINE</h2>

        <div class="online-tabs">
          <button class="tab-btn active" data-tab="matchmaking">Play</button>
          <button class="tab-btn" data-tab="lobby">Lobby</button>
          <button class="tab-btn" data-tab="cosmetics">Cosmetics</button>
          <button class="tab-btn" data-tab="stats">Stats</button>
        </div>
      </div>

      <div class="online-content">
        <div id="matchmaking-panel" class="tab-panel active"></div>
        <div id="lobby-panel" class="tab-panel"></div>
        <div id="cosmetics-panel" class="tab-panel"></div>
        <div id="stats-panel" class="tab-panel"></div>
      </div>

      <div class="online-footer-bar">
        <div class="online-footer-stats">
          <button class="nickname-btn" id="nickname-btn" title="Click to change your name">✏ <span id="nickname-value">Player</span></button>
          <span class="conn-status" id="conn-status">OFFLINE</span>
          <span class="coins-display">🪙 <span id="coins-value">0</span></span>
          <span class="level-display">Lv. <span id="level-value">1</span></span>
          <span class="ping-display"><span id="ping-value">--</span>ms</span>
        </div>
        <button class="btn-back" id="btn-online-back">← BACK</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(onlineMenu);
  
  // Cache panel references
  matchmakingPanel = document.getElementById('matchmaking-panel');
  lobbyPanel = document.getElementById('lobby-panel');
  cosmeticsPanel = document.getElementById('cosmetics-panel');
  statsPanel = document.getElementById('stats-panel');
  
  // Setup tab switching
  onlineMenu.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  
  // Back button
  document.getElementById('btn-online-back').addEventListener('click', hideOnlineMenu);

  // Nickname editor
  setupNicknameEditor();

  // Build sub-panels
  buildMatchmakingPanel();
  buildLobbyPanel();
  buildCosmeticsPanel();
  buildStatsPanel();

  // Setup network callbacks
  setupNetworkCallbacks();
}

// ---------- Nickname Editor ----------

function setupNicknameEditor() {
  const btn = document.getElementById('nickname-btn');
  const valueEl = document.getElementById('nickname-value');
  valueEl.textContent = network.playerName || 'Player';

  btn.addEventListener('click', () => {
    if (btn.querySelector('input')) return; // already editing
    const current = network.playerName || 'Player';
    btn.innerHTML = `<input class="nickname-edit" maxlength="20" value="${escapeHtml(current)}">`;
    const input = btn.querySelector('input');
    input.focus();
    input.select();

    const commit = () => {
      const name = input.value.trim() || 'Player';
      network.setName(name);
      renderNickname(name);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { renderNickname(network.playerName || 'Player'); }
    });
    input.addEventListener('blur', commit);
  });
}

function renderNickname(name) {
  const btn = document.getElementById('nickname-btn');
  if (btn) btn.innerHTML = `✏ <span id="nickname-value">${escapeHtml(name)}</span>`;
}

function escapeHtml(s) {
  return (s || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- Tab Switching ----------

function switchTab(tabName) {
  onlineMenu.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  onlineMenu.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  
  onlineMenu.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`${tabName}-panel`).classList.add('active');
  
  // Refresh data when switching tabs
  if (tabName === 'cosmetics' && network.connected) network.getCosmetics();
  if (tabName === 'stats' && network.connected) network.getStats();
  if (tabName === 'lobby') {
    updateLobbyView();
    if (network.roomId) updateLobbyPlayers();
    else if (network.connected) network.listRooms();
  }
}

// ---------- Matchmaking Panel ----------

function buildMatchmakingPanel() {
  matchmakingPanel.innerHTML = `
    <div class="matchmaking-content">
      <div class="queue-status hidden" id="queue-status">
        <div class="queue-spinner"></div>
        <p class="queue-text">Searching for match...</p>
        <p class="queue-info">Position: <span id="queue-position">-</span> | In queue: <span id="queue-size">0</span></p>
        <button class="btn-secondary" id="btn-leave-queue">Cancel</button>
      </div>

      <div class="matchmaking-actions" id="matchmaking-actions">
        <button class="btn-primary btn-large btn-block" id="btn-find-match">⚔️ FIND MATCH</button>

        <div class="matchmaking-or">— or join by code —</div>
        <div class="join-row">
          <input type="text" id="room-code-input" placeholder="Room code..." maxlength="20">
          <button class="btn-secondary" id="btn-join-room">Join</button>
        </div>
        <div class="join-error" id="join-error"></div>

        <div class="matchmaking-or">— or create —</div>
        <div class="create-btn-row">
          <button class="btn-secondary" id="btn-create-public">＋ Public Room</button>
          <button class="btn-secondary" id="btn-create-private">🔒 Private Room</button>
        </div>

        <div class="create-form hidden" id="create-form">
          <div class="create-form-row">
            <label>Room name</label>
            <input type="text" id="create-name-input" placeholder="My Arena" maxlength="24">
          </div>
          <div class="create-form-row hidden" id="create-password-row">
            <label>Password</label>
            <input type="text" id="create-password-input" placeholder="Set a password" maxlength="20">
          </div>
          <div class="create-form-actions">
            <button class="btn-primary" id="btn-create-confirm">Create</button>
            <button class="btn-secondary" id="btn-create-cancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Find match (queue)
  document.getElementById('btn-find-match').addEventListener('click', () => {
    network.joinQueue();
    showQueueUI();
  });
  document.getElementById('btn-leave-queue').addEventListener('click', () => {
    network.leaveQueue();
    hideQueueUI();
  });

  // Join by code
  const codeInput = document.getElementById('room-code-input');
  const doJoin = () => {
    const code = codeInput.value.trim();
    if (code) network.joinRoom(code);
  };
  document.getElementById('btn-join-room').addEventListener('click', doJoin);
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  // Create room forms
  document.getElementById('btn-create-public').addEventListener('click', () => openCreateForm(false));
  document.getElementById('btn-create-private').addEventListener('click', () => openCreateForm(true));
  document.getElementById('btn-create-cancel').addEventListener('click', closeCreateForm);
  document.getElementById('btn-create-confirm').addEventListener('click', submitCreateForm);
}

let createFormIsPrivate = false;

function openCreateForm(isPrivate) {
  createFormIsPrivate = isPrivate;
  const form = document.getElementById('create-form');
  const pwRow = document.getElementById('create-password-row');
  form.classList.remove('hidden');
  pwRow.classList.toggle('hidden', !isPrivate);
  const nameInput = document.getElementById('create-name-input');
  nameInput.value = `${network.playerName || 'Player'}'s Room`;
  nameInput.focus();
  nameInput.select();
}

function closeCreateForm() {
  document.getElementById('create-form').classList.add('hidden');
  document.getElementById('create-name-input').value = '';
  document.getElementById('create-password-input').value = '';
}

function submitCreateForm() {
  const name = document.getElementById('create-name-input').value.trim() || `${network.playerName || 'Player'}'s Room`;
  const settings = { name, isPublic: !createFormIsPrivate, maxPlayers: 4 };
  if (createFormIsPrivate) {
    const pw = document.getElementById('create-password-input').value.trim();
    if (!pw) {
      showJoinError('Private rooms need a password');
      return;
    }
    settings.password = pw;
  }
  network.createRoom(settings);
  closeCreateForm();
}

function showJoinError(msg) {
  const el = document.getElementById('join-error');
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }
}

function showQueueUI() {
  document.getElementById('queue-status').classList.remove('hidden');
  document.getElementById('matchmaking-actions').classList.add('hidden');
}

function hideQueueUI() {
  document.getElementById('queue-status').classList.add('hidden');
  document.getElementById('matchmaking-actions').classList.remove('hidden');
}

// ---------- Lobby Panel ----------

function buildLobbyPanel() {
  lobbyPanel.innerHTML = `
    <div class="lobby-content">
      <!-- Room browser (shown when not in a room) -->
      <div id="lobby-browser" class="lobby-browser">
        <div class="room-browser-header">
          <h3>Open Rooms</h3>
          <button class="btn-secondary btn-small" id="btn-refresh-rooms">⟳ Refresh</button>
        </div>
        <div class="room-list" id="room-list">
          <!-- Populated dynamically -->
        </div>
        <div class="room-empty" id="room-empty">No open rooms. Create one from the Play tab!</div>
      </div>

      <!-- Current room (shown when in a room) -->
      <div id="lobby-room" class="lobby-room hidden">
        <div class="lobby-header">
          <h3>Room: <span id="lobby-room-id">-</span></h3>
          <span class="lobby-role" id="lobby-role"></span>
        </div>

        <div class="lobby-players" id="lobby-players">
          <!-- Populated dynamically -->
        </div>

        <div class="lobby-countdown hidden" id="lobby-countdown">
          <div class="countdown-number" id="countdown-number">5</div>
          <div class="countdown-label">GET READY</div>
        </div>

        <div class="lobby-actions">
          <button class="btn-primary" id="btn-ready">READY</button>
          <button class="btn-secondary hidden" id="btn-start-game">Start Game</button>
          <button class="btn-secondary" id="btn-leave-room">Leave Room</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-refresh-rooms').addEventListener('click', () => {
    network.listRooms();
  });

  document.getElementById('btn-ready').addEventListener('click', () => {
    const ready = !network.isReady();
    network.setReady(ready);
    updateReadyButton(ready);
  });

  document.getElementById('btn-start-game').addEventListener('click', () => {
    network.startGame();
  });

  document.getElementById('btn-leave-room').addEventListener('click', () => {
    network.leaveRoom();
    updateLobbyView();
    network.listRooms();
  });
}

// Toggle between browser and in-room views based on whether we're in a room
function updateLobbyView() {
  const browser = document.getElementById('lobby-browser');
  const room = document.getElementById('lobby-room');
  if (!browser || !room) return;
  const inRoom = !!network.roomId;
  browser.classList.toggle('hidden', inRoom);
  room.classList.toggle('hidden', !inRoom);
}

function renderRoomList(rooms) {
  const list = document.getElementById('room-list');
  const empty = document.getElementById('room-empty');
  if (!list) return;

  rooms = rooms || network.roomsList || [];

  if (rooms.length === 0) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  list.innerHTML = rooms.map(r => `
    <div class="room-card ${r.hasPassword ? 'has-password' : ''}" data-id="${escapeHtml(r.id)}" data-locked="${r.hasPassword ? '1' : '0'}">
      <div class="room-card-main">
        <span class="room-card-name">${r.hasPassword ? '🔒 ' : ''}${escapeHtml(r.name)}</span>
        <span class="room-card-count">${r.playerCount}/${r.maxPlayers}</span>
      </div>
      <div class="room-card-actions">
        <button class="btn-secondary btn-small room-join-btn" ${r.playerCount >= r.maxPlayers ? 'disabled' : ''}>${r.playerCount >= r.maxPlayers ? 'Full' : 'Join'}</button>
      </div>
      <div class="password-prompt hidden">
        <input type="text" class="room-pw-input" placeholder="Password..." maxlength="20">
        <button class="btn-primary btn-small room-pw-go">Go</button>
        <div class="password-error hidden">Wrong password</div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.room-card').forEach(card => {
    const id = card.dataset.id;
    const locked = card.dataset.locked === '1';
    const joinBtn = card.querySelector('.room-join-btn');
    const prompt = card.querySelector('.password-prompt');

    joinBtn.addEventListener('click', () => {
      if (locked) {
        prompt.classList.toggle('hidden');
        const input = prompt.querySelector('.room-pw-input');
        if (!prompt.classList.contains('hidden')) input.focus();
      } else {
        network.joinRoom(id);
      }
    });

    if (locked) {
      const input = prompt.querySelector('.room-pw-input');
      const go = () => {
        const pw = input.value.trim();
        if (pw) network.joinRoom(id, pw);
      };
      prompt.querySelector('.room-pw-go').addEventListener('click', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }
  });
}

function updateReadyButton(ready) {
  const btn = document.getElementById('btn-ready');
  btn.textContent = ready ? '✓ READY' : 'READY';
  btn.className = ready ? 'btn-primary btn-ready-active' : 'btn-primary';
}

function updateLobbyPlayers() {
  updateLobbyView();

  const container = document.getElementById('lobby-players');
  if (!container) return;

  container.innerHTML = network.players.map(p => `
    <div class="lobby-player ${p.ready ? 'ready' : ''} ${p.id === network.playerId ? 'self' : ''}">
      <div class="player-avatar ${p.isHost ? 'host' : ''}">${p.isHost ? '👑' : '🎮'}</div>
      <div class="player-info">
        <span class="player-name">${escapeHtml(p.name || p.id)}${p.id === network.playerId ? ' (You)' : ''}</span>
        <span class="player-status">${p.ready ? '✓ Ready' : 'Not ready'}</span>
      </div>
      ${p.id === network.playerId ? `<span class="ping-badge">${network.getLatency()}ms</span>` : ''}
    </div>
  `).join('');

  // Update room info
  document.getElementById('lobby-room-id').textContent = network.roomId || '-';
  document.getElementById('lobby-role').textContent = network.isHost ? '👑 HOST' : '';

  // Show start button for host
  const startBtn = document.getElementById('btn-start-game');
  if (startBtn) {
    startBtn.classList.toggle('hidden', !network.isHost);
  }
}

// ---------- Cosmetics Panel ----------

function buildCosmeticsPanel() {
  cosmeticsPanel.innerHTML = `
    <div class="cosmetics-content">
      <div class="cosmetics-tabs">
        <button class="cos-tab active" data-cos="skins">Skins</button>
        <button class="cos-tab" data-cos="trails">Trails</button>
        <button class="cos-tab" data-cos="dashEffects">Dash</button>
        <button class="cos-tab" data-cos="deathEffects">Death</button>
      </div>
      
      <div class="cosmetics-grid" id="cosmetics-grid">
        <!-- Populated dynamically -->
      </div>
    </div>
  `;
  
  cosmeticsPanel.querySelectorAll('.cos-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      cosmeticsPanel.querySelectorAll('.cos-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCosmeticGrid(btn.dataset.cos);
    });
  });
}

function renderCosmeticGrid(type) {
  const grid = document.getElementById('cosmetics-grid');
  if (!grid || !network.cosmeticsCatalog) {
    grid.innerHTML = '<p class="loading">Loading cosmetics...</p>';
    return;
  }
  
  const items = network.cosmeticsCatalog[type];
  if (!items) {
    grid.innerHTML = '<p>No items available</p>';
    return;
  }
  
  grid.innerHTML = Object.entries(items).map(([id, item]) => {
    const owned = network.ownedCosmetics.includes(id);
    const equipped = network.equippedCosmetics && 
      Object.values(network.equippedCosmetics).includes(id);
    const rarityColor = RARITY_COLORS[item.rarity] || '#fff';
    
    return `
      <div class="cosmetic-item ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''}" 
           data-type="${type}" data-id="${id}">
        <div class="cos-preview" style="border-color: ${rarityColor}">
          <div class="cos-icon">${getCosmeticIcon(type, id)}</div>
        </div>
        <div class="cos-info">
          <span class="cos-name">${item.name}</span>
          <span class="cos-rarity" style="color: ${rarityColor}">${item.rarity}</span>
          ${!owned ? `<span class="cos-cost">🪙 ${item.cost}</span>` : ''}
          ${equipped ? '<span class="cos-equipped">✓ Equipped</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
  
  // Click handlers
  grid.querySelectorAll('.cosmetic-item').forEach(el => {
    el.addEventListener('click', () => {
      const type = el.dataset.type;
      const id = el.dataset.id;
      handleCosmeticClick(type, id);
    });
  });
}

function getCosmeticIcon(type, id) {
  const icons = {
    skins: { default: '●', neon: '◆', galaxy: '✦', fire: '🔥', ice: '❄️', plasma: '⚡', void: '◉', rainbow: '🌈', gold: '★' },
    trails: { none: '—', sparkles: '✨', fire: '🔥', rainbow: '🌈', stars: '⭐', lightning: '⚡' },
    dashEffects: { default: '→', blur: '≋', flames: '🔥', lightning: '⚡', shadow: '◐', warp: '⟳' },
    deathEffects: { default: '✕', explosion: '💥', dissolve: '◌', shatter: '⬡', blackhole: '●' }
  };
  return (icons[type] && icons[type][id]) || '●';
}

function handleCosmeticClick(type, id) {
  const owned = network.ownedCosmetics.includes(id);

  if (owned) {
    network.equipCosmetic(type, id);
  } else {
    // Try to purchase
    const catalog = network.cosmeticsCatalog[type];
    if (catalog && catalog[id]) {
      const item = catalog[id];
      if (network.coins >= item.cost) {
        network.purchaseCosmetic(type, id);
      }
    }
  }
}

// ---------- Stats Panel ----------

function buildStatsPanel() {
  statsPanel.innerHTML = `
    <div class="stats-content">
      <div class="stats-grid" id="stats-grid">
        <!-- Populated dynamically -->
      </div>
      
      <div class="leaderboard-section">
        <h3>Leaderboard</h3>
        <div class="lb-tabs">
          <button class="lb-tab active" data-stat="wins">Wins</button>
          <button class="lb-tab" data-stat="kills">Kills</button>
          <button class="lb-tab" data-stat="damageDealt">Damage</button>
          <button class="lb-tab" data-stat="bestStreak">Streak</button>
        </div>
        <div class="lb-list" id="leaderboard-list">
          <!-- Populated dynamically -->
        </div>
      </div>
    </div>
  `;
  
  statsPanel.querySelectorAll('.lb-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      statsPanel.querySelectorAll('.lb-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      network.getLeaderboard(btn.dataset.stat);
    });
  });
}

function renderStats() {
  const grid = document.getElementById('stats-grid');
  if (!grid || !network.stats) {
    if (grid) grid.innerHTML = '<p class="loading">Loading stats...</p>';
    return;
  }
  
  const s = network.stats;
  const winRate = s.gamesPlayed > 0 ? ((s.wins / s.gamesPlayed) * 100).toFixed(1) : '0.0';
  const kdRatio = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : s.kills.toString();
  
  grid.innerHTML = `
    <div class="stat-card">
      <span class="stat-value">${s.gamesPlayed}</span>
      <span class="stat-label">Games Played</span>
    </div>
    <div class="stat-card highlight">
      <span class="stat-value">${s.wins}</span>
      <span class="stat-label">Wins</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${winRate}%</span>
      <span class="stat-label">Win Rate</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${s.kills}</span>
      <span class="stat-label">Kills</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${s.deaths}</span>
      <span class="stat-label">Deaths</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${kdRatio}</span>
      <span class="stat-label">K/D Ratio</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${Math.round(s.damageDealt)}</span>
      <span class="stat-label">Damage Dealt</span>
    </div>
    <div class="stat-card highlight">
      <span class="stat-value">${s.bestStreak}</span>
      <span class="stat-label">Best Streak</span>
    </div>
  `;
}

function renderLeaderboard() {
  const list = document.getElementById('leaderboard-list');
  if (!list) return;
  
  if (!network.leaderboard || !network.leaderboard.entries) {
    list.innerHTML = '<p class="loading">Loading...</p>';
    return;
  }
  
  list.innerHTML = network.leaderboard.entries.map((entry, i) => `
    <div class="lb-entry ${entry.id === network.playerId ? 'self' : ''}">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${entry.name}</span>
      <span class="lb-level">Lv.${entry.level}</span>
      <span class="lb-value">${entry.value}</span>
    </div>
  `).join('');
}

// ---------- Network Callbacks ----------

function setConnStatus(online) {
  const el = document.getElementById('conn-status');
  if (!el) return;
  el.textContent = online ? 'ONLINE' : 'OFFLINE';
  el.classList.toggle('online', online);
}

function setupNetworkCallbacks() {
  network.onConnect = () => {
    setConnStatus(true);
    renderNickname(network.playerName || 'Player');
    updateFooter();
    network.getStats();
    // If the Lobby tab is already open, populate the room list now
    const lobbyActive = onlineMenu.querySelector('[data-tab="lobby"]')?.classList.contains('active');
    if (lobbyActive && !network.roomId) network.listRooms();
  };

  network.onDisconnect = () => {
    setConnStatus(false);
    hideQueueUI();
  };
  
  network.onQueueUpdate = (data) => {
    document.getElementById('queue-position').textContent = data.position;
    document.getElementById('queue-size').textContent = data.queueSize;
  };
  
  network.onMatchFound = (data) => {
    hideQueueUI();
    switchTab('lobby');
    updateLobbyPlayers();
  };
  
  network.onRoomJoined = () => {
    switchTab('lobby');
    updateLobbyPlayers();
  };
  
  network.onPlayerJoined = () => {
    updateLobbyPlayers();
  };
  
  network.onPlayerLeft = () => {
    updateLobbyPlayers();
  };
  
  network.onPlayerReady = () => {
    updateLobbyPlayers();
  };
  
  network.onCountdownStart = (data) => {
    const countdownEl = document.getElementById('lobby-countdown');
    if (countdownEl) {
      countdownEl.classList.remove('hidden');
      document.getElementById('countdown-number').textContent = data.seconds;
    }
  };
  
  network.onCountdownTick = (data) => {
    document.getElementById('countdown-number').textContent = data.seconds;
  };
  
  network.onReturnToLobby = () => {
    const countdownEl = document.getElementById('lobby-countdown');
    if (countdownEl) countdownEl.classList.add('hidden');
    updateLobbyPlayers();
    updateReadyButton(false);
  };
  
  network.onCosmeticsList = () => {
    updateFooter();
    const activeTab = cosmeticsPanel.querySelector('.cos-tab.active');
    if (activeTab) renderCosmeticGrid(activeTab.dataset.cos);
  };
  
  network.onPurchaseResult = (data) => {
    if (data.success) {
      updateFooter();
      const activeTab = cosmeticsPanel.querySelector('.cos-tab.active');
      if (activeTab) renderCosmeticGrid(activeTab.dataset.cos);
    }
  };
  
  network.onEquipResult = () => {
    const activeTab = cosmeticsPanel.querySelector('.cos-tab.active');
    if (activeTab) renderCosmeticGrid(activeTab.dataset.cos);
  };
  
  network.onStatsResponse = () => {
    updateFooter();
    renderStats();
    network.getLeaderboard('wins');
  };
  
  network.onLeaderboardResponse = () => {
    renderLeaderboard();
  };
  
  network.onPingUpdate = () => {
    document.getElementById('ping-value').textContent = network.getLatency();
  };

  network.onRoomsList = (rooms) => {
    renderRoomList(rooms);
  };

  network.onNameSet = (name) => {
    renderNickname(name);
  };

  network.onError = (data) => {
    const code = data && data.code;
    if (code === 'wrong_password') {
      showRoomPasswordError();
    } else if (code === 'not_found' || code === 'full') {
      showJoinError(data.message || 'Could not join room');
      network.listRooms();
    } else if (data && data.message) {
      showJoinError(data.message);
    }
  };
}

// Highlight password error on whichever locked room card is currently expanded
function showRoomPasswordError() {
  const prompts = document.querySelectorAll('#room-list .password-prompt:not(.hidden)');
  prompts.forEach(p => {
    const err = p.querySelector('.password-error');
    if (err) err.classList.remove('hidden');
    const input = p.querySelector('.room-pw-input');
    if (input) { input.focus(); input.select(); }
  });
  // Fallback: if none expanded, surface via the join-error banner on the Play tab
  if (prompts.length === 0) showJoinError('Wrong password');
}

function updateFooter() {
  const coinsEl = document.getElementById('coins-value');
  const levelEl = document.getElementById('level-value');
  const pingEl = document.getElementById('ping-value');

  if (coinsEl) coinsEl.textContent = network.coins || 0;
  if (levelEl) levelEl.textContent = network.playerData ? network.playerData.level : 1;
  if (pingEl) pingEl.textContent = network.getLatency();
}

// ---------- Show/Hide ----------

export function showOnlineMenu() {
  if (!onlineMenu) initOnlineUI();
  onlineMenu.classList.remove('hidden');

  setConnStatus(network.connected);

  if (network.connected) {
    network.getStats();
    network.getCosmetics();
  }
}

export function hideOnlineMenu() {
  if (onlineMenu) onlineMenu.classList.add('hidden');
  if (network.inQueue) network.leaveQueue();
}

export function isOnlineMenuVisible() {
  return onlineMenu && !onlineMenu.classList.contains('hidden');
}
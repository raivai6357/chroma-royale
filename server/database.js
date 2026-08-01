// Simple file-based database for player data persistence
// In production, replace with proper database (MongoDB, PostgreSQL, etc.)

const fs = require('fs');
const path = require('path');

// Container hosts (Fly, Railway, Render) give each deploy a fresh filesystem, so
// writing beside the source means stats and cosmetics silently reset on every
// restart. Point DATA_DIR at a mounted volume in production to keep them.
const DB_PATH = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

// Ensure data directory exists. A read-only or unwritable filesystem is survivable
// — every read and write below is guarded — so warn and keep going rather than
// taking the whole server down over player stats.
let storageWritable = true;
try {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(DB_PATH, { recursive: true });
  }
} catch (e) {
  storageWritable = false;
  console.warn(`Player data directory ${DB_PATH} is not writable (${e.code}); running in-memory only.`);
}

class Database {
  constructor() {
    this.players = new Map();
    this.matchmakingQueue = [];
    this._loadData();
  }

  _loadData() {
    try {
      const playersFile = path.join(DB_PATH, 'players.json');
      if (fs.existsSync(playersFile)) {
        const data = JSON.parse(fs.readFileSync(playersFile, 'utf8'));
        for (const [id, player] of Object.entries(data)) {
          this.players.set(id, player);
        }
      }
    } catch (e) {
      console.error('Failed to load player data:', e);
    }
  }

  _saveData() {
    if (!storageWritable) return;
    try {
      const playersFile = path.join(DB_PATH, 'players.json');
      const data = {};
      for (const [id, player] of this.players) {
        data[id] = player;
      }
      // Write-then-rename: a crash midway through a direct write leaves a
      // truncated players.json that fails to parse on the next boot, losing
      // everything. The rename is atomic, so readers see old or new, never half.
      const tmpFile = playersFile + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      fs.renameSync(tmpFile, playersFile);
    } catch (e) {
      console.error('Failed to save player data:', e);
    }
  }
  
  // Player management
  getPlayer(playerId) {
    return this.players.get(playerId);
  }
  
  getOrCreatePlayer(playerId) {
    let player = this.players.get(playerId);
    if (!player) {
      player = {
        id: playerId,
        name: 'Player',
        createdAt: Date.now(),
        
        // Statistics
        stats: {
          gamesPlayed: 0,
          wins: 0,
          kills: 0,
          deaths: 0,
          damageDealt: 0,
          damageTaken: 0,
          bestStreak: 0,
          currentStreak: 0,
          totalPlayTime: 0
        },
        
        // Cosmetics
        cosmetics: {
          owned: ['default'], // Start with default skin
          equipped: {
            skin: 'default',
            trail: 'none',
            dashEffect: 'default',
            deathEffect: 'default'
          }
        },
        
        // Currency (for unlocks)
        coins: 0,
        xp: 0,
        level: 1
      };
      this.players.set(playerId, player);
      this._saveData();
    }
    return player;
  }
  
  updatePlayer(playerId, updates) {
    const player = this.players.get(playerId);
    if (!player) return null;

    Object.assign(player, updates);
    this._saveData();
    return player;
  }

  setPlayerName(playerId, name) {
    const player = this.getOrCreatePlayer(playerId);
    const clean = (name || '').toString().slice(0, 20).trim();
    if (clean) player.name = clean;
    this._saveData();
    return player.name;
  }
  
  // Statistics
  recordGameResult(playerId, result) {
    const player = this.getOrCreatePlayer(playerId);
    const stats = player.stats;
    
    stats.gamesPlayed++;
    if (result.won) {
      stats.wins++;
      stats.currentStreak++;
      stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    } else {
      stats.currentStreak = 0;
    }
    stats.kills += result.kills || 0;
    stats.deaths += result.deaths || 0;
    stats.damageDealt += result.damageDealt || 0;
    stats.damageTaken += result.damageTaken || 0;
    stats.totalPlayTime += result.playTime || 0;
    
    // Award XP and coins
    const xpGained = (result.kills || 0) * 10 + (result.won ? 50 : 10);
    const coinsGained = (result.kills || 0) * 5 + (result.won ? 25 : 5);
    
    player.xp += xpGained;
    player.coins += coinsGained;
    
    // Level up check (100 XP per level)
    const newLevel = Math.floor(player.xp / 100) + 1;
    if (newLevel > player.level) {
      player.level = newLevel;
      // Award coins on level up
      player.coins += newLevel * 10;
    }
    
    this._saveData();
    
    return {
      xpGained,
      coinsGained,
      newLevel: player.level,
      stats: player.stats
    };
  }
  
  getLeaderboard(stat = 'wins', limit = 10) {
    const players = Array.from(this.players.values());
    players.sort((a, b) => (b.stats[stat] || 0) - (a.stats[stat] || 0));
    return players.slice(0, limit).map(p => ({
      id: p.id,
      name: p.name,
      value: p.stats[stat] || 0,
      level: p.level
    }));
  }
  
  // Cosmetics
  unlockCosmetic(playerId, cosmeticId) {
    const player = this.getOrCreatePlayer(playerId);
    if (!player.cosmetics.owned.includes(cosmeticId)) {
      player.cosmetics.owned.push(cosmeticId);
      this._saveData();
      return true;
    }
    return false;
  }
  
  equipCosmetic(playerId, type, cosmeticId) {
    const player = this.getOrCreatePlayer(playerId);
    if (player.cosmetics.owned.includes(cosmeticId)) {
      player.cosmetics.equipped[type] = cosmeticId;
      this._saveData();
      return true;
    }
    return false;
  }
  
  // Matchmaking queue
  addToQueue(playerId, rating = 1000) {
    if (!this.matchmakingQueue.find(p => p.id === playerId)) {
      this.matchmakingQueue.push({
        id: playerId,
        rating,
        joinedAt: Date.now()
      });
      return true;
    }
    return false;
  }
  
  removeFromQueue(playerId) {
    const index = this.matchmakingQueue.findIndex(p => p.id === playerId);
    if (index !== -1) {
      this.matchmakingQueue.splice(index, 1);
      return true;
    }
    return false;
  }
  
  // Pop a group of players to seat into a room, or null if there's nobody to
  // match yet. A full lobby (targetSize) goes immediately; a short queue waits
  // up to maxWaitTime for more arrivals and then starts anyway, since a round
  // only needs MIN_MATCH_SIZE to be playable.
  findMatch(targetSize = 4, maxWaitTime = 30000, minSize = 2) {
    if (this.matchmakingQueue.length < minSize) return null;

    const now = Date.now();
    // Sort by wait time (longest waiting first)
    const sorted = [...this.matchmakingQueue].sort((a, b) => a.joinedAt - b.joinedAt);

    // Short of a full lobby: only start once the longest-waiting player has
    // been sitting there past maxWaitTime, otherwise keep waiting for a 4th.
    if (sorted.length < targetSize) {
      const oldest = sorted[0];
      if ((now - oldest.joinedAt) < maxWaitTime) return null;
    }

    const matched = sorted.slice(0, targetSize);

    // Remove matched players from queue
    for (const player of matched) {
      this.removeFromQueue(player.id);
    }

    return matched.map(p => p.id);
  }
  
  getQueuePosition(playerId) {
    const index = this.matchmakingQueue.findIndex(p => p.id === playerId);
    return index !== -1 ? index + 1 : -1;
  }
  
  getQueueSize() {
    return this.matchmakingQueue.length;
  }
}

module.exports = { Database };
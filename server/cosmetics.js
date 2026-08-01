// Cosmetic items - safe to monetize, no gameplay impact
// All cosmetics are visual-only

const COSMETICS = {
  // Skins - change blob appearance
  skins: {
    default: { name: 'Default', rarity: 'common', cost: 0 },
    neon: { name: 'Neon', rarity: 'common', cost: 100 },
    galaxy: { name: 'Galaxy', rarity: 'rare', cost: 500 },
    fire: { name: 'Inferno', rarity: 'rare', cost: 500 },
    ice: { name: 'Frost', rarity: 'rare', cost: 500 },
    plasma: { name: 'Plasma', rarity: 'epic', cost: 1500 },
    void: { name: 'Void', rarity: 'epic', cost: 1500 },
    rainbow: { name: 'Rainbow', rarity: 'legendary', cost: 5000 },
    gold: { name: 'Golden', rarity: 'legendary', cost: 10000 }
  },
  
  // Trails - particle trail while moving
  trails: {
    none: { name: 'None', rarity: 'common', cost: 0 },
    sparkles: { name: 'Sparkles', rarity: 'common', cost: 150 },
    fire: { name: 'Fire Trail', rarity: 'rare', cost: 600 },
    rainbow: { name: 'Rainbow Trail', rarity: 'epic', cost: 2000 },
    stars: { name: 'Star Trail', rarity: 'epic', cost: 2000 },
    lightning: { name: 'Lightning', rarity: 'legendary', cost: 6000 }
  },
  
  // Dash effects - visual when dashing
  dashEffects: {
    default: { name: 'Default', rarity: 'common', cost: 0 },
    blur: { name: 'Motion Blur', rarity: 'common', cost: 200 },
    flames: { name: 'Flames', rarity: 'rare', cost: 700 },
    lightning: { name: 'Lightning Dash', rarity: 'epic', cost: 2500 },
    shadow: { name: 'Shadow Clone', rarity: 'epic', cost: 2500 },
    warp: { name: 'Warp', rarity: 'legendary', cost: 7000 }
  },
  
  // Death effects - visual when eliminated
  deathEffects: {
    default: { name: 'Default', rarity: 'common', cost: 0 },
    explosion: { name: 'Explosion', rarity: 'common', cost: 200 },
    dissolve: { name: 'Dissolve', rarity: 'rare', cost: 800 },
    shatter: { name: 'Shatter', rarity: 'epic', cost: 3000 },
    blackhole: { name: 'Black Hole', rarity: 'legendary', cost: 8000 }
  }
};

const RARITY_COLORS = {
  common: '#ffffff',
  rare: '#4dabf7',
  epic: '#be4bdb',
  legendary: '#ffd43b'
};

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

// Level-based unlocks (free rewards for playing)
const LEVEL_REWARDS = {
  5: { type: 'skin', id: 'neon', name: 'Neon Skin' },
  10: { type: 'trail', id: 'sparkles', name: 'Sparkle Trail' },
  15: { type: 'dashEffect', id: 'blur', name: 'Motion Blur Dash' },
  20: { type: 'skin', id: 'galaxy', name: 'Galaxy Skin' },
  25: { type: 'deathEffect', id: 'dissolve', name: 'Dissolve Death' },
  30: { type: 'trail', id: 'fire', name: 'Fire Trail' },
  40: { type: 'skin', id: 'plasma', name: 'Plasma Skin' },
  50: { type: 'dashEffect', id: 'lightning', name: 'Lightning Dash' }
};

// Achievement-based unlocks
const ACHIEVEMENTS = {
  first_win: { name: 'First Victory', reward: { type: 'skin', id: 'fire' }, condition: { wins: 1 } },
  ten_wins: { name: 'Champion', reward: { type: 'skin', id: 'ice' }, condition: { wins: 10 } },
  fifty_wins: { name: 'Legend', reward: { type: 'skin', id: 'void' }, condition: { wins: 50 } },
  hundred_kills: { name: 'Slayer', reward: { type: 'trail', id: 'rainbow' }, condition: { kills: 100 } },
  five_hundred_kills: { name: 'Executioner', reward: { type: 'deathEffect', id: 'shatter' }, condition: { kills: 500 } },
  streak_5: { name: 'On Fire', reward: { type: 'dashEffect', id: 'flames' }, condition: { bestStreak: 5 } },
  streak_10: { name: 'Unstoppable', reward: { type: 'dashEffect', id: 'shadow' }, condition: { bestStreak: 10 } },
  games_100: { name: 'Veteran', reward: { type: 'deathEffect', id: 'explosion' }, condition: { gamesPlayed: 100 } },
  damage_10000: { name: 'Damage Dealer', reward: { type: 'trail', id: 'stars' }, condition: { damageDealt: 10000 } }
};

function getCosmeticList() {
  return COSMETICS;
}

function getCosmeticInfo(type, id) {
  const category = COSMETICS[type + 's'];
  return category ? category[id] : null;
}

function getCosmeticCost(type, id) {
  const info = getCosmeticInfo(type, id);
  return info ? info.cost : 0;
}

function canPurchase(player, type, id) {
  const cost = getCosmeticCost(type, id);
  const owned = player.cosmetics.owned.includes(id);
  return !owned && player.coins >= cost;
}

function checkAchievements(player) {
  const newlyUnlocked = [];
  const stats = player.stats;
  
  for (const [id, achievement] of Object.entries(ACHIEVEMENTS)) {
    const alreadyOwned = player.cosmetics.owned.includes(achievement.reward.id);
    if (alreadyOwned) continue;
    
    let earned = true;
    for (const [stat, value] of Object.entries(achievement.condition)) {
      if ((stats[stat] || 0) < value) {
        earned = false;
        break;
      }
    }
    
    if (earned) {
      newlyUnlocked.push({ id, ...achievement });
    }
  }
  
  return newlyUnlocked;
}

function checkLevelRewards(player, oldLevel) {
  const newlyUnlocked = [];
  
  for (const [level, reward] of Object.entries(LEVEL_REWARDS)) {
    if (player.level >= parseInt(level) && oldLevel < parseInt(level)) {
      newlyUnlocked.push(reward);
    }
  }
  
  return newlyUnlocked;
}

module.exports = {
  COSMETICS,
  RARITY_COLORS,
  RARITY_ORDER,
  LEVEL_REWARDS,
  ACHIEVEMENTS,
  getCosmeticList,
  getCosmeticInfo,
  getCosmeticCost,
  canPurchase,
  checkAchievements,
  checkLevelRewards
};
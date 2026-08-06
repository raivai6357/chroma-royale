// Cosmetic catalog — client-authoritative copy.
//
// server/cosmetics.js holds the same data but is CommonJS, so the ESM client
// can't import it. It stays on disk because server/index.js still requires it
// for handlers no client calls any more; THIS file is the one to edit. Prices
// are duplicated rather than fetched because progression lives on the client
// now (see profile.js) — a shop that needs a socket to show its prices is a
// shop that's broken for anyone playing offline.
//
// Two naming conventions coexist here, deliberately:
//   category (plural)  — 'skins', 'trails'      : a group of purchasable items
//   slot     (singular) — 'skin', 'trail'       : the one item currently worn
// server/cosmetics.js:87 conflated them with `COSMETICS[type + 's']` against
// keys that were already plural, which resolved every cost to 0 and made the
// entire shop free. EQUIP_SLOT in profile.js maps between them explicitly so
// there is never a string concatenation deciding which is meant.

export const COSMETICS = {
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

export const RARITY_COLORS = {
  common: '#ffffff',
  rare: '#4dabf7',
  epic: '#be4bdb',
  legendary: '#ffd43b'
};

// Which equipped slot a purchasable category fills.
export const EQUIP_SLOT = {
  skins: 'skin',
  trails: 'trail',
  dashEffects: 'dashEffect',
  deathEffects: 'deathEffect'
};

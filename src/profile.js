// Player progression — coins, xp, level, stats, cosmetic ownership.
//
// This lives on the client rather than the server, which is a deliberate
// downgrade in trustworthiness for a large gain in actually working. The
// server minted a fresh playerId on every socket (server/index.js), so
// getOrCreatePlayer always took the create path and every profile it wrote was
// orphaned the moment the connection closed. Fixing that alone wouldn't have
// been enough: the free Render tier wipes the filesystem on deploy and spins
// the instance down when idle, so a correct lookup would still find an empty
// database most of the time.
//
// The tradeoff is that a determined player can edit localStorage and grant
// themselves the catalog. Everything purchasable is cosmetic and nothing costs
// real money, so that buys them nothing anyone else loses. The leaderboard was
// removed rather than left ranking numbers players can type themselves.
//
// Kept as a separate module from network.js on purpose: progression has to work
// with no server at all, and importing the socket to ask how many coins you have
// is exactly the coupling this removes. game.js doesn't import network.js.
import { storageGet, storageSet, storageRemove } from './network.js';
import { COSMETICS, EQUIP_SLOT } from './cosmetics.js';

const STORAGE_KEY = 'cr_profile';

// Bump when the shape below changes incompatibly, and give migrate() a case.
const PROFILE_VERSION = 1;

// A single key holding one blob, rather than a key per field. Storage can fail
// halfway through a multi-key write when the quota is hit, which would leave
// coins saying one thing and owned-items another — a corruption that looks like
// cheating and is impossible to reason about after the fact.
function makeDefault(){
  return {
    v: PROFILE_VERSION,
    coins: 0,
    xp: 0,
    level: 1,
    // Field names mirror server/database.js exactly. The stats panel and menu
    // footer already read this shape, so matching it means those render
    // functions only change where they read from, not what they expect.
    stats: {
      gamesPlayed: 0, wins: 0, kills: 0, deaths: 0,
      damageDealt: 0, damageTaken: 0,
      bestStreak: 0, currentStreak: 0, totalPlayTime: 0
    },
    cosmetics: {
      // 'none' is seeded alongside 'default' because it IS the default trail,
      // and equip validation requires membership in owned — without it the one
      // trail everybody starts with was the one trail nobody could re-equip.
      owned: ['default', 'none'],
      equipped: { skin: 'default', trail: 'none', dashEffect: 'default', deathEffect: 'default' }
    }
  };
}

// ---------- load ----------

const num = (x, fallback) => (Number.isFinite(x) ? x : fallback);

// Merge field-by-field onto a fresh default rather than Object.assign over it.
// A truncated or hand-edited blob with `stats: null` would otherwise replace the
// whole stats object with null, and every read in the stats panel throws — one
// bad key in localStorage taking down the entire online menu.
function coerce(raw){
  const out = makeDefault();
  if(!raw || typeof raw !== 'object') return out;

  out.coins = Math.max(0, num(raw.coins, 0));
  out.xp    = Math.max(0, num(raw.xp, 0));
  out.level = Math.max(1, num(raw.level, 1));

  if(raw.stats && typeof raw.stats === 'object'){
    for(const k of Object.keys(out.stats)) out.stats[k] = Math.max(0, num(raw.stats[k], 0));
  }

  const cos = raw.cosmetics;
  if(cos && typeof cos === 'object'){
    if(Array.isArray(cos.owned)){
      const clean = cos.owned.filter(id => typeof id === 'string');
      // Union with the defaults: a blob that lost 'default' would leave the
      // player wearing something they don't own, which equip() then refuses.
      out.cosmetics.owned = [...new Set([...out.cosmetics.owned, ...clean])];
    }
    if(cos.equipped && typeof cos.equipped === 'object'){
      for(const slot of Object.keys(out.cosmetics.equipped)){
        const id = cos.equipped[slot];
        if(typeof id === 'string' && out.cosmetics.owned.includes(id)){
          out.cosmetics.equipped[slot] = id;
        }
      }
    }
  }
  return out;
}

function migrate(raw){
  // Only v1 exists so far. Written as a real seam anyway so a future version has
  // somewhere obvious to go other than "wipe and hope".
  return coerce(raw);
}

let data = makeDefault();
let persistent = true;
let loaded = false;

function load(){
  if(loaded) return data;
  loaded = true;

  const raw = storageGet(STORAGE_KEY);
  if(raw === null){
    // Either a first visit or storage is unreachable. Don't write anything yet:
    // a player who never earns a coin shouldn't get a storage key created, and
    // on a read-only visit the write would fail for nothing.
    return data;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch(e){
    // Unparseable means something else wrote this key or it was truncated
    // mid-write. Clear it rather than failing to boot on every future load.
    storageRemove(STORAGE_KEY);
    return data;
  }

  data = (parsed && parsed.v === PROFILE_VERSION) ? coerce(parsed) : migrate(parsed);
  return data;
}

// ---------- save ----------

let saveTimer = null;

function writeNow(){
  saveTimer = null;
  const ok = storageSet(STORAGE_KEY, JSON.stringify(data));
  // One failed write means storage is blocked for the session (partitioned in a
  // third-party iframe, incognito, cookies off). Latch it so the menu can say so
  // instead of letting the player bank coins that silently evaporate.
  if(!ok) persistent = false;
  return ok;
}

// Debounced: buying five items in a row shouldn't be five JSON serialisations
// of the whole profile.
function save(){
  if(saveTimer !== null) return;
  saveTimer = setTimeout(writeNow, 250);
}

// Synchronous write for the page-hide path. A backgrounded tab can be killed
// without ever running another timer, so a pending debounce is a round's
// earnings quietly lost.
function flush(){
  if(saveTimer !== null){
    clearTimeout(saveTimer);
    writeNow();
  }
}

// ---------- progression ----------

// Ported verbatim from server/database.js:137-164. The numbers are unchanged so
// the existing catalog prices stay balanced against how fast coins come in.
function recordGameResult(result){
  load();
  const s = data.stats;

  s.gamesPlayed++;
  if(result.won){
    s.wins++;
    s.currentStreak++;
    s.bestStreak = Math.max(s.bestStreak, s.currentStreak);
  } else {
    s.currentStreak = 0;
  }
  s.kills += result.kills || 0;
  s.deaths += result.deaths || 0;
  s.damageDealt += result.damageDealt || 0;
  s.damageTaken += result.damageTaken || 0;
  s.totalPlayTime += result.playTime || 0;

  const xpGained = (result.kills || 0) * 10 + (result.won ? 50 : 10);
  const coinsGained = (result.kills || 0) * 5 + (result.won ? 25 : 5);

  data.xp += xpGained;
  data.coins += coinsGained;

  const newLevel = Math.floor(data.xp / 100) + 1;
  const leveledUp = newLevel > data.level;
  if(leveledUp){
    data.level = newLevel;
    data.coins += newLevel * 10;
  }

  save();
  return { xpGained, coinsGained, leveledUp, newLevel: data.level };
}

// ---------- cosmetics ----------

function owns(id){
  load();
  return data.cosmetics.owned.includes(id);
}

// category is plural ('skins'); the slot it fills is singular ('skin'). Looking
// the item up by indexing the catalog directly is the whole point — the server
// built its key by appending 's' to a name that was already plural, so every
// cost resolved to undefined, then to 0, and the entire shop was free.
function purchase(category, id){
  load();
  const items = COSMETICS[category];
  if(!items || !items[id]) return { ok:false, reason:'no such item' };
  if(owns(id)) return { ok:false, reason:'already owned' };

  const cost = items[id].cost;
  if(data.coins < cost) return { ok:false, reason:'not enough coins' };

  data.coins -= cost;
  data.cosmetics.owned.push(id);
  save();
  return { ok:true, coins:data.coins };
}

function equip(category, id){
  load();
  const slot = EQUIP_SLOT[category];
  if(!slot || !COSMETICS[category] || !COSMETICS[category][id]) return false;
  if(!owns(id)) return false;

  data.cosmetics.equipped[slot] = id;
  save();
  return true;
}

// False once a write has failed, so the UI can warn rather than let the player
// grind for cosmetics that won't be there next visit.
function isPersistent(){
  return persistent;
}

load();

export const profile = {
  get data(){ return data; },
  load, save, flush,
  recordGameResult, purchase, equip, owns, isPersistent
};

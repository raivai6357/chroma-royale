import {
  COLORS, PASSIVES, GAME_DURATION, DASH_MIN_HP, CRIT_HP, TOUCH, dist2
} from './utils.js';

// ---------- UI refs ----------
const startScreen = document.getElementById('startScreen');
const endScreen = document.getElementById('endScreen');
const hud = document.getElementById('hud');
const startBtn = document.getElementById('startBtn');
const againBtn = document.getElementById('againBtn');
const timerEl = document.getElementById('timer');
const aliveCountEl = document.getElementById('aliveCount');
const toastEl = document.getElementById('toast');
const edgeWarn = document.getElementById('edgeWarn');
const endEyebrow = document.getElementById('endEyebrow');
const endTitle = document.getElementById('endTitle');
const endSub = document.getElementById('endSub');
const dashBtn = document.getElementById('dashBtn');
const boostBtn = document.getElementById('boostBtn');
const touchControls = document.getElementById('touchControls');
// pre-match countdown overlay
const prematch = document.getElementById('prematch');
const pmCount = document.getElementById('pmCount');
const pmRing = document.getElementById('pmRing');
const pmSwatch = document.getElementById('pmSwatch');
const pmColor = document.getElementById('pmColor');
const pmPassive = document.getElementById('pmPassive');
// spectator bar (shown once the player is out but the round is still running)
const spectate = document.getElementById('spectate');
const specAlive = document.getElementById('specAlive');
const leaveBtn = document.getElementById('leaveBtn');
// pause / in-match menu
const pauseScreen = document.getElementById('pauseScreen');
const pauseSub = document.getElementById('pauseSub');
const pauseNote = document.getElementById('pauseNote');
const resumeBtn = document.getElementById('resumeBtn');
const pauseMenuBtn = document.getElementById('pauseMenuBtn');
const endMenuBtn = document.getElementById('endMenuBtn');

export const ui = {
  startScreen, endScreen, hud, startBtn, againBtn,
  endEyebrow, endTitle, endSub, leaveBtn,
  resumeBtn, pauseMenuBtn, endMenuBtn
};

// The thumb controls live outside #stage (they need the gutters beside the 4:3
// arena), so they can't inherit the HUD's hidden class. One function owns both,
// which is what keeps them from drifting apart across the seven call sites.
export function setHudVisible(visible){
  hud.classList.toggle('hidden', !visible);
  if(touchControls) touchControls.classList.toggle('hidden', !visible);
}

// ---------- fullscreen (touch only) ----------
// A mobile browser's URL bar and nav bar eat 100-160px of a ~390px-tall landscape
// viewport — a third of the screen, on the axis we have least of. Fullscreen gets
// it back, and it also stops the address bar from sliding in and out mid-match and
// re-laying out the arena under the player's thumbs.
//
// This has to be called from inside a real user gesture (tap), or the browser
// rejects it. Failure is deliberately silent: iOS Safari has never supported
// requestFullscreen on iPhone, so the rejection is expected on a whole platform
// and there is nothing useful to say about it. 100dvh already keeps the layout
// correct without it.
export function enterFullscreenIfTouch(){
  if(!TOUCH) return;
  const el = document.documentElement;
  if(document.fullscreenElement) return;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if(!req) return;
  try {
    const r = req.call(el, { navigationUI: 'hide' });
    if(r && typeof r.catch === 'function') r.catch(() => {});
  } catch(_){ /* older signatures reject the options object; not worth a retry */ }
}

// ---------- pause / in-match menu ----------
// `frozen` is false online, where the server keeps simulating regardless — the
// copy has to say so rather than promising a pause we can't deliver.
export function showPause(frozen){
  if(!pauseScreen) return;
  pauseSub.textContent = frozen
    ? "The arena is frozen. Take your time."
    : "The match is still running without you.";
  pauseNote.classList.toggle('hidden', frozen);
  pauseScreen.classList.remove('hidden');
}

export function hidePause(){
  if(pauseScreen) pauseScreen.classList.add('hidden');
}

export function isPauseOpen(){
  return !!pauseScreen && !pauseScreen.classList.contains('hidden');
}

// ---------- main menu ----------
// One place that puts the shell back to its start-screen state, so every caller
// (pause menu, end screen, forfeit) leaves the DOM in the same condition.
export function showMainMenu(){
  hidePause();
  hidePrematch();
  hideSpectate();
  setHudVisible(false);
  endScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
}

// ---------- spectator bar ----------
export function showSpectate(aliveCount){
  if(!spectate) return;
  specAlive.textContent = String(aliveCount);
  spectate.classList.remove('hidden');
}

export function updateSpectate(aliveCount){
  if(!spectate || spectate.classList.contains('hidden')) return;
  specAlive.textContent = String(aliveCount);
}

export function hideSpectate(){
  if(spectate) spectate.classList.add('hidden');
}

// ---------- pre-match countdown ----------
// The overlay shows the color you spawned with, so the on-canvas marker and the
// HUD passive line all agree before the first frame of real play.
export function showPrematch(player, label){
  const col = COLORS[player.color];
  pmSwatch.style.color = col;
  pmRing.style.color = col;
  pmColor.textContent = player.color.toUpperCase();
  pmColor.style.color = col;
  pmPassive.textContent = PASSIVES[player.color].label;
  prematch.classList.remove('hidden');
  setPrematchCount(label);
}

export function setPrematchCount(text){
  pmCount.textContent = text;
  pmCount.classList.remove('pop');
  pmRing.classList.remove('pop');
  void pmCount.offsetWidth; // force reflow so the animations restart
  pmCount.classList.add('pop');
  pmRing.classList.add('pop');
}

export function hidePrematch(){
  prematch.classList.add('hidden');
}

let toastTimeout=null;
let wasDashReady = true; // tracks the rising edge of dash-ready for the HUD pulse

export function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(()=>toastEl.classList.remove('show'), 1400);
}

export function updateHUD(game){
  const player = game.player;
  const hp = Math.max(0, Math.round(player.hp));

  // HP, the colour passive, and the dash bar used to be a DOM panel in the corner.
  // They're on the canvas now — radius and rim for HP, a meter beside the blob for
  // dash, the pre-match card for the passive — so nothing to update here.
  const dashReady = player.dashCooldown<=0 && player.hp>DASH_MIN_HP;
  wasDashReady = dashReady;
  dashBtn.classList.toggle('notready', !dashReady);
  // Boost is gated on hp > CRIT_HP in the physics, so grey the button out at the
  // same threshold rather than letting players press a control that does nothing.
  if(boostBtn) boostBtn.classList.toggle('notready', hp <= CRIT_HP);

  // Past the clock the round doesn't end — it goes to sudden death and the zone
  // keeps closing. A timer frozen at 00:00 would read as a bug, so say what's
  // actually happening instead.
  const remain = GAME_DURATION - game.elapsed;
  if(remain <= 0){
    timerEl.textContent = "SUDDEN DEATH";
    timerEl.classList.add('sudden');
  } else {
    const mm = Math.floor(remain/60).toString().padStart(2,'0');
    const ss = Math.floor(remain%60).toString().padStart(2,'0');
    timerEl.textContent = mm+":"+ss;
    timerEl.classList.remove('sudden');
  }

  aliveCountEl.textContent = game.em.actors().filter(e=>e.alive).length;

  const dC = Math.sqrt(dist2(player.x,player.y,game.center.x,game.center.y));
  if(dC > game.safeR){
    edgeWarn.style.boxShadow = "inset 0 0 140px rgba(150,60,255,0.45)";
  } else if(dC > game.safeR-140){
    edgeWarn.style.boxShadow = "inset 0 0 90px rgba(150,60,255,0.18)";
  } else {
    edgeWarn.style.boxShadow = "inset 0 0 0px rgba(150,60,255,0)";
  }
}

// reset the dash-ready edge tracker between rounds
export function resetHUD(){ wasDashReady = true; }

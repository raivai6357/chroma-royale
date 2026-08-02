import { Game } from './game.js';
import { ui, showMainMenu } from './ui.js';
import { showOnlineMenu, hideOnlineMenu, initOnlineUI, isOnlineMenuVisible } from './onlineUI.js';
import { network } from './network.js';
import { onlineGame } from './onlineGame.js';
import { initHowTo, showHowTo, isHowToOpen } from './howto.js';

const game = new Game();

// expose for dev sanity checks (state is one object with entities that carry ids)
window.game = game;
window.onlineGame = onlineGame;

// ---------- network wiring ----------
// onlineUI.js installs 20 callbacks from setupNetworkCallbacks(), which runs
// lazily inside initOnlineUI() on the first showOnlineMenu(). Building the menu
// up front means the handlers below are installed *after* its, so nothing
// clobbers them — and onDisconnect can chain to the one it already set rather
// than replacing it (the menu still needs to drop its "connected" badge).
initOnlineUI();

network.onGameStart = (data) => {
  hideOnlineMenu();
  onlineGame.start(data);
};
network.onSnapshot = (data) => onlineGame.onSnapshot(data);
network.onGameEnd = (data) => onlineGame.end(data);

// A dropped socket is no longer fatal: network retries on a backoff, so hold the
// round on screen and only give up once the retries are exhausted. onDisconnect
// still chains to the menu's handler so it can drop its "connected" badge.
const uiOnDisconnect = network.onDisconnect;
network.onDisconnect = () => {
  if (uiOnDisconnect) uiOnDisconnect();
};
network.onReconnecting = (info) => onlineGame.onReconnecting(info);
network.onReconnected = () => onlineGame.onReconnected();
network.onReconnectFailed = () => onlineGame.onReconnectFailed();
// Resumption outcomes: the socket coming back is not the same as getting the
// seat back, so these are what actually resume or end the round.
network.onResumed = () => onlineGame.onResumed();
network.onResumeFailed = () => onlineGame.onResumeFailed();
network.onPlayerAway = (info) => onlineGame.onPlayerAway(info);

// ---------- buttons ----------
// One "again"/"leave" pair serves both modes, so route by which loop is live.
ui.startBtn.addEventListener('click', () => game.startGame());
ui.againBtn.addEventListener('click', () => {
  if (network.isInRoom()) showOnlineMenu();
  else game.startGame();
});
ui.leaveBtn.addEventListener('click', () => {
  if (onlineGame.isActive()) onlineGame.leaveMatch();
  else game.leaveMatch();
});

// ---------- pause / main menu ----------
// The live round owns the Escape menu, so route to whichever loop is running.
// onlineGame.isActive() is the same test the leave button uses.
function activeGame() {
  if (onlineGame.isActive()) return onlineGame;
  if (game.running) return game;
  return null;
}

ui.resumeBtn.addEventListener('click', () => {
  const g = activeGame();
  if (g) g.resume();
});

ui.pauseMenuBtn.addEventListener('click', () => {
  const g = activeGame();
  if (g) g.quitToMenu();
  else showMainMenu();
});

// From the end screen the round is already over — no forfeit needed, just make
// sure a finished online round releases the room before we show the menu.
ui.endMenuBtn.addEventListener('click', () => {
  if (network.isInRoom()) network.leaveRoom();
  showMainMenu();
});

// Escape toggles the in-match menu. The How-to sheet and the online lobby have
// their own Escape behaviour and sit above the arena, so they get first refusal.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (isHowToOpen() || isOnlineMenuVisible()) return;
  const g = activeGame();
  if (!g) return;
  e.preventDefault();
  g.togglePause();
});

document.getElementById('onlineBtn').addEventListener('click', () => {
  if (!network.connected) network.connect();
  showOnlineMenu();
});

initHowTo(() => game.startGame());
document.getElementById('howToBtn').addEventListener('click', showHowTo);

// Ask for landscape on touch devices. This is best-effort by design: the Screen
// Orientation API only honours a lock in fullscreen, and iOS Safari doesn't
// implement it at all — so the CSS portrait gate in index.html, not this call,
// is what actually guarantees the player never gets an unplayable portrait
// arena. Wrapped in try/catch because a rejected lock throws synchronously on
// some Android builds rather than returning a promise.
function tryLockLandscape(){
  try {
    const o = screen.orientation;
    if (o && typeof o.lock === 'function') o.lock('landscape').catch(() => {});
  } catch { /* unsupported — the CSS gate covers it */ }
}
if (matchMedia('(pointer:coarse)').matches) {
  tryLockLandscape();
  // A lock is dropped when fullscreen exits, so re-assert it on the way in.
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) tryLockLandscape();
  });
}

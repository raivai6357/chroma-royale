import { Game } from './game.js';
import { ui } from './ui.js';
import { showOnlineMenu, hideOnlineMenu, initOnlineUI } from './onlineUI.js';
import { network } from './network.js';
import { onlineGame } from './onlineGame.js';
import { initHowTo, showHowTo } from './howto.js';

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

document.getElementById('onlineBtn').addEventListener('click', () => {
  if (!network.connected) network.connect();
  showOnlineMenu();
});

initHowTo(() => game.startGame());
document.getElementById('howToBtn').addEventListener('click', showHowTo);

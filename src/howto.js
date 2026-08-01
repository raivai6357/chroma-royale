// How-to-Play panel.
//
// Every number shown here is pulled from utils.js rather than typed into markup,
// so retuning a constant retunes the guide with it. If you add a mechanic, add a
// row here — this screen is meant to be the complete reference, not a teaser.
import {
  COLORS, PASSIVES, BEATS,
  GAME_DURATION, SAFE_R0, SAFE_R1, SHRINK_START, BOT_COUNT, BOX_COUNT,
  MAX_SPEED, ACCEL, DRAG, BOOST_MULT, BOOST_ACCEL_MULT, BOOST_DRAIN, TURN_SPEED,
  DASH_SPEED, DASH_DURATION, DASH_COOLDOWN, DASH_HP_COST, DASH_MIN_HP,
  DASH_DMG_MULT, DASH_KNOCK_MULT, DASH_WINDUP_TIME, DASH_RECOVERY_TIME,
  HIT_DMG_ADV, HIT_DMG_DISADV, HIT_IFRAMES, HIT_LIFESTEAL_RATIO,
  HIT_KNOCK_TARGET, HIT_KNOCK_ATTACKER, DEATH_KNOCK_TARGET, KNOCKBACK_BOUNCE,
  COMBO_WINDOW, COMBO_MULT, MAX_COMBO,
  STAGGER_DURATION, STAGGER_THRESHOLD, CRIT_CHANCE, CRIT_MULT, KNOCKBACK_SCALING,
  DARK_DRAIN, ZONE_WARN_TIME, ZONE_DAMAGE_SCALING, CRIT_HP,
  PLAYER_R, PLAYER_R_MIN, PLAYER_R_MAX, BOX_R
} from './utils.js';

// ---------- small formatting helpers ----------
const pct = (mult) => (mult >= 1 ? "+" : "−") + Math.round(Math.abs(mult - 1) * 100) + "%";
const x = (n) => "×" + n;
const sec = (n) => n + "s";
const up = (s) => s.toUpperCase();

// A stat row: label on the left, value on the right, optional note underneath.
function row(label, value, note){
  return `<div class="htp-row">
    <div class="htp-k">${label}</div>
    <div class="htp-v">${value}</div>
    ${note ? `<div class="htp-note">${note}</div>` : ``}
  </div>`;
}

function section(title, eyebrow, bodyHtml){
  return `<section class="htp-sec">
    <div class="htp-eyebrow">${eyebrow}</div>
    <h3 class="htp-h">${title}</h3>
    ${bodyHtml}
  </section>`;
}

// ---------- derived numbers ----------
// Boost is the only fast movement; these are the numbers a player actually feels.
const boostSpeed = Math.round(MAX_SPEED * BOOST_MULT);
// Seconds of continuous boost before HP hits the critical threshold from full.
const boostToCrit = ((100 - CRIT_HP) / BOOST_DRAIN).toFixed(1);
// Full-chain combo damage on an advantage hit, before crit.
const comboPeak = Math.round(HIT_DMG_ADV * Math.pow(COMBO_MULT, MAX_COMBO - 1));
// Same, if that last hit also crits while dash-smashing.
const bigHit = Math.round(HIT_DMG_ADV * DASH_DMG_MULT * PASSIVES.magenta.dmgMult
  * Math.pow(COMBO_MULT, MAX_COMBO - 1) * CRIT_MULT);
const shrinkSpan = GAME_DURATION - SHRINK_START;

// ---------- section builders ----------
function objectiveHtml(){
  return `
    <p class="htp-p">You are one of <b>${BOT_COUNT + 1}</b> blobs in a fixed arena. There is no
    respawn: when your HP reaches 0 you are out. Outlast everyone to win, or survive to the
    end of the clock and share the arena with whoever is left.</p>
    ${row("Round length", sec(GAME_DURATION), "The clock is the hard limit — the void does the rest.")}
    ${row("Blobs at drop-in", String(BOT_COUNT + 1), `You plus ${BOT_COUNT} rivals.`)}
    ${row("Starting HP", "100", "HP is your health, your fuel and your body size, all at once.")}
    ${row("Win", "Be the last one alive", "If the timer runs out first, everyone still standing survives.")}
  `;
}

function cycleHtml(){
  const cells = Object.keys(COLORS).map(c => {
    const loser = BEATS[c];
    return `<div class="htp-cyc">
      <span class="htp-sw" style="background:${COLORS[c]};box-shadow:0 0 12px ${COLORS[c]}"></span>
      <span class="htp-cn">${up(c)}</span>
      <span class="htp-arrow">beats</span>
      <span class="htp-sw" style="background:${COLORS[loser]};box-shadow:0 0 12px ${COLORS[loser]}"></span>
      <span class="htp-cn">${up(loser)}</span>
    </div>`;
  }).join("");
  return `
    <p class="htp-p">Colors are a closed loop, so nobody is safe and nobody is helpless.
    On every body-to-body contact the game checks the matchup and <b>both</b> blobs take
    damage — the winner just takes far less.</p>
    <div class="htp-cycwrap">${cells}</div>
    ${row("You hit the color you beat", HIT_DMG_ADV + " dmg", "Base value, before passives, combo and crits.")}
    ${row("It hits you back", HIT_DMG_DISADV + " dmg", "Trading into a favourable matchup still costs you.")}
    ${row("Same color touching", "0 dmg", `You bounce apart at ${KNOCKBACK_BOUNCE} px/s instead of trading.`)}
    ${row("Lifesteal on a winning hit", Math.round(HIT_LIFESTEAL_RATIO * 100) + "% of damage dealt",
      `A clean ${HIT_DMG_ADV} damage hit heals you ${Math.round(HIT_DMG_ADV * HIT_LIFESTEAL_RATIO)} HP. Hunting is how you heal.`)}
  `;
}

function passiveHtml(){
  const cards = Object.keys(PASSIVES).map(c => {
    const p = PASSIVES[c];
    const bits = [];
    if(p.speedMult !== 1) bits.push(`Top speed ${pct(p.speedMult)} → ${Math.round(MAX_SPEED * p.speedMult)} px/s cruise, ${Math.round(boostSpeed * p.speedMult)} px/s boosting`);
    if(p.dmgMult !== 1) bits.push(`All damage you deal ${pct(p.dmgMult)} → ${Math.round(HIT_DMG_ADV * p.dmgMult)} dmg on a winning hit`);
    if(p.dashCdMult !== 1) bits.push(`Dash cooldown ${pct(p.dashCdMult)} → ${(DASH_COOLDOWN * p.dashCdMult).toFixed(2)}s instead of ${DASH_COOLDOWN}s`);
    return `<div class="htp-card" style="border-color:${COLORS[c]}33">
      <div class="htp-cardhead">
        <span class="htp-sw" style="background:${COLORS[c]};box-shadow:0 0 12px ${COLORS[c]}"></span>
        <span class="htp-cn" style="color:${COLORS[c]}">${up(c)}</span>
        <span class="htp-tagsm">${p.label}</span>
      </div>
      <div class="htp-cardbody">${bits.join("<br>")}</div>
    </div>`;
  }).join("");
  return `
    <p class="htp-p">Your color is not just a matchup — it changes how your blob handles.
    Pick up a box and you inherit that color's passive instantly, for better or worse.</p>
    <div class="htp-cards">${cards}</div>
  `;
}

function movementHtml(){
  return `
    <p class="htp-p">There are no movement keys. Your blob steers toward your cursor and stops
    when it arrives, so aiming <em>is</em> moving. Default speed is deliberately slow: every
    fast option costs HP.</p>
    ${row("Cruise speed", MAX_SPEED + " px/s", "What you get for free, forever. No HP cost.")}
    ${row("Boost speed", x(BOOST_MULT) + " → " + boostSpeed + " px/s", `Acceleration also rises ${x(BOOST_ACCEL_MULT)} while boosting.`)}
    ${row("Boost cost", BOOST_DRAIN + " HP/sec", `Boosting non-stop from full HP puts you in critical range in ${boostToCrit}s.`)}
    ${row("Boost floor", "Stops at " + CRIT_HP + " HP", "Boost will not kill you outright — it cuts out at the critical threshold.")}
    ${row("Acceleration / drag", ACCEL + " px/s² / " + DRAG, "Heavy drag means you slide to a stop rather than braking dead.")}
    ${row("Turn rate", TURN_SPEED + " rad/s", "Reversing direction at speed takes real time — commit carefully.")}
    ${row("Body size", PLAYER_R_MIN + "–" + PLAYER_R_MAX + " px radius", `${PLAYER_R} px at 100 HP. Losing HP shrinks you: a smaller target, but a smaller reach too.`)}
  `;
}

function dashHtml(){
  return `
    <p class="htp-p">Dash is your commitment button — a fixed-speed lunge that is not steerable
    once it starts. It runs through four states, and the wind-up is long enough for a good
    opponent to read.</p>
    <div class="htp-states">
      <div class="htp-state"><b>READY</b><span>Cooldown finished, HP above the floor.</span></div>
      <div class="htp-arrow">→</div>
      <div class="htp-state"><b>WINDUP</b><span>${sec(DASH_WINDUP_TIME)} — you are committed, direction locks in.</span></div>
      <div class="htp-arrow">→</div>
      <div class="htp-state"><b>ACTIVE</b><span>${sec(DASH_DURATION)} at a flat ${DASH_SPEED} px/s.</span></div>
      <div class="htp-arrow">→</div>
      <div class="htp-state"><b>RECOVERY</b><span>${sec(DASH_RECOVERY_TIME)} — vulnerable, then cooldown ticks.</span></div>
    </div>
    ${row("Dash speed", DASH_SPEED + " px/s", `Held constant for the whole ${DASH_DURATION}s — roughly ${Math.round(DASH_SPEED * DASH_DURATION)} px of travel.`)}
    ${row("Cooldown", sec(DASH_COOLDOWN), `Yellow cuts this to ${(DASH_COOLDOWN * PASSIVES.yellow.dashCdMult).toFixed(2)}s.`)}
    ${row("HP cost", DASH_HP_COST + " HP per dash", "Paid on use, win or miss.")}
    ${row("Minimum HP", DASH_MIN_HP + " HP", "Below this the dash is locked out entirely — no escape when you need it most.")}
    ${row("Dash-smash damage", x(DASH_DMG_MULT) + " → " + Math.round(HIT_DMG_ADV * DASH_DMG_MULT) + " dmg", "Only if you connect during ACTIVE, and only into a favourable matchup.")}
    ${row("Dash-smash knockback", x(DASH_KNOCK_MULT), "Also guarantees a stagger on the target, regardless of damage.")}
  `;
}

function combatHtml(){
  return `
    <p class="htp-p">A single contact resolves in order: matchup → colour passive → combo
    → crit roll → stagger check → knockback. Each layer stacks, which is why fights
    swing so hard once someone gets going.</p>
    ${row("Combo window", sec(COMBO_WINDOW), "Land your next hit inside this window and the chain continues.")}
    ${row("Combo scaling", x(COMBO_MULT) + " per hit, up to " + MAX_COMBO,
      `A full chain reaches ${comboPeak} dmg from a ${HIT_DMG_ADV} dmg base. Hit ${MAX_COMBO + 1} resets to 1.`)}
    ${row("Critical hits", Math.round(CRIT_CHANCE * 100) + "% chance, " + x(CRIT_MULT) + " damage",
      "Rolled on every winning hit. Cannot crit while you are staggered.")}
    ${row("Theoretical max hit", bigHit + " dmg",
      `Magenta, dash-smashing, at combo ${MAX_COMBO}, with a crit. Enough to delete a full-HP blob.`)}
    ${row("Stagger", sec(STAGGER_DURATION) + " at " + STAGGER_THRESHOLD + "+ dmg",
      "A staggered attacker deals no damage on contact, so heavy hits buy you a free follow-up.")}
    ${row("Invulnerability frames", sec(HIT_IFRAMES), "After being hit you cannot be damaged again — spacing beats mashing.")}
    ${row("Knockback", HIT_KNOCK_TARGET + " px/s target, " + HIT_KNOCK_ATTACKER + " px/s attacker",
      "You get shoved too. Use it to disengage.")}
    ${row("Low-HP knockback scaling", "+" + (KNOCKBACK_SCALING * 100).toFixed(1) + "% per missing HP",
      `A 20 HP blob flies about ${(1 + 80 * KNOCKBACK_SCALING).toFixed(1)}× as far — hurt enemies get launched into the void.`)}
    ${row("Elimination knockback", DEATH_KNOCK_TARGET + " px/s", "The killing blow throws the body clear of the fight.")}
    ${row("Critical HP", "Below " + CRIT_HP + " HP", "Your blob and HUD go into alarm state, and boost is unavailable.")}
  `;
}

function pickupHtml(){
  return `
    <p class="htp-p">Color boxes are the only thing in the arena that isn't trying to kill you.
    Touching one immediately repaints you and tops you up.</p>
    ${row("Boxes in the arena", String(BOX_COUNT), `Respawned continuously — the arena is always topped back up to ${BOX_COUNT}.`)}
    ${row("Box size", BOX_R + " px", "Small enough that you have to actually aim for it.")}
    ${row("Heal on pickup", "+18 HP", "Capped at 100. This is the only healing that doesn't require winning a fight.")}
    ${row("Recolor", "Instant", "You take the box's color and its passive on contact — check the cycle before you grab.")}
    <p class="htp-p htp-tip"><b>Read the arena before you grab.</b> A box that beats your current
    hunter is a rescue; one that loses to them hands them the kill. The color triangle stays on
    screen in the top-left for exactly this reason.</p>
  `;
}

function zoneHtml(){
  return `
    <p class="htp-p">The lit circle is the safe zone. It closes over the round and forces the
    fight into a smaller and smaller space — standing outside it is survivable briefly and
    fatal quickly, because the damage grows the longer <em>and</em> the further you stray.</p>
    ${row("Starting radius", SAFE_R0 + " px", "Comfortably larger than the arena at drop-in.")}
    ${row("Final radius", SAFE_R1 + " px", "Barely wider than a few blobs. Nobody hides at the end.")}
    ${row("Shrink begins", sec(SHRINK_START), `Then closes steadily over the remaining ${shrinkSpan}s.`)}
    ${row("Warning", sec(ZONE_WARN_TIME) + " before it moves", "The edge pulses. Reposition on the warning, not after it.")}
    ${row("Base void damage", DARK_DRAIN + " HP/sec", "This is only the starting rate, not the real one.")}
    ${row("Time penalty", "+" + Math.round(ZONE_DAMAGE_SCALING * 100) + "% per second outside",
      `After 5s in the void you are taking ${(DARK_DRAIN * (1 + 5 * ZONE_DAMAGE_SCALING)).toFixed(0)} HP/sec; after 10s, ${(DARK_DRAIN * (1 + 10 * ZONE_DAMAGE_SCALING)).toFixed(0)} HP/sec.`)}
    ${row("Distance penalty", "up to " + x(2) + " damage", "Deep in the void hurts far more than skimming the edge. The two penalties multiply.")}
    <p class="htp-p htp-tip"><b>The void is a weapon.</b> Knockback scales with how hurt your
    target is, so a well-timed dash on a low-HP rival near the edge finishes them without you
    landing the last hit yourself.</p>
  `;
}

function controlsHtml(){
  // On a touch device the finger controls come first — reading past a keyboard
  // table to find out how to move is the kind of thing that loses a player.
  const touchFirst = typeof matchMedia === 'function'
    && matchMedia('(pointer:coarse)').matches;

  const desk = `<div>
        <div class="htp-eyebrow">${touchFirst ? "Also supported" : "Mouse &amp; keyboard"}</div>
        ${row("Move", "Move the cursor", "Your blob steers toward it and coasts to a stop on arrival.")}
        ${row("Boost", "Hold Left Click or Space", `${x(BOOST_MULT)} speed for ${BOOST_DRAIN} HP/sec.`)}
        ${row("Dash", "Right Click or Shift", `${DASH_SPEED} px/s lunge, ${DASH_HP_COST} HP, ${DASH_COOLDOWN}s cooldown.`)}
      </div>`;

  const touch = `<div>
        <div class="htp-eyebrow">${touchFirst ? "Touch controls" : "Touch"}</div>
        ${row("Move", "One finger, drag", "Drag anywhere on the arena — your blob follows your finger. Costs nothing.")}
        ${row("Boost", "Double-tap and hold", "Tap twice quickly and keep the second tap held down. Lift off to stop boosting.")}
        ${row("Dash", "The DASH button", "Bottom-right of the arena, appears automatically on touch devices. Dims while on cooldown.")}
      </div>`;

  return `
    <div class="htp-two">
      ${touchFirst ? touch + desk : desk + touch}
    </div>
    <p class="htp-p htp-tip"><b>Bots don't cheat, they just read you.</b> Rivals track threats and
    prey at a set range, hold their dash for openings, and only boost while healthy. They will
    disengage when they lose the matchup — so will you, if you want to win.</p>
  `;
}

// ---------- panel construction ----------
let panel = null;

function build(){
  const el = document.createElement('div');
  el.className = 'overlay hidden';
  el.id = 'howToScreen';
  el.innerHTML = `
    <div class="htp-shell">
      <div class="htp-head">
        <div>
          <div class="result-name">The complete reference</div>
          <div class="htp-title">HOW TO PLAY</div>
        </div>
        <button class="btn ghost htp-x" id="howToClose">Back</button>
      </div>
      <div class="htp-scroll" id="howToScroll">
        ${section("The goal", "01 · Objective", objectiveHtml())}
        ${section("The color cycle", "02 · Matchups", cycleHtml())}
        ${section("Color passives", "03 · Your kit", passiveHtml())}
        ${section("Moving &amp; boosting", "04 · Movement", movementHtml())}
        ${section("The dash", "05 · Commitment", dashHtml())}
        ${section("Damage in detail", "06 · Combat", combatHtml())}
        ${section("Color boxes", "07 · Pickups", pickupHtml())}
        ${section("The closing void", "08 · The zone", zoneHtml())}
        ${section("Controls", "09 · Inputs", controlsHtml())}
        <div class="htp-end">That's everything. Good luck out there.</div>
      </div>
      <div class="htp-foot">
        <button class="btn" id="howToPlayNow">Drop In</button>
        <span class="htp-hint">Esc or Back to return to the menu</span>
      </div>
    </div>
  `;
  document.getElementById('stage').appendChild(el);
  return el;
}

export function showHowTo(){
  if(!panel) panel = build();
  // Always reopen at the top — resuming mid-scroll reads as a rendering bug.
  const sc = panel.querySelector('#howToScroll');
  if(sc) sc.scrollTop = 0;
  panel.classList.remove('hidden');
}

export function hideHowTo(){
  if(panel) panel.classList.add('hidden');
}

export function isHowToOpen(){
  return !!panel && !panel.classList.contains('hidden');
}

// Wire the panel's own buttons once, on first construction.
export function initHowTo(onPlay){
  if(!panel) panel = build();
  panel.querySelector('#howToClose').addEventListener('click', hideHowTo);
  panel.querySelector('#howToPlayNow').addEventListener('click', () => {
    hideHowTo();
    onPlay();
  });
  // Clicking the dimmed area outside the sheet closes it, like the other overlays.
  panel.addEventListener('click', (e) => { if(e.target === panel) hideHowTo(); });
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && isHowToOpen()) hideHowTo();
  });
}

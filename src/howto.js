// How-to-Play panel.
//
// This screen is a quick reference, NOT a manual. A player who opens it mid-lobby
// should be able to close it a few seconds later knowing how to play. That means
// showing mechanics rather than describing them: the colour cycle is a diagram,
// the controls are keycaps, and every rule that survives is one line.
//
// Deliberately omitted, because none of it changes what you *do* on the first
// drop-in: acceleration/drag/turn-rate figures, exact knockback velocities,
// iframe and stagger durations, combo and crit tables, zone damage scaling.
// Numbers that ARE shown come from utils.js, so retuning a constant retunes the
// guide with it — never type a game value into this markup.
import {
  COLORS, PASSIVES, BEATS,
  BOT_COUNT, BOX_COUNT, GAME_DURATION,
  BOOST_MULT, BOOST_DRAIN,
  DASH_COOLDOWN, DASH_HP_COST,
  HIT_DMG_ADV, HIT_DMG_DISADV, HIT_LIFESTEAL_RATIO,
  DARK_DRAIN, CRIT_HP
} from './utils.js';

// ---------- small formatting helpers ----------
const up = (s) => s.toUpperCase();

function section(title, eyebrow, bodyHtml){
  return `<section class="htp-sec">
    <div class="htp-eyebrow">${eyebrow}</div>
    <h3 class="htp-h">${title}</h3>
    ${bodyHtml}
  </section>`;
}

// A colour dot + one line. The dot defaults to cyan; pass a hex to tint it.
function bullet(text, color){
  const style = color ? ` style="background:${color}"` : ``;
  return `<div class="htp-bullet"><span class="htp-dot"${style}></span><span>${text}</span></div>`;
}
const bullets = (items) => `<div class="htp-bullets">${items.join("")}</div>`;

function swatch(c){
  return `<span class="htp-sw" style="background:${COLORS[c]};box-shadow:0 0 10px ${COLORS[c]}"></span>`;
}

// A keycap row: cap(s), what it does, and what it costs you.
function key(caps, label, cost){
  const capHtml = caps.map(c => `<kbd class="htp-cap">${c}</kbd>`)
    .join(`<span class="htp-or">or</span>`);
  return `<div class="htp-key">${capHtml}<span>${label}</span>${
    cost ? `<span class="htp-cost">${cost}</span>` : ``}</div>`;
}

// ---------- section builders ----------
function goalHtml(){
  return `
    <div class="htp-facts">
      <div class="htp-fact"><b>${BOT_COUNT + 1}</b><span>Blobs</span></div>
      <div class="htp-fact"><b>100</b><span>Starting HP</span></div>
      <div class="htp-fact"><b>1</b><span>Survivor</span></div>
    </div>
    <p class="htp-p" style="margin-top:12px">Last blob alive wins. No respawns.
    The clock never picks a winner — it just keeps closing in.</p>
  `;
}

function cycleHtml(){
  // Walk the actual BEATS chain rather than COLORS key order, so the diagram
  // can't silently show a wrong matchup if that object is ever reordered.
  const start = Object.keys(COLORS)[0];
  const chain = [start];
  for (let c = BEATS[start]; c && c !== start; c = BEATS[c]) chain.push(c);
  chain.push(start); // close the loop visually

  const chips = chain.map((c, i) => {
    const last = i === chain.length - 1;
    return `<span class="htp-chip" style="border-color:${COLORS[c]}55">
      ${swatch(c)}<span style="color:${COLORS[c]}">${up(c)}</span>
      ${last ? `` : `<span class="htp-perk">${PASSIVES[c].label}</span>`}
    </span>${last ? `` : `<span class="htp-beat">&rsaquo;</span>`}`;
  }).join("");

  return `
    <div class="htp-tri">${chips}</div>
    ${bullets([
      bullet(`Hit the colour you beat: <b>${HIT_DMG_ADV} dmg</b>, heal
        <b>${Math.round(HIT_DMG_ADV * HIT_LIFESTEAL_RATIO)} HP</b>.`),
      bullet(`Hit the colour that beats you: <b>take ${HIT_DMG_DISADV}</b>.`),
      bullet(`Same colour: <b>just bounce</b>.`),
      bullet(`Boxes <b>swap your colour</b> — and your perk.`)
    ])}
  `;
}

function controlsHtml(){
  // On touch, finger controls come first — reading past a keyboard table to
  // find out how to move is the kind of thing that loses a player.
  const touchFirst = typeof matchMedia === 'function'
    && matchMedia('(pointer:coarse)').matches;

  const desk = `<div>
      <div class="htp-eyebrow">${touchFirst ? "Mouse &amp; keyboard" : "Controls"}</div>
      <div class="htp-keys">
        ${key(["MOVE"], "Your blob follows the cursor", "free")}
        ${key(["CLICK", "SPACE"], "Hold to boost", `${BOOST_MULT}× speed · ${BOOST_DRAIN} HP/s`)}
        ${key(["R-CLICK", "SHIFT"], "Dash — a committed lunge", `${DASH_HP_COST} HP · ${DASH_COOLDOWN}s`)}
        ${key(["ESC"], "Pause / main menu", "")}
      </div>
    </div>`;

  const touch = `<div>
      <div class="htp-eyebrow">Touch</div>
      <div class="htp-keys">
        ${key(["DRAG"], "Your blob follows your finger", "free")}
        ${key(["2-TAP"], "Double-tap and hold to boost", `${BOOST_MULT}× speed · ${BOOST_DRAIN} HP/s`)}
        ${key(["DASH"], "Button, bottom-right", `${DASH_HP_COST} HP · ${DASH_COOLDOWN}s`)}
      </div>
    </div>`;

  return `<div class="htp-two">${touchFirst ? touch + desk : desk + touch}</div>`;
}

function survivalHtml(){
  return bullets([
    bullet(`<b>Cruising is free.</b> Anything faster costs HP.`),
    bullet(`<b>HP is your size too.</b> Hurt blobs shrink and fly further.`),
    bullet(`<b>Below ${CRIT_HP} HP</b> boost cuts out.`),
    bullet(`<b>${BOX_COUNT} boxes</b> in the arena. Each heals <b>+18 HP</b>.`, COLORS.yellow)
  ]);
}

function zoneHtml(){
  return `
    ${bullets([
      bullet(`Inside the circle is <b>safe</b>. Outside drains <b>${DARK_DRAIN}+ HP/s</b>, rising fast.`),
      bullet(`It <b>shrinks</b>, then <b>roams</b> once small — no camping.`, COLORS.cyan),
      bullet(`After <b>${GAME_DURATION}s</b> it closes to nothing.`, COLORS.magenta)
    ])}
    <p class="htp-p htp-tip" style="margin-top:12px"><b>The void is a weapon.</b>
    Shove a hurt rival over the edge and it finishes them for you.</p>
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
          <div class="result-name">30 seconds to learn</div>
          <div class="htp-title">HOW TO PLAY</div>
        </div>
        <button class="btn ghost htp-x" id="howToClose">Back</button>
      </div>
      <div class="htp-scroll" id="howToScroll">
        ${section("Last blob standing", "01 · Goal", goalHtml())}
        ${section("Colour beats colour", "02 · Matchups", cycleHtml())}
        ${section("Controls", "03 · Inputs", controlsHtml())}
        ${section("Staying alive", "04 · Survival", survivalHtml())}
        ${section("The closing circle", "05 · The zone", zoneHtml())}
        <div class="htp-end">That's it. Good luck out there.</div>
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

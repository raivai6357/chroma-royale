// Audio system - procedurally generated sounds
// No external files needed - all sounds created with Web Audio API

let audioCtx = null;
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let musicOscillator = null;
let musicPlaying = false;

// Initialize audio context (must be called after user interaction)
export function initAudio() {
  if (audioCtx) return;
  
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.3;
  masterGain.connect(audioCtx.destination);
  
  musicGain = audioCtx.createGain();
  musicGain.gain.value = 0.15;
  musicGain.connect(masterGain);
  
  sfxGain = audioCtx.createGain();
  sfxGain.gain.value = 0.5;
  sfxGain.connect(masterGain);
}

// Resume audio context (required for mobile)
export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Set master volume (0-1)
export function setVolume(vol) {
  if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, vol));
}

// Set music volume (0-1)
export function setMusicVolume(vol) {
  if (musicGain) musicGain.gain.value = Math.max(0, Math.min(1, vol));
}

// Set SFX volume (0-1)
export function setSFXVolume(vol) {
  if (sfxGain) sfxGain.gain.value = Math.max(0, Math.min(1, vol));
}

// ---------- Sound Effects ----------

// Dash sound - quick whoosh
export function playDash() {
  if (!audioCtx) return;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.1);
  
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
  
  osc.connect(gain);
  gain.connect(sfxGain);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 0.15);
}

// Hit sound - impact
export function playHit() {
  if (!audioCtx) return;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'square';
  osc.frequency.setValueAtTime(150, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.1);
  
  gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
  
  osc.connect(gain);
  gain.connect(sfxGain);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 0.12);
  
  // Add noise burst
  playNoiseBurst(0.05, 0.2);
}

// Kill sound - satisfying elimination
export function playKill() {
  if (!audioCtx) return;
  
  // Rising tone
  const osc1 = audioCtx.createOscillator();
  const gain1 = audioCtx.createGain();
  
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(300, audioCtx.currentTime);
  osc1.frequency.exponentialRampToValueAtTime(900, audioCtx.currentTime + 0.2);
  
  gain1.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
  
  osc1.connect(gain1);
  gain1.connect(sfxGain);
  
  osc1.start();
  osc1.stop(audioCtx.currentTime + 0.3);
  
  // High ping
  setTimeout(() => {
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1200, audioCtx.currentTime);
    
    gain2.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    
    osc2.connect(gain2);
    gain2.connect(sfxGain);
    
    osc2.start();
    osc2.stop(audioCtx.currentTime + 0.2);
  }, 100);
}

// Pickup sound - collecting items
export function playPickup() {
  if (!audioCtx) return;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
  
  gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
  
  osc.connect(gain);
  gain.connect(sfxGain);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 0.15);
}

// Countdown tick
export function playCountdown(final = false) {
  if (!audioCtx) return;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(final ? 880 : 440, audioCtx.currentTime);
  
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
  
  osc.connect(gain);
  gain.connect(sfxGain);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 0.2);
}

// Victory fanfare
export function playVictory() {
  if (!audioCtx) return;
  
  const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
  
  notes.forEach((freq, i) => {
    setTimeout(() => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      
      osc.connect(gain);
      gain.connect(sfxGain);
      
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    }, i * 150);
  });
}

// Zone warning
export function playZoneWarning() {
  if (!audioCtx) return;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(100, audioCtx.currentTime);
  
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
  
  osc.connect(gain);
  gain.connect(sfxGain);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 0.5);
}

// UI click
export function playClick() {
  if (!audioCtx) return;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, audioCtx.currentTime);
  
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
  
  osc.connect(gain);
  gain.connect(sfxGain);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 0.05);
}

// Noise burst for impacts
function playNoiseBurst(duration, volume) {
  if (!audioCtx) return;
  
  const bufferSize = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  
  const noise = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  
  noise.buffer = buffer;
  gain.gain.value = volume;
  
  noise.connect(gain);
  gain.connect(sfxGain);
  
  noise.start();
}

// ---------- Background Music ----------

// Simple ambient music loop
export function startMusic() {
  if (!audioCtx || musicPlaying) return;
  
  musicPlaying = true;
  playMusicLoop();
}

export function stopMusic() {
  musicPlaying = false;
  if (musicOscillator) {
    musicOscillator.stop();
    musicOscillator = null;
  }
}

function playMusicLoop() {
  if (!audioCtx || !musicPlaying) return;
  
  // Ambient drone
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(55, audioCtx.currentTime); // A1
  
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(82.4, audioCtx.currentTime); // E2
  
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(200, audioCtx.currentTime);
  filter.Q.setValueAtTime(5, audioCtx.currentTime);
  
  // Slow LFO on filter
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfo.frequency.setValueAtTime(0.2, audioCtx.currentTime);
  lfoGain.gain.setValueAtTime(100, audioCtx.currentTime);
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  
  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(musicGain);
  
  osc1.start();
  osc2.start();
  lfo.start();
  
  musicOscillator = osc1;
  
  // Schedule next variation
  setTimeout(() => {
    if (musicPlaying) {
      osc1.stop();
      osc2.stop();
      lfo.stop();
      playMusicLoop();
    }
  }, 8000);
}
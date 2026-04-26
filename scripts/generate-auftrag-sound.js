// Erzeugt assets/sounds/auftrag.wav: Kalimba-Style (Daumenklavier) — warme Pentatonik
// Ausführen mit:  node scripts/generate-auftrag-sound.js

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const TOTAL_SECONDS = 1.70;
const TOTAL_SAMPLES = Math.floor(SAMPLE_RATE * TOTAL_SECONDS);

const buffer = new Float32Array(TOTAL_SAMPLES);

function addAt(startSec, durationSec, fn) {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const end = Math.min(TOTAL_SAMPLES, start + Math.floor(durationSec * SAMPLE_RATE));
  for (let i = start; i < end; i++) {
    const t = (i - start) / SAMPLE_RATE;
    buffer[i] += fn(t);
  }
}

// Kalimba-Note: scharfer Anschlag, exponentielles Ausklingen, warme Obertöne
function kalimba(freq) {
  return (t) => {
    // Hüllkurve: 2ms Attack, dann exponentielles Decay (~0.7s)
    const attack = 0.002;
    const decay = 0.75;
    let env;
    if (t < attack) {
      env = t / attack;
    } else {
      env = Math.exp(-(t - attack) / decay);
    }

    // Anschlag-"Ping" (kurzes Rauschen, gibt dem Ton Charakter)
    let attackClick = 0;
    if (t < 0.008) {
      attackClick = (Math.random() * 2 - 1) * 0.15 * (1 - t / 0.008);
    }

    // Grundton + Obertöne (Kalimba klingt warm dank gedämpfter höherer Harmonischer)
    const omega = 2 * Math.PI * freq * t;
    const wave =
      Math.sin(omega) * 1.0 +                                       // Grundton
      Math.sin(omega * 2) * 0.35 * Math.exp(-t / 0.4) +              // Oktave (kürzer)
      Math.sin(omega * 3) * 0.12 * Math.exp(-t / 0.25) +             // Quinte (sehr kurz)
      Math.sin(omega * 4.1) * 0.06 * Math.exp(-t / 0.15);            // leicht inharmonisch (Kalimba-Charakter)

    return (wave * env + attackClick) * 0.45;
  };
}

// ----- Komposition: aufsteigende Pentatonik (C-Dur), eine Oktave tiefer -----
// Notenabstand 0.20s — entspannter, weniger gehetzt
const C4 = 261.63;
const E4 = 329.63;
const G4 = 392.00;
const A4 = 440.00;
const C5 = 523.25;

addAt(0.00, 0.85, kalimba(C4));
addAt(0.20, 0.85, kalimba(E4));
addAt(0.40, 0.85, kalimba(G4));
addAt(0.60, 0.85, kalimba(A4));
addAt(0.80, 0.85, kalimba(C5));

// Normalisieren auf 0.92 Peak
let peak = 0;
for (let i = 0; i < TOTAL_SAMPLES; i++) {
  const a = Math.abs(buffer[i]);
  if (a > peak) peak = a;
}
const scale = peak > 0 ? 0.92 / peak : 1;

// In 16-bit PCM konvertieren
const pcm = Buffer.alloc(TOTAL_SAMPLES * 2);
for (let i = 0; i < TOTAL_SAMPLES; i++) {
  const s = Math.max(-1, Math.min(1, buffer[i] * scale));
  pcm.writeInt16LE(Math.round(s * 32767), i * 2);
}

// WAV-Header (44 Bytes, mono, 16-bit, 44100 Hz)
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

const out = path.join(__dirname, '..', 'assets', 'sounds', 'auftrag.wav');
fs.writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`Geschrieben: ${out}  (${(Buffer.concat([header, pcm]).length / 1024).toFixed(1)} KB, ${TOTAL_SECONDS}s)`);

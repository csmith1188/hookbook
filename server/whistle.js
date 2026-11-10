/** C tin whistle: MIDI C4 (60) through C6 (84). Holes: 1–6 top→bottom. 1=covered, 0=open. */

const C4 = 60;
const C6 = 84;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * C tin whistle fingerings (holes 1–6, mouthpiece at top).
 * All six closed = C (home note). Second octave = same shapes, blow harder.
 * Ref: Clarke / standard six-hole whistle charts.
 */
const FINGERINGS = {
  // Octave 1 — gentle air
  60: [1, 1, 1, 1, 1, 1], // C4  all closed
  61: [1, 1, 1, 1, 1, 0.5], // C#4 half-hole bottom
  62: [1, 1, 1, 1, 1, 0], // D4
  63: [1, 1, 1, 1, 0, 1], // Eb4 cross
  64: [1, 1, 1, 1, 0, 0], // E4
  65: [1, 1, 1, 0, 0, 0], // F4
  66: [1, 1, 1, 0, 1, 1], // F#4 cross
  67: [1, 1, 0, 0, 0, 0], // G4
  68: [1, 1, 0, 1, 1, 0], // G#4 cross
  69: [1, 0, 0, 0, 0, 0], // A4
  70: [0, 1, 1, 0, 0, 0], // Bb4 cross
  71: [0, 0, 0, 0, 0, 0], // B4
  // Octave 2 — same fingerings, harder breath (↑)
  72: [1, 1, 1, 1, 1, 1], // C5  all closed (blow harder)
  73: [1, 1, 1, 1, 1, 0.5], // C#5
  74: [1, 1, 1, 1, 1, 0], // D5
  75: [1, 1, 1, 1, 0, 1], // Eb5
  76: [1, 1, 1, 1, 0, 0], // E5
  77: [1, 1, 1, 0, 0, 0], // F5
  78: [1, 1, 1, 0, 1, 1], // F#5
  79: [1, 1, 0, 0, 0, 0], // G5
  80: [1, 1, 0, 1, 1, 0], // G#5
  81: [1, 0, 0, 0, 0, 0], // A5
  82: [0, 1, 1, 0, 0, 0], // Bb5
  83: [0, 0, 0, 0, 0, 0], // B5
  // Top C — same home fingering, still harder air
  84: [1, 1, 1, 1, 1, 1], // C6
};

function midiToName(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}

function isInRange(midi) {
  return Number.isFinite(midi) && midi >= C4 && midi <= C6;
}

/** Same pitch class inside C4–C6, closest octave to `midi`. */
function nearestInRangeMidi(midi) {
  if (!Number.isFinite(midi)) return null;
  if (isInRange(midi) && FINGERINGS[midi]) return midi;

  const pc = ((midi % 12) + 12) % 12;
  let best = null;
  let bestDist = Infinity;
  for (let m = C4; m <= C6; m++) {
    if (((m % 12) + 12) % 12 !== pc) continue;
    if (!FINGERINGS[m]) continue;
    const d = Math.abs(m - midi);
    if (d < bestDist || (d === bestDist && best != null && m < best)) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

function getFingering(midi) {
  const target = nearestInRangeMidi(midi);
  if (target == null) return null;
  return FINGERINGS[target] || null;
}

function durationLabel(beats) {
  if (!Number.isFinite(beats) || beats <= 0) return '';
  if (beats >= 3.5) return '○';
  if (beats >= 1.75) return '○';
  if (beats >= 0.875) return '♩';
  if (beats >= 0.4375) return '♪';
  if (beats >= 0.2) return '♬';
  return '·';
}

module.exports = {
  C4,
  C6,
  NOTE_NAMES,
  FINGERINGS,
  midiToName,
  isInRange,
  nearestInRangeMidi,
  getFingering,
  durationLabel,
};

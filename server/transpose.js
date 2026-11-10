const {
  midiToName,
  isInRange,
  nearestInRangeMidi,
  getFingering,
  durationLabel,
} = require('./whistle');

const PC = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

/** Relative major/minor pairs (same key signature). */
const TARGET_KEYS = [
  { id: 'original', label: 'Original key' },
  { id: 'C/Am', label: 'C Major / A Minor', major: 'C', minor: 'A' },
  { id: 'G/Em', label: 'G Major / E Minor', major: 'G', minor: 'E' },
  { id: 'D/Bm', label: 'D Major / B Minor', major: 'D', minor: 'B' },
  { id: 'A/F#m', label: 'A Major / F♯ Minor', major: 'A', minor: 'F#' },
  { id: 'E/C#m', label: 'E Major / C♯ Minor', major: 'E', minor: 'C#' },
  { id: 'B/G#m', label: 'B Major / G♯ Minor', major: 'B', minor: 'G#' },
  { id: 'F#/D#m', label: 'F♯ Major / D♯ Minor', major: 'F#', minor: 'D#' },
  { id: 'Db/Bbm', label: 'D♭ Major / B♭ Minor', major: 'Db', minor: 'Bb' },
  { id: 'Ab/Fm', label: 'A♭ Major / F Minor', major: 'Ab', minor: 'F' },
  { id: 'Eb/Cm', label: 'E♭ Major / C Minor', major: 'Eb', minor: 'C' },
  { id: 'Bb/Gm', label: 'B♭ Major / G Minor', major: 'Bb', minor: 'G' },
  { id: 'F/Dm', label: 'F Major / D Minor', major: 'F', minor: 'D' },
];

const DEFAULT_TARGET_KEY = 'C/Am';

function normalizeTonicName(name) {
  if (!name) return 'C';
  const t = String(name).trim().replace('♯', '#').replace('♭', 'b');
  const letter = t[0].toUpperCase();
  const rest = t.slice(1);
  const key = letter + rest;
  return PC[key] != null ? key : 'C';
}

function pitchClass(name) {
  return PC[normalizeTonicName(name)] ?? 0;
}

function isMinorScale(scale) {
  const s = String(scale || '').toLowerCase();
  return (
    s.includes('minor') ||
    s === 'aeolian' ||
    s === 'dorian' ||
    s === 'phrygian' ||
    s === 'locrian' ||
    s === 'harmonicminor' ||
    s === 'phrygiandominant'
  );
}

function resolveTargetKey(targetKeyId) {
  return (
    TARGET_KEYS.find((k) => k.id === targetKeyId) ||
    TARGET_KEYS.find((k) => k.id === DEFAULT_TARGET_KEY)
  );
}

/**
 * Choose tonic from the relative pair based on the song's mode.
 * For "original", keep the song's written tonic.
 */
function targetTonicForSong(targetKeyId, scale, originalTonic) {
  if (targetKeyId === 'original') {
    return normalizeTonicName(originalTonic || 'C');
  }
  const pair = resolveTargetKey(targetKeyId);
  return isMinorScale(scale) ? pair.minor : pair.major;
}

/**
 * Semitone offset that maps original tonic → target tonic, then ± octaves
 * to maximize notes in the C whistle range.
 */
function keyTransposeOffset(midiNotes, originalTonic, targetTonic) {
  const pitched = midiNotes.filter((m) => Number.isFinite(m));
  const keyShift =
    (pitchClass(targetTonic) - pitchClass(originalTonic) + 12) % 12;

  if (pitched.length === 0) {
    return { offset: keyShift, inRange: 0, total: 0, keyShift };
  }

  let best = { offset: keyShift, inRange: -1, total: pitched.length, abs: Infinity };

  for (const oct of [-24, -12, 0, 12, 24]) {
    const offset = keyShift + oct;
    let inRange = 0;
    for (const m of pitched) {
      if (isInRange(m + offset)) inRange++;
    }
    const abs = Math.abs(offset);
    if (
      inRange > best.inRange ||
      (inRange === best.inRange && abs < best.abs)
    ) {
      best = { offset, inRange, total: pitched.length, abs };
    }
  }

  return {
    offset: best.offset,
    inRange: best.inRange,
    total: best.total,
    keyShift,
  };
}

function keyNameFromMidi(midi) {
  return midiToName(midi).replace(/\d+$/, '');
}

/**
 * @param {Array<{ midi: number|null, duration: number, isRest: boolean, beat?: number }>} notes
 * @param {{ originalKey?: string, scale?: string, targetKey?: string }} meta
 */
function buildTablature(notes, meta = {}) {
  const originalKey = meta.originalKey ? normalizeTonicName(meta.originalKey) : 'C';
  const scale = meta.scale || 'major';
  const target = resolveTargetKey(meta.targetKey || DEFAULT_TARGET_KEY);
  const keepOriginal = target.id === 'original';
  const targetTonic = targetTonicForSong(target.id, scale, originalKey);

  const midiList = notes.map((n) => (n.isRest ? null : n.midi));
  const { offset, inRange, total } = keyTransposeOffset(
    midiList.filter((m) => m != null),
    originalKey,
    targetTonic
  );

  const transposedKey = targetTonic;
  const modeLabel = isMinorScale(scale) ? 'minor' : 'major';

  const cells = notes.map((n) => {
    if (n.isRest || n.midi == null) {
      return {
        type: 'rest',
        duration: n.duration,
        durationLabel: durationLabel(n.duration),
        beat: n.beat,
      };
    }
    const midi = n.midi + offset;
    const playable = isInRange(midi);
    const fingeringMidi = nearestInRangeMidi(midi);
    const fingering = getFingering(midi);
    return {
      type: 'note',
      midi,
      name: midiToName(midi),
      duration: n.duration,
      durationLabel: durationLabel(n.duration),
      beat: n.beat,
      playable,
      fingering,
      fingeringMidi: fingeringMidi != null ? fingeringMidi : null,
      overblow: fingeringMidi != null && fingeringMidi >= 72,
    };
  });

  const fromLabel = `${originalKey} ${modeLabel}`;
  const toLabel = `${targetTonic} ${modeLabel}`;
  let summary;
  if (keepOriginal) {
    summary =
      offset === 0
        ? `Original key ${toLabel} (${inRange}/${total} notes in C4–C6)`
        : `Original key ${toLabel}, octave shift ${offset > 0 ? '+' : ''}${offset} (${inRange}/${total} in range)`;
  } else {
    summary =
      offset === 0
        ? `Already in ${toLabel} (${inRange}/${total} notes in C4–C6)`
        : `Transposed ${fromLabel} → ${toLabel} (${offset > 0 ? '+' : ''}${offset} semitones, ${inRange}/${total} in range)`;
  }

  return {
    offset,
    inRange,
    total,
    originalKey,
    originalScale: scale,
    targetKeyId: target.id,
    targetKeyLabel: target.label,
    transposedKey,
    transposedMode: modeLabel,
    summary,
    cells,
  };
}

module.exports = {
  TARGET_KEYS,
  DEFAULT_TARGET_KEY,
  bestTranspose: keyTransposeOffset,
  buildTablature,
  resolveTargetKey,
  targetTonicForSong,
  keyNameFromMidi,
};

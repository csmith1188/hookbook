const { XMLParser } = require('fast-xml-parser');

const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
};

const MODE_NUMBER_TO_SCALE = {
  1: 'major',
  2: 'dorian',
  3: 'phrygian',
  4: 'lydian',
  5: 'mixolydian',
  6: 'minor',
  7: 'locrian',
};

const TONIC_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5,
  'E#': 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};

const BASE_OCTAVE_MIDI = 60; // C4 reference; TheoryTab octave 0 ≈ around here with tonic

function normalizeTonic(tonic) {
  if (!tonic) return 'C';
  const t = String(tonic).trim();
  if (TONIC_PC[t] != null) return t;
  const letter = t[0].toUpperCase();
  const rest = t.slice(1).replace('♯', '#').replace('♭', 'b');
  const key = letter + rest;
  return TONIC_PC[key] != null ? key : 'C';
}

function parseScaleDegree(sd) {
  if (sd == null) return null;
  const s = String(sd).trim().toLowerCase();
  if (!s || s === 'rest') return { rest: true };

  let accidental = 0;
  let degreeStr = s;

  // JSON-style prefix: #5, b3, ##4
  const prefix = degreeStr.match(/^([#b]+)(\d+)$/);
  if (prefix) {
    for (const c of prefix[1]) accidental += c === '#' ? 1 : -1;
    degreeStr = prefix[2];
  } else {
    // XML-style suffix: 5s, 3f, 5#
    const suffix = degreeStr.match(/^(\d+)([sf#b]+)$/);
    if (suffix) {
      degreeStr = suffix[1];
      for (const c of suffix[2]) {
        if (c === 's' || c === '#') accidental += 1;
        else accidental -= 1;
      }
    }
  }

  const degree = parseInt(degreeStr, 10);
  if (!Number.isFinite(degree) || degree < 1 || degree > 7) return null;
  return { degree, accidental, rest: false };
}

function scaleDegreeToMidi(sd, octave, tonic, scaleName) {
  const parsed = parseScaleDegree(sd);
  if (!parsed || parsed.rest) return null;

  const tonicName = normalizeTonic(tonic);
  const tonicPc = TONIC_PC[tonicName] ?? 0;
  const scale = SCALE_INTERVALS[scaleName] || SCALE_INTERVALS.major;
  const interval = scale[parsed.degree - 1] + parsed.accidental;
  const oct = Number.isFinite(Number(octave)) ? Number(octave) : 0;
  // TheoryTab: octave 0 is the "home" register; map tonic of home octave near C4–C5
  return BASE_OCTAVE_MIDI + tonicPc + interval + oct * 12;
}

function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function truthyRest(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/**
 * Chord root → MIDI. `applied` = secondary (e.g. V/vi → root=5, applied=6).
 */
function chordRootToMidi(chord, tonic, scaleName) {
  if (!chord || truthyRest(chord.isRest) || chord.root == null) return null;
  const degree = parseInt(chord.root, 10);
  if (!Number.isFinite(degree) || degree < 1) return null;

  let scale = SCALE_INTERVALS[scaleName] || SCALE_INTERVALS.major;
  let tonicPc = TONIC_PC[normalizeTonic(tonic)] ?? 0;

  const applied = parseInt(chord.applied, 10) || 0;
  if (applied > 0) {
    // Temporary tonic = home-key degree `applied`; chord root relative to that (usually major)
    tonicPc = (tonicPc + (scale[(applied - 1) % 7] || 0) + 120) % 12;
    scale = SCALE_INTERVALS.major;
  } else if (chord.borrowed && SCALE_INTERVALS[chord.borrowed]) {
    scale = SCALE_INTERVALS[chord.borrowed];
  }

  const interval = scale[(degree - 1) % 7] || 0;
  return BASE_OCTAVE_MIDI + tonicPc + interval;
}

function parseJsonChordRoots(data, tonic, scale) {
  const chordRoots = [];
  for (const c of data.chords || []) {
    const duration = Number(c.duration) || 0;
    const beat = c.beat != null ? Number(c.beat) - 1 : undefined;
    if (truthyRest(c.isRest) || c.root == null) {
      chordRoots.push({ midi: null, duration, isRest: true, beat });
      continue;
    }
    const midi = chordRootToMidi(c, tonic, scale);
    chordRoots.push({
      midi,
      duration,
      isRest: false,
      beat,
      sd: String(c.root),
      octave: 0,
      chordRoot: true,
    });
  }
  return chordRoots;
}

function parseJsonData(jsonData, meta = {}) {
  const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
  const keys = data.keys || [];
  const key0 = keys[0] || { tonic: 'C', scale: 'major' };
  const tonic = normalizeTonic(key0.tonic);
  const scale = key0.scale || 'major';

  const notes = [];
  for (const n of data.notes || []) {
    const isRest = truthyRest(n.isRest) || String(n.sd || '').toLowerCase() === 'rest';
    const duration = Number(n.duration) || 0;
    const beat = n.beat != null ? Number(n.beat) - 1 : undefined;
    if (isRest) {
      notes.push({ midi: null, duration, isRest: true, beat });
      continue;
    }
    const midi = scaleDegreeToMidi(n.sd, n.octave, tonic, scale);
    notes.push({ midi, duration, isRest: false, beat, sd: n.sd, octave: n.octave });
  }

  return {
    notes,
    chordRoots: parseJsonChordRoots(data, tonic, scale),
    key: tonic,
    scale,
    bpm: meta.bpm || (data.tempos && data.tempos[0] && data.tempos[0].bpm) || null,
    source: 'json',
  };
}

function textOf(node) {
  if (node == null) return null;
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (typeof node === 'object' && '#text' in node) return String(node['#text']);
  return null;
}

function parseXmlData(xmlString, meta = {}) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => ['note', 'segment', 'section', 'chord'].includes(name),
  });
  const root = parser.parse(xmlString);
  // Roots vary: super, score, theorytab, etc.
  const doc = root.super || root.score || root.theorytab || root;

  const tonic = normalizeTonic(textOf(doc.key) || meta.key || 'C');
  const modeNum = parseInt(textOf(doc.mode) || '1', 10);
  const scale = MODE_NUMBER_TO_SCALE[modeNum] || 'major';
  const bpm = parseInt(textOf(doc.BPM) || textOf(doc.bpm) || meta.bpm || '0', 10) || null;

  const noteNodes = [];
  collectTagged(doc, noteNodes, 'note');

  const notes = noteNodes.map((n) => {
    const sd = textOf(n.scale_degree);
    const isRest = truthyRest(textOf(n.isRest)) || (sd && sd.toLowerCase() === 'rest');
    const duration = parseFloat(textOf(n.note_length) || '0') || 0;
    const beat = textOf(n.start_beat_abs) != null ? parseFloat(textOf(n.start_beat_abs)) : undefined;
    if (isRest) return { midi: null, duration, isRest: true, beat };
    const octave = parseInt(textOf(n.octave) || '0', 10);
    const midi = scaleDegreeToMidi(sd, octave, tonic, scale);
    return { midi, duration, isRest: false, beat, sd, octave };
  });

  const chordNodes = [];
  collectTagged(doc, chordNodes, 'chord');
  const chordRoots = chordNodes.map((c) => {
    const sd = textOf(c.sd) || textOf(c.scale_degree);
    const duration =
      parseFloat(textOf(c.chord_duration) || textOf(c.duration) || '0') || 0;
    const beat =
      textOf(c.start_beat_abs) != null
        ? parseFloat(textOf(c.start_beat_abs))
        : undefined;
    if (truthyRest(textOf(c.isRest)) || !sd || String(sd).toLowerCase() === 'rest') {
      return { midi: null, duration, isRest: true, beat };
    }
    const midi = scaleDegreeToMidi(sd, 0, tonic, scale);
    return {
      midi,
      duration,
      isRest: false,
      beat,
      sd: String(sd),
      octave: 0,
      chordRoot: true,
    };
  });

  return { notes, chordRoots, key: tonic, scale, bpm, source: 'xml' };
}

function collectTagged(node, out, tag) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node[tag])) {
    out.push(...node[tag]);
  } else if (node[tag]) {
    out.push(node[tag]);
  }
  const plural = tag + 's';
  if (node[plural] && tag !== 'chord') collectTagged(node[plural], out, tag);
  if (tag === 'chord' && (node.chords || node.harmony)) {
    collectTagged(node.chords || node.harmony, out, tag);
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === tag || k === plural || k === 'chords' || k === 'harmony') continue;
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) v.forEach((child) => collectTagged(child, out, tag));
      else collectTagged(v, out, tag);
    }
  }
}

module.exports = {
  SCALE_INTERVALS,
  parseJsonData,
  parseXmlData,
  scaleDegreeToMidi,
  chordRootToMidi,
  normalizeTonic,
};

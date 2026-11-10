require('dotenv').config();

const path = require('path');
const express = require('express');
const {
  searchByText,
  downloadMelody,
  downloadSongSections,
  listSongSections,
} = require('./hooktheory');
const {
  buildTablature,
  TARGET_KEYS,
  DEFAULT_TARGET_KEY,
} = require('./transpose');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    targetKeys: TARGET_KEYS,
    defaultTargetKey: DEFAULT_TARGET_KEY,
  });
});

app.get('/api/search', async (req, res) => {
  try {
    const page = req.query.page;
    const q = req.query.q;
    if (!q || !String(q).trim()) {
      return res.status(400).json({
        error: 'Provide q (song/artist), e.g. ?q=adele',
      });
    }
    const result = await searchByText(q, page);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
    res.status(status).json({ error: err.message || 'Search failed' });
  }
});

app.post('/api/sections', async (req, res) => {
  try {
    const { artist, song, url } = req.body || {};
    const result = await listSongSections({ artist, song, url });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to list sections' });
  }
});

function pickNoteEvents(sec, chordRootMode) {
  if (chordRootMode) {
    const roots = sec.chordRoots || [];
    const pitched = roots.filter((n) => !n.isRest && n.midi != null);
    if (pitched.length) return { events: roots, mode: 'chord-roots' };
    return { events: [], mode: 'chord-roots', empty: true };
  }
  return { events: sec.notes || [], mode: 'melody' };
}

app.post('/api/transcribe', async (req, res) => {
  try {
    const { artist, song, section, url, sections, targetKey, chordRootMode } =
      req.body || {};
    const key = targetKey || DEFAULT_TARGET_KEY;
    const useRoots = Boolean(chordRootMode);

    // Multi-section
    if (Array.isArray(sections) && sections.length) {
      const packed = await downloadSongSections({
        artist,
        song,
        url,
        sections,
      });
      const outSections = packed.sections.map((sec) => {
        const picked = pickNoteEvents(sec, useRoots);
        if (sec.error || picked.empty || !picked.events.length) {
          return {
            section: sec.section,
            label: sec.label,
            error:
              sec.error ||
              (useRoots
                ? 'No chord roots in this section'
                : 'No notes'),
            noteMode: picked.mode,
            tablature: null,
          };
        }
        return {
          section: sec.section,
          label: sec.label,
          key: sec.key,
          scale: sec.scale,
          bpm: sec.bpm,
          source: sec.source,
          songId: sec.songId,
          url: sec.url,
          noteMode: picked.mode,
          tablature: buildTablature(picked.events, {
            originalKey: sec.key,
            scale: sec.scale,
            targetKey: key,
          }),
        };
      });
      return res.json({
        artist: packed.artist,
        song: packed.song,
        url: packed.url,
        chordRootMode: useRoots,
        sections: outSections,
      });
    }

    // Single section (legacy)
    const melody = await downloadMelody({ artist, song, section, url });
    const picked = pickNoteEvents(melody, useRoots);
    if (picked.empty || !picked.events.length) {
      return res.status(502).json({
        error: useRoots
          ? 'No chord roots in this section'
          : 'No melody notes in this section',
      });
    }
    const tablature = buildTablature(picked.events, {
      originalKey: melody.key,
      scale: melody.scale,
      targetKey: key,
    });
    res.json({
      artist: melody.artist,
      song: melody.song,
      section: melody.section,
      url: melody.url,
      key: melody.key,
      scale: melody.scale,
      bpm: melody.bpm,
      source: melody.source,
      songId: melody.songId,
      chordRootMode: useRoots,
      tablature,
      sections: [
        {
          section: melody.section,
          label: melody.section,
          key: melody.key,
          scale: melody.scale,
          bpm: melody.bpm,
          noteMode: picked.mode,
          tablature,
        },
      ],
    });
  } catch (err) {
    const status = err.status || 500;
    if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
    res.status(status).json({ error: err.message || 'Transcription failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Hookbook listening on http://localhost:${PORT}`);
});

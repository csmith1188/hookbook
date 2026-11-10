const { parseJsonData, parseXmlData } = require('./parse');

const API = 'https://api.hooktheory.com/v1';
const SITE = 'https://www.hooktheory.com';

const MEILI_CONFIG_URL =
  'https://www.hooktheory.com/js/meilisearch/meilisearchAppDashboard.js';
const MEILI_SEARCH_URL = 'https://www.hooktheory.com/meili/multi-search';
const TEXT_PAGE_SIZE = 20;

let meiliConfig = null;
let meiliConfigExpiresAt = 0;

async function getMeiliConfig(force = false) {
  if (!force && meiliConfig && Date.now() < meiliConfigExpiresAt) {
    return meiliConfig;
  }
  const res = await fetch(MEILI_CONFIG_URL, {
    headers: {
      Accept: '*/*',
      'User-Agent': 'Hookbook/1.0 (educational tin-whistle transcription)',
    },
  });
  if (!res.ok) {
    const err = new Error(`Failed to load TheoryTab search config (${res.status})`);
    err.status = 502;
    throw err;
  }
  const js = await res.text();
  const searchKey = (js.match(/searchKey:\s*"([a-f0-9]+)"/) || [])[1];
  const indexName = (js.match(/indexName:\s*"([^"]+)"/) || [])[1];
  if (!searchKey || !indexName) {
    const err = new Error('Could not parse TheoryTab Meilisearch config');
    err.status = 502;
    throw err;
  }
  meiliConfig = { searchKey, indexName };
  meiliConfigExpiresAt = Date.now() + 6 * 60 * 60 * 1000;
  return meiliConfig;
}

function hitToResult(hit) {
  const artistSlug = hit.artistSlug || slugifySection(hit.artist || '');
  const songSlug = hit.songSlug || slugifySection(hit.song || '');
  const section = hit.section || '';
  const sectionHash = slugifySection(section);
  const url =
    artistSlug && songSlug
      ? `${SITE}/theorytab/view/${artistSlug}/${songSlug}${
          sectionHash ? `#${sectionHash}` : ''
        }`
      : null;
  return {
    artist: hit.artist || '',
    song: hit.song || '',
    section,
    url,
    key: hit.key || null,
  };
}

/**
 * Song / artist text search via TheoryTab's public Meilisearch endpoint.
 */
async function searchByText(query, page = 1) {
  const q = String(query || '').trim();
  if (!q) {
    const err = new Error('Query parameter q (song or artist) is required');
    err.status = 400;
    throw err;
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const offset = (pageNum - 1) * TEXT_PAGE_SIZE;
  const { searchKey, indexName } = await getMeiliConfig();

  const res = await fetch(MEILI_SEARCH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${searchKey}`,
      'User-Agent': 'Hookbook/1.0 (educational tin-whistle transcription)',
    },
    body: JSON.stringify({
      queries: [
        {
          indexUid: indexName,
          q,
          limit: TEXT_PAGE_SIZE,
          offset,
        },
      ],
    }),
  });

  if (!res.ok) {
    // Config may have rotated — refresh once
    if (res.status === 401 || res.status === 403) {
      const fresh = await getMeiliConfig(true);
      const retry = await fetch(MEILI_SEARCH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${fresh.searchKey}`,
          'User-Agent': 'Hookbook/1.0 (educational tin-whistle transcription)',
        },
        body: JSON.stringify({
          queries: [
            {
              indexUid: fresh.indexName,
              q,
              limit: TEXT_PAGE_SIZE,
              offset,
            },
          ],
        }),
      });
      if (!retry.ok) {
        const text = await retry.text();
        const err = new Error(`TheoryTab text search failed (${retry.status}): ${text}`);
        err.status = 502;
        throw err;
      }
      const retryData = await retry.json();
      return formatTextSearchResponse(q, pageNum, retryData);
    }
    const text = await res.text();
    const err = new Error(`TheoryTab text search failed (${res.status}): ${text}`);
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  return formatTextSearchResponse(q, pageNum, data);
}

function formatTextSearchResponse(q, pageNum, data) {
  const block = (data && data.results && data.results[0]) || {};
  const hits = Array.isArray(block.hits) ? block.hits : [];
  const total =
    block.estimatedTotalHits ??
    block.totalHits ??
    hits.length + (pageNum - 1) * TEXT_PAGE_SIZE;
  const results = hits.map(hitToResult).filter((r) => r.url);
  return {
    mode: 'text',
    q,
    page: pageNum,
    results,
    total,
    hasMore: pageNum * TEXT_PAGE_SIZE < total,
  };
}

function slugifySection(section) {
  return String(section || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

/**
 * Extract section song ids from TheoryTab HTML.
 * Current pages use: <div id="tab-XXXX" data-hash="XXXX" data-section-url="chorus">
 * Older pages used idOfSong= / getXmlByPk?pk=
 */
function extractSectionIds(html, sectionHint) {
  const want = slugifySection(sectionHint);
  const sections = [];
  const allIds = new Set();
  let m;

  // Current TheoryTab: data-hash + data-section-url (order of attrs varies)
  const hashSectionRe =
    /<[^>]*\bdata-hash=["']([A-Za-z0-9_-]{8,16})["'][^>]*\bdata-section-url=["']([^"']+)["'][^>]*>|<[^>]*\bdata-section-url=["']([^"']+)["'][^>]*\bdata-hash=["']([A-Za-z0-9_-]{8,16})["'][^>]*>/gi;
  while ((m = hashSectionRe.exec(html)) !== null) {
    const idOfSong = m[1] || m[4];
    const section = slugifySection(m[2] || m[3]);
    if (idOfSong) {
      allIds.add(idOfSong);
      sections.push({ section, idOfSong, pk: null });
    }
  }

  // id="tab-XXXX" alone
  const tabIdRe = /\bid=["']tab-([A-Za-z0-9_-]{8,16})["']/gi;
  while ((m = tabIdRe.exec(html)) !== null) {
    allIds.add(m[1]);
  }

  // Legacy Hookpad links: idOfSong=XXXXXXXXXXX
  const linkRe =
    /idOfSong=([A-Za-z0-9_-]{8,16})|(?:href|data-href)=["'][^"']*idOfSong=([A-Za-z0-9_-]{8,16})/gi;
  while ((m = linkRe.exec(html)) !== null) {
    allIds.add(m[1] || m[2]);
  }

  // Legacy tab panels
  const panelRe =
    /<(?:div|section)[^>]*(?:id=["']([^"']+)["'][^>]*role=["']tabpanel["']|role=["']tabpanel["'][^>]*id=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/(?:div|section)>/gi;
  while ((m = panelRe.exec(html)) !== null) {
    const id = slugifySection(m[1] || m[2] || '');
    const body = m[3] || '';
    const idOfSong =
      (body.match(/idOfSong=([A-Za-z0-9_-]{8,16})/) || [])[1] || null;
    const pk =
      (body.match(/getXmlByPk\?pk=(\d+)/) || [])[1] ||
      (body.match(/\bid=["'](\d{3,})["']/) || [])[1] ||
      null;
    if (idOfSong) allIds.add(idOfSong);
    sections.push({ section: id, idOfSong, pk });
  }

  const jsonIdRe = /"idOfSong"\s*:\s*"([A-Za-z0-9_-]{8,16})"/g;
  while ((m = jsonIdRe.exec(html)) !== null) {
    allIds.add(m[1]);
  }

  const pkRe = /getXmlByPk\?pk=(\d+)/g;
  const pks = [];
  while ((m = pkRe.exec(html)) !== null) pks.push(m[1]);

  let match = null;
  if (want) {
    // Exact match first (avoid "chorus" matching "pre-chorus")
    match = sections.find((s) => s.section === want && s.idOfSong);
    if (!match) match = sections.find((s) => s.section === want);
    if (!match) {
      match = sections.find(
        (s) =>
          s.idOfSong &&
          (s.section.startsWith(want + '-') || want.startsWith(s.section + '-'))
      );
    }
    if (!match) {
      match = sections.find(
        (s) => want.includes(s.section) && s.section.length >= 3
      );
    }
  }

  const idOfSong =
    (match && match.idOfSong) ||
    [...allIds][0] ||
    null;
  const pk = (match && match.pk) || pks[0] || null;

  return { idOfSong, pk, sections, allIds: [...allIds] };
}

async function fetchTheoryTabHtml(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'Hookbook/1.0 (educational tin-whistle transcription)',
    },
  });
  if (!res.ok) {
    const err = new Error(`Failed to fetch TheoryTab page (${res.status})`);
    err.status = 502;
    throw err;
  }
  return res.text();
}

async function fetchPublicSong(id) {
  const url = `${API}/songs/public/${encodeURIComponent(id)}?fields=ID,song,jsonData,xmlData,bpm`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Public song fetch failed (${res.status}): ${text}`);
    err.status = 502;
    throw err;
  }
  return res.json();
}

async function fetchXmlByPk(pk) {
  const url = `${SITE}/songs/getXmlByPk?pk=${encodeURIComponent(pk)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/xml,text/xml,*/*',
      'User-Agent': 'Hookbook/1.0 (educational tin-whistle transcription)',
    },
  });
  if (!res.ok) {
    const err = new Error(`getXmlByPk failed (${res.status})`);
    err.status = 502;
    throw err;
  }
  return res.text();
}

function parseSongPayload(payload) {
  if (payload.jsonData) {
    try {
      return parseJsonData(payload.jsonData, { bpm: payload.bpm });
    } catch (e) {
      // fall through to xml
    }
  }
  if (payload.xmlData) {
    const xml = String(payload.xmlData).replace(/%20/g, ' ');
    return parseXmlData(xml, { bpm: payload.bpm });
  }
  return null;
}

function sectionFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hash) return slugifySection(u.hash.replace(/^#/, ''));
  } catch {
    // ignore
  }
  return '';
}

async function tryParsePublicId(id) {
  const payload = await fetchPublicSong(id);
  let parsed = parseSongPayload(payload);
  if ((!parsed || !parsed.notes.length) && payload.song) {
    parsed = parseSongPayload({
      jsonData: payload.song.jsonData,
      xmlData: payload.song.xmlData,
      bpm: payload.bpm || payload.song.bpm,
    });
  }
  return parsed;
}

function titleCaseSection(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function baseTheoryTabUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString().replace(/\/$/, '') || url.split('#')[0];
  } catch {
    return String(url || '').split('#')[0];
  }
}

/**
 * List available TheoryTab sections for a song page.
 */
async function listSongSections({ url, artist, song }) {
  if (!url) {
    const err = new Error('url is required');
    err.status = 400;
    throw err;
  }
  const baseUrl = baseTheoryTabUrl(url);
  const html = await fetchTheoryTabHtml(baseUrl);
  const { sections } = extractSectionIds(html, '');

  const seen = new Set();
  const list = [];
  for (const s of sections) {
    if (!s.section || !s.idOfSong || seen.has(s.section)) continue;
    seen.add(s.section);
    list.push({
      id: s.section,
      label: titleCaseSection(s.section),
      idOfSong: s.idOfSong,
      url: `${baseUrl}#${s.section}`,
    });
  }

  return {
    artist: artist || null,
    song: song || null,
    url: baseUrl,
    sections: list,
  };
}

async function parseSectionFromExtracted(extracted, sectionHint) {
  const want = slugifySection(sectionHint);
  const { sections, allIds } = extracted;

  let match = sections.find((s) => s.section === want && s.idOfSong);
  if (!match) match = sections.find((s) => s.section === want);
  if (!match && want) {
    match = sections.find(
      (s) =>
        s.idOfSong &&
        (s.section.startsWith(want + '-') || want.startsWith(s.section + '-'))
    );
  }

  let idOfSong = (match && match.idOfSong) || null;
  let pk = (match && match.pk) || null;
  let parsed = null;
  let songId = idOfSong;
  let usedPk = null;

  if (idOfSong) {
    try {
      parsed = await tryParsePublicId(idOfSong);
    } catch {
      parsed = null;
    }
  }

  if ((!parsed || !parsed.notes.length) && pk) {
    usedPk = pk;
    const xml = await fetchXmlByPk(pk);
    parsed = parseXmlData(xml);
  }

  if (!parsed || !parsed.notes.length) {
    const candidates = allIds.filter((id) => id !== idOfSong).slice(0, 4);
    for (const id of candidates) {
      try {
        const attempt = await tryParsePublicId(id);
        if (attempt && attempt.notes.length) {
          parsed = attempt;
          songId = id;
          break;
        }
      } catch {
        // continue
      }
    }
  }

  const notes = (parsed && parsed.notes) || [];
  const chordRoots = (parsed && parsed.chordRoots) || [];
  if (!parsed || (!notes.length && !chordRoots.length)) return null;

  return {
    section: sectionHint || want || null,
    songId,
    pk: usedPk,
    key: parsed.key,
    scale: parsed.scale,
    bpm: parsed.bpm,
    source: parsed.source,
    notes,
    chordRoots,
  };
}

/**
 * Resolve TheoryTab URL → melody notes.
 */
async function downloadMelody({ url, section, artist, song }) {
  if (!url) {
    const err = new Error('url is required');
    err.status = 400;
    throw err;
  }

  const sectionHint = section || sectionFromUrl(url);
  const html = await fetchTheoryTabHtml(url);
  const extracted = extractSectionIds(html, sectionHint);
  const parsed = await parseSectionFromExtracted(extracted, sectionHint);

  if (!parsed) {
    const err = new Error(
      `Could not load melody notes for this TheoryTab section` +
        (sectionHint ? ` (${sectionHint})` : '') +
        `. Found ${extracted.allIds.length} section id(s) on the page.` +
        (extracted.allIds.length === 0
          ? ' The page format may have changed.'
          : ' The section may have no melody data.')
    );
    err.status = 502;
    throw err;
  }

  return {
    artist: artist || null,
    song: song || null,
    section: parsed.section,
    url,
    songId: parsed.songId,
    pk: parsed.pk,
    key: parsed.key,
    scale: parsed.scale,
    bpm: parsed.bpm,
    source: parsed.source,
    notes: parsed.notes,
    chordRoots: parsed.chordRoots || [],
  };
}

/**
 * Download multiple sections of one song (single TheoryTab page fetch).
 */
async function downloadSongSections({ url, sections, artist, song }) {
  if (!url) {
    const err = new Error('url is required');
    err.status = 400;
    throw err;
  }
  const wanted = (sections || []).map(slugifySection).filter(Boolean);
  if (!wanted.length) {
    const err = new Error('Select at least one section');
    err.status = 400;
    throw err;
  }

  const baseUrl = baseTheoryTabUrl(url);
  const html = await fetchTheoryTabHtml(baseUrl);
  const extracted = extractSectionIds(html, '');

  const out = [];
  for (const section of wanted) {
    const parsed = await parseSectionFromExtracted(extracted, section);
    if (!parsed) {
      out.push({
        section,
        label: titleCaseSection(section),
        error: `Could not load melody for ${section}`,
        notes: [],
        chordRoots: [],
      });
      continue;
    }
    out.push({
      artist: artist || null,
      song: song || null,
      section: parsed.section,
      label: titleCaseSection(parsed.section),
      url: `${baseUrl}#${slugifySection(parsed.section)}`,
      songId: parsed.songId,
      key: parsed.key,
      scale: parsed.scale,
      bpm: parsed.bpm,
      source: parsed.source,
      notes: parsed.notes,
      chordRoots: parsed.chordRoots || [],
    });
  }

  return {
    artist: artist || null,
    song: song || null,
    url: baseUrl,
    sections: out,
  };
}

module.exports = {
  searchByText,
  downloadMelody,
  downloadSongSections,
  listSongSections,
  extractSectionIds,
  slugifySection,
};

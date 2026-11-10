const form = document.getElementById('search-form');
const queryInput = document.getElementById('query');
const statusEl = document.getElementById('status');
const resultsSection = document.getElementById('results-section');
const resultsEl = document.getElementById('results');
const prevBtn = document.getElementById('prev-page');
const nextBtn = document.getElementById('next-page');
const pageLabel = document.getElementById('page-label');
const songPanel = document.getElementById('song-panel');
const selectedTitle = document.getElementById('selected-title');
const selectedMeta = document.getElementById('selected-meta');
const changeSongBtn = document.getElementById('change-song');
const sectionCheckboxes = document.getElementById('section-checkboxes');
const tabSection = document.getElementById('tab-section');
const tabTitle = document.getElementById('tab-title');
const tabSummary = document.getElementById('tab-summary');
const printTitle = document.getElementById('print-title');
const printMeta = document.getElementById('print-meta');
const printBtn = document.getElementById('print-charts');
const outChart = document.getElementById('out-chart');
const outKeyroll = document.getElementById('out-keyroll');
const chartSections = document.getElementById('chart-sections');
const keyrollSections = document.getElementById('keyroll-sections');
const searchBtn = document.getElementById('search-btn');
const targetKeySelect = document.getElementById('target-key');

const STEP = 0.25;

let currentPage = 1;
let hasMore = false;
let selectedSong = null;
let availableSections = [];
let lastTabData = null;
let transcribeTimer = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message || '';
  statusEl.classList.toggle('error', Boolean(isError));
}

function songKey(item) {
  const url = (item.url || '').split('#')[0];
  return `${item.artist || ''}||${item.song || ''}||${url}`;
}

function groupSongs(results) {
  const map = new Map();
  for (const item of results) {
    const key = songKey(item);
    if (!map.has(key)) {
      map.set(key, {
        artist: item.artist,
        song: item.song,
        url: (item.url || '').split('#')[0],
        key: item.key || null,
        sectionsSeen: [],
      });
    }
    const g = map.get(key);
    if (item.section) g.sectionsSeen.push(item.section);
    if (!g.key && item.key) g.key = item.key;
  }
  return [...map.values()];
}

function selectedOutput() {
  const el = document.querySelector('input[name="output"]:checked');
  return el ? el.value : 'chart';
}

function selectedSectionIds() {
  return [...sectionCheckboxes.querySelectorAll('input[name="section"]:checked')].map(
    (el) => el.value
  );
}

function selectedTargetKey() {
  return targetKeySelect.value || 'C/Am';
}

function chordRootModeOn() {
  const el = document.getElementById('chord-root-mode');
  return Boolean(el && el.checked);
}

function clearSelection({ keepStatus } = {}) {
  selectedSong = null;
  availableSections = [];
  lastTabData = null;
  songPanel.hidden = true;
  tabSection.hidden = true;
  sectionCheckboxes.innerHTML = '';
  if (!keepStatus) setStatus('');
}

function showSongList() {
  resultsSection.hidden = false;
  songPanel.hidden = true;
  tabSection.hidden = true;
}

async function search(page = 1) {
  const query = queryInput.value.trim();
  if (!query) return;

  currentPage = page;
  clearSelection({ keepStatus: true });
  setStatus('Searching TheoryTab…');
  searchBtn.disabled = true;
  resultsSection.hidden = true;

  try {
    const params = new URLSearchParams({
      q: query,
      page: String(page),
    });

    const res = await fetch(`/api/search?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');

    hasMore = Boolean(data.hasMore);
    const songs = groupSongs(data.results || []);
    renderSongList(songs);

    const totalBit = data.total != null ? ` · ${data.total} total hits` : '';
    pageLabel.textContent = `Page ${data.page}${totalBit}`;
    prevBtn.disabled = data.page <= 1;
    nextBtn.disabled = !hasMore;

    const label = `“${data.q || query}”`;
    resultsSection.hidden = false;
    if (!songs.length) {
      setStatus(`No songs found for ${label} on page ${data.page}.`);
    } else {
      setStatus(`Found ${songs.length} song${songs.length === 1 ? '' : 's'} for ${label}.`);
    }
  } catch (err) {
    setStatus(err.message || 'Search failed', true);
  } finally {
    searchBtn.disabled = false;
  }
}

function renderSongList(songs) {
  resultsEl.innerHTML = '';
  for (const item of songs) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'result-btn';
    const keyBit = item.key ? ` · ${escapeHtml(item.key)}` : '';
    btn.innerHTML = `
      <span class="title">${escapeHtml(item.song || 'Unknown')}</span>
      <span class="action">Select →</span>
      <span class="meta">${escapeHtml(item.artist || '')}${keyBit}</span>
    `;
    btn.addEventListener('click', () => selectSong(item));
    li.appendChild(btn);
    resultsEl.appendChild(li);
  }
}

async function selectSong(item) {
  selectedSong = item;
  resultsSection.hidden = true;
  songPanel.hidden = false;
  tabSection.hidden = true;
  selectedTitle.textContent = item.song || 'Song';
  if (item.url) {
    selectedTitle.href = item.url;
    selectedTitle.removeAttribute('aria-disabled');
    selectedTitle.title = 'Open on Hooktheory';
  } else {
    selectedTitle.removeAttribute('href');
    selectedTitle.setAttribute('aria-disabled', 'true');
    selectedTitle.title = '';
  }
  selectedMeta.textContent = item.artist || '';
  sectionCheckboxes.innerHTML = '<span class="muted">Loading sections…</span>';
  setStatus(`Loading sections for “${item.song}”…`);

  try {
    const res = await fetch('/api/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist: item.artist,
        song: item.song,
        url: item.url,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load sections');

    availableSections = data.sections || [];
    renderSectionCheckboxes(availableSections);
    setStatus(
      availableSections.length
        ? `Choose sections for “${item.song}”, then tablature will load.`
        : `No sections found for “${item.song}”.`,
      !availableSections.length
    );
    scheduleTranscribe();
  } catch (err) {
    sectionCheckboxes.innerHTML = '';
    setStatus(err.message || 'Failed to load sections', true);
  }
}

function renderSectionCheckboxes(sections) {
  sectionCheckboxes.innerHTML = '';
  if (!sections.length) {
    sectionCheckboxes.innerHTML =
      '<span class="muted">No sections available for this song.</span>';
    return;
  }

  const hasChorus = sections.some((s) => s.id === 'chorus');
  for (const sec of sections) {
    const checked = hasChorus
      ? sec.id === 'chorus'
      : sec.id === sections[0].id;
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = `<input type="checkbox" name="section" value="${escapeHtml(
      sec.id
    )}" ${checked ? 'checked' : ''} /> ${escapeHtml(sec.label || sec.id)}`;
    sectionCheckboxes.appendChild(label);
  }
}

function scheduleTranscribe() {
  clearTimeout(transcribeTimer);
  transcribeTimer = setTimeout(() => transcribeSelected(), 150);
}

async function transcribeSelected() {
  if (!selectedSong) return;
  const sections = selectedSectionIds();
  if (!sections.length) {
    tabSection.hidden = true;
    setStatus('Check at least one section to show tablature.', true);
    return;
  }

  setStatus(
    `Transcribing ${sections.length} section${sections.length === 1 ? '' : 's'}…`
  );

  try {
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artist: selectedSong.artist,
        song: selectedSong.song,
        url: selectedSong.url,
        sections,
        targetKey: selectedTargetKey(),
        chordRootMode: chordRootModeOn(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Transcription failed');

    lastTabData = data;
    renderTablature(data);
    const ok = (data.sections || []).filter((s) => s.tablature).length;
    const modeLabel = chordRootModeOn() ? 'chord roots' : 'melody';
    setStatus(
      `Ready — ${ok} section${ok === 1 ? '' : 's'} loaded (${modeLabel}).`
    );
  } catch (err) {
    setStatus(err.message || 'Transcription failed', true);
  }
}

function renderTablature(data) {
  const sections = (data.sections || []).filter((s) => s.tablature);
  const title = data.song || 'Song';
  const noteMode = data.chordRootMode ? 'Chord roots' : 'Melody';
  const bpm = sections.map((s) => s.bpm).find(Boolean);
  const bpmLabel = bpm ? `${bpm} BPM` : null;
  tabTitle.textContent = title;
  tabSummary.innerHTML =
    `<div class="summary-line"><strong>Source:</strong> ${escapeHtml(
      noteMode
    )}${bpmLabel ? ` · ${escapeHtml(bpmLabel)}` : ''}</div>` +
    sections
      .map(
        (s) =>
          `<div class="summary-line"><strong>${escapeHtml(
            s.label || s.section
          )}:</strong> ${escapeHtml(s.tablature.summary)}</div>`
      )
      .join('');

  printTitle.textContent = title;
  printMeta.textContent = [
    data.artist || null,
    noteMode,
    bpmLabel,
    sections.map((s) => s.label || s.section).join(', '),
    targetKeySelect.options[targetKeySelect.selectedIndex]
      ? targetKeySelect.options[targetKeySelect.selectedIndex].text
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const mode = selectedOutput();
  outChart.hidden = mode !== 'chart';
  outKeyroll.hidden = mode !== 'keyroll';

  if (mode === 'chart') {
    renderChartBySections(sections, data.chordRootMode);
  } else {
    renderKeyRollBySections(sections, data.chordRootMode);
  }

  tabSection.hidden = false;
}

function sectionHeading(sec, chordRootMode) {
  const isChords = Boolean(chordRootMode) || sec.noteMode === 'chord-roots';
  const bits = [
    sec.label || sec.section,
    isChords ? 'Chord roots' : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

function buildFingerChart(cells) {
  const scroll = document.createElement('div');
  scroll.className = 'tab-scroll';
  const linesWrap = document.createElement('div');
  linesWrap.className = 'tab-lines';
  const row = document.createElement('div');
  row.className = 'tab-row';
  row.setAttribute('aria-label', 'Finger chart');
  (cells || []).forEach((cell, i) => {
    row.appendChild(makeChartCell(cell, i));
  });
  linesWrap.appendChild(row);
  scroll.appendChild(linesWrap);
  return scroll;
}

function renderChartBySections(sections, chordRootMode) {
  chartSections.innerHTML = '';
  for (const sec of sections) {
    const block = document.createElement('div');
    block.className = 'section-block';
    block.innerHTML = `<h3 class="section-heading">${escapeHtml(
      sectionHeading(sec, chordRootMode)
    )}</h3>`;
    block.appendChild(buildFingerChart(sec.tablature.cells || []));
    chartSections.appendChild(block);
  }
}

function makeChartCell(cell, i) {
  const el = document.createElement('div');
  el.className = 'cell';
  el.style.animationDelay = `${Math.min(i, 40) * 12}ms`;
  if (cell.type === 'rest') {
    el.classList.add('rest');
    el.innerHTML = `
      <span class="name">rest</span>
      <span class="dur">${escapeHtml(cell.durationLabel || '')}</span>
      <span class="rest-mark">𝄽</span>
    `;
  } else {
    if (!cell.playable) el.classList.add('unplayable');
    const flag = !cell.playable ? 'out' : cell.overblow ? '↑' : '';
    el.innerHTML = `
      <span class="name">${escapeHtml(cell.name)}</span>
      <span class="dur">${escapeHtml(cell.durationLabel || '')}</span>
      <span class="flag">${flag}</span>
      ${fingeringSvg(cell.fingering)}
    `;
  }
  return el;
}

function estimateRollColsForWidth(widthPx, { labelPx = 54, colPx = 22, padPx = 28 } = {}) {
  return Math.max(4, Math.floor((Math.max(widthPx, 320) - labelPx - padPx) / colPx));
}

function rollColsBudget() {
  if (document.body.classList.contains('print-layout')) {
    // Letter printable width ≈ 8.5in − 0.8in margins
    return estimateRollColsForWidth((8.5 - 0.8) * 96);
  }
  const host = keyrollSections;
  const width = (host && host.clientWidth) || window.innerWidth || 900;
  return estimateRollColsForWidth(width);
}

function renderKeyRollBySections(sections, chordRootMode) {
  keyrollSections.innerHTML = '';
  const maxCols = rollColsBudget();
  for (const sec of sections) {
    const block = document.createElement('div');
    block.className = 'section-block';
    block.innerHTML = `<h3 class="section-heading">${escapeHtml(
      sectionHeading(sec, chordRootMode)
    )}</h3>`;

    const legendWrap = document.createElement('div');
    legendWrap.className = 'fingering-legend';
    legendWrap.setAttribute('aria-label', 'Fingering key');
    fillFingeringLegend(legendWrap, sec.tablature.cells || []);
    block.appendChild(legendWrap);

    const rollScroll = document.createElement('div');
    rollScroll.className = 'roll-scroll';
    fillPianoRollChunks(rollScroll, sec.tablature.cells || [], maxCols);
    block.appendChild(rollScroll);

    keyrollSections.appendChild(block);
  }
}

function fillFingeringLegend(container, cells) {
  const byMidi = new Map();
  for (const cell of cells) {
    if (cell.type !== 'note' || cell.midi == null) continue;
    if (!byMidi.has(cell.midi)) byMidi.set(cell.midi, cell);
  }
  const unique = [...byMidi.values()].sort((a, b) => a.midi - b.midi);
  container.innerHTML = '';
  if (!unique.length) {
    container.innerHTML = '<p class="empty-legend">No pitched notes.</p>';
    return;
  }
  for (const cell of unique) {
    const el = document.createElement('div');
    el.className = 'finger-card' + (cell.playable ? '' : ' unplayable');
    const flag = !cell.playable ? 'out' : cell.overblow ? '↑' : '';
    el.innerHTML = `
      <span class="name">${escapeHtml(cell.name)}</span>
      <span class="flag">${flag}</span>
      ${fingeringSvg(cell.fingering)}
    `;
    container.appendChild(el);
  }
}

function buildPianoRollModel(cells) {
  const events = [];
  let cursor = 0;
  for (const cell of cells) {
    const start =
      cell.beat != null && Number.isFinite(cell.beat) ? cell.beat : cursor;
    const dur = Number(cell.duration) > 0 ? Number(cell.duration) : STEP;
    if (cell.type === 'note' && cell.midi != null) {
      events.push({
        midi: cell.midi,
        name: cell.name,
        start,
        end: start + dur,
        playable: cell.playable,
        overblow: cell.overblow,
      });
    }
    cursor = start + dur;
  }

  if (!events.length) return null;

  const midis = [...new Set(events.map((e) => e.midi))].sort((a, b) => b - a);
  const nameByMidi = new Map(events.map((e) => [e.midi, e.name]));
  const endBeat = Math.max(...events.map((e) => e.end), STEP);
  const cols = Math.max(1, Math.ceil(endBeat / STEP - 1e-9));

  const occ = new Map();
  for (const midi of midis) occ.set(midi, Array(cols).fill(null));
  for (const ev of events) {
    const c0 = Math.max(0, Math.floor(ev.start / STEP + 1e-9));
    const c1 = Math.min(cols, Math.ceil(ev.end / STEP - 1e-9));
    const row = occ.get(ev.midi);
    for (let c = c0; c < c1; c++) row[c] = ev;
  }

  return { midis, nameByMidi, cols, occ };
}

function paintPianoRollSlice(pianoRoll, model, colStart, colCount) {
  const { midis, nameByMidi, occ } = model;
  const cols = Math.max(1, colCount);
  pianoRoll.innerHTML = '';
  pianoRoll.style.setProperty('--roll-cols', String(cols));
  pianoRoll.style.setProperty('--roll-rows', String(midis.length));

  const corner = document.createElement('div');
  corner.className = 'roll-corner';
  corner.textContent = 'Note';
  corner.style.gridColumn = '1';
  corner.style.gridRow = '1';
  pianoRoll.appendChild(corner);

  for (let c = 0; c < cols; c++) {
    const head = document.createElement('div');
    head.className = 'roll-colhead';
    head.style.gridColumn = String(c + 2);
    head.style.gridRow = '1';
    const beat = (colStart + c) * STEP;
    if (Math.abs(beat - Math.round(beat)) < 1e-6) {
      head.textContent = String(Math.round(beat) + 1);
      head.classList.add('beat');
    }
    pianoRoll.appendChild(head);
  }

  midis.forEach((midi, rowIdx) => {
    const gridRow = String(rowIdx + 2);
    const label = document.createElement('div');
    label.className = 'roll-label';
    label.textContent = nameByMidi.get(midi) || String(midi);
    label.style.gridColumn = '1';
    label.style.gridRow = gridRow;
    pianoRoll.appendChild(label);

    const row = occ.get(midi);
    let c = 0;
    while (c < cols) {
      const abs = colStart + c;
      const ev = row[abs];
      if (!ev) {
        const empty = document.createElement('div');
        empty.className = 'roll-cell empty';
        empty.style.gridColumn = String(c + 2);
        empty.style.gridRow = gridRow;
        pianoRoll.appendChild(empty);
        c += 1;
        continue;
      }
      let span = 1;
      while (c + span < cols && row[colStart + c + span] === ev) span += 1;
      const block = document.createElement('div');
      block.className =
        'roll-cell note' +
        (ev.playable === false ? ' unplayable' : '') +
        (ev.overblow ? ' overblow' : '');
      block.style.gridColumn = `${c + 2} / span ${span}`;
      block.style.gridRow = gridRow;
      block.title = `${ev.name}${ev.overblow ? ' ↑' : ''}`;
      block.innerHTML = `<span class="roll-note-name">${escapeHtml(ev.name)}${
        ev.overblow ? ' ↑' : ''
      }</span>`;
      pianoRoll.appendChild(block);
      c += span;
    }
  });
}

function fillPianoRollChunks(host, cells, maxCols) {
  host.innerHTML = '';
  const model = buildPianoRollModel(cells);
  if (!model) {
    host.innerHTML = '<p class="empty-legend">Nothing to show in the roll.</p>';
    return;
  }

  const chunkSize = Math.max(1, Math.min(maxCols || model.cols, model.cols));
  for (let start = 0; start < model.cols; start += chunkSize) {
    const chunk = document.createElement('div');
    chunk.className = 'piano-roll-chunk';
    const roll = document.createElement('div');
    roll.className = 'piano-roll';
    paintPianoRollSlice(
      roll,
      model,
      start,
      Math.min(chunkSize, model.cols - start)
    );
    chunk.appendChild(roll);
    host.appendChild(chunk);
  }
}

function fingeringSvg(holes) {
  if (!holes || !holes.length) {
    return `<div class="holes" title="No fingering">${[0, 0, 0, 0, 0, 0]
      .map(() => `<span class="hole" style="opacity:0.2"></span>`)
      .join('')}</div>`;
  }
  const parts = holes.map((h) => {
    if (h === 1) return '<span class="hole covered"></span>';
    if (h === 0.5) return '<span class="hole half"></span>';
    return '<span class="hole"></span>';
  });
  return `<div class="holes" aria-hidden="true">${parts.join('')}</div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function populateTargetKeys(keys, defaultId) {
  if (!Array.isArray(keys) || !keys.length) return;
  const current = targetKeySelect.value || defaultId || 'C/Am';
  targetKeySelect.innerHTML = '';
  for (const key of keys) {
    const opt = document.createElement('option');
    opt.value = key.id;
    opt.textContent = key.label;
    targetKeySelect.appendChild(opt);
  }
  targetKeySelect.value = keys.some((k) => k.id === current)
    ? current
    : defaultId || keys[0].id;
}

changeSongBtn.addEventListener('click', () => {
  clearSelection();
  showSongList();
  setStatus('Pick another song from the list.');
});

printBtn.addEventListener('click', () => {
  document.body.classList.add('print-layout');
  if (lastTabData && selectedOutput() === 'keyroll') {
    renderTablature(lastTabData);
  }
  requestAnimationFrame(() => window.print());
});

window.addEventListener('beforeprint', () => {
  document.body.classList.add('print-layout');
  if (lastTabData && selectedOutput() === 'keyroll') {
    renderTablature(lastTabData);
  }
});

window.addEventListener('afterprint', () => {
  document.body.classList.remove('print-layout');
  if (lastTabData && selectedOutput() === 'keyroll') {
    renderTablature(lastTabData);
  }
});

sectionCheckboxes.addEventListener('change', () => scheduleTranscribe());

document.getElementById('output-filters').addEventListener('change', (e) => {
  if (e.target && e.target.id === 'chord-root-mode') {
    if (selectedSong) scheduleTranscribe();
    return;
  }
  if (lastTabData) renderTablature(lastTabData);
});

targetKeySelect.addEventListener('change', () => {
  if (selectedSong) scheduleTranscribe();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  search(1);
});

prevBtn.addEventListener('click', () => {
  if (currentPage > 1) search(currentPage - 1);
});

nextBtn.addEventListener('click', () => {
  if (hasMore) search(currentPage + 1);
});

fetch('/api/health')
  .then((r) => r.json())
  .then((h) => {
    populateTargetKeys(h.targetKeys, h.defaultTargetKey);
  })
  .catch(() => {});

# Hookbook

Search [Hooktheory](https://www.hooktheory.com) by song or artist, download a TheoryTab melody, transpose it for a **C tin whistle**, and read **finger-chart tablature**.

## Setup

1. Install dependencies:

```bash
npm install
cp .env.example .env
```

2. Start the server:

```bash
npm start
```

3. Open [http://localhost:3000](http://localhost:3000).

Optional: set `PORT` in `.env` (default `3000`).

## How to search

Type a song or artist name (e.g. `Adele`, `Someone Like You`). Search uses TheoryTab’s public Meilisearch endpoint.

### After you pick a song

The song list hides. Below it you get:

- **Sections** — checkboxes for sections available on that TheoryTab (Chorus checked by default when present)
- **Output** — **Finger chart**, **Fingering key + piano-roll**, and optional **Chord root notes**

Each selected section is rendered separately with a clear heading. Click the song title to open its Hooktheory page.

### Print

**Print charts** uses US Letter and fills the page width. Charts wrap at the right edge; long sections can span multiple pages.

## What happens when you pick a song

1. For the chosen TheoryTab URL, the server resolves section ids and downloads melody JSON/XML.
2. Scale-degree notes are converted to MIDI, then transposed to the key chosen in **Transpose to** (default **C Major / A Minor** — major songs → C, minor songs → A), with octave chosen to fit the C whistle range (**C4–C6**).
3. The page shows a finger chart: six holes (mouthpiece at top), note names, and duration hints.

## Scripts

| Command | Description |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with Node `--watch` |

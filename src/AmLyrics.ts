import { html, css, LitElement } from 'lit';
import { property, state, query } from 'lit/decorators.js';
import { GoogleService } from './GoogleService.js';

const VERSION = '0.6.5';
const INSTRUMENTAL_THRESHOLD_MS = 3000; // Show ellipsis for gaps >= 3s

const KPOE_SERVERS = [
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyrics-plus-backend.vercel.app',
  'https://lyricsplus.onrender.com',
  'https://lyricsplus.prjktla.online',
];
const DEFAULT_KPOE_SOURCE_ORDER =
  'apple,lyricsplus,musixmatch,spotify,musixmatch-word';

interface Syllable {
  text: string;
  part: boolean;
  timestamp: number;
  endtime: number;
  romanizedText?: string;
}

interface LyricsLine {
  text: Syllable[];
  background: boolean;
  backgroundText: Syllable[];
  oppositeTurn: boolean;
  timestamp: number;
  endtime: number;
  isWordSynced?: boolean;
  alignment?: 'start' | 'end';
  songPart?: string;
  romanizedText?: string;
  translation?: string;
}

interface SongMetadata {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
}

interface SongCatalogResult {
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  id?: {
    appleMusic?: string;
    [key: string]: unknown;
  };
  isrc?: string;
}

interface ParsedQueryMetadata {
  title?: string;
  artist?: string;
  album?: string;
}

interface YouLyPlusLyricsResult {
  lines: LyricsLine[];
  source?: string;
}

interface ResolvedMetadata {
  metadata?: SongMetadata;
  appleId?: string;
  appleSong?: any;
  catalogIsrc?: string;
}

export class AmLyrics extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family:
        -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu,
        Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      background: transparent;
      height: 100%;
      overflow: hidden; /* Ensure the host doesn't show scrollbars */
    }

    .lyrics-container {
      padding: 20px;
      border-radius: 8px;
      background-color: transparent;
      width: 100%;
      height: 100%;
      max-height: 100vh; /* Ensure it doesn't exceed viewport height */
      overflow-y: auto;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch; /* iOS smooth scrolling */
      box-sizing: border-box; /* Include padding in height calculation */
    }

    .lyrics-line {
      margin: 10px 0;
      padding: 10px;
      border-radius: 5px;
      transition: all 0.3s ease-in-out;
      text-align: left; /* Default to left */
      cursor: pointer;
      position: relative;
      font-size: 2em; /* Increased font size */
      color: #888; /* Default text color to gray */
      word-wrap: break-word;
      overflow-wrap: break-word;
      display: flex;
      flex-direction: column; /* Allow reordering of main and background text */
      line-height: 1.2; /* Tighten line height to reduce gaps */
      gap: 2px; /* Small consistent gap between main and background text */
      /* Performance optimizations */
      contain: layout style paint;
      transform: translate3d(0, 0, 0);
    }

    .lyrics-line > span {
      flex-shrink: 0; /* Prevent the main text span from shrinking */
      margin: 0; /* Remove default margins */
    }

    .lyrics-line:hover {
      background-color: var(
        --am-lyrics-hover-background,
        var(--hover-background-color, #f0f0f0)
      );
    }

    .opposite-turn {
      text-align: right; /* Opposite is right */
    }

    .active-line {
      font-weight: bold;
      /* No background color needed, just boldness */
    }

    .progress-text {
      position: relative;
      display: inline-block;
      /* Use background gradient for highlighting instead of pseudo-element */
      background: linear-gradient(
        to right,
        var(--am-lyrics-highlight-color, var(--highlight-color, #000)) 0%,
        var(--am-lyrics-highlight-color, var(--highlight-color, #000))
          var(--line-progress, 0%),
        #888 var(--line-progress, 0%),
        #888 100%
      );
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      /* Fallback for browsers that don't support background-clip: text */
      color: #888;
      /* white-space: pre-wrap; */
      /* Performance optimizations */
      transform: translate3d(0, 0, 0);
      will-change: background-size;
    }

    .progress-text::before {
      /* Remove the pseudo-element approach entirely */
      display: none;
    }

    .active-word {
      /* No longer needed for highlighting, but keeping for potential future use */
    }

    span {
      transition:
        color 0.2s ease-in-out,
        text-decoration 0.2s ease-in-out;
    }

    .background-text {
      display: block;
      color: rgba(136, 136, 136, 0.8);
      font-size: 0.8em; /* a bit smaller than main line */
      font-style: normal; /* no italics */
      margin: 0; /* Remove margins - use flexbox gap instead */
      flex-shrink: 0; /* Prevent shrinking */
      line-height: 1.1; /* Slightly tighter line height for background text */
    }

    .background-text.before {
      order: -1; /* Place before main text when background starts earlier */
    }

    .background-text.after {
      order: 1; /* Place after main text when background starts later */
    }
    .progress-text:last-child {
      margin-right: 0 !important; /* Remove margin for the last word */
    }

    .lyrics-footer {
      text-align: left;
      font-size: 0.8em;
      color: #888;
      padding: 10px 0;
      border-top: 1px solid #eee;
      margin-top: 10px;
    }

    .lyrics-footer p {
      margin: 5px 0;
    }

    .lyrics-footer a {
      color: #555;
      text-decoration: none;
    }

    .lyrics-footer a:hover {
      text-decoration: underline;
    }

    .lyrics-header .download-button {
      background: none;
      border: none;
      cursor: pointer;
      color: #888;
      padding: 0;
      margin-left: 10px;
      vertical-align: middle;
      display: inline-flex;
      align-items: center;
    }

    .lyrics-header .download-button:hover {
      color: #555;
    }

    .lyrics-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
    }

    .footer-content {
      display: flex;
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
    }

    .footer-controls {
      display: flex;
      align-items: center;
    }

    /* Instrumental indicator */
    .instrumental-line {
      display: inline-flex;
      align-items: baseline;
      gap: 8px;
      color: #aaa;
      font-size: 0.9em;
      padding: 4px 10px;
      animation: instrumentalIn 220ms ease;
    }
    @keyframes instrumentalIn {
      from {
        opacity: 0;
        transform: translateY(-6px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    .instrumental-duration {
      color: #aaa;
      font-size: 0.8em;
    }

    .singer-right {
      text-align: right;
      justify-content: flex-end;
    }

    .singer-left {
      text-align: left;
      justify-content: flex-start;
    }

    /* Skeleton Loading */
    @keyframes skeleton-loading {
      0% {
        background-color: hsl(200, 20%, 80%);
      }
      100% {
        background-color: hsl(200, 20%, 95%);
      }
    }

    .skeleton-line {
      height: 2.5em; /* Taller to match lyrics */
      margin: 20px 0; /* More spacing */
      border-radius: 8px;
      animation: skeleton-loading 1s linear infinite alternate;
      opacity: 0.7;
      width: 60%; /* Default width */
    }

    /* Varying widths for more natural look */
    .skeleton-line:nth-child(even) {
      width: 80%;
    }
    .skeleton-line:nth-child(3n) {
      width: 50%;
    }
    .skeleton-line:nth-child(5n) {
      width: 70%;
    }

    .format-select {
      background: transparent;
      border: 1px solid #ccc;
      border-radius: 4px;
      color: #888;
      font-size: 0.8em;
      margin-left: 10px;
      padding: 2px 5px;
      cursor: pointer;
    }

    .format-select:hover {
      color: #555;
      border-color: #aaa;
    }

    .lyrics-header {
      display: flex;
      padding: 10px 0;
      margin-bottom: 10px;
      gap: 10px;
      justify-content: space-between;
      align-items: center;
    }

    .header-controls {
      display: flex;
      gap: 8px;
    }

    .download-controls {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .control-button {
      background: transparent;
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 0.8em;
      color: #888;
      cursor: pointer;
      transition: all 0.2s;
    }

    .control-button:hover {
      color: #555;
      border-color: #aaa;
    }

    .control-button.active {
      background-color: var(--am-lyrics-highlight-color, #000);
      border-color: var(--am-lyrics-highlight-color, #000);
      color: #fff;
    }

    .main-line-wrapper.small {
      font-size: 0.5em; /* 50% size when translation is active */
      opacity: 0.8;
      display: block;
      margin-bottom: 0px; /* Reduced from 4px */
    }

    .translation-line {
      font-size: 1em; /* Normal size (relative to container font-size) */
      font-weight: bold; /* Bold like active line usually is */
      display: block;
      margin-top: 0px; /* Reduced from 4px */
      line-height: 1.1;
    }

    .romanized-line {
      font-size: 0.5em;
      color: #aaa;
      display: block;
      margin-top: 2px;
    }
  `;

  @property({ type: String })
  query?: string;

  @property({ type: String })
  musicId?: string;

  @property({ type: String })
  isrc?: string;

  @property({ type: String, attribute: 'song-title' })
  songTitle?: string;

  @state()
  private downloadFormat: 'auto' | 'lrc' | 'ttml' = 'auto';

  @property({ type: String, attribute: 'song-artist' })
  songArtist?: string;

  @property({ type: String, attribute: 'song-album' })
  songAlbum?: string;

  @property({ type: Number, attribute: 'song-duration' })
  songDurationMs?: number;

  @property({ type: String, attribute: 'highlight-color' })
  highlightColor = '#000';

  @property({ type: String, attribute: 'hover-background-color' })
  hoverBackgroundColor = '#f0f0f0';

  @property({ type: String, attribute: 'font-family' })
  fontFamily?: string;

  @property({ type: Boolean })
  autoScroll = true;

  @property({ type: Boolean })
  interpolate = true;

  @state()
  private showRomanization = false;

  @state()
  private showTranslation = false;

  private async toggleRomanization() {
    this.showRomanization = !this.showRomanization;
    await this.applyRomanization();
  }

  private async applyRomanization() {
    if (this.showRomanization && this.lyrics) {
      const needsRomanization = this.lyrics.some(
        l =>
          !l.romanizedText && (!l.text || !l.text.some(s => s.romanizedText)),
      );

      if (needsRomanization) {
        this.isLoading = true;
        try {
          const romanizedLines = await GoogleService.romanize(this.lyrics);
          this.lyrics = romanizedLines;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('Romanization failed', e);
        } finally {
          this.isLoading = false;
        }
      }
    }
  }

  private async toggleTranslation() {
    this.showTranslation = !this.showTranslation;
    await this.applyTranslation();
  }

  private async applyTranslation() {
    if (this.showTranslation && this.lyrics) {
      const needsTranslation = this.lyrics.some(l => !l.translation);
      if (needsTranslation) {
        this.isLoading = true;
        try {
          // Prepare batch: extract text from all lines
          const textToTranslate = this.lyrics.map(line => {
            if (line.translation) return '';
            return line.text.map(s => s.text).join('');
          });

          // If all are empty, skip
          if (textToTranslate.every(t => !t)) {
            this.isLoading = false;
            return;
          }

          const result = await GoogleService.translate(textToTranslate, 'en');
          const translations = Array.isArray(result) ? result : [result];

          const newLyrics = this.lyrics.map((line, index) => {
            if (line.translation) return line;
            return {
              ...line,
              translation: translations[index] || undefined,
            };
          });

          this.lyrics = newLyrics;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('Translation failed', e);
        } finally {
          this.isLoading = false;
        }
      }
    }
  }

  @property({ type: Number })
  duration?: number;

  @property({ type: Number })
  currentTime = 0;

  @state()
  private isLoading = false;

  @state()
  private lyrics?: LyricsLine[];

  @state()
  private activeLineIndices: number[] = [];

  @state()
  private activeMainWordIndices: Map<number, number> = new Map();

  @state()
  private activeBackgroundWordIndices: Map<number, number> = new Map();

  @state()
  private mainWordProgress: Map<number, number> = new Map();

  @state()
  private backgroundWordProgress: Map<number, number> = new Map();

  @state()
  private lyricsSource: string | null = null;

  private animationFrameId?: number;

  private mainWordAnimations: Map<
    number,
    { startTime: number; duration: number }
  > = new Map();

  private backgroundWordAnimations: Map<
    number,
    { startTime: number; duration: number }
  > = new Map();

  @query('.lyrics-container')
  private lyricsContainer?: HTMLElement;

  private lastInstrumentalIndex: number | null = null;

  private userScrollTimeoutId?: number;

  @state()
  private isUserScrolling = false;

  private isProgrammaticScroll = false;

  connectedCallback() {
    super.connectedCallback();
    this.fetchLyrics();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
    }
  }

  private async fetchLyrics() {
    this.isLoading = true;
    this.lyrics = undefined;
    this.lyricsSource = null;
    try {
      const resolvedMetadata = await this.resolveSongMetadata();

      const isMusicIdOnlyRequest =
        Boolean(this.musicId) &&
        !this.songTitle &&
        !this.songArtist &&
        !this.query;

      if (resolvedMetadata?.metadata && !isMusicIdOnlyRequest) {
        const youLyResult = await AmLyrics.fetchLyricsFromYouLyPlus(
          resolvedMetadata.metadata,
        );

        if (youLyResult && youLyResult.lines.length > 0) {
          this.lyrics = youLyResult.lines;
          this.lyricsSource = youLyResult.source ?? 'LyricsPlus (KPoe)';
          await this.onLyricsLoaded();
          return;
        }
      }

      this.lyrics = undefined;
      this.lyricsSource = null;
    } finally {
      this.isLoading = false;
    }
  }

  private async onLyricsLoaded() {
    this.activeLineIndices = [];
    this.activeMainWordIndices.clear();
    this.activeBackgroundWordIndices.clear();
    this.mainWordProgress.clear();
    this.backgroundWordProgress.clear();
    this.mainWordAnimations.clear();
    this.backgroundWordAnimations.clear();

    if (this.lyricsContainer) {
      this.isProgrammaticScroll = true;
      this.lyricsContainer.scrollTop = 0;
      window.setTimeout(() => {
        this.isProgrammaticScroll = false;
      }, 100);
    }

    await this.autoProcessLyrics();
  }

  private async autoProcessLyrics() {
    if (this.showRomanization) {
      await this.applyRomanization();
    }
    if (this.showTranslation) {
      await this.applyTranslation();
    }
  }

  private async resolveSongMetadata(): Promise<ResolvedMetadata> {
    const metadata: SongMetadata = {
      title: this.songTitle?.trim() ?? '',
      artist: this.songArtist?.trim() ?? '',
      album: this.songAlbum?.trim() || undefined,
      durationMs: undefined,
    };

    if (typeof this.songDurationMs === 'number' && this.songDurationMs > 0) {
      metadata.durationMs = this.songDurationMs;
    } else if (typeof this.duration === 'number' && this.duration > 0) {
      metadata.durationMs = this.duration;
    }

    const appleSong: any = null;
    let appleId = this.musicId;
    let catalogIsrc: string | undefined;

    if (
      this.query &&
      (!metadata.title || !metadata.artist || !metadata.album)
    ) {
      const parsed = AmLyrics.parseQueryMetadata(this.query);
      if (parsed) {
        if (!metadata.title && parsed.title) {
          metadata.title = parsed.title;
        }
        if (!metadata.artist && parsed.artist) {
          metadata.artist = parsed.artist;
        }
        if (!metadata.album && parsed.album) {
          metadata.album = parsed.album;
        }
      }
    }

    let catalogResult: SongCatalogResult | null = null;

    if (this.query && (!metadata.title || !metadata.artist)) {
      catalogResult = await AmLyrics.searchLyricsPlusCatalog(this.query);

      if (catalogResult) {
        if (!metadata.title && catalogResult.title) {
          metadata.title = catalogResult.title;
        }
        if (!metadata.artist && catalogResult.artist) {
          metadata.artist = catalogResult.artist;
        }
        if (!metadata.album && catalogResult.album) {
          metadata.album = catalogResult.album;
        }
        if (
          metadata.durationMs == null &&
          typeof catalogResult.durationMs === 'number' &&
          catalogResult.durationMs > 0
        ) {
          metadata.durationMs = catalogResult.durationMs;
        }

        if (!appleId && catalogResult.id?.appleMusic) {
          appleId = catalogResult.id.appleMusic;
        }

        if (!catalogIsrc && catalogResult.isrc) {
          catalogIsrc = catalogResult.isrc;
        }
      }
    }

    const trimmedTitle = metadata.title?.trim() ?? '';
    const trimmedArtist = metadata.artist?.trim() ?? '';
    const trimmedAlbum = metadata.album?.trim();
    const sanitizedDuration =
      typeof metadata.durationMs === 'number' &&
      Number.isFinite(metadata.durationMs) &&
      metadata.durationMs > 0
        ? Math.round(metadata.durationMs)
        : undefined;

    const finalMetadata =
      trimmedTitle && trimmedArtist
        ? {
            title: trimmedTitle,
            artist: trimmedArtist,
            album: trimmedAlbum || undefined,
            durationMs: sanitizedDuration,
          }
        : undefined;

    return {
      metadata: finalMetadata,
      appleId,
      appleSong,
      catalogIsrc,
    };
  }

  private static parseQueryMetadata(
    rawQuery: string,
  ): ParsedQueryMetadata | null {
    const trimmed = rawQuery?.trim();
    if (!trimmed) return null;

    const result: ParsedQueryMetadata = {};

    const hyphenSplit = trimmed.split(/\s[-–—]\s/);
    if (hyphenSplit.length >= 2) {
      const [rawTitle, ...rest] = hyphenSplit;
      const rawArtist = rest.join(' - ');
      const titleCandidate = rawTitle.trim();
      const artistCandidate = rawArtist.trim();
      if (titleCandidate && artistCandidate) {
        result.title = titleCandidate;
        result.artist = artistCandidate;
        return result;
      }
    }

    const bySplit = trimmed.split(/\s+[bB]y\s+/);
    if (bySplit.length === 2) {
      const [maybeTitle, maybeArtist] = bySplit.map(part => part.trim());
      if (maybeTitle && maybeArtist) {
        result.title = maybeTitle;
        result.artist = maybeArtist;
        return result;
      }
    }

    return null;
  }

  private static async searchLyricsPlusCatalog(
    searchTerm: string,
  ): Promise<SongCatalogResult | null> {
    const trimmedQuery = searchTerm?.trim();
    if (!trimmedQuery) return null;

    for (const base of KPOE_SERVERS) {
      const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
      const url = `${normalizedBase}/v1/songlist/search?q=${encodeURIComponent(
        trimmedQuery,
      )}`;

      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(url);
        if (response.ok) {
          // eslint-disable-next-line no-await-in-loop
          const payload = await response.json();
          let results: SongCatalogResult[] = [];

          const typedPayload = payload as {
            results?: SongCatalogResult[];
          } | null;

          if (Array.isArray(typedPayload?.results)) {
            results = typedPayload.results as SongCatalogResult[];
          } else if (Array.isArray(payload)) {
            results = payload as SongCatalogResult[];
          }

          if (results.length > 0) {
            const primary = results.find(
              (item: SongCatalogResult) => item?.id && item.id.appleMusic,
            );
            return (primary ?? results[0]) as SongCatalogResult;
          }
        }
      } catch (error) {
        // Ignore and try next server
      }
    }

    return null;
  }

  private static async fetchLyricsFromYouLyPlus(
    metadata: SongMetadata,
  ): Promise<YouLyPlusLyricsResult | null> {
    const title = metadata.title?.trim();
    const artist = metadata.artist?.trim();

    if (!title || !artist) {
      return null;
    }

    const params = new URLSearchParams({ title, artist });

    if (metadata.album) {
      params.append('album', metadata.album);
    }

    if (metadata.durationMs && metadata.durationMs > 0) {
      params.append(
        'duration',
        Math.round(metadata.durationMs / 1000).toString(),
      );
    }

    params.append('source', DEFAULT_KPOE_SOURCE_ORDER);

    let fallbackResult: YouLyPlusLyricsResult | null = null;

    for (const base of KPOE_SERVERS) {
      const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
      const url = `${normalizedBase}/v2/lyrics/get?${params.toString()}`;

      let payload: any = null;

      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(url);
        if (response.ok) {
          // eslint-disable-next-line no-await-in-loop
          payload = await response.json();
        }
      } catch (error) {
        payload = null;
      }

      if (payload) {
        const lines = AmLyrics.convertKPoeLyrics(payload);
        if (lines && lines.length > 0) {
          const sourceLabel =
            payload?.metadata?.source ||
            payload?.metadata?.provider ||
            'LyricsPlus (KPoe)';

          const result = { lines, source: sourceLabel };

          // If source is Apple, return immediately (best quality)
          if (sourceLabel.toLowerCase() === 'apple') {
            return result;
          }

          // Otherwise, store as fallback if we don't have one yet
          if (!fallbackResult) {
            fallbackResult = result;
          }
        }
      }
    }

    return fallbackResult;
  }

  private static convertKPoeLyrics(payload: any): LyricsLine[] | null {
    if (!payload) {
      return null;
    }

    let rawLyrics: any[] | null = null;
    if (Array.isArray(payload?.lyrics)) {
      rawLyrics = payload.lyrics;
    } else if (Array.isArray(payload?.data?.lyrics)) {
      rawLyrics = payload.data.lyrics;
    } else if (Array.isArray(payload?.data)) {
      rawLyrics = payload.data;
    }

    if (!rawLyrics || rawLyrics.length === 0) {
      return null;
    }

    const sanitizedEntries = rawLyrics.filter((item: any) => Boolean(item));
    const lines: LyricsLine[] = [];

    const isLineType = payload.type === 'Line';

    // Convert metadata.agents to alignment map
    const agents = payload.metadata?.agents ?? {};
    const agentEntries = Object.entries(agents);
    const singerAlignmentMap: Record<string, 'start' | 'end'> = {};

    if (agentEntries.length > 0) {
      agentEntries.sort((a, b) => a[0].localeCompare(b[0]));

      const personAgents = agentEntries.filter(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ([_, agentData]: [string, any]) => agentData.type === 'person',
      );
      const personIndexMap = new Map();
      personAgents.forEach(([agentKey], personIndex) => {
        personIndexMap.set(agentKey, personIndex);
      });

      agentEntries.forEach(([agentKey, agentData]: [string, any]) => {
        if (agentData.type === 'group') {
          singerAlignmentMap[agentKey] = 'start';
        } else if (agentData.type === 'other') {
          singerAlignmentMap[agentKey] = 'end';
        } else if (agentData.type === 'person') {
          const personIndex = personIndexMap.get(agentKey);
          if (personIndex !== undefined) {
            singerAlignmentMap[agentKey] =
              personIndex % 2 === 0 ? 'start' : 'end';
          }
        }
      });
    }

    for (const entry of sanitizedEntries) {
      const start = Number(entry.time);
      const duration = Number(entry.duration);

      // Determine alignment
      let alignment: 'start' | 'end' | undefined;
      const singerId = entry.element?.singer;
      if (singerId && singerAlignmentMap[singerId]) {
        alignment = singerAlignmentMap[singerId];
      }
      const lineText = typeof entry.text === 'string' ? entry.text : '';
      const lineStart = AmLyrics.toMilliseconds(entry.time);
      const lineDuration = AmLyrics.toMilliseconds(entry.duration);
      const explicitEnd = AmLyrics.toMilliseconds(entry.endTime);
      const lineEnd = explicitEnd || lineStart + (lineDuration || 0);

      const syllabus = Array.isArray(entry.syllabus)
        ? entry.syllabus.filter((s: any) => Boolean(s))
        : [];
      const mainSyllables: Syllable[] = [];
      const backgroundSyllables: Syllable[] = [];

      if (!isLineType && syllabus.length > 0) {
        for (const syl of syllabus) {
          const sylStart = AmLyrics.toMilliseconds(syl.time, lineStart);
          const sylDuration = AmLyrics.toMilliseconds(syl.duration);
          const sylEnd = sylDuration > 0 ? sylStart + sylDuration : lineEnd;
          const syllable: Syllable = {
            text: typeof syl.text === 'string' ? syl.text : '',
            part: Boolean(syl.part),
            timestamp: sylStart,
            endtime: sylEnd,
          };

          if (syl.isBackground) {
            backgroundSyllables.push(syllable);
          } else {
            mainSyllables.push(syllable);
          }
        }
      }

      if (mainSyllables.length === 0 && lineText) {
        mainSyllables.push({
          text: lineText,
          part: false,
          timestamp: lineStart,
          endtime: lineEnd || lineStart,
        });
      }

      const hasWordSync =
        mainSyllables.length > 0 || backgroundSyllables.length > 0;

      const { transliteration } = entry;
      let romanizedTextFromPayload: string | undefined;

      if (transliteration) {
        romanizedTextFromPayload = transliteration.text;
        // If syllabus data matches, map it to main syllables
        if (
          Array.isArray(transliteration.syllabus) &&
          transliteration.syllabus.length === mainSyllables.length
        ) {
          transliteration.syllabus.forEach((s: any, i: number) => {
            if (mainSyllables[i]) {
              mainSyllables[i].romanizedText = s.text;
            }
          });
        }
      }

      const lineResult: LyricsLine = {
        text: mainSyllables,
        background: backgroundSyllables.length > 0,
        backgroundText: backgroundSyllables,
        oppositeTurn: Array.isArray(entry.element)
          ? entry.element.includes('opposite') ||
            entry.element.includes('right')
          : false,
        timestamp: lineStart,
        endtime: start + duration,
        isWordSynced: isLineType ? false : hasWordSync,
        alignment,
        songPart: entry.element?.songPart,
        romanizedText: romanizedTextFromPayload,
      };

      lines.push(lineResult);
    }

    return lines;
  }

  private static toMilliseconds(value: unknown, fallback = 0): number {
    const num = Number(value);
    if (!Number.isFinite(num) || Number.isNaN(num)) {
      return fallback;
    }

    if (!Number.isInteger(num)) {
      return Math.round(num * 1000);
    }

    return Math.max(0, Math.round(num));
  }

  firstUpdated() {
    // Set up scroll event listener for user scroll detection
    if (this.lyricsContainer) {
      this.lyricsContainer.addEventListener(
        'scroll',
        this.handleUserScroll.bind(this),
        { passive: true },
      );
    }
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    // Handle duration reset (-1 stops playback and resets currentTime to 0)
    if (changedProperties.has('duration') && this.duration === -1) {
      this.currentTime = 0;
      this.activeLineIndices = [];
      this.activeMainWordIndices.clear();
      this.activeBackgroundWordIndices.clear();
      this.mainWordProgress.clear();
      this.backgroundWordProgress.clear();
      this.mainWordAnimations.clear();
      this.backgroundWordAnimations.clear();
      this.isUserScrolling = false;

      // Cancel any running animations
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = undefined;
      }

      // Clear user scroll timeout
      if (this.userScrollTimeoutId) {
        clearTimeout(this.userScrollTimeoutId);
        this.userScrollTimeoutId = undefined;
      }

      // Scroll to top
      if (this.lyricsContainer) {
        this.lyricsContainer.scrollTop = 0;
      }

      return; // Exit early, don't process other changes
    }

    if (
      (changedProperties.has('query') ||
        changedProperties.has('musicId') ||
        changedProperties.has('isrc') ||
        changedProperties.has('songTitle') ||
        changedProperties.has('songArtist') ||
        changedProperties.has('songAlbum') ||
        changedProperties.has('songDurationMs')) &&
      !changedProperties.has('currentTime')
    ) {
      this.fetchLyrics();
    }

    if (changedProperties.has('currentTime') && this.lyrics) {
      const oldTime = (changedProperties.get('currentTime') as number) ?? 0;
      const timeDiff = Math.abs(this.currentTime - oldTime);

      const newActiveLines = this.findActiveLineIndices(this.currentTime);

      // Reset animation if active lines change or if we skip time.
      // A threshold of 0.5s (500ms) is used to detect a "skip".
      const linesChanged = !AmLyrics.arraysEqual(
        newActiveLines,
        this.activeLineIndices,
      );
      if (linesChanged || timeDiff > 0.5) {
        this.startAnimationFromTime(this.currentTime);
      }
      // For small, continuous updates, we do nothing and let the animation loop handle it.
    }

    if (
      this.autoScroll &&
      !this.isUserScrolling &&
      changedProperties.has('activeLineIndices') &&
      this.activeLineIndices.length > 0
    ) {
      this.scrollToActiveLine();
    }

    // Smoothly scroll to the indicator when entering a gap
    const instrumental = this.findInstrumentalGapAt(this.currentTime);
    const idx = instrumental ? instrumental.insertBeforeIndex : null;
    if (this.autoScroll && !this.isUserScrolling) {
      if (idx !== null && idx !== this.lastInstrumentalIndex) {
        this.scrollToInstrumental(idx);
        this.lastInstrumentalIndex = idx;
      } else if (idx === null && this.lastInstrumentalIndex !== null) {
        // Gap ended — gently scroll to the line that begins now
        this.scrollToInstrumental(this.lastInstrumentalIndex);
        this.lastInstrumentalIndex = null;
      }
    }
  }

  private static arraysEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((val, i) => val === b[i]);
  }

  private handleUserScroll() {
    // Ignore programmatic scrolls
    if (this.isProgrammaticScroll) {
      return;
    }

    // Mark that user is currently scrolling
    this.isUserScrolling = true;

    // Clear any existing timeout
    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
    }

    // Set timeout to re-enable auto-scroll after 2 seconds of no scrolling
    this.userScrollTimeoutId = window.setTimeout(() => {
      this.isUserScrolling = false;
      this.userScrollTimeoutId = undefined;

      // Optionally scroll back to current active line when re-enabling auto-scroll
      if (this.activeLineIndices.length > 0) {
        this.scrollToActiveLine();
      }
    }, 2000);
  }

  private findActiveLineIndices(time: number): number[] {
    if (!this.lyrics) return [];
    const activeLines: number[] = [];
    for (let i = 0; i < this.lyrics.length; i += 1) {
      if (time >= this.lyrics[i].timestamp && time <= this.lyrics[i].endtime) {
        activeLines.push(i);
      }
    }
    return activeLines;
  }

  private findInstrumentalGapAt(
    time: number,
  ): { insertBeforeIndex: number; gapStart: number; gapEnd: number } | null {
    if (!this.lyrics || this.lyrics.length === 0) return null;

    // Start-of-song gap: from 0 to first line timestamp
    const first = this.lyrics[0];
    if (time >= 0 && time < first.timestamp) {
      const gapStart = 0;
      const gapEnd = first.timestamp;
      if (gapEnd - gapStart >= INSTRUMENTAL_THRESHOLD_MS) {
        return { insertBeforeIndex: 0, gapStart, gapEnd };
      }
      return null;
    }

    // Find consecutive pair (i, i+1) that bounds the current time
    for (let i = 0; i < this.lyrics.length - 1; i += 1) {
      const curr = this.lyrics[i];
      const next = this.lyrics[i + 1];
      const gapStart = curr.endtime;
      const gapEnd = next.timestamp;
      if (time > gapStart && time < gapEnd) {
        if (gapEnd - gapStart >= INSTRUMENTAL_THRESHOLD_MS) {
          return { insertBeforeIndex: i + 1, gapStart, gapEnd };
        }
        return null;
      }
    }

    return null;
  }

  private startAnimationFromTime(time: number) {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    if (!this.lyrics) return;

    const activeLineIndices = this.findActiveLineIndices(time);
    this.activeLineIndices = activeLineIndices;

    // Clear previous state
    this.activeMainWordIndices.clear();
    this.activeBackgroundWordIndices.clear();
    this.mainWordAnimations.clear();
    this.backgroundWordAnimations.clear();
    this.mainWordProgress.clear();
    this.backgroundWordProgress.clear();

    if (activeLineIndices.length === 0) {
      return;
    }

    // Set up animations for each active line
    for (const lineIndex of activeLineIndices) {
      const line = this.lyrics[lineIndex];

      // Find main word based on the reset time
      let mainWordIdx = -1;
      for (let i = 0; i < line.text.length; i += 1) {
        if (time >= line.text[i].timestamp && time <= line.text[i].endtime) {
          mainWordIdx = i;
          break;
        }
      }
      this.activeMainWordIndices.set(lineIndex, mainWordIdx);

      // Find background word based on the reset time
      let backWordIdx = -1;
      if (line.backgroundText) {
        for (let i = 0; i < line.backgroundText.length; i += 1) {
          if (
            time >= line.backgroundText[i].timestamp &&
            time <= line.backgroundText[i].endtime
          ) {
            backWordIdx = i;
            break;
          }
        }
      }
      this.activeBackgroundWordIndices.set(lineIndex, backWordIdx);
    }

    // With the state correctly set, configure the animation parameters
    this.setupAnimations();

    // Start the animation loop
    if (this.interpolate) {
      this.animateProgress();
    }
  }

  private updateActiveLineAndWords() {
    if (!this.lyrics) return;

    const activeLineIndices = this.findActiveLineIndices(this.currentTime);
    this.activeLineIndices = activeLineIndices;

    // Clear previous state
    this.activeMainWordIndices.clear();
    this.activeBackgroundWordIndices.clear();

    for (const lineIdx of activeLineIndices) {
      const line = this.lyrics[lineIdx];
      let mainWordIdx = -1;
      for (let i = 0; i < line.text.length; i += 1) {
        if (
          this.currentTime >= line.text[i].timestamp &&
          this.currentTime <= line.text[i].endtime
        ) {
          mainWordIdx = i;
          break;
        }
      }
      this.activeMainWordIndices.set(lineIdx, mainWordIdx);

      let backWordIdx = -1;
      if (line.backgroundText) {
        for (let i = 0; i < line.backgroundText.length; i += 1) {
          if (
            this.currentTime >= line.backgroundText[i].timestamp &&
            this.currentTime <= line.backgroundText[i].endtime
          ) {
            backWordIdx = i;
            break;
          }
        }
      }
      this.activeBackgroundWordIndices.set(lineIdx, backWordIdx);
    }
  }

  private setupAnimations() {
    if (this.activeLineIndices.length === 0 || !this.lyrics) {
      this.mainWordAnimations.clear();
      this.backgroundWordAnimations.clear();
      return;
    }

    for (const lineIndex of this.activeLineIndices) {
      const line = this.lyrics[lineIndex];
      const mainWordIndex = this.activeMainWordIndices.get(lineIndex) ?? -1;
      const backgroundWordIndex =
        this.activeBackgroundWordIndices.get(lineIndex) ?? -1;

      // Main word animation
      if (mainWordIndex !== -1) {
        const word = line.text[mainWordIndex];
        const wordDuration = word.endtime - word.timestamp;
        const elapsedInWord = this.currentTime - word.timestamp;
        this.mainWordAnimations.set(lineIndex, {
          startTime: performance.now() - elapsedInWord,
          duration: wordDuration,
        });
      } else {
        this.mainWordAnimations.set(lineIndex, { startTime: 0, duration: 0 });
      }

      // Background word animation
      if (backgroundWordIndex !== -1 && line.backgroundText) {
        const word = line.backgroundText[backgroundWordIndex];
        const wordDuration = word.endtime - word.timestamp;
        const elapsedInWord = this.currentTime - word.timestamp;
        this.backgroundWordAnimations.set(lineIndex, {
          startTime: performance.now() - elapsedInWord,
          duration: wordDuration,
        });
      } else {
        this.backgroundWordAnimations.set(lineIndex, {
          startTime: 0,
          duration: 0,
        });
      }
    }
  }

  private handleLineClick(line: LyricsLine) {
    const event = new CustomEvent('line-click', {
      detail: {
        timestamp: line.timestamp,
      },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  private static getBackgroundTextPlacement(
    line: LyricsLine,
  ): 'before' | 'after' {
    if (
      !line.backgroundText ||
      line.backgroundText.length === 0 ||
      line.text.length === 0
    ) {
      return 'after'; // Default to after if no comparison is possible
    }

    // Compare the start times of the first syllables
    const mainTextStartTime = line.text[0].timestamp;
    const backgroundTextStartTime = line.backgroundText[0].timestamp;

    return backgroundTextStartTime < mainTextStartTime ? 'before' : 'after';
  }

  private scrollToActiveLine() {
    if (!this.lyricsContainer || this.activeLineIndices.length === 0) {
      return;
    }

    // Scroll to the first active line
    const firstActiveLineIndex = Math.min(...this.activeLineIndices);
    const activeLineElement = this.lyricsContainer.querySelector(
      `.lyrics-line:nth-child(${firstActiveLineIndex + 1})`,
    ) as HTMLElement;

    if (activeLineElement) {
      const containerHeight = this.lyricsContainer.clientHeight;
      const lineTop = activeLineElement.offsetTop;
      const lineHeight = activeLineElement.clientHeight;

      // Check if the line has background text placed before the main text
      const hasBackgroundBefore = activeLineElement.querySelector(
        '.background-text.before',
      );

      // Calculate the offset to center the main text content, accounting for background text placement
      let offsetAdjustment = 0;
      if (hasBackgroundBefore) {
        const backgroundElement = hasBackgroundBefore as HTMLElement;
        offsetAdjustment = backgroundElement.clientHeight / 2; // Adjust to focus on main content
      }

      const top =
        lineTop - containerHeight / 2 + lineHeight / 2 - offsetAdjustment;

      // Use requestAnimationFrame for smoother iOS performance
      requestAnimationFrame(() => {
        this.isProgrammaticScroll = true;
        this.lyricsContainer?.scrollTo({ top, behavior: 'smooth' });
        // Reset the flag after a short delay to allow the scroll to complete
        setTimeout(() => {
          this.isProgrammaticScroll = false;
        }, 100);
      });
    }
  }

  private scrollToInstrumental(insertBeforeIndex: number) {
    if (!this.lyricsContainer) return;
    const target = this.lyricsContainer.querySelector(
      `.lyrics-line:nth-child(${insertBeforeIndex + 1})`,
    ) as HTMLElement | null;

    if (target) {
      const containerHeight = this.lyricsContainer.clientHeight;
      const lineTop = target.offsetTop;
      const lineHeight = target.clientHeight;

      // Check if the target line has background text placed before the main text
      const hasBackgroundBefore = target.querySelector(
        '.background-text.before',
      );

      // Calculate the offset to center the main text content, accounting for background text placement
      let offsetAdjustment = 0;
      if (hasBackgroundBefore) {
        const backgroundElement = hasBackgroundBefore as HTMLElement;
        offsetAdjustment = backgroundElement.clientHeight / 2; // Adjust to focus on main content
      }

      const top =
        lineTop - containerHeight / 2 + lineHeight / 2 - offsetAdjustment;

      // Use requestAnimationFrame for smoother iOS performance
      requestAnimationFrame(() => {
        this.isProgrammaticScroll = true;
        this.lyricsContainer?.scrollTo({ top, behavior: 'smooth' });
        // Reset the flag after a short delay to allow the scroll to complete
        setTimeout(() => {
          this.isProgrammaticScroll = false;
        }, 100);
      });
    }
  }

  private animateProgress() {
    const now = performance.now();
    let running = false;

    if (!this.lyrics || this.activeLineIndices.length === 0) {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = undefined;
      }
      return;
    }

    // Process each active line
    for (const lineIndex of this.activeLineIndices) {
      const line = this.lyrics[lineIndex];
      const mainWordAnimation = this.mainWordAnimations.get(lineIndex);

      // Main text animation
      if (mainWordAnimation && mainWordAnimation.duration > 0) {
        const elapsed = now - mainWordAnimation.startTime;
        if (elapsed >= 0) {
          const progress = Math.min(1, elapsed / mainWordAnimation.duration);
          this.mainWordProgress.set(lineIndex, progress);

          if (progress < 1) {
            running = true;
          } else {
            // Word animation finished. Look for the next word in the same line.
            const currentMainWordIndex =
              this.activeMainWordIndices.get(lineIndex) ?? -1;
            const nextWordIndex = currentMainWordIndex + 1;
            if (
              currentMainWordIndex !== -1 &&
              nextWordIndex < line.text.length
            ) {
              const currentWord = line.text[currentMainWordIndex];
              const nextWord = line.text[nextWordIndex];

              this.activeMainWordIndices.set(lineIndex, nextWordIndex);
              const gap = nextWord.timestamp - currentWord.endtime;
              const nextWordDuration = nextWord.endtime - nextWord.timestamp;

              this.mainWordAnimations.set(lineIndex, {
                startTime: performance.now() + gap,
                duration: nextWordDuration,
              });
              running = true;
            } else {
              this.mainWordAnimations.set(lineIndex, {
                startTime: 0,
                duration: 0,
              });
            }
          }
        } else {
          // Waiting in a gap
          this.mainWordProgress.set(lineIndex, 0);
          running = true;
        }
      }

      // Background text animation
      const backgroundWordAnimation =
        this.backgroundWordAnimations.get(lineIndex);
      if (backgroundWordAnimation && backgroundWordAnimation.duration > 0) {
        const elapsed = now - backgroundWordAnimation.startTime;
        if (elapsed >= 0) {
          const progress = Math.min(
            1,
            elapsed / backgroundWordAnimation.duration,
          );
          this.backgroundWordProgress.set(lineIndex, progress);

          if (progress < 1) {
            running = true;
          } else {
            // Word animation finished. Look for the next word in the same line.
            const currentBackgroundWordIndex =
              this.activeBackgroundWordIndices.get(lineIndex) ?? -1;
            if (
              line.backgroundText &&
              currentBackgroundWordIndex !== -1 &&
              currentBackgroundWordIndex < line.backgroundText.length - 1
            ) {
              const nextWordIndex = currentBackgroundWordIndex + 1;
              const currentWord =
                line.backgroundText[currentBackgroundWordIndex];
              const nextWord = line.backgroundText[nextWordIndex];

              this.activeBackgroundWordIndices.set(lineIndex, nextWordIndex);
              const gap = nextWord.timestamp - currentWord.endtime;
              const nextWordDuration = nextWord.endtime - nextWord.timestamp;

              this.backgroundWordAnimations.set(lineIndex, {
                startTime: performance.now() + gap,
                duration: nextWordDuration,
              });
              running = true;
            } else {
              this.backgroundWordAnimations.set(lineIndex, {
                startTime: 0,
                duration: 0,
              });
            }
          }
        } else {
          // Waiting in a gap
          this.backgroundWordProgress.set(lineIndex, 0);
          running = true;
        }
      }
    }

    if (running) {
      this.animationFrameId = requestAnimationFrame(
        this.animateProgress.bind(this),
      );
    } else if (this.animationFrameId) {
      // Stop animation if no words are running
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
  }

  private generateLRC(): string {
    if (!this.lyrics) return '';
    let lrc = '';

    // Add metadata if available
    if (this.songTitle) lrc += `[ti:${this.songTitle}]\n`;
    if (this.songArtist) lrc += `[ar:${this.songArtist}]\n`;
    if (this.songAlbum) lrc += `[al:${this.songAlbum}]\n`;
    if (this.lyricsSource) lrc += `[re:${this.lyricsSource}]\n`;

    for (const line of this.lyrics) {
      if (line.text && line.text.length > 0) {
        const timestamp = AmLyrics.formatTimestampLRC(line.timestamp);
        // Construct line text from syllables
        const lineText = line.text
          .map(s => s.text)
          .join('')
          .trim();
        lrc += `[${timestamp}]${lineText}\n`;
      }
    }

    return lrc;
  }

  private generateTTML(): string {
    if (!this.lyrics) return '';

    // Basic TTML structure
    let ttml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    ttml +=
      '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyrics">\n';
    ttml += '  <body>\n';

    let currentPart: string | undefined;

    for (let i = 0; i < this.lyrics.length; i += 1) {
      const line = this.lyrics[i];
      const part = line.songPart;

      // If part changed (or first line), start new div
      if (part !== currentPart || i === 0) {
        if (i > 0) {
          ttml += '    </div>\n';
        }
        currentPart = part;
        if (currentPart) {
          ttml += `    <div itunes:song-part="${currentPart}">\n`;
        } else {
          ttml += '    <div>\n';
        }
      }

      // For TTML, we can represent syllables as spans if word-synced
      const begin = AmLyrics.formatTimestampTTML(line.timestamp);
      const end = AmLyrics.formatTimestampTTML(line.endtime);

      ttml += `      <p begin="${begin}" end="${end}">\n`;

      for (const word of line.text) {
        const wBegin = AmLyrics.formatTimestampTTML(word.timestamp);
        const wEnd = AmLyrics.formatTimestampTTML(word.endtime);
        // Escape special characters in text
        const text = word.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        ttml += `        <span begin="${wBegin}" end="${wEnd}">${text}</span>\n`;
      }

      ttml += '      </p>\n';
    }

    if (this.lyrics.length > 0) {
      ttml += '    </div>\n';
    }

    ttml += '  </body>\n';
    ttml += '</tt>';

    return ttml;
  }

  private static formatTimestampLRC(ms: number): string {
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const hundredths = Math.floor((ms % 1000) / 10);

    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}`;
  }

  private static formatTimestampTTML(ms: number): string {
    // TTML standard format: HH:MM:SS.mmm
    const totalSeconds = ms / 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const milliseconds = Math.floor(ms % 1000);

    const pad = (n: number, width = 2) => n.toString().padStart(width, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
  }

  private downloadLyrics() {
    if (!this.lyrics || this.lyrics.length === 0) return;

    // Determine format: TTML if ANY line is word-synced, else LRC
    const isWordSynced = this.lyrics.some(l => l.isWordSynced !== false);

    let content = '';
    let extension = this.downloadFormat;
    if (extension === 'auto') {
      extension = isWordSynced ? 'ttml' : 'lrc';
    }
    let mimeType = '';

    if (extension === 'ttml') {
      content = this.generateTTML();
      mimeType = 'application/xml';
    } else {
      content = this.generateLRC();
      mimeType = 'text/plain';
    }

    if (!content) return;

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const filename = this.songTitle
      ? `${this.songTitle}${this.songArtist ? ` - ${this.songArtist}` : ''}.${extension}`
      : `lyrics.${extension}`;

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  render() {
    if (this.fontFamily) {
      this.style.fontFamily = this.fontFamily;
    }

    // Set both old internal CSS variables (for backward compatibility)
    // and new public CSS variables (which take precedence)
    this.style.setProperty(
      '--hover-background-color',
      this.hoverBackgroundColor,
    );
    this.style.setProperty('--highlight-color', this.highlightColor);

    const sourceLabel = this.lyricsSource ?? 'Unavailable';

    const renderContent = () => {
      if (this.isLoading) {
        // Render stylized skeleton lines
        return html`
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
        `;
      }
      if (!this.lyrics || this.lyrics.length === 0) {
        return html`<div class="no-lyrics">No lyrics found.</div>`;
      }

      const instrumental = this.findInstrumentalGapAt(this.currentTime);

      return this.lyrics.map((line, lineIndex) => {
        const isLineActive = this.activeLineIndices.includes(lineIndex);
        const bgIsPlayingNow =
          line.backgroundText && line.backgroundText.length > 0
            ? line.backgroundText.some(
                syl =>
                  this.currentTime >= syl.timestamp &&
                  this.currentTime <= syl.endtime,
              )
            : false;

        const backgroundPlacement = AmLyrics.getBackgroundTextPlacement(line);
        const shouldShowBackground =
          line.backgroundText &&
          line.backgroundText.length > 0 &&
          (isLineActive || bgIsPlayingNow);

        // Create background text element
        const backgroundTextElement = shouldShowBackground
          ? html`<span class="background-text ${backgroundPlacement}">
              ${line.backgroundText!.map((syllable, wordIndex) => {
                const activeBackgroundWordIndex =
                  this.activeBackgroundWordIndices.get(lineIndex) ?? -1;
                const isWordActive =
                  isLineActive && wordIndex === activeBackgroundWordIndex;
                const isWordPassed =
                  isLineActive &&
                  (wordIndex < activeBackgroundWordIndex ||
                    (activeBackgroundWordIndex === -1 &&
                      this.currentTime > syllable.endtime));
                let progress = 0;
                if (isWordActive) {
                  progress = this.interpolate
                    ? (this.backgroundWordProgress.get(lineIndex) ?? 0)
                    : 1;
                } else if (isWordPassed) {
                  progress = 1;
                }

                const text = syllable.text || '';
                const hasTrailingSpace = text.endsWith(' ');
                const contentText = hasTrailingSpace ? text.slice(0, -1) : text;

                return html`<span
                    class="progress-text"
                    style="--line-progress: ${progress *
                    100}%; margin-right: 0; --transition-style: ${isLineActive
                      ? 'all'
                      : 'color'}"
                    >${contentText}</span
                  >${hasTrailingSpace ? ' ' : ''}`;
              })}
            </span>`
          : '';

        // Create main text element (original lyrics)
        const mainTextContent = html`<span>
          ${line.text.map((syllable, wordIndex) => {
            const activeMainWordIndex =
              this.activeMainWordIndices.get(lineIndex) ?? -1;
            const isWordActive =
              isLineActive && wordIndex === activeMainWordIndex;
            const isWordPassed =
              isLineActive &&
              (wordIndex < activeMainWordIndex ||
                (activeMainWordIndex === -1 &&
                  this.currentTime > syllable.endtime));
            let progress = 0;
            if (isWordActive) {
              if (line.isWordSynced === false) {
                progress = 1;
              } else {
                progress = this.interpolate
                  ? (this.mainWordProgress.get(lineIndex) ?? 0)
                  : 1;
              }
            } else if (isWordPassed) {
              progress = 1;
            }

            const text = syllable.text || '';
            const hasTrailingSpace = text.endsWith(' ');
            const contentText = hasTrailingSpace ? text.slice(0, -1) : text;

            return html`<span
                class="progress-text"
                style="--line-progress: ${progress *
                100}%; margin-right: 0; --transition-style: ${isLineActive
                  ? 'all'
                  : 'color'}"
                >${contentText}</span
              >${hasTrailingSpace ? ' ' : ''}`;
          })}
        </span>`;

        // Logic for Display Mode
        // If Translation is ON:
        //  - Original (mainTextContent) becomes small and top.
        //  - Translation becomes Big and Bottom.
        // If Translation is OFF:
        //  - Original is Big.

        const showTranslationLine = this.showTranslation && line.translation;
        const showRomanizationLine =
          this.showRomanization &&
          (line.romanizedText ||
            (line.text && line.text.some(s => s.romanizedText)));

        let mainContent;

        if (showTranslationLine) {
          // Translation Mode

          // 1. Original Text (Small, Top) - retains word sync
          const originalWrapper = html`<div class="main-line-wrapper small">
            ${mainTextContent}
          </div>`;

          // 2. Translation Text (Big, Bottom) - line sync (highlight whole line if active)
          const translationText = html`<div class="translation-line">
            <span
              class="progress-text"
              style="--line-progress: ${isLineActive ? 100 : 0}%"
            >
              ${line.translation}
            </span>
          </div>`;

          mainContent = html` ${originalWrapper} ${translationText} `;
        } else {
          // Standard Mode
          mainContent = mainTextContent;
        }

        let romanizationInner;
        if (line.text && line.text.some(s => s.romanizedText)) {
          // Word-synced romanisation
          romanizationInner = html`<span>
            ${line.text.map((syllable, wordIndex) => {
              const activeMainWordIndex =
                this.activeMainWordIndices.get(lineIndex) ?? -1;
              const isWordActive =
                isLineActive && wordIndex === activeMainWordIndex;
              const isWordPassed =
                isLineActive &&
                (wordIndex < activeMainWordIndex ||
                  (activeMainWordIndex === -1 &&
                    this.currentTime > syllable.endtime));
              let progress = 0;
              if (isWordActive) {
                if (line.isWordSynced === false) {
                  progress = 1;
                } else {
                  progress = this.interpolate
                    ? (this.mainWordProgress.get(lineIndex) ?? 0)
                    : 1;
                }
              } else if (isWordPassed) {
                progress = 1;
              }

              const text = syllable.romanizedText || '';
              const hasTrailingSpace = text.endsWith(' ');
              const contentText = hasTrailingSpace ? text.slice(0, -1) : text;

              return html`<span
                  class="progress-text"
                  style="--line-progress: ${progress *
                  100}%; margin-right: 0; --transition-style: ${isLineActive
                    ? 'all'
                    : 'color'}"
                  >${contentText}</span
                >${hasTrailingSpace ? ' ' : ''}`;
            })}
          </span>`;
        } else {
          // Line-synced romanisation
          romanizationInner = html` <span
            class="progress-text"
            style="--line-progress: ${isLineActive ? 100 : 0}%"
          >
            ${line.romanizedText}
          </span>`;
        }

        const romanizationContent = showRomanizationLine
          ? html` <div class="romanized-line">${romanizationInner}</div> `
          : '';

        let maybeInstrumentalBlock: unknown = null;
        if (instrumental && instrumental.insertBeforeIndex === lineIndex) {
          const remainingSeconds = Math.max(
            0,
            Math.ceil((instrumental.gapEnd - this.currentTime) / 1000),
          );
          if (remainingSeconds > 0) {
            maybeInstrumentalBlock = html`<div
              class="instrumental-line"
              aria-label="Instrumental gap"
            >
              <span class="instrumental-duration">${remainingSeconds}s</span>
            </div>`;
          }
        }

        return html`
          ${maybeInstrumentalBlock}
          <div
            class="lyrics-line ${line.oppositeTurn
              ? 'opposite-turn'
              : ''} ${isLineActive ? 'active-line' : ''} ${line.alignment ===
            'end'
              ? 'singer-right'
              : 'singer-left'}"
            @click=${() => this.handleLineClick(line)}
            tabindex="0"
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                this.handleLineClick(line);
              }
            }}
          >
            ${backgroundPlacement === 'before' ? backgroundTextElement : ''}
            ${mainContent} ${romanizationContent}
            ${backgroundPlacement === 'after' ? backgroundTextElement : ''}
          </div>
        `;
      });
    };

    return html`
      <div class="lyrics-container">
        ${!this.isLoading && this.lyrics && this.lyrics.length > 0
          ? html`
              <div class="lyrics-header">
                <div class="header-controls">
                  <button
                    class="control-button ${this.showRomanization
                      ? 'active'
                      : ''}"
                    @click=${this.toggleRomanization}
                    title="Toggle Romanization"
                  >
                    Rom
                  </button>
                  <button
                    class="control-button ${this.showTranslation
                      ? 'active'
                      : ''}"
                    @click=${this.toggleTranslation}
                    title="Toggle Translation"
                  >
                    Trans
                  </button>
                </div>
                <div class="download-controls">
                  <select
                    class="format-select"
                    @change=${(e: Event) => {
                      this.downloadFormat = (e.target as HTMLSelectElement)
                        .value as 'lrc' | 'ttml';
                    }}
                    .value=${this.downloadFormat}
                    @click=${(e: Event) => e.stopPropagation()}
                  >
                    <option value="auto">Auto</option>
                    <option value="lrc">LRC</option>
                    <option value="ttml">TTML</option>
                  </select>
                  <button
                    class="download-button"
                    @click=${this.downloadLyrics}
                    title="Download Lyrics"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="lucide lucide-download-icon lucide-download"
                    >
                      <path d="M12 15V3" />
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <path d="m7 10 5 5 5-5" />
                    </svg>
                  </button>
                </div>
              </div>
            `
          : ''}
        ${renderContent()}
        ${!this.isLoading
          ? html`
              <footer class="lyrics-footer">
                <div class="footer-content">
                  <span class="source-info">Source: ${sourceLabel}</span>
                  <span class="version-info">
                    v${VERSION} •

                    <a
                      href="https://github.com/uimaxbai/apple-music-web-components"
                      target="_blank"
                      rel="noopener noreferrer"
                      >Star me on GitHub</a
                    >
                  </span>
                </div>
              </footer>
            `
          : ''}
      </div>
    `;
  }
}

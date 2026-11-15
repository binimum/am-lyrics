import { html, LitElement, nothing, svg } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { lyricsStyles } from './AmLyrics.styles.js';
import {
  createLineSpringFrames,
  getCharacterFrames,
  getMotionMetrics,
  getNormalWordFrames,
  NORMAL_WORD_SPRING_DURATION_MS,
  sampleSpring,
} from './LyricMotion.js';
import type { MotionMetrics } from './LyricMotion.js';
import { GoogleService } from './GoogleService.js';
import { parseSpicyLyrics, secondsToMs } from './LyricsSources.js';
import type {
  LyricsContributor,
  LyricsLine,
  LyricsSourceResult as YouLyPlusLyricsResult,
  Syllable,
} from './LyricsSources.js';

const VERSION = '1.9.1';
const SPICY_LYRICS_CLIENT_KEY =
  'sl_pk_8nNuJf0L-xFUv8L5uU-pfin69WU4j3IzzV2-T3GPWKY';
const SPOTIFY_TOKEN_URL =
  'https://flxgjwpkztgpdywkgckk.supabase.co/functions/v1/spotify-token';
const INSTRUMENTAL_THRESHOLD_MS = 7000; // Show dots for gaps >= 7s
const FETCH_TIMEOUT_MS = 8000; // Default timeout for lyrics fetch requests
const LRC_RED_TIMEOUT_MS = 3000;
const BINIMUM_LOOKUP_TIMEOUT_MS = 3000;
const SEEK_THRESHOLD_MS = 500;
const SCROLL_ANIMATION_DURATION_MS = 350;
const BACKGROUND_EXIT_DURATION_MS = 450;
const BACKGROUND_CARRY_MIN_OVERLAP_MS = 800;
const USER_SCROLL_RESUME_DELAY_MS = 5000;
const GAP_PULSE_DURATION_MS = 4000;
const GAP_ENTRY_FADE_MS = 160;
const GAP_ENTRY_SCALE_MS = 400;
const GAP_COLLAPSE_LEAD_MS = 500;
const GAP_EXIT_LEAD_MS = SCROLL_ANIMATION_DURATION_MS;
const GAP_EXIT_TRAIL_MS = 250;
const GAP_BREATH_MIN_SCALE = 0.85;
const GAP_BREATH_MAX_SCALE = 1.12;
const GAP_EXIT_POP_SCALE = 1.2;
const GAP_EXIT_POP_PROGRESS = 0.35;
const NEXT_WORD_PRE_WIPE_MAX_GAP_MS = 180;
const NEXT_WORD_PRE_WIPE_MIN_DURATION_MS = 80;
const NEXT_WORD_PRE_WIPE_MAX_DURATION_MS = 240;
const BASE_WIPE_GRADIENT_EM = 0.75;
const CJK_WIPE_GRADIENT_EM = 0.3;
const LONG_WORD_WIPE_EXTRA_EM = 0.45;
const LONG_WORD_WIPE_EXTRA_RATIO = 0.35;
const WORD_PRE_WIPE_HANDOFF_LEAD_MS = 100;
const WORD_WIPE_LOOKAHEAD_MS = 500;
const NEXT_LINE_BASE_BLUR_EM = 0.02;
const NEXT_LINE_UNBLUR_DURATION_MS = 2000;

/**
 * Fetch with an automatic timeout via AbortSignal.
 * Rejects if the request takes longer than `timeoutMs`.
 */
function fetchWithTimeout(
  url: string,
  options: Parameters<typeof fetch>[1] = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId),
  );
}

const KPOE_SERVERS = [
  'https://lyricsplus.binimum.org',
  'https://lyricsplus-seven.vercel.app',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyrics-plus-backend.vercel.app',
];
const DEFAULT_KPOE_SOURCE_ORDER =
  'apple,lyricsplus,musixmatch,spotify,qq,deezer,musixmatch-word';

const GENIUS_WORKER_URL = 'https://fetch-genius.samidy.workers.dev/';

interface WordWipe {
  syllables: HTMLElement[];
  fragments: Array<{
    element: HTMLElement;
    width: number;
    offset: number;
    fontSize: number;
    padding: number;
  }>;
  segments: Array<{ start: number; end: number; width: number }>;
  width: number;
  count: number;
  cjk: boolean;
  start: number;
  end: number;
  rtl: boolean;
  animations: Animation[];
  epoch: number;
  prepared: boolean;
  settled: boolean;
}

interface NormalWordMotion {
  targets: HTMLElement[];
  animations: Animation[];
  start: number;
  settled: boolean;
  rise: number;
}

interface LyricLayout {
  tops: Map<HTMLElement, number>;
  contents: Map<HTMLElement, number>;
  scrollTop: number;
}

interface SongMetadata {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  songwriters?: string;
}

interface SongCatalogResult {
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  songwriters?: string;
  id?: {
    appleMusic?: string;
    spotify?: string;
    [key: string]: unknown;
  };
  isrc?: string;
}

interface ParsedQueryMetadata {
  title?: string;
  artist?: string;
  album?: string;
}

interface ResolvedMetadata {
  metadata?: SongMetadata;
  appleId?: string;
  appleSong?: any;
  catalogIsrc?: string;
  spotifyId?: string;
}

export class AmLyrics extends LitElement {
  static styles = lyricsStyles;

  @property({ type: String })
  query?: string;

  @property({ type: String })
  musicId?: string;

  @property({ type: String, attribute: 'spotify-id' })
  spotifyId?: string;

  @property({ type: String })
  isrc?: string;

  @property({ type: String })
  ttml?: string;

  @property({ type: String, attribute: 'song-title' })
  songTitle?: string;

  @state()
  private downloadFormat: 'auto' | 'lrc' | 'ttml' | 'plain' = 'auto';

  @property({ type: String, attribute: 'song-artist' })
  songArtist?: string;

  @property({ type: String, attribute: 'song-album' })
  songAlbum?: string;

  @property({ type: String, attribute: 'songwriters' })
  songwriters?: string;

  @property({ type: Number, attribute: 'song-duration' })
  songDurationMs?: number;

  @property({ type: String, attribute: 'highlight-color' })
  highlightColor = '#ffffff';

  @property({ type: String, attribute: 'font-family' })
  fontFamily: string | undefined;

  @property({ type: Boolean })
  autoScroll = true;

  @property({ type: Boolean })
  interpolate = true;

  /** Freeze the playback clock and timed effects while the player is paused. */
  @property({ type: Boolean })
  paused = false;

  /** Use supplied alternates only; disable Google generation, including button actions. */
  @property({ type: Boolean, attribute: 'no-auto-alternates' })
  noAutoAlternates = false;

  /** Disable distance and predictive blur without changing lyric timing. */
  @property({ type: Boolean, attribute: 'no-blur', reflect: true })
  noBlur = false;

  @property({ type: Boolean, attribute: 'hide-played-lines', reflect: true })
  hidePlayedLines = false;

  /** Also enabled automatically by the system reduced-motion preference. */
  @property({ type: Boolean, attribute: 'reduced-motion' })
  reducedMotion = false;

  /** Browser implementations; these are not the native app's version IDs. */
  @property({ type: String, attribute: 'line-motion' })
  lineMotion: 'staggered' | 'uniform' | 'instant' = 'staggered';

  @state()
  private systemReducedMotion = false;

  private motionPreference?: MediaQueryList;

  private get shouldReduceMotion(): boolean {
    return this.reducedMotion || this.systemReducedMotion;
  }

  private readonly handleMotionPreference = (event: MediaQueryListEvent) => {
    this.systemReducedMotion = event.matches;
  };

  @state()
  private showRomanization = false;

  @state()
  private showTranslation = false;

  private async toggleRomanization() {
    this.showRomanization = !this.showRomanization;
    await this.applyRomanization();
  }

  private async applyRomanization() {
    if (this.noAutoAlternates) return;
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
    if (this.noAutoAlternates) return;
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

  private _currentTime = 0;

  private playbackAnchor = 0;

  private playbackStamp = 0;

  private lastHostTime?: number;

  private lastAdvanceStamp = 0;

  private hostCadence = 250;

  private clockAdvancing = false;

  private playbackTimer?: ReturnType<typeof setTimeout>;

  private playbackEvents: number[] = [];

  private playbackEventIndex = -1;

  private heldPlaybackAnimations = new Set<Animation>();

  private playbackEventAt(time: number): number {
    let low = 0;
    let high = this.playbackEvents.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.playbackEvents[middle] <= time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private get playbackHorizon(): number {
    return AmLyrics.clamp(this.hostCadence * 2.5, 750, 5000);
  }

  private estimatedPlaybackTime(now = performance.now()): number {
    return this.clockAdvancing && this.interpolate && !this.paused
      ? this.playbackAnchor +
          Math.min(Math.max(0, now - this.playbackStamp), this.playbackHorizon)
      : this._currentTime;
  }

  private cancelPlaybackTick(): void {
    clearTimeout(this.playbackTimer);
    this.playbackTimer = undefined;
  }

  private schedulePlaybackTick(): void {
    this.cancelPlaybackTick();
    if (
      !this.clockAdvancing ||
      !this.interpolate ||
      this.paused ||
      !this.isConnected ||
      document.hidden ||
      !this.lyrics ||
      this.cachedIsUnsynced
    )
      return;
    const now = performance.now();
    const time = Math.max(this._currentTime, this.estimatedPlaybackTime(now));
    const next = this.playbackEvents[this.playbackEventAt(time)] ?? Infinity;
    const remaining = this.playbackStamp + this.playbackHorizon - now;
    // Native effects run continuously. JS wakes only at lyric boundaries or
    // when host updates stop, rather than rewriting clocks every frame.
    this.playbackTimer = setTimeout(
      () => {
        this.playbackTimer = undefined;
        this.applyPlaybackTime(
          Math.max(this._currentTime, this.estimatedPlaybackTime()),
          false,
          false,
        );
        if (performance.now() - this.playbackStamp >= this.playbackHorizon) {
          this.clockAdvancing = false;
          this.holdPlaybackAnimations();
        } else this.schedulePlaybackTick();
      },
      Math.max(1, Math.min(next - time, remaining)),
    );
  }

  private holdPlaybackAnimations(): void {
    const roots = new Set<HTMLElement>();
    for (const index of this.activeLineIndices) {
      const line = this._getLineElement(index);
      if (line) roots.add(line);
    }
    this.preActiveLineElements.forEach(line => roots.add(line));
    this.backgroundCarries.forEach(entry => roots.add(entry.clone));
    this.activeGapLineElements.forEach(line => roots.add(line));
    for (const root of roots)
      for (const animation of root.getAnimations({ subtree: true })) {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        const glyph =
          target instanceof HTMLElement &&
          (target.classList.contains('char-motion')
            ? target.querySelector<HTMLElement>('.char')
            : target);
        const name =
          'animationName' in animation ? String(animation.animationName) : '';
        const gap = target instanceof Element && target.closest('.lyrics-gap');
        if (
          (AmLyrics.wipeClocks.has(animation) ||
            AmLyrics.normalRiseClocks.has(animation) ||
            (glyph &&
              AmLyrics.characterAnimations.get(glyph)?.animation ===
                animation) ||
            /wipe|char-glow/.test(name) ||
            gap) &&
          animation.playState !== 'finished' &&
          animation.playState !== 'idle'
        ) {
          animation.pause();
          this.heldPlaybackAnimations.add(animation);
        }
      }
  }

  private releasePlaybackAnimations(): void {
    for (const animation of this.heldPlaybackAnimations)
      if (animation.playState === 'paused') {
        const time = animation.currentTime;
        animation.play();
        animation.currentTime = time;
      }
    this.heldPlaybackAnimations.clear();
  }

  private readonly handlePlaybackVisibility = () => {
    if (document.hidden) {
      this.cancelPlaybackTick();
      this.holdPlaybackAnimations();
    } else {
      if (performance.now() - this.playbackStamp >= this.playbackHorizon)
        this.clockAdvancing = false;
      if (!this.paused) this.releasePlaybackAnimations();
      this.applyPlaybackTime(this.estimatedPlaybackTime(), true, true, false);
      if (this.paused || (this.interpolate && !this.clockAdvancing))
        this.holdPlaybackAnimations();
      this.schedulePlaybackTick();
    }
  };

  private rewindingLines = new Set<HTMLElement>();

  private rewindFrame = 0;

  private rewindEffects: Array<{
    animation: Animation;
    from: number;
    to: number;
  }> = [];

  private finishLineRewind(): void {
    cancelAnimationFrame(this.rewindFrame);
    this.rewindFrame = 0;
    for (const { animation } of this.rewindEffects) {
      if (
        animation.playState !== 'idle' &&
        Number(animation.currentTime) <
          Number(animation.effect?.getComputedTiming().endTime)
      ) {
        const time = animation.currentTime;
        animation.play();
        // play() rewinds negative local times to zero. Negative times are valid
        // here because CSS wipes/glow may have started with a negative delay.
        animation.currentTime = time;
      }
    }
    this.rewindEffects = [];
    for (const line of this.rewindingLines)
      line
        .querySelectorAll<HTMLElement>('.shared-word-wipe')
        .forEach(fragment => fragment.style.removeProperty('transition'));
    this.rewindingLines.clear();
  }

  private startLineRewind(lines: HTMLElement[], targetTime: number): void {
    this.finishLineRewind();
    this.rewindingLines = new Set(lines);
    for (const line of lines) {
      for (const word of AmLyrics.motionWords.get(line) || []) {
        if (
          word.wipe &&
          targetTime < word.wipe.end &&
          (word.wipe.settled ||
            word.wipe.animations.some(
              animation => animation.playState === 'idle',
            ))
        )
          AmLyrics.startWordWipe(
            word.wipe,
            word.wipe.end,
            word.wipe.epoch,
            true,
          );
        const motion = AmLyrics.normalWordMotions.get(word.element);
        if (
          motion?.settled &&
          targetTime < motion.start + NORMAL_WORD_SPRING_DURATION_MS
        )
          AmLyrics.startNormalWordMotion(
            motion,
            NORMAL_WORD_SPRING_DURATION_MS,
          );
      }
      for (const syllable of AmLyrics.motionSyllables.get(line) || []) {
        const parameters = AmLyrics.motionParameters.get(syllable);
        for (const char of parameters?.chars || []) {
          const entry = AmLyrics.characterAnimations.get(char);
          if (entry?.settled && targetTime < entry.start + entry.end)
            AmLyrics.resumeCharacterMotion(char, entry.end);
        }
      }
    }
    // Use the existing painted pose, even when another rewind is interrupted.
    // Only the short seek transition needs JS; normal playback stays compositor-driven.
    lines
      .flatMap(line => line.getAnimations({ subtree: true }))
      .forEach(animation => {
        const effect = animation.effect as KeyframeEffect | null;
        const target = effect?.target;
        if (!(target instanceof HTMLElement)) return;
        const name =
          'animationName' in animation ? String(animation.animationName) : '';
        const syllable = target.closest<HTMLElement>('.lyrics-syllable');
        let to: number;
        const wipeEpoch = AmLyrics.wipeClocks.get(animation);
        const riseEpoch = AmLyrics.normalRiseClocks.get(animation);
        if (riseEpoch !== undefined) {
          to = targetTime - riseEpoch;
        } else if (wipeEpoch !== undefined) {
          to = targetTime - wipeEpoch;
        } else if (name.includes('wipe') && syllable) {
          to =
            targetTime -
            Number(syllable.dataset.startTime) +
            Number(effect!.getTiming().delay);
        } else {
          const char = target.classList.contains('char-motion')
            ? target.querySelector<HTMLElement>('.char')
            : target;
          const entry = char && AmLyrics.characterAnimations.get(char);
          if (!entry || (entry.animation !== animation && name !== 'char-glow'))
            return;
          to =
            targetTime -
            entry.start -
            (name === 'char-glow' ? entry.glowEpoch : 0);
        }
        const end = Number(effect!.getComputedTiming().endTime);
        this.rewindEffects.push({
          animation,
          from: Number(animation.currentTime || 0),
          to: Math.min(to, end),
        });
        animation.pause();
      });
    lines.forEach(line =>
      line
        .querySelectorAll('.lyrics-syllable.finished')
        .forEach(syllable => syllable.classList.remove('finished')),
    );
    lines.forEach(line =>
      line
        .querySelectorAll<HTMLElement>('.shared-word-wipe')
        .forEach(fragment => {
          const target = fragment;
          target.style.transition = 'none';
          target.style.backgroundColor =
            'var(--word-inactive-color, var(--lyplus-text-secondary))';
        }),
    );
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 260);
      const eased = progress * progress * (3 - 2 * progress);
      const playbackAdvance = this.currentTime - targetTime;
      for (const { animation, from, to } of this.rewindEffects)
        if (animation.playState !== 'idle')
          animation.currentTime = from + (to + playbackAdvance - from) * eased;
      if (progress < 1) {
        this.rewindFrame = requestAnimationFrame(tick);
      } else {
        this.finishLineRewind();
        for (const line of lines) {
          AmLyrics.updateSyllablesForLine(
            line,
            this.currentTime,
            this.shouldReduceMotion,
          );
          AmLyrics.seekLineWipes(line, this.currentTime);
        }
      }
    };
    this.rewindFrame = requestAnimationFrame(tick);
  }

  @property({ type: Number, attribute: 'currenttime', hasChanged: () => false })
  set currentTime(value: number) {
    if (!Number.isFinite(value)) return;
    const now = performance.now();
    const previousHost = this.lastHostTime;
    const expected =
      previousHost !== undefined && this.interpolate && !this.paused
        ? this.playbackAnchor +
          Math.min(Math.max(0, now - this.playbackStamp), 5000)
        : this._currentTime;
    const isSeek =
      previousHost !== undefined &&
      (value < previousHost - 32 ||
        Math.abs(value - expected) > SEEK_THRESHOLD_MS);
    const advances = previousHost !== undefined && value > previousHost;
    const duplicateWhileMoving =
      previousHost === value &&
      this.clockAdvancing &&
      now - this.lastAdvanceStamp <
        Math.max(200, Math.min(1000, this.hostCadence * 1.5));
    const minorCorrection =
      previousHost !== undefined &&
      value < previousHost &&
      previousHost - value <= 32 &&
      this.clockAdvancing;
    if (
      advances &&
      !isSeek &&
      this.playbackStamp &&
      now - this.playbackStamp > 8
    )
      this.hostCadence = AmLyrics.clamp(now - this.playbackStamp, 16, 2000);
    this.clockAdvancing =
      this.interpolate &&
      !this.paused &&
      (advances || duplicateWhileMoving || minorCorrection) &&
      !isSeek;
    if (!duplicateWhileMoving && !minorCorrection) {
      this.playbackAnchor = value;
      this.playbackStamp = now;
    }
    if (advances || previousHost === undefined) this.lastAdvanceStamp = now;
    this.lastHostTime = value;
    if (previousHost !== value && !this.paused && !document.hidden)
      this.releasePlaybackAnimations();
    if (document.hidden) {
      this._currentTime = value;
      this.cancelPlaybackTick();
      return;
    }
    this.applyPlaybackTime(
      this.clockAdvancing
        ? Math.max(value, this._currentTime, this.estimatedPlaybackTime(now))
        : value,
      previousHost === undefined || isSeek,
      isSeek || previousHost === undefined,
      previousHost !== value && !this.paused,
    );
    if (this.paused || (previousHost === value && !this.clockAdvancing)) {
      this.finishLineRewind();
      this.holdPlaybackAnimations();
    }
    this.schedulePlaybackTick();
  }

  get currentTime(): number {
    return this._currentTime;
  }

  private applyPlaybackTime(
    value: number,
    force = false,
    isSeek = false,
    allowRewind = true,
  ): void {
    const oldValue = this._currentTime;

    if (allowRewind && oldValue - value > 32 && !this.shouldReduceMotion) {
      const nextActive = this.findActiveLineIndices(value);
      const sharedLines = this.activeLineIndices
        .filter(index => nextActive.includes(index))
        .map(index => this._getLineElement(index))
        .filter((line): line is HTMLElement => line !== null);
      if (sharedLines.length) this.startLineRewind(sharedLines, value);
      else this.finishLineRewind();
    } else if (this.rewindingLines.size) {
      const nextActive = this.findActiveLineIndices(value);
      if (
        value - oldValue > SEEK_THRESHOLD_MS ||
        [...this.rewindingLines].some(
          line =>
            !nextActive.includes(AmLyrics.getLineIndexFromElement(line) ?? -1),
        )
      )
        this.finishLineRewind();
    }

    this._currentTime = value;
    if ((force || oldValue !== value) && this.lyrics) {
      this._ensureLineDataCache();
      const index = this.playbackEventAt(value);
      if (force || value < oldValue || index !== this.playbackEventIndex) {
        this.playbackEventIndex = index;
        this._onTimeChanged(oldValue, value, isSeek);
      }
    }
  }

  @state()
  private isLoading = false;

  @state()
  private lyrics?: LyricsLine[];

  private activeLineIndices: number[] = [];

  private timingLyrics?: LyricsLine[];

  private lineHighlightEnds: number[] = [];

  private activeTimelineIntervals: Array<{
    start: number;
    end: number;
    indices: number[];
  }> = [];

  private backgroundWraps = new WeakMap<HTMLElement, HTMLElement | null>();

  private ensureTimingCache(): void {
    if (this.timingLyrics === this.lyrics) return;
    this.timingLyrics = this.lyrics;
    this.lineHighlightEnds = [];
    this.activeTimelineIntervals = [];
  }

  private getBackgroundWrap(line: HTMLElement): HTMLElement | null {
    let wrap = this.backgroundWraps.get(line);
    if (wrap === undefined) {
      wrap = line.querySelector<HTMLElement>(
        '.background-vocal-container:not([data-bg-carried]) .background-vocal-wrap',
      );
      this.backgroundWraps.set(line, wrap);
    }
    return wrap;
  }

  @state()
  private lyricsSource: string | null = null;

  @state()
  private availableSources: YouLyPlusLyricsResult[] = [];

  @state()
  private currentSourceIndex = 0;

  @state()
  private isFetchingAlternatives = false;

  @state()
  private sourceSwitchPending = false;

  private selectedSourceKey: string | null = null;

  private hasFetchedAllProviders = false;

  private hasFetchedSpicyLyrics = false;

  private _updateFooter() {
    // Lit owns the label and icon nodes, including their update markers.
    this.requestUpdate();
  }

  @query('.lyrics-container', true)
  private lyricsContainer?: HTMLElement;

  private lastInstrumentalIndex: number | null = null;

  private userScrollTimeoutId?: number;

  private isUserScrolling = false;

  private isProgrammaticScroll = false;

  private isClickSeeking = false;

  private clickSeekTimeout?: ReturnType<typeof setTimeout>;

  // Cached DOM elements for animation updates
  private cachedLyricsLines: HTMLElement[] = [];

  // Cached line elements array for scroll/position queries
  private cachedLineArray: HTMLElement[] = [];

  // Cached line and gap element maps for fast lookup
  private lineElementCache = new Map<number, HTMLElement>();

  private gapElementCache = new Map<number, HTMLElement>();

  private gapAnimations = new Map<
    HTMLElement,
    { animations: Animation[]; end: number }
  >();

  private gapDotCache = new WeakMap<HTMLElement, HTMLElement[]>();

  private gapExitDurationCache = new WeakMap<HTMLElement, number>();

  private gapCollapseDurationCache = new WeakMap<HTMLElement, number>();

  private footerElement?: HTMLElement;

  // Cached gap computation results
  private cachedAllGaps: Array<{
    insertBeforeIndex: number;
    gapStart: number;
    gapEnd: number;
  }> = [];

  private gapsCached = false;

  // Cached isUnsynced flag
  private cachedIsUnsynced = false;

  // Cached pre-computed line data for render
  private cachedLineData: Array<{
    wordGroups: Syllable[][];
    groupGrowable: boolean[];
    groupGlowing: boolean[];
    groupCharRise: boolean[];
    groupCharDrag: boolean[];
    vwFullDuration: number[];
    vwCharOffset: number[];
    vwStartMs: number[];
    vwEndMs: number[];
    lineIsRTL: boolean;
    mainEnd: number;
    overlapWordEnds: number[];
    substantialOverlap: boolean;
    backgroundEnd: number;
  }> | null = null;

  private backgroundTailIndices: number[] = [];

  // Active line tracking
  private activeLineIds: Set<string> = new Set();

  private currentPrimaryActiveLine: HTMLElement | null = null;

  private lastPrimaryActiveLine: HTMLElement | null = null;

  private backgroundExpandedLines = new Set<HTMLElement>();

  private backgroundAnimations = new Map<HTMLElement, Animation>();

  private pendingRenderLayout?: LyricLayout;

  private contentSprings = new Map<
    HTMLElement,
    { animation: Animation; position: number; velocity: number }
  >();

  private currentScrollOffset = 0;

  // AbortController for cancelling in-flight lyrics fetches
  private fetchAbortController?: AbortController;

  // Syllable animation tracking
  private lastActiveIndex = 0;

  private visibleLineIds: Set<string> = new Set();

  // IntersectionObserver for viewport virtualization
  private visibilityObserver?: IntersectionObserver;

  // Cached element tracking to avoid repeated querySelectorAll calls
  private preActiveLineElements: HTMLElement[] = [];

  private progressiveBlurLine: HTMLElement | null = null;

  private progressiveBlurAnimation?: Animation;

  private positionedLineElements: HTMLElement[] = [];

  private activeGapLineElements: HTMLElement[] = [];

  // Bound handler references for proper event listener removal
  private _boundHandleUserScroll = this.handleUserScroll.bind(this);

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      'visibilitychange',
      this.handlePlaybackVisibility,
    );
    this.motionPreference = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    );
    this.systemReducedMotion = this.motionPreference.matches;
    this.motionPreference.addEventListener(
      'change',
      this.handleMotionPreference,
    );
    this.fetchLyrics();
  }

  disconnectedCallback() {
    this.cancelPlaybackTick();
    this.clockAdvancing = false;
    this.lastHostTime = undefined;
    this.heldPlaybackAnimations.clear();
    document.removeEventListener(
      'visibilitychange',
      this.handlePlaybackVisibility,
    );
    this.finishLineRewind();
    this.pendingLayoutOffsets.clear();
    this.clearGapAnimations();
    super.disconnectedCallback();
    this.motionPreference?.removeEventListener(
      'change',
      this.handleMotionPreference,
    );
    this.motionPreference = undefined;
    this.cancelLineScrollAnimation();
    this.lyricsContainer
      ?.querySelectorAll<HTMLElement>('.native-motion')
      .forEach(char => AmLyrics.clearCharacterMotion(char));
    this.lyricsContainer
      ?.querySelectorAll<HTMLElement>('.lyrics-word')
      .forEach(word => {
        AmLyrics.clearNormalWordMotion(word);
        AmLyrics.clearWordWipe(word);
      });
    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
      this.userScrollTimeoutId = undefined;
    }
    if (this.clickSeekTimeout) {
      clearTimeout(this.clickSeekTimeout);
      this.clickSeekTimeout = undefined;
    }
    this.clearBackgroundExpandedLine();
    this.clearProgressiveBlurLine();
    // Cancel any in-flight fetch requests
    this.fetchAbortController?.abort();
    this.fetchAbortController = undefined;
    // Remove scroll event listeners
    if (this.lyricsContainer) {
      this.lyricsContainer.removeEventListener(
        'wheel',
        this._boundHandleUserScroll,
      );
      this.lyricsContainer.removeEventListener(
        'touchmove',
        this._boundHandleUserScroll,
      );
    }
    this.preActiveLineElements = [];
    this.positionedLineElements = [];
    this.clearGapAnimations();
    this.activeGapLineElements = [];
    this.lastInstrumentalIndex = null;
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = undefined;
  }

  private async fetchLyrics() {
    this.cancelPlaybackTick();
    this.clockAdvancing = false;
    this.lastHostTime = undefined;
    this.heldPlaybackAnimations.clear();
    // Cancel any in-flight fetch to prevent stale results from racing
    this.fetchAbortController?.abort();
    const controller = new AbortController();
    this.fetchAbortController = controller;

    this.isLoading = true;
    this.sourceUpgrade = false;
    this.lyrics = undefined;
    this.lyricsSource = null;
    this.availableSources = [];
    this.currentSourceIndex = 0;
    this.isFetchingAlternatives = false;
    this.sourceSwitchPending = false;
    this.selectedSourceKey = null;
    this.hasFetchedAllProviders = false;
    this.hasFetchedSpicyLyrics = false;
    this._updateFooter();
    try {
      if (this.ttml) {
        const parseResult = AmLyrics.parseTTML(this.ttml);
        if (parseResult && parseResult.lines.length > 0) {
          this.lyrics = parseResult.lines;
          this.lyricsSource = 'Local';
          if (parseResult.songwriters) {
            this.songwriters = parseResult.songwriters;
          }
          this.availableSources = [
            {
              lines: this.lyrics,
              source: 'Local',
              originalTTML: this.ttml,
              songwriters: this.songwriters,
            },
          ];
          this.currentSourceIndex = 0;
          this.hasFetchedAllProviders = true;
          this._updateFooter();
          await this.onLyricsLoaded();
          return;
        }
      }

      const lrcRedResult = await AmLyrics.fetchLyricsFromLrcRed(
        this.songTitle?.trim() || '',
        this.songArtist?.trim() || '',
        this.isrc?.trim(),
        {
          album: this.songAlbum?.trim(),
          durationMs: this.songDurationMs || this.duration,
        },
        this.query?.trim(),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (
        lrcRedResult &&
        !lrcRedResult.byModel &&
        AmLyrics.hasWordSyncedLyrics(lrcRedResult.lines)
      ) {
        this.availableSources = [lrcRedResult];
        this.lyrics = lrcRedResult.lines;
        this.lyricsSource = lrcRedResult.source;
        if (lrcRedResult.songwriters) {
          this.songwriters = lrcRedResult.songwriters;
        }
        this._updateFooter();
        await this.onLyricsLoaded();
        return;
      }

      this.isFetchingAlternatives = true;
      if (lrcRedResult) {
        await this.publishAvailableSources([lrcRedResult], controller.signal);
      }

      const resolvedMetadata = await this.resolveSongMetadata(
        lrcRedResult?.metadata,
      );
      // If a newer fetch was triggered while we awaited, bail out
      if (controller.signal.aborted) return;

      const isMusicIdOnlyRequest =
        Boolean(this.musicId) &&
        !this.songTitle &&
        !this.songArtist &&
        !this.query &&
        !this.isrc;

      const collectedSources: YouLyPlusLyricsResult[] = lrcRedResult
        ? [lrcRedResult]
        : [];
      const hasWordSync = (sources: YouLyPlusLyricsResult[]) =>
        sources.some(s => !s.byModel && AmLyrics.hasWordSyncedLyrics(s.lines));

      if (resolvedMetadata?.metadata && !isMusicIdOnlyRequest) {
        const title = resolvedMetadata.metadata.title?.trim() || '';
        const artist = resolvedMetadata.metadata.artist?.trim() || '';

        if (!lrcRedResult?.byModel) {
          const biniResult = await AmLyrics.fetchLyricsFromBiniLyrics(
            title,
            artist,
            resolvedMetadata.catalogIsrc,
            resolvedMetadata.metadata,
          );
          if (controller.signal.aborted) return;
          if (biniResult?.lines.length) {
            collectedSources.push(biniResult);
            await this.publishAvailableSources(
              collectedSources,
              controller.signal,
            );
          }
        }
      }

      if (lrcRedResult?.byModel || !hasWordSync(collectedSources)) {
        const spicyResult = await this.fetchLyricsFromSpicyLyrics(
          resolvedMetadata.spotifyId,
          controller.signal,
          lrcRedResult?.isrc || resolvedMetadata.catalogIsrc,
          resolvedMetadata.metadata,
        );
        if (controller.signal.aborted) return;
        if (spicyResult) {
          collectedSources.push(spicyResult);
          await this.publishAvailableSources(
            collectedSources,
            controller.signal,
          );
        }
      }

      const unisonIsrc = lrcRedResult?.isrc || resolvedMetadata.catalogIsrc;
      if (
        (resolvedMetadata.metadata || unisonIsrc) &&
        !isMusicIdOnlyRequest &&
        !hasWordSync(collectedSources)
      ) {
        const unisonResult = await AmLyrics.fetchLyricsFromUnison(
          resolvedMetadata.metadata,
          unisonIsrc,
        );
        if (unisonResult && unisonResult.lines.length > 0) {
          collectedSources.push(unisonResult);
          await this.publishAvailableSources(
            collectedSources,
            controller.signal,
          );
        }
        if (controller.signal.aborted) return;
      }

      if (resolvedMetadata?.metadata && !isMusicIdOnlyRequest) {
        const { title, artist } = resolvedMetadata.metadata;
        if (!hasWordSync(collectedSources)) {
          const youLyResults = await AmLyrics.fetchLyricsFromYouLyPlus(
            title,
            artist,
            resolvedMetadata.catalogIsrc,
            resolvedMetadata.metadata,
            true,
          );

          if (youLyResults && youLyResults.length > 0) {
            collectedSources.push(...youLyResults);
            await this.publishAvailableSources(
              collectedSources,
              controller.signal,
            );
          }
          if (controller.signal.aborted) return;
        }
      }

      const hasLineSync = (sources: YouLyPlusLyricsResult[]) =>
        sources.some(
          s =>
            AmLyrics.hasWordSyncedLyrics(s.lines) ||
            (!s.byModel && AmLyrics.getTimingRank(s.lines) < 2),
        );

      if (
        (collectedSources.length === 0 || !hasLineSync(collectedSources)) &&
        resolvedMetadata?.metadata
      ) {
        // Fallback: LRCLIB
        const lrclibResult = await AmLyrics.fetchLyricsFromLrclib(
          resolvedMetadata.metadata,
        );
        if (lrclibResult && lrclibResult.lines.length > 0) {
          collectedSources.push({
            lines: lrclibResult.lines,
            source: 'LRCLIB',
          });
        }
      }

      if (collectedSources.length === 0 && resolvedMetadata?.metadata) {
        const geniusResult = await AmLyrics.fetchLyricsFromGenius(
          resolvedMetadata.metadata,
        );
        if (geniusResult && geniusResult.lines.length > 0) {
          collectedSources.push({
            lines: geniusResult.lines,
            source: 'Genius',
          });
        }
      }

      if (controller.signal.aborted) return;
      this.hasFetchedAllProviders =
        collectedSources.length === 0 ||
        collectedSources.some(
          s => s.source === 'LRCLIB' || s.source === 'Genius',
        );
      this._updateFooter();

      const published = await this.publishAvailableSources(
        collectedSources,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (published) {
        if (!this.noAutoAlternates) await this.autoProcessLyrics();
        return;
      }

      this.lyrics = undefined;
      this.lyricsSource = null;
    } finally {
      // Only update loading state if this fetch wasn't superseded
      if (!controller.signal.aborted) {
        this.isLoading = false;
        this.isFetchingAlternatives = false;
        this.sourceSwitchPending = false;
        this._updateFooter();
      }
    }
  }

  private async publishAvailableSources(
    sources: YouLyPlusLyricsResult[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted) return false;
    const previousSource = this.availableSources[this.findCurrentSourceIndex()];
    this.availableSources = AmLyrics.mergeAndSortSources(sources);
    const best = this.availableSources[0];
    if (!best) return false;
    let selected =
      this.availableSources.find(
        source =>
          AmLyrics.getSourceKey(source.source) === this.selectedSourceKey,
      ) || best;
    if (this.sourceSwitchPending) {
      const currentKey = AmLyrics.getSourceKey(this.lyricsSource);
      const alternative = this.availableSources.find(
        source => AmLyrics.getSourceKey(source.source) !== currentKey,
      );
      if (alternative) {
        selected = alternative;
        this.selectedSourceKey = AmLyrics.getSourceKey(selected.source);
        this.sourceSwitchPending = false;
      }
    }
    this.currentSourceIndex = this.availableSources.indexOf(selected);
    this.isLoading = false;
    if (
      !this.lyrics ||
      previousSource?.lines !== selected.lines ||
      this.lyricsSource !== selected.source
    ) {
      this.sourceUpgrade = Boolean(this.lyrics);
      this.lyrics = selected.lines;
      this.lyricsSource = selected.source;
      this.songwriters = selected.songwriters;
      await this.onLyricsLoaded(false);
    }
    this._updateFooter();
    return true;
  }

  private sourceUpgrade = false;

  private async onLyricsLoaded(processAlternates = true) {
    this.activeLineIndices = [];
    this.preActiveLineElements = [];
    this.positionedLineElements = [];
    this.clearGapAnimations();
    this.activeGapLineElements = [];
    this.lastInstrumentalIndex = null;
    this.clearBackgroundExpandedLine();

    if (this.lyricsContainer) {
      this.isProgrammaticScroll = true;
      this.lyricsContainer.scrollTop = 0;
      window.setTimeout(() => {
        this.isProgrammaticScroll = false;
      }, 100);
    }

    if (processAlternates && !this.noAutoAlternates)
      await this.autoProcessLyrics();
  }

  private async autoProcessLyrics() {
    if (this.noAutoAlternates) return;
    if (this.showRomanization) {
      await this.applyRomanization();
    }
    if (this.showTranslation && !this.noAutoAlternates) {
      await this.applyTranslation();
    }
  }

  private static hasWordSyncedLyrics(lines: LyricsLine[]): boolean {
    return lines.some(
      line =>
        line.text.some(
          s => s.text.trim() && (s.timestamp > 0 || s.endtime > 0),
        ) &&
        (line.isWordSynced ??
          (line.text.length > 1 && !line.text.every(s => s.lineSynced))),
    );
  }

  private static getTimingRank(lines: LyricsLine[]): number {
    if (AmLyrics.hasWordSyncedLyrics(lines)) return 0;
    return lines.some(
      line =>
        line.text.some(s => s.text.trim()) &&
        (line.timestamp > 0 || line.endtime > 0),
    )
      ? 1
      : 2;
  }

  private static getRankForCollected(sourceLabel: string): number {
    const lower = sourceLabel.trim().toLowerCase();
    if (lower === 'lrc.red') return 0;
    // Spicy catalogue labels belong to Spicy, including "(Apple Music)".
    if (lower.startsWith('spicy lyrics')) return 2.5;
    if (lower.includes('apple')) return 1;
    if (lower.includes('bini')) return 2;
    if (lower.includes('unison')) return 3;
    if (lower.includes('qq') || lower.includes('lyricsplus')) return 4;
    if (lower.includes('musixmatch')) return 5;
    if (lower.includes('lrclib')) return 6;
    if (lower.includes('genius')) return 8;
    return 7;
  }

  private static compareSources(
    a: YouLyPlusLyricsResult,
    b: YouLyPlusLyricsResult,
  ): number {
    // Word > line > plain; prefer non-model results within each timing tier.
    return (
      AmLyrics.getTimingRank(a.lines) - AmLyrics.getTimingRank(b.lines) ||
      Number(Boolean(a.byModel)) - Number(Boolean(b.byModel)) ||
      AmLyrics.getRankForCollected(a.source) -
        AmLyrics.getRankForCollected(b.source)
    );
  }

  private static getDisplaySourceLabel(sourceLabel: string): string {
    return sourceLabel.toLowerCase().includes('lyricsplus')
      ? 'QQ'
      : sourceLabel;
  }

  private static getSourceKey(sourceLabel: string | null | undefined): string {
    const lower = (sourceLabel || '').trim().toLowerCase();
    if (!lower) return '';
    if (lower.includes('lyricsplus') || lower === 'qq') return 'qq';
    return lower.replace(/\s+/g, ' ');
  }

  private static mergeAndSortSources(
    collectedSources: YouLyPlusLyricsResult[],
  ): YouLyPlusLyricsResult[] {
    const uniqueSourcesMap = new Map<string, YouLyPlusLyricsResult>();

    collectedSources.forEach(source => {
      if (!source.lines.some(line => line.text.some(s => s.text.trim())))
        return;
      const key = AmLyrics.getSourceKey(source.source);
      const previous = uniqueSourcesMap.get(key);
      if (!previous || AmLyrics.compareSources(source, previous) < 0) {
        uniqueSourcesMap.set(key, {
          ...source,
          source: AmLyrics.getDisplaySourceLabel(source.source),
        });
      }
    });

    return Array.from(uniqueSourcesMap.values()).sort(AmLyrics.compareSources);
  }

  private findCurrentSourceIndex(
    sources = this.availableSources,
    sourceLabel = this.lyricsSource,
    lines = this.lyrics,
  ): number {
    const identityIndex = sources.findIndex(source => source.lines === lines);
    if (identityIndex !== -1) return identityIndex;

    const sourceKey = AmLyrics.getSourceKey(sourceLabel);
    if (!sourceKey) return -1;

    return sources.findIndex(
      source => AmLyrics.getSourceKey(source.source) === sourceKey,
    );
  }

  private static getNextSourceIndex(
    sources: YouLyPlusLyricsResult[],
    currentIndex: number,
    currentSourceLabel: string | null,
    currentLines: LyricsLine[] | undefined,
  ): number {
    if (sources.length <= 1) return -1;

    if (currentIndex !== -1) {
      return (currentIndex + 1) % sources.length;
    }

    const currentKey = AmLyrics.getSourceKey(currentSourceLabel);
    const fallbackIndex = sources.findIndex(
      source =>
        source.lines !== currentLines &&
        AmLyrics.getSourceKey(source.source) !== currentKey,
    );

    return fallbackIndex === -1 ? 0 : fallbackIndex;
  }

  private async applySourceAtIndex(index: number) {
    const sourceResult = this.availableSources[index];
    if (!sourceResult) return;

    this.currentSourceIndex = index;
    this.sourceUpgrade = Boolean(this.lyrics);
    this.lyrics = sourceResult.lines;
    this.lyricsSource = sourceResult.source;
    this.songwriters = sourceResult.songwriters;
    await this.onLyricsLoaded();
  }

  private async switchSource() {
    const controller = this.fetchAbortController;
    if (this.availableSources.length > 1) {
      const nextIndex = AmLyrics.getNextSourceIndex(
        this.availableSources,
        this.findCurrentSourceIndex(),
        this.lyricsSource,
        this.lyrics,
      );
      if (nextIndex !== -1) {
        this.selectedSourceKey = AmLyrics.getSourceKey(
          this.availableSources[nextIndex].source,
        );
        this.sourceSwitchPending = false;
        await this.applySourceAtIndex(nextIndex);
      }
    } else if (!this.hasFetchedAllProviders) {
      this.sourceSwitchPending = true;
    }

    if (
      controller !== this.fetchAbortController ||
      controller?.signal.aborted ||
      this.isFetchingAlternatives ||
      this.hasFetchedAllProviders
    )
      return;

    await this.discoverAlternativeSources();
  }

  private async discoverAlternativeSources(): Promise<void> {
    const controller = this.fetchAbortController;
    const isCurrent = () =>
      this.isConnected &&
      controller === this.fetchAbortController &&
      !controller?.signal.aborted;
    const publish = async (sources: YouLyPlusLyricsResult[]) => {
      if (isCurrent() && sources.length)
        await this.publishAvailableSources(
          [...this.availableSources, ...sources],
          controller?.signal,
        );
    };
    let completed = false;

    this.isFetchingAlternatives = true;
    this._updateFooter();
    try {
      const resolvedMetadata = await this.resolveSongMetadata(
        this.availableSources.find(s => s.source === 'lrc.red')?.metadata,
      );
      if (!isCurrent()) return;
      if (
        resolvedMetadata.metadata &&
        !this.availableSources.some(s => s.byModel) &&
        !this.availableSources.some(s =>
          s.source.toLowerCase().includes('bini'),
        )
      ) {
        const biniResult = await AmLyrics.fetchLyricsFromBiniLyrics(
          resolvedMetadata.metadata.title,
          resolvedMetadata.metadata.artist,
          resolvedMetadata.catalogIsrc,
          resolvedMetadata.metadata,
        );
        if (!isCurrent()) return;
        if (biniResult) await publish([biniResult]);
      }

      if (!this.hasFetchedSpicyLyrics) {
        const spicyResult = await this.fetchLyricsFromSpicyLyrics(
          resolvedMetadata.spotifyId,
          controller?.signal,
          this.availableSources.find(s => s.source === 'lrc.red')?.isrc ||
            resolvedMetadata.catalogIsrc,
          resolvedMetadata.metadata,
        );
        if (!isCurrent()) return;
        if (spicyResult) await publish([spicyResult]);
      }

      const unisonIsrc =
        this.availableSources.find(s => s.source === 'lrc.red')?.isrc ||
        resolvedMetadata.catalogIsrc;
      if (
        (resolvedMetadata.metadata || unisonIsrc) &&
        !this.availableSources.some(s =>
          s.source.toLowerCase().includes('unison'),
        )
      ) {
        const unisonResult = await AmLyrics.fetchLyricsFromUnison(
          resolvedMetadata.metadata,
          unisonIsrc,
        );
        if (!isCurrent()) return;
        if (unisonResult && unisonResult.lines.length > 0)
          await publish([unisonResult]);
      }

      if (resolvedMetadata.metadata) {
        // Only a non-model Apple word result completes the KPoe upgrade search.
        if (
          !this.availableSources.some(
            s =>
              !s.byModel &&
              AmLyrics.getRankForCollected(s.source) === 1 &&
              AmLyrics.hasWordSyncedLyrics(s.lines),
          )
        ) {
          const title = resolvedMetadata.metadata.title?.trim() || '';
          const artist = resolvedMetadata.metadata.artist?.trim() || '';
          const youLyResults = await AmLyrics.fetchLyricsFromYouLyPlus(
            title,
            artist,
            resolvedMetadata.catalogIsrc,
            resolvedMetadata.metadata,
            true,
          );
          if (!isCurrent()) return;
          if (youLyResults && youLyResults.length > 0) {
            await publish(youLyResults);
          }
        }

        // Try LRCLIB if not fetched
        if (
          !this.availableSources.some(s =>
            s.source.toLowerCase().includes('lrclib'),
          )
        ) {
          const lrclibResult = await AmLyrics.fetchLyricsFromLrclib(
            resolvedMetadata.metadata,
          );
          if (!isCurrent()) return;
          if (lrclibResult && lrclibResult.lines.length > 0) {
            await publish([{ ...lrclibResult, source: 'LRCLIB' }]);
          }
        }

        if (
          !this.availableSources.some(s =>
            s.source.toLowerCase().includes('genius'),
          )
        ) {
          const geniusResult = await AmLyrics.fetchLyricsFromGenius(
            resolvedMetadata.metadata,
          );
          if (!isCurrent()) return;
          if (geniusResult && geniusResult.lines.length > 0) {
            await publish([{ ...geniusResult, source: 'Genius' }]);
          }
        }
      }
      completed = true;
    } catch (error) {
      // Keep available sources usable and allow another discovery attempt.
      // eslint-disable-next-line no-console
      console.warn('Alternative lyrics search failed', error);
    } finally {
      if (isCurrent()) {
        this.hasFetchedAllProviders = completed;
        this.isFetchingAlternatives = false;
        this.sourceSwitchPending = false;
        this._updateFooter();
      }
    }
  }

  private async resolveSongMetadata(
    fallback?: SongMetadata,
  ): Promise<ResolvedMetadata> {
    const metadata: SongMetadata = {
      title: this.songTitle?.trim() || fallback?.title || '',
      artist: this.songArtist?.trim() || fallback?.artist || '',
      album: this.songAlbum?.trim() || fallback?.album,
      songwriters: this.songwriters?.trim() || undefined,
      durationMs: fallback?.durationMs,
    };

    if (typeof this.songDurationMs === 'number' && this.songDurationMs > 0) {
      metadata.durationMs = this.songDurationMs;
    } else if (typeof this.duration === 'number' && this.duration > 0) {
      metadata.durationMs = this.duration;
    }

    const appleSong: any = null;
    let appleId = this.musicId;
    let catalogIsrc: string | undefined = this.isrc;

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
        if (!metadata.songwriters && catalogResult.songwriters) {
          metadata.songwriters = catalogResult.songwriters;
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
      spotifyId: this.spotifyId?.trim() || catalogResult?.id?.spotify,
    };
  }

  private static spotifyToken?: { value: string; expiresAt: number };

  private static spotifyTokenRequest?: Promise<string | null>;

  private static async lookupSpotifyIdByIsrc(
    isrc: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    if (signal.aborted) return undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, BINIMUM_LOOKUP_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://link.binimum.org/api/v1/isrc/${encodeURIComponent(isrc.trim())}`,
        { signal: controller.signal },
      );
      if (!response.ok) return undefined;
      const data = await response.json();
      return typeof data?.spotify === 'string' &&
        /^[A-Za-z0-9]{22}$/.test(data.spotify)
        ? data.spotify
        : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }

  private static async getSpotifyToken(): Promise<string | null> {
    if (AmLyrics.spotifyToken && AmLyrics.spotifyToken.expiresAt > Date.now())
      return AmLyrics.spotifyToken.value;
    if (AmLyrics.spotifyTokenRequest) return AmLyrics.spotifyTokenRequest;

    // Share one request across component instances; a track change must not
    // cancel a refresh that another instance is still waiting for.
    AmLyrics.spotifyTokenRequest = (async () => {
      const requestedAt = Date.now();
      try {
        const response = await fetchWithTimeout(SPOTIFY_TOKEN_URL, {
          method: 'POST',
        });
        if (!response.ok) return null;
        const payload = await response.json();
        const lifetime = payload.expires_in * 1000;
        if (
          typeof payload.access_token !== 'string' ||
          !payload.access_token.trim() ||
          !Number.isFinite(lifetime) ||
          lifetime <= 0
        )
          return null;
        AmLyrics.spotifyToken = {
          value: payload.access_token,
          expiresAt: requestedAt + lifetime - Math.min(30000, lifetime * 0.1),
        };
        return AmLyrics.spotifyToken.value;
      } catch {
        return null;
      }
    })();
    try {
      return await AmLyrics.spotifyTokenRequest;
    } finally {
      AmLyrics.spotifyTokenRequest = undefined;
    }
  }

  private async fetchLyricsFromSpicyLyrics(
    spotifyId?: string,
    signal?: AbortSignal,
    isrc?: string,
    metadata?: SongMetadata,
  ): Promise<YouLyPlusLyricsResult | null> {
    this.hasFetchedSpicyLyrics = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) return null;
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, FETCH_TIMEOUT_MS);
    try {
      let trackId = spotifyId;
      if (!trackId && isrc) {
        trackId = await AmLyrics.lookupSpotifyIdByIsrc(isrc, controller.signal);
        if (controller.signal.aborted) return null;
      }
      if (!trackId) {
        let searchTerm = isrc ? `isrc:${isrc}` : '';
        if (!searchTerm && metadata?.title && metadata.artist)
          searchTerm = `track:${metadata.title} artist:${metadata.artist}`;
        if (!searchTerm) return null;
        const search = new URLSearchParams({
          q: searchTerm,
          type: 'track',
          limit: isrc ? '1' : '5',
        });
        let token = await AmLyrics.getSpotifyToken();
        if (!token || controller.signal.aborted) return null;
        const lookupTrack = (accessToken: string) =>
          fetch(`https://api.spotify.com/v1/search?${search}`, {
            signal: controller.signal,
            headers: { Authorization: `Bearer ${accessToken}` },
          });
        let lookup = await lookupTrack(token);
        if (lookup.status === 401) {
          if (AmLyrics.spotifyToken?.value === token)
            AmLyrics.spotifyToken = undefined;
          token = await AmLyrics.getSpotifyToken();
          if (!token || controller.signal.aborted) return null;
          lookup = await lookupTrack(token);
        }
        if (!lookup.ok) return null;
        const result = await lookup.json();
        const tracks = Array.isArray(result?.tracks?.items)
          ? result.tracks.items
          : [];
        const normalize = (value: string) =>
          value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
        const match = isrc
          ? tracks.find(
              (track: any) =>
                !track.external_ids?.isrc ||
                track.external_ids.isrc.toUpperCase() === isrc.toUpperCase(),
            )
          : tracks.find(
              (track: any) =>
                normalize(track.name || '') === normalize(metadata!.title) &&
                track.artists?.some(
                  (artist: any) =>
                    normalize(artist.name || '') ===
                    normalize(metadata!.artist),
                ) &&
                (!metadata!.durationMs ||
                  Math.abs(track.duration_ms - metadata!.durationMs) <= 3000),
            );
        trackId = match?.id;
      }
      if (!trackId || !/^[A-Za-z0-9]{22}$/.test(trackId)) return null;
      const response = await fetch(
        `https://api.spicylyrics.org/v1/lyrics/${encodeURIComponent(trackId)}`,
        {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${SPICY_LYRICS_CLIENT_KEY}` },
        },
      );
      if (!response.ok) return null;
      return parseSpicyLyrics(await response.json());
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
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
        const response = await fetchWithTimeout(url);
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

  private static async fetchLyricsFromLrcRed(
    title: string,
    artist: string,
    isrc?: string,
    metadata: { durationMs?: number; album?: string } = {},
    searchQuery = '',
    signal: AbortSignal | undefined = undefined,
  ): Promise<YouLyPlusLyricsResult | null> {
    if (signal?.aborted) return null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeoutId = setTimeout(() => controller.abort(), LRC_RED_TIMEOUT_MS);
    try {
      const fetchSong = async (trackIsrc: string) => {
        try {
          const response = await fetch(
            `https://lrc.red/s/${encodeURIComponent(trackIsrc)}.song.json`,
            { signal: controller.signal },
          );
          if (!response.ok) return null;
          const song = await response.json();
          // The JSON also carries the original TTML, including its alternates
          // and background vocals. Keep that for lossless rendering/downloads.
          const originalTTML =
            typeof song.source === 'string' ? song.source : undefined;
          const parsed = originalTTML ? AmLyrics.parseTTML(originalTTML) : null;
          const lines = parsed?.lines.length
            ? parsed.lines
            : AmLyrics.parseLrcRedJson(song);
          if (!lines.length) return null;
          return {
            lines,
            source: 'lrc.red',
            originalTTML,
            byModel: song.byModel === true,
            isrc: trackIsrc,
            metadata:
              typeof song.title === 'string' && typeof song.artist === 'string'
                ? {
                    title: song.title,
                    artist: song.artist,
                    album:
                      typeof song.album === 'string' ? song.album : undefined,
                    durationMs: secondsToMs(song.duration) || undefined,
                  }
                : undefined,
            songwriters: Array.isArray(song.songwriters)
              ? song.songwriters.join(', ')
              : parsed?.songwriters,
          };
        } catch {
          return null;
        }
      };

      if (isrc) {
        const result = await fetchSong(isrc);
        if (result) return result;
        if (controller.signal.aborted) return null;
      }

      let url: string;
      if (title && artist) {
        const params = new URLSearchParams({ track: title, artist });
        if (metadata.album) params.set('album', metadata.album);
        if (
          metadata.durationMs &&
          Number.isFinite(metadata.durationMs) &&
          metadata.durationMs > 0
        ) {
          params.set(
            'duration',
            Math.round(metadata.durationMs / 1000).toString(),
          );
        }
        url = `https://lrc.red/match.json?${params.toString()}`;
      } else if (searchQuery) {
        url = `https://lrc.red/search.json?${new URLSearchParams({ q: searchQuery })}`;
      } else {
        return null;
      }

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        const payload = await response.json();
        const hit = Array.isArray(payload?.hits) ? payload.hits[0] : undefined;
        if (typeof hit?.isrc === 'string' && hit.isrc.trim()) {
          return await fetchSong(hit.isrc.trim());
        }
      } catch {
        // Continue with the existing providers when lrc.red is unavailable.
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abort);
    }
  }

  private static parseLrcRedJson(song: any): LyricsLine[] {
    const entries = song?.lyrics?.lines;
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((line: any): LyricsLine[] => {
      if (typeof line?.text !== 'string' || !line.text.trim()) return [];
      const timestamp = secondsToMs(line.begin);
      const endtime = secondsToMs(line.end, timestamp);
      const wordSynced =
        song.lyrics.sync === 'word' &&
        Array.isArray(line.words) &&
        line.words.length > 0;
      const text: Syllable[] = wordSynced
        ? line.words.flatMap((word: any[], wordIndex: number) =>
            Array.isArray(word)
              ? word.map((syllable: any, index: number) => {
                  const part = index < word.length - 1;
                  const space =
                    !part && wordIndex < line.words.length - 1 ? ' ' : '';
                  return {
                    text: `${syllable.text || ''}${space}`,
                    part,
                    timestamp: secondsToMs(syllable.begin, timestamp),
                    endtime: secondsToMs(syllable.end, endtime),
                  };
                })
              : [],
          )
        : [
            {
              text: line.text,
              part: false,
              timestamp,
              endtime,
              lineSynced: true,
            },
          ];
      return text.length
        ? [
            {
              text,
              background: false,
              backgroundText: [],
              oppositeTurn: line.voice === 'b',
              agentId: line.voice,
              timestamp,
              endtime,
              isWordSynced: wordSynced,
            },
          ]
        : [];
    });
  }

  private static async fetchLyricsFromBiniLyrics(
    title: string,
    artist: string,
    isrc?: string,
    metadata: { durationMs?: number; album?: string } = {},
  ): Promise<YouLyPlusLyricsResult | null> {
    if ((!title || !artist) && !isrc) return null;

    try {
      let cacheData: any = null;

      if (isrc) {
        try {
          const isrcUrl = `https://lyrics-api.binimum.org/?isrc=${encodeURIComponent(isrc)}`;
          const isrcRes = await fetchWithTimeout(isrcUrl);
          if (isrcRes.ok) {
            const data = await isrcRes.json();
            if (data.results && data.results.length > 0) {
              cacheData = data;
            }
          }
        } catch {
          // Fall through to title/artist search
        }
      }

      if (!cacheData && title && artist) {
        const cacheParams = new URLSearchParams({
          track: title,
          artist,
        });
        if (metadata.album) {
          cacheParams.append('album', metadata.album);
        }
        if (metadata.durationMs && metadata.durationMs > 0) {
          cacheParams.append(
            'duration',
            Math.round(metadata.durationMs / 1000).toString(),
          );
        }

        const cacheUrl = `https://lyrics-api.binimum.org/?${cacheParams.toString()}`;
        const cacheRes = await fetchWithTimeout(cacheUrl);
        if (cacheRes.ok) {
          cacheData = await cacheRes.json();
        }
      }

      if (cacheData && cacheData.results && cacheData.results.length > 0) {
        const result = cacheData.results[0];
        if (result.lyricsUrl) {
          const ttmlRes = await fetchWithTimeout(result.lyricsUrl);
          if (ttmlRes.ok) {
            const ttmlText = await ttmlRes.text();
            const parseResult = AmLyrics.parseTTML(ttmlText);
            if (parseResult && parseResult.lines.length > 0) {
              return {
                lines: parseResult.lines,
                source: 'BiniLyrics',
                originalTTML: ttmlText,
                songwriters: parseResult.songwriters,
              };
            }
          }
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Cache API failed', e);
    }

    return null;
  }

  private static async fetchLyricsFromYouLyPlus(
    title: string,
    artist: string,
    isrc?: string,
    metadata: { durationMs?: number; album?: string } = {},
    skipBiniCache = false,
  ): Promise<YouLyPlusLyricsResult[]> {
    if ((!title || !artist) && !isrc) return [];

    const params = new URLSearchParams();
    if (title) params.append('title', title);
    if (artist) params.append('artist', artist);
    if (isrc) params.append('isrc', isrc);

    if (metadata.album) {
      params.append('album', metadata.album);
    }

    if (metadata.durationMs && metadata.durationMs > 0) {
      params.append(
        'duration',
        Math.round(metadata.durationMs / 1000).toString(),
      );
    }

    if (!DEFAULT_KPOE_SOURCE_ORDER.includes('apple')) {
      params.append('source', DEFAULT_KPOE_SOURCE_ORDER);
    }

    const allResults: YouLyPlusLyricsResult[] = [];

    if (!skipBiniCache) {
      const biniResult = await AmLyrics.fetchLyricsFromBiniLyrics(
        title,
        artist,
        isrc,
        metadata,
      );
      if (biniResult) {
        allResults.push(biniResult);
        if (
          !biniResult.byModel &&
          AmLyrics.hasWordSyncedLyrics(biniResult.lines)
        )
          return allResults;
      }
    }

    // Shuffle servers so we pick a random one first, with all others as fallback
    // Try up to 3 servers to improve reliability when some have CORS or connectivity issues
    const shuffledServers = [...KPOE_SERVERS]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    for (const base of shuffledServers) {
      const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
      const url = `${normalizedBase}/v2/lyrics/get?${params.toString()}`;

      let payload: any = null;

      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetchWithTimeout(url);
        if (response.ok) {
          // eslint-disable-next-line no-await-in-loop
          payload = await response.json();
        }
      } catch {
        payload = null;
      }

      if (payload) {
        const lines = AmLyrics.convertKPoeLyrics(payload);
        if (lines && lines.length > 0) {
          const sourceLabel =
            payload?.metadata?.source ||
            payload?.metadata?.provider ||
            'LyricsPlus (KPoe)';

          const rank = AmLyrics.getRankForCollected(sourceLabel);
          const result = { lines, source: sourceLabel };

          allResults.push(result);

          // If source is Apple synced, we have the best so we can just immediately break the sweep
          if (rank === 1 && AmLyrics.hasWordSyncedLyrics(lines)) {
            break;
          }
        }
      }
    }

    // If we haven't found a completely synced result (rank 1 or 2) among the servers,
    // force an explicit query against lyricsplus.binimum.org looking for word lyrics
    const hasHighRankResult = allResults.some(
      r =>
        AmLyrics.getRankForCollected(r.source) <= 2 &&
        !r.byModel &&
        AmLyrics.hasWordSyncedLyrics(r.lines),
    );

    if (!hasHighRankResult) {
      try {
        const fallbackParams = new URLSearchParams(params);
        const url = `https://lyricsplus.binimum.org/v2/lyrics/get?${fallbackParams.toString()}`;
        const response = await fetchWithTimeout(url);
        if (response.ok) {
          const payload = await response.json();
          if (payload) {
            const lines = AmLyrics.convertKPoeLyrics(payload);
            const sourceLabel =
              payload?.metadata?.source ||
              payload?.metadata?.provider ||
              'LyricsPlus (KPoe)';
            const hasWordSync = lines && AmLyrics.hasWordSyncedLyrics(lines);
            if (lines && lines.length > 0 && hasWordSync) {
              allResults.push({ lines, source: sourceLabel });
            }
          }
        }
      } catch (error) {
        // Explicit fallback failed, ignore
      }
    }

    return AmLyrics.mergeAndSortSources(allResults);
  }

  /**
   * Parse LRC subtitle format into LyricsLine[].
   * Handles "[mm:ss.xx] text" lines.
   */
  private static parseLrcSubtitles(lrc: string): LyricsLine[] {
    if (!lrc || typeof lrc !== 'string') return [];

    const lines: LyricsLine[] = [];
    const rawLines = lrc.split('\n');
    const parsed: { timestamp: number; text: string }[] = [];

    for (const raw of rawLines) {
      const match = raw.match(/^\[(\d{1,3}):(\d{2})\.(\d{2,3})\]\s?(.*)$/);
      if (!match) {
        // Skip non-timestamped lines (headers like [ti:], [ar:], etc.)
        // eslint-disable-next-line no-continue
        continue;
      }
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      let centiseconds = parseInt(match[3], 10);
      // Handle both mm:ss.xx (centiseconds) and mm:ss.xxx (milliseconds)
      if (match[3].length === 3) {
        centiseconds = Math.round(centiseconds / 10);
      }
      const timestamp = (minutes * 60 + seconds) * 1000 + centiseconds * 10;
      const text = match[4] || '';
      parsed.push({ timestamp, text });
    }

    for (let i = 0; i < parsed.length; i += 1) {
      const { timestamp, text } = parsed[i];
      // Endtime is the start of the next line, or timestamp + 5s for the last line
      const endtime =
        i + 1 < parsed.length ? parsed[i + 1].timestamp : timestamp + 5000;

      // Skip empty lines (instrumental gaps)
      if (!text.trim()) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const syllable: Syllable = {
        text,
        part: false,
        timestamp,
        endtime,
        lineSynced: true,
      };

      lines.push({
        text: [syllable],
        background: false,
        backgroundText: [],
        oppositeTurn: false,
        timestamp,
        endtime,
        isWordSynced: false,
      });
    }

    return lines;
  }

  /**
   * Fetch lyrics from LRCLIB.
   * Uses search endpoint, prefers synced lyrics.
   */
  private static async fetchLyricsFromLrclib(
    metadata: SongMetadata,
  ): Promise<YouLyPlusLyricsResult | null> {
    const title = metadata.title?.trim();
    const artist = metadata.artist?.trim();

    if (!title || !artist) return null;

    try {
      const searchQuery = `${artist} ${title}`;
      const params = new URLSearchParams({ q: searchQuery });
      const response = await fetchWithTimeout(
        `https://lrclib.net/api/search?${params.toString()}`,
        {
          headers: {
            'Lrclib-Client': `am-lyrics/${VERSION} (https://github.com/uimaxbai/apple-music-web-components)`,
          },
        },
      );

      if (!response.ok) return null;

      const results = await response.json();
      if (!Array.isArray(results) || results.length === 0) return null;

      // Prefer results with synced lyrics
      const withSynced = results.find(
        (r: any) => r.syncedLyrics && typeof r.syncedLyrics === 'string',
      );
      const bestMatch = withSynced || results[0];

      // Try synced lyrics first
      if (bestMatch.syncedLyrics) {
        const lines = AmLyrics.parseLrcSubtitles(bestMatch.syncedLyrics);
        if (lines.length > 0) {
          return { lines, source: 'LRCLIB' };
        }
      }

      // Fall back to plain lyrics (unsynced)
      if (bestMatch.plainLyrics && typeof bestMatch.plainLyrics === 'string') {
        const plainLines = bestMatch.plainLyrics
          .split('\n')
          .filter((l: string) => l.trim());
        if (plainLines.length > 0) {
          const lines: LyricsLine[] = plainLines.map(
            (text: string): LyricsLine => ({
              text: [
                {
                  text,
                  part: false,
                  timestamp: 0,
                  endtime: 0,
                },
              ],
              background: false,
              backgroundText: [],
              oppositeTurn: false,
              timestamp: 0,
              endtime: 0,
              isWordSynced: false,
            }),
          );
          return { lines, source: 'LRCLIB (unsynced)' };
        }
      }
    } catch {
      // LRCLIB fetch failed
    }

    return null;
  }

  private static async fetchLyricsFromGenius(
    metadata: SongMetadata,
  ): Promise<YouLyPlusLyricsResult | null> {
    const title = metadata.title?.trim();
    const artist = metadata.artist?.trim();

    if (!title || !artist) return null;

    try {
      const params = new URLSearchParams({ title, artist });
      const response = await fetchWithTimeout(
        `${GENIUS_WORKER_URL}?${params.toString()}`,
      );

      if (!response.ok) return null;
      const data = await response.json();

      if (data.lyrics) {
        const plainLines = data.lyrics
          .split('\n')
          .map((l: string) => l.trim())
          .filter((l: string) => l && !l.startsWith('['));

        if (plainLines.length > 0) {
          const lines: LyricsLine[] = plainLines.map(
            (text: string): LyricsLine => ({
              text: [
                {
                  text,
                  part: false,
                  timestamp: 0,
                  endtime: 0,
                },
              ],
              background: false,
              backgroundText: [],
              oppositeTurn: false,
              timestamp: 0,
              endtime: 0,
              isWordSynced: false,
            }),
          );
          return { lines, source: 'Genius' };
        }
      }
    } catch {
      // Genius fetch failed, will fall through to return null
    }

    return null;
  }

  private static async fetchLyricsFromUnison(
    metadata?: SongMetadata,
    isrc?: string,
  ): Promise<YouLyPlusLyricsResult | null> {
    const title = metadata?.title?.trim();
    const artist = metadata?.artist?.trim();
    const recordingIsrc = isrc?.trim();
    if (!recordingIsrc && (!title || !artist)) return null;

    const params = new URLSearchParams();
    if (recordingIsrc) params.append('isrc', recordingIsrc);
    if (title) params.append('song', title);
    if (artist) params.append('artist', artist);
    if (metadata?.album) {
      params.append('album', metadata.album);
    }
    if (metadata?.durationMs && metadata.durationMs > 0) {
      params.append(
        'duration',
        Math.round(metadata.durationMs / 1000).toString(),
      );
    }

    try {
      const response = await fetchWithTimeout(
        `https://unison.boidu.dev/lyrics?${params.toString()}`,
      );
      if (!response.ok) return null;

      const data = await response.json();
      if (!data.success || !data.data?.lyrics) return null;

      const lyricsData = data.data;
      const { submitter } = lyricsData;
      const attribution: Partial<YouLyPlusLyricsResult> = {
        confidence:
          typeof lyricsData.confidence === 'string'
            ? lyricsData.confidence
            : undefined,
        matchScore:
          typeof lyricsData.matchScore === 'number' &&
          Number.isFinite(lyricsData.matchScore)
            ? lyricsData.matchScore
            : undefined,
        matchedBy:
          typeof lyricsData.matchedBy === 'string'
            ? lyricsData.matchedBy
            : undefined,
        contributors:
          typeof submitter?.displayName === 'string' &&
          submitter.displayName.trim()
            ? [
                {
                  username: submitter.displayName.trim(),
                  url:
                    typeof submitter.keyId === 'string'
                      ? `https://unison.betterlyrics.org/curator/${encodeURIComponent(submitter.keyId)}`
                      : undefined,
                  roles: ['Lyric author'],
                },
              ]
            : undefined,
      };
      const format = lyricsData.format || 'lrc';
      const syncType = lyricsData.syncType || 'linesync';
      const lyricsText = lyricsData.lyrics;

      if (format === 'ttml') {
        const parseResult = AmLyrics.parseTTML(lyricsText);
        if (parseResult && parseResult.lines.length > 0) {
          return {
            lines: parseResult.lines,
            source: 'Unison',
            songwriters: parseResult.songwriters,
            ...attribution,
          };
        }
      }

      if (format === 'lrc') {
        if (syncType === 'plain') {
          const plainLines = lyricsText
            .split('\n')
            .map((l: string) => l.trim())
            .filter((l: string) => l);
          if (plainLines.length > 0) {
            const lines: LyricsLine[] = plainLines.map(
              (text: string): LyricsLine => ({
                text: [{ text, part: false, timestamp: 0, endtime: 0 }],
                background: false,
                backgroundText: [],
                oppositeTurn: false,
                timestamp: 0,
                endtime: 0,
                isWordSynced: false,
              }),
            );
            return { lines, source: 'Unison (unsynced)', ...attribution };
          }
        } else {
          const lines = AmLyrics.parseLrcSubtitles(lyricsText);
          if (lines.length > 0) {
            return { lines, source: 'Unison', ...attribution };
          }
        }
      }
    } catch {
      // Unison fetch failed
    }

    return null;
  }

  private static calculateLineAlignments(
    lineSingers: (string | undefined)[],
    agentTypes: Record<string, string>,
  ): ('start' | 'end' | undefined)[] {
    const lineSideAssignments = new Array(lineSingers.length).fill(undefined);
    let currentSideIsLeft = true;
    let lastPersonSingerId: string | null = null;
    let rightCount = 0;
    let totalCount = 0;

    lineSingers.forEach((singerId, index) => {
      let sideClass: 'start' | 'end' | undefined;

      if (singerId) {
        let type = agentTypes[singerId];
        if (!type) {
          if (singerId === 'v1000') {
            type = 'group';
          } else if (singerId === 'v2000') {
            type = 'other';
          } else {
            type = 'person';
          }
        }

        if (type === 'group') {
          sideClass = 'start';
        } else {
          if (lastPersonSingerId === null) {
            if (type === 'other') {
              currentSideIsLeft = false;
            } else {
              currentSideIsLeft = true;
            }
          } else if (singerId !== lastPersonSingerId) {
            currentSideIsLeft = !currentSideIsLeft;
          }

          sideClass = currentSideIsLeft ? 'start' : 'end';
          lastPersonSingerId = singerId;
        }
      }

      if (sideClass) {
        totalCount += 1;
        if (sideClass === 'end') rightCount += 1;
      }

      lineSideAssignments[index] = sideClass;
    });

    if (totalCount > 0 && Math.round((rightCount / totalCount) * 100) >= 85) {
      const flip = (s: 'start' | 'end' | undefined) => {
        if (s === 'start') return 'end';
        if (s === 'end') return 'start';
        return s;
      };

      for (let i = 0; i < lineSideAssignments.length; i += 1) {
        lineSideAssignments[i] = flip(lineSideAssignments[i]);
      }
    }

    return lineSideAssignments;
  }

  private static parseTTMLTime(value: string | null, fallback = 0): number {
    if (!value) return fallback;
    const normalized = value.trim().toLowerCase();
    const unitMatch = normalized.match(/^(-?\d+(?:\.\d+)?)(ms|h|m|s)$/);

    if (unitMatch) {
      const amount = Number(unitMatch[1]);
      const multipliers: Record<string, number> = {
        ms: 1,
        s: 1000,
        m: 60_000,
        h: 3_600_000,
      };
      return Math.max(0, Math.round(amount * multipliers[unitMatch[2]]));
    }

    const parts = normalized.split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part))) return fallback;

    let seconds = 0;
    if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      seconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
      [seconds] = parts;
    } else {
      return fallback;
    }

    return Math.max(0, Math.round(seconds * 1000));
  }

  private static isRightToLeftLanguage(language: string | null): boolean {
    if (!language) return false;
    const primaryLanguage = language.toLowerCase().split(/[-_]/)[0];
    return ['ar', 'dv', 'fa', 'he', 'ku', 'ps', 'ur', 'yi'].includes(
      primaryLanguage,
    );
  }

  private static parseTTML(
    ttmlString: string,
  ): { lines: LyricsLine[]; songwriters?: string } | null {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(ttmlString, 'text/xml');

      const translations: Record<string, string> = {};
      const transliterations: Record<string, any> = {};
      const agentMap: Record<string, string> = {};
      const documentLanguage =
        doc.documentElement.getAttribute('xml:lang') ||
        doc.documentElement.getAttribute('lang');

      const agents = doc.getElementsByTagName('ttm:agent');
      for (let i = 0; i < agents.length; i += 1) {
        const agent = agents[i];
        const id = agent.getAttribute('xml:id');
        const type = agent.getAttribute('type');
        if (id && type) {
          agentMap[id] = type;
        }
      }

      let songwriters: string | undefined;
      const songwritersNodes = doc.getElementsByTagName('songwriter');
      if (songwritersNodes.length > 0) {
        const names: string[] = [];
        for (let i = 0; i < songwritersNodes.length; i += 1) {
          if (songwritersNodes[i].textContent) {
            names.push(songwritersNodes[i].textContent!);
          }
        }
        if (names.length > 0) {
          songwriters = names.join(', ');
        }
      }

      const translationNodes = doc.getElementsByTagName('translation');
      for (let i = 0; i < translationNodes.length; i += 1) {
        const texts = translationNodes[i].getElementsByTagName('text');
        for (let j = 0; j < texts.length; j += 1) {
          const textNode = texts[j];
          const key = textNode.getAttribute('for');
          if (key && textNode.textContent) {
            translations[key] = textNode.textContent;
          }
        }
      }

      const timeToMs = AmLyrics.parseTTMLTime;

      const transliterationNodes = doc.getElementsByTagName('transliteration');
      for (let i = 0; i < transliterationNodes.length; i += 1) {
        const texts = transliterationNodes[i].getElementsByTagName('text');
        for (let j = 0; j < texts.length; j += 1) {
          const textNode = texts[j];
          const key = textNode.getAttribute('for');
          if (!key) {
            // eslint-disable-next-line no-continue
            continue;
          }

          const spans = Array.from(
            textNode.getElementsByTagName('span'),
          ).filter(span => span.getAttribute('begin'));

          if (spans.length > 0) {
            const syllabus: any[] = [];
            let fullText = '';
            for (let k = 0; k < spans.length; k += 1) {
              const span = spans[k];
              const begin = span.getAttribute('begin');
              const end = span.getAttribute('end');
              let spanText = span.textContent || '';
              const nextNode = span.nextSibling;
              if (
                nextNode &&
                nextNode.nodeType === 3 &&
                /^\s/.test(nextNode.textContent || '') &&
                !spanText.endsWith(' ')
              ) {
                spanText += ' ';
              }
              if (spanText.trim() === '') {
                // eslint-disable-next-line no-continue
                continue;
              }

              syllabus.push({
                time: timeToMs(begin),
                duration: timeToMs(end) - timeToMs(begin),
                text: spanText,
              });
              fullText += spanText;
            }
            transliterations[key] = { text: fullText.trim(), syllabus };
          } else if (textNode.textContent) {
            transliterations[key] = {
              text: textNode.textContent.trim().replace(/\s+/g, ' '),
            };
          }
        }
      }

      const lines: LyricsLine[] = [];
      const pNodes = doc.getElementsByTagName('p');

      for (let i = 0; i < pNodes.length; i += 1) {
        const p = pNodes[i];
        const key =
          p.getAttributeNS('http://lrc.red/lyric-ttml-internal', 'key') ||
          p.getAttribute('itunes:key');
        const beginMs = timeToMs(p.getAttribute('begin'));
        const endMs = timeToMs(p.getAttribute('end'), beginMs);
        const agentId = p.getAttribute('ttm:agent') || undefined;
        const lineLanguage =
          p.getAttribute('xml:lang') ||
          p.getAttribute('lang') ||
          documentLanguage;

        let songPart: string | undefined;
        if (p.parentNode && (p.parentNode as Element).tagName === 'div') {
          songPart =
            (p.parentNode as Element).getAttributeNS(
              'http://lrc.red/lyric-ttml-internal',
              'songPart',
            ) ||
            (p.parentNode as Element).getAttribute('itunes:songPart') ||
            undefined;
        }

        const mainSyllables: Syllable[] = [];
        const bgSyllables: Syllable[] = [];

        const spans = p.getElementsByTagName('span');
        const hasWordLevelSync = Array.from(spans).some(span => {
          const isBackground =
            span.getAttribute('ttm:role') === 'x-bg' ||
            (span.parentNode as Element | null)?.getAttribute?.('ttm:role') ===
              'x-bg';
          return (
            !isBackground &&
            Boolean(span.getAttribute('begin')) &&
            Boolean(span.getAttribute('end'))
          );
        });
        if (spans.length > 0) {
          for (let j = 0; j < spans.length; j += 1) {
            const span = spans[j];

            if (span.getAttribute('ttm:role') === 'x-bg') {
              const bgInnerSpans = span.getElementsByTagName('span');
              for (let k = 0; k < bgInnerSpans.length; k += 1) {
                const bgSpan = bgInnerSpans[k];
                let bgText = bgSpan.textContent || '';
                const nextNode = bgSpan.nextSibling;
                if (
                  nextNode &&
                  nextNode.nodeType === 3 &&
                  /^\s/.test(nextNode.textContent || '') &&
                  !bgText.endsWith(' ')
                ) {
                  bgText += ' ';
                }
                const bgTimestamp = timeToMs(
                  bgSpan.getAttribute('begin'),
                  beginMs,
                );
                bgSyllables.push({
                  text: bgText,
                  timestamp: bgTimestamp,
                  endtime: Math.max(
                    bgTimestamp,
                    timeToMs(bgSpan.getAttribute('end'), endMs),
                  ),
                  part: !/\s$/.test(bgText),
                });
              }
              // eslint-disable-next-line no-continue
              continue;
            }

            if (
              span.parentNode &&
              (span.parentNode as Element).getAttribute?.('ttm:role') === 'x-bg'
            ) {
              // eslint-disable-next-line no-continue
              continue;
            }

            let text = span.textContent || '';
            const nextNode = span.nextSibling;
            if (
              nextNode &&
              nextNode.nodeType === 3 &&
              /^\s/.test(nextNode.textContent || '') &&
              !text.endsWith(' ')
            ) {
              text += ' ';
            }
            const syllableTimestamp = timeToMs(
              span.getAttribute('begin'),
              beginMs,
            );
            mainSyllables.push({
              text,
              timestamp: syllableTimestamp,
              endtime: Math.max(
                syllableTimestamp,
                timeToMs(span.getAttribute('end'), endMs),
              ),
              part: !/\s$/.test(text),
            });
          }
        }

        if (mainSyllables.length === 0) {
          const primaryLineText = Array.from(p.childNodes)
            .filter(
              node =>
                !(
                  node instanceof Element &&
                  node.getAttribute('ttm:role') === 'x-bg'
                ),
            )
            .map(node => node.textContent || '')
            .join('')
            .trim();
          mainSyllables.push({
            text: primaryLineText,
            timestamp: beginMs,
            endtime: endMs,
            part: false,
            lineSynced: true,
          });
        }

        // Distribute line-level transliteration to individual syllables
        // so that per-syllable animated romanisation works (like KPoe lyrics)
        const lineTransliterationItem = key ? transliterations[key] : undefined;
        if (
          lineTransliterationItem &&
          mainSyllables.length > 1 &&
          spans.length > 0
        ) {
          if (
            lineTransliterationItem.syllabus &&
            lineTransliterationItem.syllabus.length === mainSyllables.length
          ) {
            mainSyllables.forEach((syl, mapIdx) => {
              // eslint-disable-next-line no-param-reassign
              syl.romanizedText = lineTransliterationItem.syllabus[mapIdx].text;
            });
          } else {
            const lineTransliteration = lineTransliterationItem.text;
            const romanWords = lineTransliteration.split(/\s+/).filter(Boolean);

            const syllableGroups: number[][] = [];
            for (let si = 0; si < mainSyllables.length; si += 1) {
              if (mainSyllables[si].part && syllableGroups.length > 0) {
                syllableGroups[syllableGroups.length - 1].push(si);
              } else {
                syllableGroups.push([si]);
              }
            }

            const isCJK =
              /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(
                mainSyllables.map(s => s.text).join(''),
              );

            if (romanWords.length === syllableGroups.length) {
              syllableGroups.forEach((group, gi) => {
                // eslint-disable-next-line no-param-reassign
                mainSyllables[group[0]].romanizedText = romanWords[gi];
              });
            } else if (romanWords.length === mainSyllables.length) {
              mainSyllables.forEach((syl, mapIdx) => {
                // eslint-disable-next-line no-param-reassign
                syl.romanizedText = romanWords[mapIdx];
              });
            } else if (isCJK) {
              let romanIdx = 0;
              for (const group of syllableGroups) {
                const syl = mainSyllables[group[0]];
                const sylText = group
                  .map(gIndex => mainSyllables[gIndex].text)
                  .join('');
                const validChars =
                  sylText.match(
                    /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7afA-Za-z0-9]/g,
                  ) || [];
                const needed = validChars.length;
                if (needed > 0 && romanIdx < romanWords.length) {
                  // eslint-disable-next-line no-param-reassign
                  syl.romanizedText = romanWords
                    .slice(romanIdx, romanIdx + needed)
                    .join(' ');
                  romanIdx += needed;
                }
              }
            }
          }
        }

        const resolvedBeginMs = p.getAttribute('begin')
          ? beginMs
          : Math.min(...mainSyllables.map(syllable => syllable.timestamp));
        const resolvedEndMs = Math.max(
          endMs,
          resolvedBeginMs,
          ...mainSyllables.map(syllable => syllable.endtime),
          ...bgSyllables.map(syllable => syllable.endtime),
        );

        lines.push({
          text: mainSyllables,
          background: bgSyllables.length > 0,
          backgroundText: bgSyllables,
          timestamp: resolvedBeginMs,
          endtime: resolvedEndMs,
          isWordSynced: hasWordLevelSync,
          songPart,
          translation: key ? translations[key] : undefined,
          romanizedText: lineTransliterationItem?.text,
          oppositeTurn: false,
          agentId,
          direction:
            p.getAttribute('dir') === 'rtl' ||
            AmLyrics.isRightToLeftLanguage(lineLanguage)
              ? 'rtl'
              : undefined,
        });
      }

      const sortedLines = lines
        .map((line, sourceIndex) => ({ line, sourceIndex }))
        .sort(
          (a, b) =>
            a.line.timestamp - b.line.timestamp ||
            a.sourceIndex - b.sourceIndex,
        )
        .map(item => item.line);
      const alignments = AmLyrics.calculateLineAlignments(
        sortedLines.map(line => line.agentId),
        agentMap,
      );
      const alignedLines = sortedLines.map((line, index) => ({
        ...line,
        alignment: alignments[index],
        oppositeTurn: alignments[index] === 'end',
      }));

      return { lines: alignedLines, songwriters };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to parse TTML', e);
      return null;
    }
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

    // If type is 'Line', we revert to line-by-line highlighting by skipping syllabus parsing
    const isLineType = payload.type === 'Line' || payload.type === 'line';

    // Convert metadata.agents to type map
    const agentTypes: Record<string, string> = {};
    if (payload.metadata?.agents) {
      Object.entries(payload.metadata.agents).forEach(
        ([key, agent]: [string, any]) => {
          const mappedKey = agent.alias || key;
          agentTypes[mappedKey] = agent.type;
        },
      );
    }

    const lineSingers = sanitizedEntries.map(
      (entry: any) => entry.element?.singer,
    );
    const alignments = AmLyrics.calculateLineAlignments(
      lineSingers,
      agentTypes,
    );

    for (let i = 0; i < sanitizedEntries.length; i += 1) {
      const entry = sanitizedEntries[i];
      const alignment = alignments[i];
      const lineText = typeof entry.text === 'string' ? entry.text : '';
      const lineStart = AmLyrics.toMilliseconds(entry.time);
      const lineDuration = AmLyrics.toMilliseconds(entry.duration);
      const explicitEnd = AmLyrics.toMilliseconds(entry.endTime);
      const lineEnd = explicitEnd || lineStart + (lineDuration || 0);

      let syllabus = [];
      if (Array.isArray(entry.syllabus)) {
        syllabus = entry.syllabus.filter((s: any) => Boolean(s));
      } else if (Array.isArray(entry.words)) {
        syllabus = entry.words.filter((s: any) => Boolean(s));
      }

      const mainSyllables: Syllable[] = [];
      const backgroundSyllables: Syllable[] = [];

      if (!isLineType && syllabus.length > 0) {
        for (const syl of syllabus) {
          const sylStart = AmLyrics.toMilliseconds(syl.time, lineStart);
          const sylDuration = AmLyrics.toMilliseconds(syl.duration);

          // If there's only 1 syllable and duration is 0, it's likely a line-synced fallback.
          // Otherwise, it's an instantaneous boundary (like a space or comma) and should not span the line.
          const sylEnd =
            sylDuration === 0 && syllabus.length === 1
              ? lineEnd
              : sylStart + sylDuration;

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
          lineSynced: isLineType, // Mark as line-synced
        });
      }

      const hasWordSync =
        !isLineType &&
        syllabus.length > 0 &&
        (mainSyllables.length > 0 || backgroundSyllables.length > 0);

      const { transliteration } = entry;
      let romanizedTextFromPayload: string | undefined;

      if (transliteration) {
        romanizedTextFromPayload = transliteration.text;
        // If syllabus data matches, map it to main syllables
        if (
          Array.isArray(transliteration.syllabus) &&
          transliteration.syllabus.length === mainSyllables.length
        ) {
          transliteration.syllabus.forEach((s: any, idx: number) => {
            mainSyllables[idx].romanizedText = s.text;
          });
        }
      }

      // Extract translation from KPoe API if available
      const translationText = entry.translation?.text;

      const lineResult: LyricsLine = {
        text: mainSyllables,
        background: backgroundSyllables.length > 0,
        backgroundText: backgroundSyllables,
        oppositeTurn:
          alignment === 'end' ||
          (Array.isArray(entry.element)
            ? entry.element.includes('opposite') ||
              entry.element.includes('right')
            : false),
        timestamp: lineStart,
        endtime: lineEnd,
        isWordSynced: isLineType ? false : hasWordSync,
        alignment,
        songPart: entry.element?.songPart,
        romanizedText: romanizedTextFromPayload,
        translation: translationText,
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
    // Use wheel/touchmove which are guaranteed to be user initiated,
    // unlike 'scroll' which fires for both user and programmatic/inertia
    if (this.lyricsContainer) {
      this.lyricsContainer.addEventListener(
        'wheel',
        this._boundHandleUserScroll,
        { passive: true },
      );
      this.lyricsContainer.addEventListener(
        'touchmove',
        this._boundHandleUserScroll,
        { passive: true },
      );
    }
  }

  /**
   * Handle currentTime changes imperatively, bypassing Lit's render cycle.
   * This prevents the template from re-rendering on every frame, which would
   * reset imperative animation classes (highlight, finished, etc.) set by
   * updateSyllablesForLine.
   */
  private _onTimeChanged(
    oldTime: number,
    newTime: number,
    isSeek = Math.abs(newTime - oldTime) > SEEK_THRESHOLD_MS,
  ): void {
    if (this.cachedIsUnsynced) return;
    const newActiveLines = this.findActiveLineIndices(newTime);
    const oldActiveLines = this.activeLineIndices;

    // Reset animation if active lines change or if we skip time.
    const linesChanged = !AmLyrics.arraysEqual(newActiveLines, oldActiveLines);
    if (this.hidePlayedLines && (linesChanged || isSeek))
      this.updatePlayedLines(newTime);

    if (newTime < oldTime && (linesChanged || isSeek)) {
      // A retired word keeps its lift until playback returns before its start.
      for (const line of this.cachedLineArray) {
        for (const word of AmLyrics.motionWords.get(line) || []) {
          if (newTime < word.start) {
            word.element.classList.remove('word-started');
            if (!this.rewindingLines.has(line))
              AmLyrics.clearNormalWordMotion(word.element);
          }
        }
      }
    }

    if (linesChanged || isSeek) {
      if (this.lyricsContainer) {
        // Drop highlighting at the phrase end. Backing layout is managed by
        // predictive scroll so its entrance and exit do not lag behind it.
        for (const lineIndex of oldActiveLines) {
          if (!newActiveLines.includes(lineIndex)) {
            const lineElement = this._getLineElement(lineIndex);
            if (lineElement) {
              AmLyrics.unfinishSyllables(lineElement);

              lineElement.classList.remove('active', 'scroll-exiting');
              lineElement.classList.remove('progressive-unblur');
              lineElement.removeAttribute('aria-current');

              if (lineElement.classList.contains('pre-active')) {
                lineElement.classList.remove('pre-active');
              }
              lineElement.style.removeProperty('filter');
              const preIdx = this.preActiveLineElements.indexOf(lineElement);
              if (preIdx !== -1) this.preActiveLineElements.splice(preIdx, 1);
            }
          }
        }

        // Add 'active' to newly active lines. Background expansion is driven
        // separately by the current scroll target.
        for (const lineIndex of newActiveLines) {
          if (!oldActiveLines.includes(lineIndex) || isSeek) {
            const lineElement = this._getLineElement(lineIndex);
            if (lineElement) {
              if (
                !oldActiveLines.includes(lineIndex) &&
                !lineElement.classList.contains('pre-active')
              ) {
                lineElement
                  .querySelectorAll<HTMLElement>('.native-motion')
                  .forEach(char => AmLyrics.clearCharacterMotion(char));
              }
              lineElement.classList.add('active');
              lineElement.setAttribute('aria-current', 'true');
              lineElement.classList.remove('pre-active', 'scroll-exiting');
              lineElement.classList.remove('progressive-unblur');
              lineElement.style.removeProperty('filter');
              const preIdx = this.preActiveLineElements.indexOf(lineElement);
              if (preIdx !== -1) this.preActiveLineElements.splice(preIdx, 1);
            }
          }
        }

        // Remove pre-active from lines that are now active (they no longer
        // need the unblur preview class) and from lines that dropped.
        for (const lineElement of this.preActiveLineElements) {
          const idx = AmLyrics.getLineIndexFromElement(lineElement);
          if (
            idx === null ||
            (!newActiveLines.includes(idx) &&
              lineElement !== this.currentPrimaryActiveLine)
          ) {
            lineElement.classList.remove('pre-active');
            lineElement.classList.remove('progressive-unblur');
            lineElement.style.removeProperty('filter');
          }
        }
        this.preActiveLineElements = this.preActiveLineElements.filter(el =>
          el.classList.contains('pre-active'),
        );
      }

      this.activeLineIndices = newActiveLines;
    }

    // Predictive scroll: run on every tick so we scroll *before* the next
    // line starts, matching YouLyPlus behaviour.
    this._handleActiveLineScroll(isSeek);
    if (linesChanged || isSeek) {
      this.clearPastLineHighlights();
    }

    if (this.lyricsContainer) {
      // Update syllables in active lines using cached elements
      for (const lineIndex of this.activeLineIndices) {
        const lineElement = this._getLineElement(lineIndex);
        if (
          lineElement?.classList.contains('active') &&
          !this.rewindingLines.has(lineElement)
        ) {
          AmLyrics.updateSyllablesForLine(
            lineElement,
            newTime,
            this.shouldReduceMotion,
          );
          if (isSeek) AmLyrics.seekLineWipes(lineElement, newTime);
        }
      }

      if (isSeek) {
        for (const entry of this.backgroundCarries.values())
          if (!entry.exiting) AmLyrics.seekLineWipes(entry.clone, newTime);
      }

      // Tie gap motion directly to playback time. This keeps the entrance,
      // breathing, sequential dots, and exit deterministic across seeks. Only
      // touch the current/previous gap instead of scanning every gap per frame.
      const currentGap = this.findInstrumentalGapAt(newTime);
      const gapElements = new Set(this.activeGapLineElements);
      if (currentGap) {
        const currentGapElement = this._getGapElement(
          currentGap.insertBeforeIndex,
        );
        if (currentGapElement) gapElements.add(currentGapElement);
      }
      for (const gap of gapElements) {
        this.updateInstrumentalGap(gap, newTime, isSeek || newTime < oldTime);
      }

      // Track instrumental gap state
      if (currentGap) {
        if (currentGap.insertBeforeIndex !== this.lastInstrumentalIndex) {
          this.setBackgroundExpandedLine(null);
          if (
            this.autoScroll &&
            !this.isUserScrolling &&
            !this.isClickSeeking
          ) {
            this.scrollToInstrumental(currentGap.insertBeforeIndex);
          }
        }
        this.lastInstrumentalIndex = currentGap.insertBeforeIndex;
        // Un-highlight the previous line immediately when gap dots are playing
        if (currentGap.insertBeforeIndex > 0) {
          const prevLine = this._getLineElement(
            currentGap.insertBeforeIndex - 1,
          );
          if (
            prevLine &&
            prevLine.classList.contains('persist-highlight') &&
            !prevLine.classList.contains('active')
          ) {
            AmLyrics.unfinishSyllables(prevLine);
          }
        }
      } else if (this.lastInstrumentalIndex !== null) {
        this.lastInstrumentalIndex = null;
      }

      // Check footer active state
      const lastLyric =
        this.lyrics && this.lyrics.length > 0
          ? this.lyrics[this.lyrics.length - 1]
          : null;
      const footer = this.footerElement;
      if (footer && lastLyric && lastLyric.endtime > 0) {
        const isFooterActive = newTime > lastLyric.endtime + 200; // Snappier 200ms buffer
        if (isFooterActive && !footer.classList.contains('active')) {
          footer.classList.add('active');
          // Clear pre-active from the last lyric so it doesn't stay
          // unblurred when the footer takes over.
          const lastLine = this.lyrics
            ? this._getLineElement(this.lyrics.length - 1)
            : null;
          if (lastLine) {
            lastLine.classList.remove('pre-active');
            lastLine.classList.remove('progressive-unblur');
            lastLine.style.removeProperty('filter');
            const preIdx = this.preActiveLineElements.indexOf(lastLine);
            if (preIdx !== -1) this.preActiveLineElements.splice(preIdx, 1);
          }
          if (
            this.autoScroll &&
            !this.isUserScrolling &&
            !this.isClickSeeking
          ) {
            this.focusLine(footer);
          }
        } else if (!isFooterActive && footer.classList.contains('active')) {
          footer.classList.remove('active');
        }
      }
    }
  }

  private updatePlayedLines(time: number): void {
    if (!this.lyrics) return;
    this.lyrics.forEach((line, index) => {
      const played =
        this.hidePlayedLines &&
        this.getLineHighlightEndTime(index) > line.timestamp &&
        time >= this.getLineHighlightEndTime(index);
      this._getLineElement(index)?.classList.toggle('played', played);
    });
  }

  protected willUpdate(
    changedProperties: Map<string | number | symbol, unknown>,
  ) {
    if (
      this.backgroundCarries.size &&
      [
        'lyrics',
        'isLoading',
        'showRomanization',
        'showTranslation',
        'fontFamily',
      ].some(propertyName => changedProperties.has(propertyName))
    ) {
      if (!changedProperties.has('lyrics'))
        for (const [index, entry] of this.backgroundCarries)
          if (!entry.exiting) {
            this.backgroundCarryRestoreTops.set(
              index,
              AmLyrics.getBackgroundCarryTop(entry.clone),
            );
            const ownerIndex = AmLyrics.getLineIndexFromElement(entry.owner);
            if (ownerIndex !== null)
              this.backgroundCarryRestoreOwners.set(index, ownerIndex);
          }
      this.restoreCarriesAfterRender = true;
      this.clearBackgroundCarries();
    }
    if (changedProperties.has('lyrics')) {
      this._updateCachedIsUnsynced();
      this.cachedLineData = null;
      this._ensureLineDataCache();
    }
    if (
      this.lyrics &&
      !changedProperties.has('lyrics') &&
      (changedProperties.has('showRomanization') ||
        changedProperties.has('showTranslation') ||
        changedProperties.has('fontFamily'))
    )
      this.pendingRenderLayout = this.captureLyricLayout();
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    const lyricsDomBecameRenderable =
      changedProperties.has('lyrics') ||
      (changedProperties.has('isLoading') &&
        !this.isLoading &&
        Boolean(this.lyrics));

    if (lyricsDomBecameRenderable) {
      this._invalidateCaches();
      this._ensureLineDataCache();
      // Recalculate timing data for accurate animations whenever lyrics change
      this._updateCharTimingData();

      // Apply 'active' classes imperatively after lyrics first render,
      // since the template no longer binds the 'active' class (to avoid
      // clobbering imperative scroll-animate classes on re-render).
      if (this.lyricsContainer && this.lyrics && !this.cachedIsUnsynced) {
        const activeLines = this.findActiveLineIndices(this.currentTime);
        for (const lineIndex of activeLines) {
          const lineEl = this._getLineElement(lineIndex);
          if (lineEl) {
            lineEl.classList.add('active');
            lineEl.setAttribute('aria-current', 'true');
          }
        }
        const primaryActiveLine = this.getPrimaryActiveLineIndex(activeLines);
        this.setBackgroundExpandedLine(
          primaryActiveLine !== null
            ? this._getLineElement(primaryActiveLine)
            : null,
          true,
          activeLines,
        );

        // Trigger a faux time-change so that updateSyllablesForLine fires
        // to setup inline syllable CSS wipe animations for whatever the current time is
        this._onTimeChanged(0, this.currentTime);
        if (this.sourceUpgrade) {
          this.cancelLineScrollAnimation();
        }

        // Ensure position classes are applied on initial render if not playing yet
        if (this.positionedLineElements.length === 0) {
          const firstLine = this.lyricsContainer.querySelector(
            '.lyrics-line',
          ) as HTMLElement;
          if (firstLine) this.updatePositionClasses(firstLine);
        }

        // Set up IntersectionObserver for viewport virtualization
        this.visibilityObserver?.disconnect();
        this.visibilityObserver = new IntersectionObserver(
          entries => {
            entries.forEach(entry => {
              const el = entry.target as HTMLElement;
              el.classList.toggle('far-line', !entry.isIntersecting);
            });
          },
          {
            root: this.lyricsContainer,
            rootMargin: '200px',
            threshold: 0,
          },
        );
        const lines = this.lyricsContainer.querySelectorAll('.lyrics-line');
        lines.forEach(line => this.visibilityObserver!.observe(line));
      }
      this.sourceUpgrade = false;
    }

    if (lyricsDomBecameRenderable || changedProperties.has('hidePlayedLines')) {
      this.updatePlayedLines(this.currentTime);
    }
    if (this.pendingRenderLayout && !lyricsDomBecameRenderable) {
      this._updateCharTimingData();
      for (const line of this.backgroundExpandedLines) {
        const wrap = this.getBackgroundWrap(line);
        if (wrap)
          line.style.setProperty(
            '--am-lyrics-background-vocal-height',
            `${wrap.offsetHeight + 4}px`,
          );
      }
      this.finishLyricLayout(this.pendingRenderLayout);
      for (const index of this.activeLineIndices) {
        const line = this._getLineElement(index);
        if (line)
          AmLyrics.updateSyllablesForLine(
            line,
            this.currentTime,
            this.shouldReduceMotion,
          );
      }
    }
    this.pendingRenderLayout = undefined;
    if (this.restoreCarriesAfterRender) {
      this.restoreCarriesAfterRender = false;
      this._handleActiveLineScroll(true);
      this.backgroundCarryRestoreTops.clear();
      this.backgroundCarryRestoreOwners.clear();
    }
    if (changedProperties.has('noBlur') && this.noBlur) {
      this.clearProgressiveBlurLine();
    }
    if (
      changedProperties.has('reducedMotion') ||
      changedProperties.has('systemReducedMotion') ||
      changedProperties.has('lineMotion')
    ) {
      if (this.shouldReduceMotion) {
        this.finishLineRewind();
        for (const line of this.cachedLineArray) {
          for (const word of AmLyrics.motionWords.get(line) || [])
            AmLyrics.clearNormalWordMotion(word.element);
          line
            .querySelectorAll<HTMLElement>('.native-motion')
            .forEach(char => AmLyrics.clearCharacterMotion(char));
        }
        for (const [line, animation] of this.backgroundAnimations) {
          animation.cancel();
          line.classList.remove('bg-collapsing');
        }
        this.backgroundAnimations.clear();
        for (const { animation } of this.contentSprings.values())
          animation.cancel();
        this.contentSprings.clear();
      }
      this.cancelLineScrollAnimation();
      if (this.lyricsContainer) {
        // Cancel an in-flight native smooth scroll at its current position.
        this.lyricsContainer.scrollTo({
          top: this.lyricsContainer.scrollTop,
          behavior: 'instant',
        });
      }
      if (this.lyrics) this._onTimeChanged(this.currentTime, this.currentTime);
    }

    // Handle duration reset (-1 stops playback and resets currentTime to 0)
    if (changedProperties.has('duration') && this.duration === -1) {
      this.currentTime = 0;
      this.finishLineRewind();
      this.clockAdvancing = false;
      this.cancelPlaybackTick();
      this.holdPlaybackAnimations();
      this.activeLineIndices = [];
      this.preActiveLineElements = [];
      this.positionedLineElements = [];
      this.clearGapAnimations();
      this.activeGapLineElements = [];
      this.clearBackgroundExpandedLine();
      this.setUserScrolling(false);

      // Cancel any running animations

      // Clear user scroll timeout
      if (this.userScrollTimeoutId) {
        clearTimeout(this.userScrollTimeoutId);
        this.userScrollTimeoutId = undefined;
      }
      this.cancelLineScrollAnimation();
      if (this.lyricsContainer) this.lyricsContainer.scrollTop = 0;
      return;
    }

    if (
      changedProperties.has('paused') ||
      changedProperties.has('interpolate')
    ) {
      this.cancelPlaybackTick();
      if (this.paused) {
        this.finishLineRewind();
        this.holdPlaybackAnimations();
      } else {
        if (changedProperties.has('paused') && this.lastHostTime !== undefined)
          this.clockAdvancing = this.interpolate;
        if (!this.interpolate) this.clockAdvancing = false;
        this.playbackAnchor = this._currentTime;
        this.playbackStamp = performance.now();
        this.releasePlaybackAnimations();
        this.schedulePlaybackTick();
      }
    }
    if (lyricsDomBecameRenderable) this.schedulePlaybackTick();
    if (this.paused || document.hidden) this.holdPlaybackAnimations();

    if (
      (changedProperties.has('query') ||
        changedProperties.has('musicId') ||
        changedProperties.has('spotifyId') ||
        changedProperties.has('isrc') ||
        changedProperties.has('ttml') ||
        changedProperties.has('songTitle') ||
        changedProperties.has('songArtist') ||
        changedProperties.has('songAlbum') ||
        changedProperties.has('songDurationMs')) &&
      !changedProperties.has('currentTime')
    ) {
      this.fetchLyrics();
    }

    if (changedProperties.has('currentTime') && this.lyrics) {
      // currentTime changes are now handled by the custom setter (_onTimeChanged)
      // This block intentionally left empty — only here for backwards compat with
      // any subclasses that might check changedProperties
    }
  }

  /**
   * Handle scrolling when active line indices change.
   * Called imperatively from _onTimeChanged instead of from updated().
   *
   * Uses predictive scroll like YouLyPlus: computes a scrollLookAheadMs based
   * on the gap to the next line, finds the primary line at predictiveTime,
   * and scrolls with a duration matching the lookahead.
   */
  private _handleActiveLineScroll(forceScroll = false): void {
    if (
      !this.lyricsContainer ||
      !this.lyrics ||
      this.lyrics.length === 0 ||
      this.cachedIsUnsynced
    ) {
      return;
    }

    // If the footer is already active, it set up its own scroll.
    // Don't override it with a scroll back to the last lyric.
    const footer = this.footerElement;
    if (footer?.classList.contains('active')) {
      this.setBackgroundExpandedLine(null);
      return;
    }

    // 1. Compute scroll lookahead based on gap to next line (YouLyPlus style)
    let scrollLookAheadMs = 350;
    let low = 0;
    let high = this.lyrics.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.lyrics[middle].timestamp <= this.currentTime) low = middle + 1;
      else high = middle;
    }
    const currentAudioIndex = low - 1;

    if (
      currentAudioIndex !== -1 &&
      currentAudioIndex + 1 < this.lyrics.length
    ) {
      const currentLine = this.lyrics[currentAudioIndex];
      const nextLine = this.lyrics[currentAudioIndex + 1];
      const gap = nextLine.timestamp - currentLine.endtime;
      scrollLookAheadMs = Math.min(500, Math.max(350, gap));
    }

    // Blur follows playback time, independently of predictive scrolling.
    const nextLineIndex = currentAudioIndex + 1;
    const nextLineElement =
      nextLineIndex >= 0 && nextLineIndex < this.lyrics.length
        ? this._getLineElement(nextLineIndex)
        : null;
    if (
      nextLineElement &&
      !this.noBlur &&
      !this.shouldReduceMotion &&
      !this.isUserScrolling &&
      this.lyricsContainer.classList.contains('blur-inactive-enabled') &&
      !this.lyricsContainer.classList.contains('not-focused') &&
      !nextLineElement.classList.contains('active') &&
      !nextLineElement.classList.contains('lyrics-gap')
    ) {
      if (this.progressiveBlurLine !== nextLineElement) {
        this.clearProgressiveBlurLine();
        this.progressiveBlurLine = nextLineElement;
        nextLineElement.classList.add('progressive-unblur');
        // Animate the filter in the browser instead of invalidating the next
        // line's styles on every playback tick. The underlying style holds zero.
        nextLineElement.style.filter = 'blur(0em)';
        const animation = nextLineElement.animate(
          [
            { filter: `blur(${NEXT_LINE_BASE_BLUR_EM}em)` },
            { filter: 'blur(0em)' },
          ],
          {
            duration: NEXT_LINE_UNBLUR_DURATION_MS,
            easing: 'linear',
            fill: 'both',
          },
        );
        this.progressiveBlurAnimation = animation;
        animation.onfinish = () => {
          if (this.progressiveBlurAnimation === animation) animation.cancel();
        };
      }
      const elapsed =
        this.currentTime -
        this.lyrics[nextLineIndex].timestamp +
        NEXT_LINE_UNBLUR_DURATION_MS;
      const animation = this.progressiveBlurAnimation!;
      if (elapsed < NEXT_LINE_UNBLUR_DURATION_MS) {
        if (animation.playState === 'idle') animation.play();
        if (
          forceScroll ||
          animation.currentTime === null ||
          Math.abs(Number(animation.currentTime) - elapsed) > 200
        )
          animation.currentTime = elapsed;
      }
    } else {
      this.clearProgressiveBlurLine();
    }

    // 2. Find scroll target at predictive time
    const predictiveTime = this.currentTime + scrollLookAheadMs;
    const predictiveActiveIndices = this.findActiveLineIndices(predictiveTime);

    let targetElement: HTMLElement | null = null;
    let targetLineIndex: number | null = null;

    if (predictiveActiveIndices.length > 0) {
      targetLineIndex = this.getPrimaryScrollLineIndex(
        predictiveActiveIndices,
        predictiveTime,
      );
      if (targetLineIndex !== null && targetLineIndex !== -1) {
        targetElement = this._getLineElement(targetLineIndex);
      }
    }

    if (!targetElement) {
      // Fallback: closest line before predictiveTime
      targetLineIndex = this.getLineIndexAtTime(predictiveTime, 0);
      if (targetLineIndex !== null && targetLineIndex !== -1) {
        targetElement = this._getLineElement(targetLineIndex);
      }
    }
    if (!targetElement) {
      return;
    }

    const scrollDuration = scrollLookAheadMs;
    if (targetElement !== this.currentPrimaryActiveLine || forceScroll) {
      targetElement.style.setProperty(
        '--scroll-duration',
        `${scrollDuration}ms`,
      );
    }
    // Unblur the upcoming target line early as the predictive scroll begins.
    if (
      !targetElement.classList.contains('active') &&
      !targetElement.classList.contains('pre-active')
    ) {
      targetElement.classList.add('pre-active');
      if (!this.preActiveLineElements.includes(targetElement)) {
        this.preActiveLineElements.push(targetElement);
      }
      AmLyrics.updateSyllablesForLine(
        targetElement,
        this.currentTime,
        this.shouldReduceMotion,
      );
    }

    // Commit backing spacing before measuring the destination. Its displacement
    // and scrolling share the same spring rather than competing height tweens.
    const carryChanged = this.syncBackgroundCarries(
      targetElement,
      predictiveTime,
    );
    const layoutChanged = this.setBackgroundExpandedLine(
      targetElement,
      true,
      predictiveActiveIndices,
      predictiveTime,
    );
    this.focusLine(
      targetElement,
      forceScroll || layoutChanged || carryChanged,
      scrollDuration,
    );
    if (this.pendingLayoutOffsets.size)
      this.finishLyricLayout(this.captureLyricLayout());
    this.animateBackgroundCarries();
  }

  private _rebuildDomCache() {
    this.backgroundWraps = new WeakMap();
    if (!this.lyricsContainer) return;

    this.lineElementCache.clear();
    this.gapElementCache.clear();
    this.footerElement =
      (this.lyricsContainer.querySelector(
        '.lyrics-footer',
      ) as HTMLElement | null) ?? undefined;
    this.cachedLineArray = [];

    if (!this.lyrics) return;

    for (let i = 0; i < this.lyrics.length; i += 1) {
      const lineEl = this.lyricsContainer.querySelector(
        `#lyrics-line-${i}`,
      ) as HTMLElement | null;
      if (lineEl) {
        if (this.sourceUpgrade)
          lineEl.classList.remove('active', 'pre-active', 'scroll-exiting');
        this.lineElementCache.set(i, lineEl);
        if (
          lineEl.querySelector(
            '.shared-word-wipe, .native-motion, .highlight, .finished, .pre-highlight, .normal-word-motion',
          )
        )
          AmLyrics.resetSyllables(lineEl);
        (lineEl as any)._cachedSyllableElements = null;
        AmLyrics.motionWords.delete(lineEl);
        AmLyrics.motionSyllables.delete(lineEl);
      }

      const gapEl = this.lyricsContainer.querySelector(
        `#gap-${i}`,
      ) as HTMLElement | null;
      if (gapEl) {
        // Cache numeric timing values to avoid parseFloat on every frame
        (gapEl as any)._cachedStartTime = parseFloat(
          gapEl.getAttribute('data-start-time') || '0',
        );
        (gapEl as any)._cachedEndTime = parseFloat(
          gapEl.getAttribute('data-end-time') || '0',
        );
        this.gapElementCache.set(i, gapEl);
      }
    }

    this.lyricsContainer
      .querySelectorAll<HTMLElement>('.lyrics-word')
      .forEach(wordElement => {
        AmLyrics.clearNormalWordMotion(wordElement);
        AmLyrics.clearWordWipe(wordElement);
        AmLyrics.wordWipes.delete(wordElement);
        const target = wordElement as any;
        target._cachedVirtualWordElements = undefined;
        target._cachedVirtualWordCharSpans = undefined;
        target._wordPreWipeKey = undefined;
      });
    this.lyricsContainer
      .querySelectorAll<HTMLElement>('.lyrics-syllable')
      .forEach(syllable => {
        AmLyrics.motionParameters.delete(syllable);
        AmLyrics.getCachedCharSpans(syllable).forEach(char =>
          AmLyrics.clearCharacterMotion(char),
        );
        const target = syllable as any;
        target._cachedStartTime = undefined;
        target._cachedEndTime = undefined;
        target._cachedVocalTrack = undefined;
        target._cachedCharSpans = undefined;
      });

    // Rebuild cached line array for scroll/position queries
    const lineElements = this.lyricsContainer.querySelectorAll('.lyrics-line');
    this.cachedLineArray = Array.from(lineElements) as HTMLElement[];
  }

  private _getLineElement(index: number): HTMLElement | null {
    const cached = this.lineElementCache.get(index);
    if (cached) return cached;
    if (!this.lyricsContainer) return null;
    const el = this.lyricsContainer.querySelector(
      `#lyrics-line-${index}`,
    ) as HTMLElement | null;
    if (el) this.lineElementCache.set(index, el);
    return el;
  }

  private _getGapElement(index: number): HTMLElement | null {
    const cached = this.gapElementCache.get(index);
    if (cached) return cached;
    if (!this.lyricsContainer) return null;
    const el = this.lyricsContainer.querySelector(
      `#gap-${index}`,
    ) as HTMLElement | null;
    if (el) this.gapElementCache.set(index, el);
    return el;
  }

  private clearGapAnimations(): void {
    this.gapAnimations.forEach((motion, gap) => {
      motion.animations.forEach(animation => animation.cancel());
      gap.classList.remove('active', 'gap-collapsing', 'gap-exiting');
    });
    this.gapAnimations.clear();
  }

  private _invalidateCaches() {
    this.timingLyrics = undefined;
    this.lineHighlightEnds = [];
    this.activeTimelineIntervals = [];
    this.finishLineRewind();
    for (const line of this.cachedLineArray) {
      for (const word of AmLyrics.motionWords.get(line) || [])
        AmLyrics.clearNormalWordMotion(word.element);
    }
    this.pendingLayoutOffsets.clear();
    this.clearGapAnimations();
    this.cancelLineScrollAnimation();
    this.lyricsContainer
      ?.querySelectorAll<HTMLElement>('.native-motion')
      .forEach(char => AmLyrics.clearCharacterMotion(char));
    this.clearProgressiveBlurLine();
    this.cachedAllGaps = [];
    this.gapsCached = false;
    this.cachedLineData = null;
    this.lineElementCache.clear();
    this.gapElementCache.clear();
    this.footerElement = undefined;
    this.cachedLineArray = [];
    this.preActiveLineElements = [];
    this.positionedLineElements = [];
    this.clearGapAnimations();
    this.activeGapLineElements = [];
    this.lastInstrumentalIndex = null;
    this.clearBackgroundExpandedLine();
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = undefined;
  }

  private _updateCachedIsUnsynced() {
    this.cachedIsUnsynced =
      this.lyrics && this.lyrics.length > 0
        ? this.lyrics.every(l => l.timestamp === 0 && l.endtime === 0)
        : false;
  }

  private static characterMotionMode(
    text: string,
    durationMs: number,
    background = false,
  ): 'none' | 'rise' | 'emphasis' {
    // Native constructor RVA 0x2f483c–0x2f48e0 and draw gate 0x2f662f.
    // 0x2f4080 detects Chinese/Japanese; Hangul is not part of that predicate.
    // Keep connected RTL scripts intact in the browser renderer.
    if (/[\u0590-\u08ff]/.test(text)) return 'none';
    const count = Array.from(text.trim()).length;
    if (!count) return 'none';
    if (/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/.test(text)) {
      return count > 1 ? 'rise' : 'none';
    }
    return !background && durationMs >= 1000 && count <= 7
      ? 'emphasis'
      : 'none';
  }

  private static overlapSegmenter = (Intl as any).Segmenter
    ? new (Intl as any).Segmenter(undefined, { granularity: 'word' })
    : null;

  private static getOverlapWordEnds(syllables: Syllable[]): number[] {
    const text = syllables.map(s => s.text).join('');
    const segments: Array<{
      index: number;
      segment: string;
      isWordLike?: boolean;
    }> = AmLyrics.overlapSegmenter
      ? Array.from(AmLyrics.overlapSegmenter.segment(text))
      : Array.from(
          text.matchAll(
            /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]|[^\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g,
          ),
          match => ({ index: match.index!, segment: match[0] }),
        );
    let offset = 0;
    const spans = syllables.map(syllable => {
      const start = offset;
      offset += syllable.text.length;
      return { syllable, start, end: offset };
    });
    return segments
      .filter(
        segment =>
          segment.isWordLike ?? /[^\s.,!?;:…。，！？、]/.test(segment.segment),
      )
      .map(segment => {
        const end = segment.index + segment.segment.length;
        const span = spans.find(item => end > item.start && end <= item.end)!;
        return (
          span.syllable.timestamp +
          (span.syllable.endtime - span.syllable.timestamp) *
            ((end - span.start) / Math.max(1, span.end - span.start))
        );
      });
  }

  private _ensureLineDataCache() {
    if (this.cachedLineData || !this.lyrics) return;
    this.backgroundTailIndices = [];
    this.cachedLineData = this.lyrics.map((line, index) => {
      if (
        line.backgroundText.length &&
        AmLyrics.getBackgroundTextPlacement(line) === 'after'
      )
        this.backgroundTailIndices.push(index);
      const wordGroups: Syllable[][] = [];
      let group: Syllable[] = [];
      line.text.forEach((syllable, syllableIndex) => {
        group.push(syllable);
        const next = line.text[syllableIndex + 1];
        if (!next || /\s$/.test(syllable.text) || /^\s/.test(next.text)) {
          wordGroups.push(group);
          group = [];
        }
      });
      const lineSynced = AmLyrics.isLineSyncedLine(line);
      const words = wordGroups.map(syllables => {
        const text = syllables
          .map(syllable => syllable.text)
          .join('')
          .trim();
        const start = Math.min(
          ...syllables.map(syllable => syllable.timestamp),
        );
        const end = Math.max(...syllables.map(syllable => syllable.endtime));
        return {
          start,
          end,
          duration: end - start,
          mode: lineSynced
            ? 'none'
            : AmLyrics.characterMotionMode(text, end - start),
          rtl: /[\u0590-\u08ff]/.test(text),
        };
      });
      const overlapWordEnds = AmLyrics.getOverlapWordEnds(line.text);
      const nextLine = this.lyrics![index + 1];
      return {
        wordGroups,
        mainEnd: Math.max(line.timestamp, ...line.text.map(s => s.endtime)),
        overlapWordEnds,
        substantialOverlap: Boolean(
          nextLine &&
            overlapWordEnds.filter(end => end > nextLine.timestamp).length > 1,
        ),
        backgroundEnd: Math.max(
          line.timestamp,
          ...line.backgroundText.map(s => s.endtime),
        ),
        groupGrowable: words.map(word => word.mode === 'emphasis'),
        groupGlowing: words.map(word => word.mode === 'emphasis'),
        groupCharRise: words.map(word => word.mode === 'rise'),
        groupCharDrag: words.map(() => false),
        vwFullDuration: words.map(word => word.duration),
        vwCharOffset: words.map(() => 0),
        vwStartMs: words.map(word => word.start),
        vwEndMs: words.map(word => word.end),
        lineIsRTL: line.direction === 'rtl' || words.some(word => word.rtl),
      };
    });
    const events = new Set<number>();
    const addGapEvents = (end: number) => {
      events.add(end - GAP_COLLAPSE_LEAD_MS - GAP_EXIT_LEAD_MS);
      events.add(end - GAP_COLLAPSE_LEAD_MS);
      events.add(end + GAP_EXIT_TRAIL_MS);
    };
    this.lyrics.forEach((line, index) => {
      const next = this.lyrics![index + 1];
      const lead = this.cachedLineData![index];
      const lookAhead = next
        ? Math.min(500, Math.max(350, next.timestamp - line.endtime))
        : 350;
      events.add(line.timestamp - 500);
      events.add(line.timestamp - 350);
      events.add(line.timestamp);
      events.add(line.endtime + 1);
      events.add(line.endtime + 201);
      events.add(lead.mainEnd);
      if (next) events.add(next.timestamp - lookAhead);
      if (index === 0 && line.timestamp >= INSTRUMENTAL_THRESHOLD_MS)
        addGapEvents(line.timestamp);
      if (next && next.timestamp - line.endtime >= INSTRUMENTAL_THRESHOLD_MS)
        addGapEvents(next.timestamp);
      lead.overlapWordEnds.forEach(time => events.add(time));
      for (const syllable of [...line.text, ...line.backgroundText]) {
        events.add(syllable.timestamp - WORD_WIPE_LOOKAHEAD_MS);
        events.add(syllable.timestamp - NEXT_WORD_PRE_WIPE_MAX_DURATION_MS);
        events.add(syllable.timestamp - WORD_PRE_WIPE_HANDOFF_LEAD_MS);
        events.add(syllable.timestamp);
        events.add(syllable.endtime);
        events.add(syllable.endtime + 1);
      }
    });
    this.playbackEvents = [...events]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    this.playbackEventIndex = -1;
  }

  private _updateCharTimingData() {
    if (!this.shadowRoot) return;

    this._rebuildDomCache();

    const words = Array.from(
      this.shadowRoot.querySelectorAll<HTMLElement>('.lyrics-word'),
    );
    const wordsById = new Map<string, HTMLElement[]>();
    words.forEach((word, index) => {
      const id = word.dataset.virtualWordId || `word-${index}`;
      const group = wordsById.get(id) || [];
      group.push(word);
      wordsById.set(id, group);
    });
    wordsById.forEach(group => {
      const chars = group.flatMap(word =>
        Array.from(word.querySelectorAll<HTMLElement>('.char')),
      );
      group.forEach(word => {
        const target = word as any;
        target._cachedVirtualWordElements = group;
        target._cachedVirtualWordCharSpans = chars;
      });
      // Word geometry is prepared lazily for active/upcoming lines.
    });
  }

  private static arraysEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((val, i) => val === b[i]);
  }

  private static isOppositeAgent(line: LyricsLine): boolean {
    return (
      line.alignment === 'end' ||
      (line.alignment === undefined && line.oppositeTurn)
    );
  }

  private static isLineSyncedLine(line: LyricsLine | undefined): boolean {
    if (!line) return false;
    return line.isWordSynced === false || line.text.some(s => s.lineSynced);
  }

  private getLineHighlightEndTime(index: number): number {
    this.ensureTimingCache();
    if (this.lineHighlightEnds[index] !== undefined)
      return this.lineHighlightEnds[index];
    const end = this.computeLineHighlightEndTime(index);
    this.lineHighlightEnds[index] = end;
    return end;
  }

  private computeLineHighlightEndTime(index: number): number {
    if (!this.lyrics) return 0;
    const line = this.lyrics[index];
    if (!line) return 0;

    const backgroundEnd = line.backgroundText?.reduce(
      (latest, syllable) => Math.max(latest, syllable.endtime),
      line.timestamp,
    );
    const rawEnd = Math.max(
      line.endtime,
      backgroundEnd ?? line.timestamp,
      line.timestamp,
    );

    const nextLine = this.lyrics[index + 1];
    if (!nextLine || nextLine.timestamp <= line.timestamp) {
      return rawEnd > line.timestamp ? rawEnd + 200 : rawEnd;
    }

    this._ensureLineDataCache();
    const leadEnd = this.cachedLineData?.[index].mainEnd ?? line.endtime;
    if (backgroundEnd && backgroundEnd > Math.max(leadEnd, nextLine.timestamp))
      return Math.max(leadEnd, nextLine.timestamp);

    if (rawEnd > line.timestamp) {
      if (nextLine.timestamp < rawEnd) {
        return rawEnd;
      }

      const gapToNext = nextLine.timestamp - rawEnd;
      if (gapToNext >= INSTRUMENTAL_THRESHOLD_MS) {
        return rawEnd;
      }
    }

    return nextLine.timestamp;
  }

  private static getLineIndexFromElement(
    lineElement: HTMLElement | null,
  ): number | null {
    if (!lineElement) return null;
    const match = lineElement.id.match(/^lyrics-line-(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  private static easeOutExpo(progress: number): number {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return 1 - 2 ** (-10 * progress);
  }

  private static getCssTimeMs(
    element: HTMLElement,
    propertyName: string,
    fallback: number,
  ): number {
    const value = getComputedStyle(element)
      .getPropertyValue(propertyName)
      .trim();
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return fallback;
    return value.endsWith('ms') ? parsed : parsed * 1000;
  }

  private updateInstrumentalGap(
    gap: HTMLElement,
    timeMs: number,
    isSeek = false,
  ): void {
    const gapStartTime =
      (gap as any)._cachedStartTime ??
      parseFloat(gap.getAttribute('data-start-time') || '0');
    const gapEndTime =
      (gap as any)._cachedEndTime ??
      parseFloat(gap.getAttribute('data-end-time') || '0');
    let exitLeadMs = this.gapExitDurationCache.get(gap);
    if (exitLeadMs === undefined) {
      exitLeadMs = AmLyrics.getCssTimeMs(
        gap,
        '--am-lyrics-instrumental-exit-duration',
        GAP_EXIT_LEAD_MS,
      );
      this.gapExitDurationCache.set(gap, exitLeadMs);
    }
    let collapseLeadMs = this.gapCollapseDurationCache.get(gap);
    if (collapseLeadMs === undefined) {
      collapseLeadMs = AmLyrics.getCssTimeMs(
        gap,
        '--am-lyrics-instrumental-collapse-duration',
        GAP_COLLAPSE_LEAD_MS,
      );
      this.gapCollapseDurationCache.set(gap, collapseLeadMs);
    }
    let dots = this.gapDotCache.get(gap);
    if (!dots) {
      dots = Array.from(gap.querySelectorAll<HTMLElement>('.lyrics-syllable'));
      this.gapDotCache.set(gap, dots);
    }
    const duration = Math.max(1, gapEndTime - gapStartTime);
    const elapsed = timeMs - gapStartTime;
    if (elapsed < 0 || elapsed >= duration + GAP_EXIT_TRAIL_MS) {
      const before = gap.classList.contains('active')
        ? this.captureLyricLayout()
        : null;
      this.gapAnimations
        .get(gap)
        ?.animations.forEach(animation => animation.cancel());
      this.gapAnimations.delete(gap);
      gap.classList.remove('active', 'gap-collapsing', 'gap-exiting');
      const index = this.activeGapLineElements.indexOf(gap);
      if (index !== -1) this.activeGapLineElements.splice(index, 1);
      if (before) this.finishLyricLayout(before);
      return;
    }
    const remaining = duration - elapsed;
    const layoutBefore =
      gap.classList.contains('active') !== remaining > collapseLeadMs
        ? this.captureLyricLayout()
        : null;
    gap.classList.toggle('active', remaining > collapseLeadMs);
    gap.classList.toggle('gap-collapsing', remaining <= collapseLeadMs);
    gap.classList.toggle(
      'gap-exiting',
      remaining <= collapseLeadMs + exitLeadMs,
    );
    if (!this.activeGapLineElements.includes(gap))
      this.activeGapLineElements.push(gap);
    if (layoutBefore) this.finishLyricLayout(layoutBefore);

    let motion = this.gapAnimations.get(gap);
    if (!motion) {
      const layer = gap.querySelector<HTMLElement>('.main-vocal-container');
      if (!layer) return;
      const exitStart = Math.max(
        GAP_ENTRY_SCALE_MS,
        duration - collapseLeadMs - exitLeadMs,
      );
      const end = Math.min(duration, exitStart + exitLeadMs);
      const entryStart = Math.max(
        0,
        Math.min(elapsed, exitStart - GAP_ENTRY_SCALE_MS),
      );
      // Dense samples only around the entrance and exit; the slow breath needs
      // far fewer. The browser interpolates all frames without playback ticks.
      const times = new Set([
        0,
        entryStart,
        entryStart + GAP_ENTRY_FADE_MS,
        entryStart + GAP_ENTRY_SCALE_MS,
        exitStart,
        end,
      ]);
      for (
        let t = entryStart + 25;
        t < entryStart + GAP_ENTRY_SCALE_MS;
        t += 25
      )
        times.add(t);
      for (
        let t = entryStart + GAP_ENTRY_SCALE_MS;
        t < exitStart;
        t += Math.max(200, exitStart / 1000)
      )
        times.add(t);
      for (let t = exitStart; t < end; t += 20) times.add(t);
      const frames = [...times]
        .filter(t => t <= end)
        .sort((a, b) => a - b)
        .map(time => {
          const cycle = GAP_PULSE_DURATION_MS * 2;
          const phase =
            (time + GAP_PULSE_DURATION_MS - (exitStart % cycle) + cycle) %
            cycle;
          const mix =
            (1 - Math.cos((Math.PI * phase) / GAP_PULSE_DURATION_MS)) / 2;
          let scale =
            (GAP_BREATH_MAX_SCALE +
              (GAP_BREATH_MIN_SCALE - GAP_BREATH_MAX_SCALE) * mix) *
            AmLyrics.easeOutExpo(
              AmLyrics.clamp((time - entryStart) / GAP_ENTRY_SCALE_MS, 0, 1),
            );
          let opacity = AmLyrics.clamp(
            (time - entryStart) / GAP_ENTRY_FADE_MS,
            0,
            1,
          );
          if (time >= exitStart) {
            const progress = (time - exitStart) / Math.max(1, end - exitStart);
            const popping = progress <= GAP_EXIT_POP_PROGRESS;
            const phaseProgress = popping
              ? progress / GAP_EXIT_POP_PROGRESS
              : (progress - GAP_EXIT_POP_PROGRESS) /
                (1 - GAP_EXIT_POP_PROGRESS);
            const ease =
              phaseProgress * phaseProgress * (3 - 2 * phaseProgress);
            scale = popping
              ? GAP_BREATH_MIN_SCALE +
                (GAP_EXIT_POP_SCALE - GAP_BREATH_MIN_SCALE) * ease
              : GAP_EXIT_POP_SCALE * (1 - ease);
            opacity = popping ? 1 : 1 - ease;
          }
          return { offset: time / end, transform: `scale(${scale})`, opacity };
        });
      const animation = layer.animate(frames, { duration: end, fill: 'both' });
      const animations = [
        animation,
        ...dots.map((dot, index) =>
          dot.animate([{ opacity: 0.25 }, { opacity: 1 }], {
            duration: exitStart / 3,
            delay: (index * exitStart) / 3,
            fill: 'both',
          }),
        ),
      ];
      for (const effect of animations) {
        const timelineTime = effect.timeline?.currentTime;
        if (typeof timelineTime === 'number')
          effect.startTime = timelineTime - elapsed;
        else effect.currentTime = elapsed;
      }
      motion = { animations, end };
      this.gapAnimations.set(gap, motion);
    } else if (
      isSeek ||
      Math.min(elapsed, motion.end) - Number(motion.animations[0].currentTime) >
        200
    ) {
      // Forward clock corrections must not replay the entrance or exit pop.
      // Explicit seeks can move either way, including into a completed gap.
      motion.animations.forEach(animation => {
        const timeline = animation;
        timeline.currentTime = elapsed;
        if (
          animation.playState === 'finished' &&
          elapsed < Number(animation.effect?.getComputedTiming().endTime)
        )
          animation.play();
      });
    }
  }

  private clearProgressiveBlurLine(): void {
    this.progressiveBlurAnimation?.cancel();
    this.progressiveBlurAnimation = undefined;
    if (!this.progressiveBlurLine) return;
    this.progressiveBlurLine.classList.remove('progressive-unblur');
    this.progressiveBlurLine.style.removeProperty('filter');
    this.progressiveBlurLine = null;
  }

  private pendingLayoutOffsets = new Map<HTMLElement, number>();

  private captureLyricLayout(): LyricLayout {
    const lines = this.cachedLineArray.length
      ? this.cachedLineArray
      : Array.from(
          this.lyricsContainer?.querySelectorAll<HTMLElement>('.lyrics-line') ||
            [],
        );
    const reference = Math.max(
      0,
      lines.indexOf(this.currentPrimaryActiveLine!),
    );
    const nearby = lines.slice(Math.max(0, reference - 20), reference + 21);
    const contents = nearby.flatMap(line =>
      Array.from(
        line.querySelectorAll<HTMLElement>(
          '.lyrics-line-container, .main-vocal-container',
        ),
      ),
    );
    return {
      tops: new Map(nearby.map(line => [line, line.offsetTop])),
      contents: new Map(contents.map(content => [content, content.offsetTop])),
      scrollTop: this.lyricsContainer?.scrollTop || 0,
    };
  }

  private finishLyricLayout(before: LyricLayout, deferScroll = false): void {
    if (!this.lyricsContainer) return;
    const scrollCorrection = this.lyricsContainer.scrollTop - before.scrollTop;
    before.tops.forEach((top, line) => {
      const delta = top - line.offsetTop + scrollCorrection;
      if (Math.abs(delta) > 0.1)
        this.pendingLayoutOffsets.set(
          line,
          (this.pendingLayoutOffsets.get(line) || 0) + delta,
        );
    });
    const contentChanges = [...before.contents].map(([content, top]) => ({
      content,
      delta: top - content.offsetTop,
    }));
    for (const { content, delta } of contentChanges) {
      // eslint-disable-next-line no-continue
      if (Math.abs(delta) < 0.1) continue;
      const previous = this.contentSprings.get(content);
      const pose = previous
        ? sampleSpring(
            previous.position,
            previous.velocity,
            Number(previous.animation.currentTime || 0) / 1000,
            10,
          )
        : { position: 0, velocity: 0 };
      previous?.animation.cancel();
      this.contentSprings.delete(content);
      // eslint-disable-next-line no-continue
      if (this.shouldReduceMotion || this.lineMotion === 'instant') continue;
      const position = pose.position + delta;
      const animation = content.animate(
        createLineSpringFrames(position, pose.velocity, 10, 'translate'),
        { duration: 1200, easing: 'linear', fill: 'both' },
      );
      this.contentSprings.set(content, {
        animation,
        position,
        velocity: pose.velocity,
      });
      animation.onfinish = () => {
        if (this.contentSprings.get(content)?.animation !== animation) return;
        animation.cancel();
        this.contentSprings.delete(content);
      };
    }
    if (deferScroll || !this.pendingLayoutOffsets.size) return;
    const target = this.currentPrimaryActiveLine;
    const top =
      target && this.autoScroll && !this.isUserScrolling
        ? Math.max(0, target.offsetTop - this.getScrollPaddingTop())
        : this.lyricsContainer.scrollTop;
    this.animateScrollYouLy(-top, false, undefined, target);
  }

  private setBackgroundExpandedLine(
    lineElement: HTMLElement | null,
    deferScroll = false,
    visibleIndices: number[] = [],
    visibilityTime = this.currentTime,
  ): boolean {
    const desired = new Set<HTMLElement>();
    for (const index of visibleIndices) {
      const line = this._getLineElement(index);
      if (
        line &&
        this.getBackgroundWrap(line) &&
        this.lyrics?.[index].backgroundText.some(
          note => note.endtime > visibilityTime,
        )
      )
        desired.add(line);
    }
    if (lineElement && this.getBackgroundWrap(lineElement))
      desired.add(lineElement);
    const entering = [...desired].filter(
      line => !this.backgroundExpandedLines.has(line),
    );
    const leaving = [...this.backgroundExpandedLines].filter(
      line => !desired.has(line),
    );
    if (!entering.length && !leaving.length) return false;

    const before = this.captureLyricLayout();
    // Capture every pose before committing any height, including interrupted fades.
    const changes = [...leaving, ...entering].map(line => {
      const wrap = this.getBackgroundWrap(line)!;
      const style = getComputedStyle(wrap);
      const pose = { opacity: style.opacity, transform: style.transform };
      const expanded = desired.has(line);
      const duration = this.shouldReduceMotion
        ? 0
        : AmLyrics.getCssTimeMs(
            line,
            expanded
              ? '--am-lyrics-background-vocal-enter-duration'
              : '--am-lyrics-background-vocal-exit-duration',
            expanded ? 650 : BACKGROUND_EXIT_DURATION_MS,
          );
      const height = expanded ? wrap.offsetHeight + 4 : 0;
      return { line, wrap, pose, expanded, duration, height };
    });
    for (const { line, expanded, duration, height } of changes) {
      this.backgroundAnimations.get(line)?.cancel();
      this.backgroundAnimations.delete(line);
      if (expanded) {
        line.style.setProperty(
          '--am-lyrics-background-vocal-height',
          `${height}px`,
        );
        this.backgroundExpandedLines.add(line);
      } else {
        this.backgroundExpandedLines.delete(line);
      }
      line.classList.toggle('bg-expanded', expanded);
      line.classList.toggle('bg-collapsing', !expanded && duration > 0);
    }
    const destinations = changes.map(({ wrap }) => {
      const style = getComputedStyle(wrap);
      return { opacity: style.opacity, transform: style.transform };
    });
    changes.forEach(({ line, wrap, pose, duration }, index) => {
      if (duration > 0) {
        const animation = wrap.animate([pose, destinations[index]], {
          duration,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'both',
        });
        this.backgroundAnimations.set(line, animation);
        animation.onfinish = () => {
          if (this.backgroundAnimations.get(line) !== animation) return;
          animation.cancel();
          this.backgroundAnimations.delete(line);
          line.classList.remove('bg-collapsing');
        };
      }
    });
    this.finishLyricLayout(before, deferScroll);
    return true;
  }

  private clearBackgroundExpandedLine(): void {
    this.clearBackgroundCarries();
    for (const animation of this.backgroundAnimations.values())
      animation.cancel();
    for (const line of new Set([
      ...this.backgroundExpandedLines,
      ...this.backgroundAnimations.keys(),
    ]))
      line.classList.remove('bg-expanded', 'bg-collapsing');
    this.backgroundAnimations.clear();
    this.backgroundExpandedLines.clear();
    for (const { animation } of this.contentSprings.values())
      animation.cancel();
    this.contentSprings.clear();
  }

  private backgroundCarries = new Map<
    number,
    {
      original: HTMLElement;
      clone: HTMLElement;
      sourceLine: HTMLElement;
      owner: HTMLElement;
      display: string;
      exiting: boolean;
      animation?: Animation;
      fromTop?: number;
      until: number;
    }
  >();

  private restoreCarriesAfterRender = false;

  private backgroundCarryRestoreTops = new Map<number, number>();

  private backgroundCarryRestoreOwners = new Map<number, number>();

  private lastCarryTime = 0;

  private static getBackgroundCarryTop(container: HTMLElement): number {
    return (
      container.querySelector<HTMLElement>('.lyrics-word') || container
    ).getBoundingClientRect().top;
  }

  private animateBackgroundCarries(): void {
    for (const entry of this.backgroundCarries.values()) {
      // eslint-disable-next-line no-continue
      if (entry.fromTop === undefined || entry.exiting) continue;
      const { fromTop } = entry;
      entry.fromTop = undefined;
      // eslint-disable-next-line no-continue
      if (this.shouldReduceMotion || this.lineMotion === 'instant') continue;
      // Measure after the new line's scroll/layout springs have committed.
      // The local spring and its parent then share the same displacement curve.
      const scale =
        entry.clone.getBoundingClientRect().height /
        Math.max(1, entry.clone.offsetHeight);
      const delta =
        (fromTop - AmLyrics.getBackgroundCarryTop(entry.clone)) /
        Math.max(0.01, scale);
      const animation = entry.clone.animate(createLineSpringFrames(delta, 0), {
        duration: 1200,
        easing: 'linear',
        fill: 'both',
      });
      entry.animation = animation;
      animation.onfinish = () => {
        if (entry.animation !== animation) return;
        animation.cancel();
        entry.animation = undefined;
      };
    }
  }

  private static invalidateVocalCache(line: HTMLElement): void {
    AmLyrics.motionWords.delete(line);
    AmLyrics.motionSyllables.delete(line);
    const target = line as any;
    target._cachedSyllableElements = null;
  }

  private removeBackgroundCarry(index: number): void {
    const entry = this.backgroundCarries.get(index);
    if (!entry) return;
    entry.animation?.cancel();
    AmLyrics.resetSyllables(entry.clone);
    entry.clone.getAnimations({ subtree: true }).forEach(a => a.cancel());
    entry.clone.remove();
    entry.original.style.display = entry.display;
    entry.original.removeAttribute('data-bg-suspended');
    AmLyrics.invalidateVocalCache(entry.sourceLine);
    this.backgroundCarries.delete(index);
  }

  private clearBackgroundCarries(): void {
    for (const index of this.backgroundCarries.keys())
      this.removeBackgroundCarry(index);
  }

  private syncBackgroundCarries(
    owner: HTMLElement,
    predictiveTime: number,
  ): boolean {
    if (!this.lyrics) return false;
    const ownerIndex = AmLyrics.getLineIndexFromElement(owner);
    if (ownerIndex === null) return false;
    if (this.currentTime < this.lastCarryTime) this.clearBackgroundCarries();
    this.lastCarryTime = this.currentTime;
    const desired = new Set<number>();
    const currentCarry = [...this.backgroundCarries].find(
      ([, entry]) => !entry.exiting && this.currentTime < entry.until,
    );
    const restoredCarry = [...this.backgroundCarryRestoreOwners].find(
      ([, restoredOwner]) =>
        this.currentTime < this.lyrics![restoredOwner].endtime,
    );
    if (currentCarry) desired.add(currentCarry[0]);
    else if (restoredCarry) desired.add(restoredCarry[0]);
    else {
      const index = ownerIndex - 1;
      const line = this.lyrics[index];
      const end = this.cachedLineData?.[index]?.backgroundEnd ?? 0;
      const leadEnd = this.cachedLineData?.[index]?.mainEnd ?? 0;
      const incoming = this.lyrics[ownerIndex];
      if (
        line &&
        end > this.currentTime &&
        end - Math.max(leadEnd, incoming.timestamp) >=
          BACKGROUND_CARRY_MIN_OVERLAP_MS &&
        leadEnd <= Math.max(this.currentTime, incoming.timestamp) &&
        incoming.timestamp <= predictiveTime &&
        this.currentTime < incoming.endtime &&
        AmLyrics.isOppositeAgent(line) === AmLyrics.isOppositeAgent(incoming) &&
        (!line.agentId ||
          !incoming.agentId ||
          line.agentId === incoming.agentId) &&
        AmLyrics.getBackgroundTextPlacement(line) === 'after'
      )
        desired.add(index);
    }
    let changed = false;
    let before: LyricLayout | undefined;
    const capture = () => {
      before ??= this.captureLyricLayout();
    };
    Array.from(this.backgroundCarries).forEach(([index, carry]) => {
      const entry = carry;
      if (desired.has(index) && !entry.exiting) return;
      if (desired.size && !desired.has(index)) {
        capture();
        this.removeBackgroundCarry(index);
        changed = true;
        return;
      }
      if (entry.exiting) {
        if (desired.has(index)) this.removeBackgroundCarry(index);
        return;
      }
      capture();
      const wrap = entry.clone.querySelector<HTMLElement>(
        '.background-vocal-wrap',
      )!;
      entry.animation?.cancel();
      entry.exiting = true;
      changed = true;
      if (this.shouldReduceMotion) {
        this.removeBackgroundCarry(index);
        return;
      }
      // Release its layout space now; the lead's spring absorbs the displacement.
      const top = entry.clone.offsetTop;
      const width = entry.clone.offsetWidth;
      entry.clone.style.cssText += `;position:absolute;top:${top}px;width:${width}px;height:0;`;
      entry.animation = wrap.animate(
        [
          {
            opacity: getComputedStyle(wrap).opacity,
            transform: getComputedStyle(wrap).transform,
          },
          { opacity: 0, transform: 'translateY(-6px)' },
        ],
        {
          duration: BACKGROUND_EXIT_DURATION_MS,
          easing: 'ease-out',
          fill: 'forwards',
        },
      );
      entry.animation.onfinish = () => {
        if (this.backgroundCarries.get(index) === entry && entry.exiting)
          this.removeBackgroundCarry(index);
      };
    });
    desired.forEach(index => {
      let entry = this.backgroundCarries.get(index);
      if (!entry) {
        const destinationIndex =
          this.backgroundCarryRestoreOwners.get(index) ?? ownerIndex;
        const destination = this._getLineElement(destinationIndex) || owner;
        const sourceLine = this._getLineElement(index);
        const original = sourceLine?.querySelector<HTMLElement>(
          '.background-vocal-container:not([data-bg-carried])',
        );
        const main = destination.querySelector<HTMLElement>(
          '.lyrics-line-container',
        );
        if (!sourceLine || !original || !main) return;
        capture();
        const oldTop =
          this.backgroundCarryRestoreTops.get(index) ??
          AmLyrics.getBackgroundCarryTop(original);
        const style = getComputedStyle(original);
        const clone = original.cloneNode(true) as HTMLElement;
        clone.setAttribute('data-bg-carried', `${index}`);
        clone.classList.replace('background-after', 'background-before');
        clone.style.direction = style.direction;
        clone.style.textAlign = style.textAlign;
        clone.style.display = 'block';
        for (const node of clone.querySelectorAll<HTMLElement>(
          '.lyrics-word, .lyrics-syllable, .char, .char-motion',
        )) {
          node.classList.remove(
            'shared-word-wipe',
            'masked-word-wipe',
            'is-rising',
            'word-wipe-rtl',
            'native-motion',
            'highlight',
            'finished',
            'pre-highlight',
            'word-started',
            'normal-word-motion',
          );
          node.removeAttribute('data-glow');
          node.removeAttribute('data-wipe-text');
          for (const prop of [
            'animation',
            'background-position',
            '--word-wipe-position',
            'background-size',
            'background-color',
            'transform',
          ])
            node.style.removeProperty(prop);
        }
        const { display } = original.style;
        AmLyrics.resetSyllables(original);
        original.setAttribute('data-bg-suspended', '');
        original.style.display = 'none';
        AmLyrics.invalidateVocalCache(sourceLine);
        main.before(clone);
        const wrap = clone.querySelector<HTMLElement>(
          '.background-vocal-wrap',
        )!;
        wrap.style.opacity = '1';
        wrap.style.transform = 'none';
        clone.style.height = `${wrap.offsetHeight + 4}px`;
        entry = {
          original,
          clone,
          sourceLine,
          owner: destination,
          display,
          exiting: false,
          fromTop: oldTop,
          until: this.lyrics![destinationIndex].endtime,
        };
        this.backgroundCarries.set(index, entry);
        changed = true;
      }
      AmLyrics.updateSyllablesForLine(
        entry.clone,
        this.currentTime,
        this.shouldReduceMotion,
      );
    });
    if (before && changed) this.finishLyricLayout(before, true);
    return changed;
  }

  private getPrimaryActiveLineIndex(activeIndices: number[]): number | null {
    if (activeIndices.length === 0) return null;

    const groupStart = activeIndices[0];
    const groupEnd = activeIndices[activeIndices.length - 1];
    let candidateIndex = Math.max(groupStart, groupEnd - 2);

    const currentPrimaryIndex = AmLyrics.getLineIndexFromElement(
      this.currentPrimaryActiveLine,
    );
    if (
      currentPrimaryIndex !== null &&
      activeIndices.includes(currentPrimaryIndex)
    ) {
      if (activeIndices.length <= 3) {
        candidateIndex = currentPrimaryIndex;
      } else if (candidateIndex < currentPrimaryIndex) {
        candidateIndex = currentPrimaryIndex;
      }
    }

    return candidateIndex;
  }

  private getPrimaryScrollLineIndex(
    activeIndices: number[],
    time: number,
  ): number | null {
    if (!this.lyrics || this.lyrics.length === 0) return null;

    const latest = activeIndices.length
      ? activeIndices[activeIndices.length - 1]
      : this.getLineIndexAtTime(time, this.lastActiveIndex);
    if (latest === -1) return null;
    this._ensureLineDataCache();
    // Judge overlap at its start, then hold until the earlier lead actually ends.
    for (const index of this.findActiveLineIndices(this.currentTime)) {
      const data = this.cachedLineData?.[index];
      if (
        index < latest &&
        data &&
        data.mainEnd > this.currentTime &&
        data.substantialOverlap
      )
        return index;
    }
    return latest;
  }

  private focusLine(
    lineElement: HTMLElement,
    forceScroll = false,
    scrollDuration: number | undefined = undefined,
    skipScroll = false,
    preservePrimary = false,
  ): void {
    const primaryChanged = lineElement !== this.currentPrimaryActiveLine;

    if (primaryChanged && !preservePrimary) {
      this.lastPrimaryActiveLine = this.currentPrimaryActiveLine;
      if (this.lastPrimaryActiveLine) {
        this.lastPrimaryActiveLine.style.setProperty(
          '--scroll-duration',
          `${scrollDuration ?? SCROLL_ANIMATION_DURATION_MS}ms`,
        );
        const previousIndex = AmLyrics.getLineIndexFromElement(
          this.lastPrimaryActiveLine,
        );
        const nextIndex = AmLyrics.getLineIndexFromElement(lineElement);
        const overlaps =
          previousIndex !== null &&
          nextIndex !== null &&
          this.getLineHighlightEndTime(previousIndex) >
            (this.lyrics?.[nextIndex].timestamp ?? 0);
        this.lastPrimaryActiveLine.classList.toggle(
          'scroll-exiting',
          !overlaps,
        );
        if (!this.lastPrimaryActiveLine.classList.contains('active')) {
          this.lastPrimaryActiveLine.classList.remove('pre-active');
          this.preActiveLineElements = this.preActiveLineElements.filter(
            element => element !== this.lastPrimaryActiveLine,
          );
        }
      }
      this.currentPrimaryActiveLine = lineElement;
      this.currentPrimaryActiveLine.classList.remove('scroll-exiting');
      const lineIndex = AmLyrics.getLineIndexFromElement(lineElement);
      if (lineIndex !== null) {
        this.lastActiveIndex = lineIndex;
      }
    }

    // Line-timed highlighting follows pre-scroll, including seeks while the
    // target stays unchanged. Word-timed overlaps keep their own clocks.
    const targetIndex = AmLyrics.getLineIndexFromElement(lineElement);
    if (!preservePrimary && targetIndex !== null) {
      for (const index of this.activeLineIndices) {
        if (
          index < targetIndex &&
          AmLyrics.isLineSyncedLine(this.lyrics?.[index]) &&
          this.getLineHighlightEndTime(index) <=
            (this.lyrics?.[targetIndex].timestamp ?? 0)
        ) {
          const previousLine = this._getLineElement(index);
          if (previousLine?.classList.contains('active')) {
            previousLine.classList.remove('active', 'pre-active');
            previousLine.removeAttribute('aria-current');
            AmLyrics.unfinishSyllables(previousLine);
          }
        }
      }
    }

    // Only update blur/opacity position classes when the primary line
    // actually changes (or on force scroll). Running this every tick
    // causes visual churn and upward glitches.
    if (primaryChanged || forceScroll) {
      this.updatePositionClasses(lineElement);
    }

    if (
      !skipScroll &&
      (forceScroll || primaryChanged || preservePrimary) &&
      this.autoScroll &&
      !this.isUserScrolling &&
      !this.isClickSeeking
    ) {
      this.scrollToActiveLineYouLy(lineElement, forceScroll, scrollDuration);
    }
  }

  private setUserScrolling(value: boolean) {
    this.isUserScrolling = value;
    if (value) {
      this.lyricsContainer?.classList.add('user-scrolling');
      this.clearProgressiveBlurLine();
    } else {
      this.lyricsContainer?.classList.remove('user-scrolling');
    }
  }

  private handleUserScroll() {
    // Ignore programmatic scrolls and click-seek scrolls
    if (this.isProgrammaticScroll || this.isClickSeeking) {
      return;
    }

    // Mark that user is currently scrolling
    this.setUserScrolling(true);

    this.clearPastLineHighlights();

    // Clear any existing timeout
    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
    }

    // Let native momentum settle before returning control to auto-scroll.
    this.userScrollTimeoutId = window.setTimeout(() => {
      this.setUserScrolling(false);
      this.userScrollTimeoutId = undefined;

      // Optionally scroll back to current active line when re-enabling auto-scroll
      if (this.activeLineIndices.length > 0) {
        this._handleActiveLineScroll(true);
      } else {
        const currentGap = this.findInstrumentalGapAt(this.currentTime);
        if (currentGap) {
          this.scrollToInstrumental(currentGap.insertBeforeIndex, true);
        }
      }
    }, USER_SCROLL_RESUME_DELAY_MS);
  }

  private clearPastLineHighlights() {
    if (!this.lyricsContainer) return;

    const lineElements = this.cachedLineArray.length
      ? this.cachedLineArray
      : (Array.from(
          this.lyricsContainer.querySelectorAll(
            '.lyrics-line:not(.lyrics-gap)',
          ),
        ) as HTMLElement[]);
    for (const line of lineElements) {
      if (
        !line.classList.contains('active') &&
        line.classList.contains('persist-highlight')
      ) {
        AmLyrics.unfinishSyllables(line);
      }
    }
  }

  /**
   * Find the first (lowest-index) line whose raw time range contains `timeMs`.
   * Uses a stable forward scan so overlapping ranges always return the same
   * line, preventing primary-target jitter that causes scroll glitches.
   */
  private getLineIndexAtTime(timeMs: number, startHintIndex = 0): number {
    if (!this.lyrics || this.lyrics.length === 0) return -1;
    const len = this.lyrics.length;

    // 1. Check hint and immediate neighbours first (fast path)
    const hint = Math.max(0, Math.min(startHintIndex, len - 1));
    for (let i = hint; i < len; i += 1) {
      const line = this.lyrics[i];
      if (line.timestamp > timeMs) break;
      if (timeMs >= line.timestamp && timeMs < line.endtime) {
        return i;
      }
    }
    for (let i = hint - 1; i >= 0; i -= 1) {
      const line = this.lyrics[i];
      if (timeMs >= line.timestamp && timeMs < line.endtime) {
        return i;
      }
      if (line.endtime < timeMs) break;
    }

    // 2. Full forward scan — guaranteed deterministic for overlaps
    for (let i = 0; i < len; i += 1) {
      const line = this.lyrics[i];
      if (line.timestamp > timeMs) break;
      if (timeMs >= line.timestamp && timeMs < line.endtime) {
        return i;
      }
    }

    return -1;
  }

  private findActiveLineIndices(time: number): number[] {
    if (!this.lyrics || this.lyrics.length === 0) return [];
    this.ensureTimingCache();
    const interval = this.activeTimelineIntervals.find(
      entry => time >= entry.start && time < entry.end,
    );
    if (interval) return interval.indices;
    const activeLines: number[] = [];
    let start = -Infinity;
    let end = Infinity;

    for (let i = 0; i < this.lyrics.length; i += 1) {
      const line = this.lyrics[i];
      const highlightEndTime = this.getLineHighlightEndTime(i);

      if (line.timestamp > time) {
        end = Math.min(end, line.timestamp);
        break;
      }
      start = Math.max(start, line.timestamp);
      if (time >= line.timestamp && time < highlightEndTime) {
        activeLines.push(i);
        end = Math.min(end, highlightEndTime);
      } else {
        start = Math.max(start, highlightEndTime);
      }
    }
    // Playback and scroll look-ahead alternate between nearby intervals.
    // Retain both instead of rescanning the song on each clock change.
    if (this.activeTimelineIntervals.length >= 8)
      this.activeTimelineIntervals.shift();
    this.activeTimelineIntervals.push({ start, end, indices: activeLines });
    return activeLines;
  }

  private findInstrumentalGapAt(
    time: number,
  ): { insertBeforeIndex: number; gapStart: number; gapEnd: number } | null {
    if (!this.lyrics || this.lyrics.length === 0) return null;

    const gaps = this.findAllInstrumentalGaps();
    let low = 0;
    let high = gaps.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (gaps[middle].gapStart <= time) low = middle + 1;
      else high = middle;
    }
    const gap = gaps[low - 1];
    return gap && time < gap.gapEnd ? gap : null;
  }

  /**
   * Find ALL instrumental gaps in the song, regardless of current time.
   * Used by the template to always render gap elements in the DOM.
   */
  private findAllInstrumentalGaps(): Array<{
    insertBeforeIndex: number;
    gapStart: number;
    gapEnd: number;
  }> {
    if (this.gapsCached) return this.cachedAllGaps;
    if (!this.lyrics || this.lyrics.length === 0) return [];
    const gaps: Array<{
      insertBeforeIndex: number;
      gapStart: number;
      gapEnd: number;
    }> = [];

    // Start-of-song gap
    const first = this.lyrics[0];
    if (first.timestamp >= INSTRUMENTAL_THRESHOLD_MS) {
      gaps.push({ insertBeforeIndex: 0, gapStart: 0, gapEnd: first.timestamp });
    }

    // Inter-line gaps
    for (let i = 0; i < this.lyrics.length - 1; i += 1) {
      const curr = this.lyrics[i];
      const next = this.lyrics[i + 1];
      const gapStart = curr.endtime;
      const gapEnd = next.timestamp;
      if (gapEnd - gapStart >= INSTRUMENTAL_THRESHOLD_MS) {
        gaps.push({ insertBeforeIndex: i + 1, gapStart, gapEnd });
      }
    }

    this.cachedAllGaps = gaps;
    this.gapsCached = true;
    return gaps;
  }

  private handleLineClick(line: LyricsLine) {
    if (this.cachedIsUnsynced) return;

    // Reset all syllables to prevent highlighting conflicts during seek
    if (this.lyricsContainer) {
      const allLines = this.lyricsContainer.querySelectorAll('.lyrics-line');
      allLines.forEach(lineEl => {
        AmLyrics.resetSyllables(lineEl as HTMLElement);
        // Remove scroll-animate class and properties to stop any scroll animations
        lineEl.classList.remove('scroll-animate', 'scroll-exiting');
        (lineEl as HTMLElement).style.removeProperty('--scroll-delta');
        (lineEl as HTMLElement).style.removeProperty('--lyrics-line-delay');
      });
      // Ensure container state is clean
      this.lyricsContainer.classList.remove('wheel-scrolling');
    }

    this.cancelLineScrollAnimation();

    // Clear scroll animation timeouts

    // Also clear user scroll timeout to prevent stale scrollToActiveLine
    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
      this.userScrollTimeoutId = undefined;
    }
    this.setUserScrolling(false);

    // Reset active line tracking to prevent scroll fighting
    this.currentPrimaryActiveLine = null;
    this.lastPrimaryActiveLine = null;
    this.activeLineIds.clear();

    this.setBackgroundExpandedLine(null);

    // Find the clicked line element and scroll to it with forceScroll (like YouLyPlus)
    // Timestamps are already in milliseconds — match the data-start-time attribute directly
    const clickedLineElement = this.lyricsContainer?.querySelector(
      `.lyrics-line[data-start-time="${line.text[0]?.timestamp || 0}"]`,
    ) as HTMLElement | null;

    if (clickedLineElement && this.lyricsContainer) {
      // Update active line reference to the clicked line
      this.currentPrimaryActiveLine = clickedLineElement;

      // Reset currentScrollOffset to actual scroll position to prevent stale delta
      this.currentScrollOffset = -this.lyricsContainer.scrollTop;

      // Set click-seek cooldown to prevent updated() scroll from fighting
      this.isClickSeeking = true;
      if (this.clickSeekTimeout) clearTimeout(this.clickSeekTimeout);
      this.clickSeekTimeout = setTimeout(() => {
        this.isClickSeeking = false;
      }, 800);

      this.scrollToActiveLineYouLy(clickedLineElement, true);
      this.setBackgroundExpandedLine(clickedLineElement);
    }

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

  private scrollToInstrumental(insertBeforeIndex: number, forceScroll = false) {
    if (!this.lyricsContainer) return;

    // Find the gap element by ID instead of nth-child
    const gapTarget = this.lyricsContainer.querySelector(
      `#gap-${insertBeforeIndex}`,
    ) as HTMLElement | null;

    if (gapTarget) {
      // Use same scroll position as lyrics (scroll-padding-top from top), not center
      // This matches YouLyPlus behavior where gaps don't scroll to a different position
      const paddingTop = this.getScrollPaddingTop();
      const targetTranslateY = paddingTop - gapTarget.offsetTop;

      this.isProgrammaticScroll = true;
      this.clearPastLineHighlights();
      this.animateScrollYouLy(
        targetTranslateY,
        forceScroll,
        undefined,
        gapTarget,
      );

      setTimeout(() => {
        this.isProgrammaticScroll = false;
      }, 250);
    }
  }

  // === YouLyPlus-style Animation Methods ===

  /**
   * Get the scroll padding top value from CSS variable
   */
  private getScrollPaddingTop(): number {
    if (!this.lyricsContainer) return 0;
    const style = getComputedStyle(this.lyricsContainer);
    const paddingTopValue =
      style.getPropertyValue('--lyrics-scroll-padding-top') || '12%';
    let result: number;
    if (paddingTopValue.includes('%')) {
      result =
        this.lyricsContainer.clientHeight * (parseFloat(paddingTopValue) / 100);
    } else {
      result = parseFloat(paddingTopValue) || 0;
    }
    return result;
  }

  private cancelLineScrollAnimation(): void {
    this.lineSprings.forEach((spring, line) => {
      spring.animation.cancel();
      line.style.removeProperty('will-change');
    });
    this.lineSprings.clear();
  }

  private lineSprings = new Map<
    HTMLElement,
    {
      animation: Animation;
      position: number;
      velocity: number;
      delay: number;
      frequency: number;
    }
  >();

  private getLayoutScrollHeight(): number {
    const parent = this.lyricsContainer;
    if (!parent) return 0;
    const last =
      this.footerElement || (parent.lastElementChild as HTMLElement | null);
    if (!last) return parent.scrollHeight;
    return Math.max(
      parent.clientHeight,
      last.offsetTop +
        last.offsetHeight +
        (Number.parseFloat(getComputedStyle(last).marginBottom) || 0) +
        (Number.parseFloat(getComputedStyle(parent).paddingBottom) || 0),
    );
  }

  private animateScrollYouLy(
    newTranslateY: number,
    _forceScroll?: boolean,
    _scrollDuration?: number,
    referenceElement: HTMLElement | null = null,
  ): void {
    if (!this.lyricsContainer) return;
    const parent = this.lyricsContainer;
    const currentTop = parent.scrollTop;
    const requestedDelta = -newTranslateY - currentTop;
    if (this.shouldReduceMotion || this.lineMotion === 'instant') {
      this.cancelLineScrollAnimation();
      parent.scrollTop = Math.max(0, -newTranslateY);
      this.currentScrollOffset = -parent.scrollTop;
      this.pendingLayoutOffsets.clear();
      return;
    }
    if (Math.abs(requestedDelta) < 0.5 && !this.pendingLayoutOffsets.size)
      return;
    const lines = this.cachedLineArray.length
      ? this.cachedLineArray
      : Array.from(parent.querySelectorAll<HTMLElement>('.lyrics-line'));
    const reference = lines.indexOf(
      referenceElement || this.currentPrimaryActiveLine || lines[0],
    );
    const retargeting = this.lineSprings.size > 0;
    // LyricsBlossom's published line spring: mass 1, stiffness 100,
    // damping 18. Predictive look-ahead is not a playback-speed multiplier.
    const frequency = 10;
    // Sample the analytic spring once. The compositor advances translation;
    // playback work, lyric painting and JS frame scheduling cannot hold it up.
    // Read all current poses before cancelling anything or changing scrollTop.
    const firstVisibleIndex = Math.max(0, reference - 20);
    const poses = lines
      .slice(firstVisibleIndex, reference + 21)
      .map((line, localIndex) => {
        const index = firstVisibleIndex + localIndex;
        const previous = this.lineSprings.get(line);
        const age = previous
          ? Math.max(
              0,
              Number(previous.animation.currentTime || 0) / 1000 -
                previous.delay,
            )
          : 0;
        const pose = previous
          ? sampleSpring(
              previous.position,
              previous.velocity,
              age,
              previous.frequency,
            )
          : { position: 0, velocity: 0 };
        // Retarget from the painted pose: the compositor can be ahead of the
        // animation time exposed to JS, particularly in Firefox and WebKit.
        const transform = previous ? getComputedStyle(line).transform : 'none';
        const position =
          transform === 'none'
            ? pose.position
            : new DOMMatrixReadOnly(transform).m42;
        const steps =
          requestedDelta >= 0 ? index - reference : reference - index;
        // Keep an in-flight cascade's remaining delays. A row that settled
        // early must not start a fresh stagger while its neighbours are moving.
        let delay = 0;
        if (this.lineMotion !== 'uniform') {
          if (retargeting && previous) {
            delay = Math.max(
              0,
              previous.delay -
                Number(previous.animation.currentTime || 0) / 1000,
            );
          } else if (!retargeting) {
            delay = Math.max(0, Math.min(4, steps)) * 0.05;
          }
        }
        return {
          line,
          index,
          top: line.offsetTop,
          height: line.offsetHeight,
          moving: Boolean(previous),
          position: position + (this.pendingLayoutOffsets.get(line) || 0),
          velocity: pose.velocity,
          delay,
        };
      });
    this.pendingLayoutOffsets.clear();
    this.cancelLineScrollAnimation();
    // Animated translation contributes to scrollHeight. Measure the real
    // range only after removing it, or retargeting near the bottom jumps.
    const target = AmLyrics.clamp(
      -newTranslateY,
      0,
      Math.max(0, this.getLayoutScrollHeight() - parent.clientHeight),
    );
    const delta = target - currentTop;
    // Cover the entire swept viewport, not just its destination. Retargeted
    // rows retain their motion; distant rows need no sampled spring or layer.
    const visibleStart = Math.min(currentTop, target) - 200;
    const visibleEnd = Math.max(currentTop, target) + parent.clientHeight + 200;
    poses.forEach(
      ({
        line,
        index,
        top,
        height,
        moving,
        position: previousPosition,
        velocity,
        delay,
      }) => {
        const position = previousPosition + delta;
        if (
          Math.abs(index - reference) > 20 ||
          (!moving && (top + height < visibleStart || top > visibleEnd)) ||
          (Math.abs(position) < 0.1 && Math.abs(velocity) < 0.1)
        )
          return;
        const duration = 1.2;
        const frames = createLineSpringFrames(position, velocity, frequency);
        line.style.setProperty('will-change', 'transform');
        const animation = line.animate(frames, {
          duration: duration * 1000,
          delay: delay * 1000,
          fill: 'both',
          easing: 'linear',
        });
        animation.pause();
        animation.currentTime = 0;
        this.lineSprings.set(line, {
          animation,
          position,
          velocity,
          delay,
          frequency,
        });
        animation.onfinish = () => {
          if (this.lineSprings.get(line)?.animation !== animation) return;
          animation.cancel();
          line.style.removeProperty('will-change');
          this.lineSprings.delete(line);
        };
      },
    );
    // Commit the compensating poses before WebKit's asynchronous scroll layer
    // moves. Pending play starts all rows at the next paint, including stagger;
    // backdating to this document frame skips motion after expensive layout work.
    parent.scrollTop = target;
    this.currentScrollOffset = -target;
    for (const { animation } of this.lineSprings.values()) {
      animation.play();
    }
  }

  /**
   * Update position classes for YouLyPlus-style opacity/blur gradients
   */
  private updatePositionClasses(lineToScroll: HTMLElement): void {
    if (!this.lyricsContainer) return;

    const positionClasses = [
      'lyrics-activest',
      'post-active-line',
      'next-active-line',
      'prev-1',
      'prev-2',
      'prev-3',
      'prev-4',
      'next-1',
      'next-2',
      'next-3',
      'next-4',
    ];

    // Remove old position classes from tracked elements
    for (const el of this.positionedLineElements) {
      el.classList.remove(...positionClasses);
    }
    this.positionedLineElements = [];

    // Add new position classes
    lineToScroll.classList.add('lyrics-activest');
    this.positionedLineElements.push(lineToScroll);

    if (this.cachedLineArray.length === 0) {
      this.cachedLineArray = Array.from(
        this.lyricsContainer.querySelectorAll('.lyrics-line'),
      ) as HTMLElement[];
    }
    const lineElements = this.cachedLineArray;
    const scrollLineIndex = lineElements.indexOf(lineToScroll);
    if (scrollLineIndex === -1) return;

    for (
      let i = Math.max(0, scrollLineIndex - 4);
      i <= Math.min(lineElements.length - 1, scrollLineIndex + 4);
      i += 1
    ) {
      const position = i - scrollLineIndex;
      if (position !== 0) {
        const element = lineElements[i];
        if (position === -1) element.classList.add('post-active-line');
        else if (position === 1) element.classList.add('next-active-line');
        else if (position < 0)
          element.classList.add(`prev-${Math.abs(position)}`);
        else element.classList.add(`next-${position}`);
        this.positionedLineElements.push(element);
      }
    }
  }

  /**
   * Scroll to active line with YouLyPlus-style animation
   */
  private scrollToActiveLineYouLy(
    activeLine: HTMLElement,
    forceScroll = false,
    scrollDuration: number | undefined = undefined,
  ): void {
    if (!activeLine || !this.lyricsContainer) return;

    const paddingTop = this.getScrollPaddingTop();
    const targetTop = Math.max(0, activeLine.offsetTop - paddingTop);
    const targetTranslateY = -targetTop;

    // Skip if already at target position
    if (
      !forceScroll &&
      !this.pendingLayoutOffsets.size &&
      Math.abs(this.lyricsContainer.scrollTop - targetTop) < 1
    ) {
      return;
    }

    // Skip scroll if near the bottom of content and we aren't trying to scroll back up
    if (
      !forceScroll &&
      !this.pendingLayoutOffsets.size &&
      !activeLine.classList.contains('lyrics-footer')
    ) {
      const parent = this.lyricsContainer;
      const atBottom =
        parent.scrollTop + parent.clientHeight >= parent.scrollHeight - 50;
      if (atBottom && targetTop > parent.scrollTop - 50) {
        return;
      }
    }

    this.lyricsContainer.classList.remove('not-focused', 'user-scrolling');
    this.isProgrammaticScroll = true;
    this.setUserScrolling(false);

    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
      this.userScrollTimeoutId = undefined;
    }

    this.clearPastLineHighlights();

    const duration = scrollDuration ?? SCROLL_ANIMATION_DURATION_MS;
    setTimeout(() => {
      this.isProgrammaticScroll = false;
    }, duration + 160);

    this.animateScrollYouLy(
      targetTranslateY,
      forceScroll,
      scrollDuration,
      activeLine,
    );
  }

  /**
   * Update syllable highlight animation - apply CSS wipe animation
   */
  private static clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private static getVisibleCharacterCount(element: HTMLElement): number {
    const attrLength = parseFloat(
      element.getAttribute('data-word-length') || '',
    );
    if (Number.isFinite(attrLength) && attrLength > 0) return attrLength;
    return (element.textContent || '').replace(/\s/g, '').length;
  }

  private static getLongWordWipeScale(charCount: number): number {
    if (charCount <= 6) return 1;
    return (
      1 +
      AmLyrics.clamp((charCount - 6) / 10, 0, 1) * LONG_WORD_WIPE_EXTRA_RATIO
    );
  }

  private static applyWipeShape(
    element: HTMLElement,
    charCount: number,
    cjk = false,
  ): void {
    const extra =
      AmLyrics.clamp((charCount - 6) / 10, 0, 1) * LONG_WORD_WIPE_EXTRA_EM;
    const width = cjk ? CJK_WIPE_GRADIENT_EM : BASE_WIPE_GRADIENT_EM + extra;
    element.style.setProperty('--wipe-gradient-width', `${width.toFixed(3)}em`);
    element.style.setProperty(
      '--wipe-gradient-half',
      `${(width / 2).toFixed(3)}em`,
    );
  }

  private static ensureWordWipeGeometry(
    charSpans: HTMLElement[],
    charCount: number,
  ): void {
    if (charSpans.length === 0) return;

    const approxWidthCh = Math.max(1, charCount || charSpans.length);
    charSpans.forEach((span, index) => {
      if (!span.style.getPropertyValue('--word-wipe-width')) {
        span.style.setProperty('--word-wipe-width', `${approxWidthCh}ch`);
      }

      if (!span.style.getPropertyValue('--char-wipe-position')) {
        const startPct = index / Math.max(1, charSpans.length);
        span.style.setProperty(
          '--char-wipe-position',
          `${-(AmLyrics.clamp(startPct, 0, 1) * approxWidthCh)}ch`,
        );
      }
    });
  }

  private static clearPreHighlight(syllable: HTMLElement): void {
    const word = AmLyrics.getWordElementForSyllable(syllable);
    if (word) AmLyrics.clearWordWipe(word);
    const target = syllable;
    target.classList.remove('pre-highlight');
    target.style.removeProperty('--pre-wipe-duration');
    target.style.removeProperty('--pre-wipe-delay');
    target.style.animation = '';
    target
      .querySelectorAll('.pre-wipe-lead')
      .forEach(element => AmLyrics.clearPreWipeLead(element as HTMLElement));
    AmLyrics.getCachedVirtualWordElements(
      AmLyrics.getWordElementForSyllable(syllable),
    ).forEach(element => {
      const wordTarget = element as any;
      wordTarget._wordPreWipeKey = undefined;
    });
  }

  private static clearPreWipeLead(element: HTMLElement): void {
    element.classList.remove('pre-wipe-lead');
    element.style.removeProperty('--pre-wipe-duration');
    element.style.removeProperty('--pre-wipe-delay');
  }

  private static hasTextBoundaryAfter(syllable: HTMLElement): boolean {
    return /\s$/.test(syllable.textContent || '');
  }

  private static getSyllableWordIndex(syllable: HTMLElement): string {
    const wordElement = AmLyrics.getWordElementForSyllable(syllable);
    const virtualWordId = wordElement?.dataset.virtualWordId;
    if (virtualWordId) {
      return `virtual:${virtualWordId}`;
    }

    const virtualWordStart = wordElement?.dataset.virtualWordStart;
    const virtualWordEnd = wordElement?.dataset.virtualWordEnd;
    if (virtualWordStart || virtualWordEnd) {
      return `virtual:${virtualWordStart || ''}:${virtualWordEnd || ''}`;
    }

    return (
      syllable.getAttribute('data-word-index') ||
      syllable.getAttribute('data-syllable-index') ||
      ''
    );
  }

  private static getNextWordSyllable(
    syllables: HTMLElement[],
    index: number,
  ): HTMLElement | null {
    const current = syllables[index];
    const currentWordIndex = AmLyrics.getSyllableWordIndex(current);
    const previousSyllable = current;
    const currentVocalTrack = AmLyrics.getVocalTrack(current);

    for (let i = index + 1; i < syllables.length; i += 1) {
      const candidate = syllables[i];
      if (AmLyrics.getVocalTrack(candidate) !== currentVocalTrack) {
        return null;
      }
      if (candidate.classList.contains('transliteration')) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const candidateWordIndex = AmLyrics.getSyllableWordIndex(candidate);
      if (
        candidateWordIndex === currentWordIndex ||
        (!AmLyrics.hasTextBoundaryAfter(previousSyllable) &&
          !/^\s/.test(candidate.textContent || ''))
      ) {
        return null;
      }

      return candidate;
    }

    return null;
  }

  private static getPreviousNonTransliterationSyllable(
    syllables: HTMLElement[],
    index: number,
  ): HTMLElement | null {
    const currentVocalTrack = AmLyrics.getVocalTrack(syllables[index]);
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = syllables[i];
      if (AmLyrics.getVocalTrack(candidate) !== currentVocalTrack) {
        return null;
      }
      if (!candidate.classList.contains('transliteration')) {
        return candidate;
      }
    }

    return null;
  }

  private static getVocalTrack(syllable: HTMLElement): Element | null {
    const target = syllable as any;
    if (target._cachedVocalTrack === undefined) {
      target._cachedVocalTrack = syllable.closest(
        '.main-vocal-container, .background-vocal-container',
      );
    }
    return target._cachedVocalTrack as Element | null;
  }

  private static getRenderedWordSyllables(
    syllable: HTMLElement,
  ): HTMLElement[] {
    const wordElement = AmLyrics.getWordElementForSyllable(syllable);
    const wordElements = AmLyrics.getCachedVirtualWordElements(wordElement);
    const wordSyllables = wordElements.flatMap(
      element =>
        Array.from(
          element.querySelectorAll('.lyrics-syllable'),
        ) as HTMLElement[],
    );

    return wordSyllables.filter(
      wordSyllable => !wordSyllable.classList.contains('transliteration'),
    );
  }

  private static wordWipes = new WeakMap<HTMLElement, WordWipe>();

  private static wipeClocks = new WeakMap<Animation, number>();

  private static readonly supportsMaskedWipes =
    typeof CSS !== 'undefined' &&
    CSS.supports('mask-image', 'linear-gradient(#000, transparent)') &&
    typeof KeyframeEffect !== 'undefined' &&
    'pseudoElement' in KeyframeEffect.prototype;

  private static setWordWipePosition(element: HTMLElement, position: string) {
    if (!AmLyrics.supportsMaskedWipes)
      element.style.setProperty('background-position', position);
    element.style.setProperty('--word-wipe-position', position);
  }

  private static getWordWipe(syllable: HTMLElement): WordWipe | undefined {
    if (
      syllable.classList.contains('line-synced') ||
      syllable.classList.contains('transliteration')
    )
      return undefined;
    const words = AmLyrics.getCachedVirtualWordElements(
      AmLyrics.getWordElementForSyllable(syllable),
    );
    const word = words[0];
    if (!word) return undefined;
    const cached = AmLyrics.wordWipes.get(word);
    if (cached) return cached;
    const syllables = AmLyrics.getRenderedWordSyllables(syllable);
    const fragments: WordWipe['fragments'] = [];
    const segments: WordWipe['segments'] = [];
    let width = 0;
    for (const segment of syllables) {
      const chars = AmLyrics.getCachedCharSpans(segment);
      const targets = chars.length ? chars : [segment];
      let segmentWidth = 0;
      for (const element of targets) {
        const style = getComputedStyle(element);
        const fragmentWidth = Number.parseFloat(style.width);
        // eslint-disable-next-line no-continue
        if (!Number.isFinite(fragmentWidth) || fragmentWidth <= 0) continue;
        fragments.push({
          element,
          width: fragmentWidth,
          offset: width,
          fontSize: Number.parseFloat(style.fontSize),
          padding: Math.max(
            Number.parseFloat(style.paddingLeft) || 0,
            Number.parseFloat(style.paddingRight) || 0,
          ),
        });
        width += fragmentWidth;
        segmentWidth += fragmentWidth;
      }
      segments.push({
        start: Number(segment.dataset.startTime),
        end: Number(segment.dataset.endTime),
        width: segmentWidth,
      });
    }
    if (!width || !segments.length) return undefined;
    const start = Math.min(...segments.map(segment => segment.start));
    let end = Math.max(start + 1, ...segments.map(segment => segment.end));
    const nextWord = words[words.length - 1]
      .nextElementSibling as HTMLElement | null;
    const nextStart = Number(nextWord?.dataset.virtualWordStart);
    // Some providers overlap adjacent words. Finish the preceding edge at the
    // next word's timestamp while retaining the soft pre-wipe handoff.
    if (nextStart > start) end = Math.min(end, nextStart);
    const text = syllables
      .map(segment => segment.textContent || '')
      .join('')
      .replace(/\s/g, '');
    // Resolve the handoff once, even if no player tick lands in its window.
    let epoch = start;
    const previousWord = word.previousElementSibling as HTMLElement | null;
    const previousStart = Number(previousWord?.dataset.virtualWordStart);
    const previousEnd = Math.min(
      Number(previousWord?.dataset.virtualWordEnd),
      start,
    );
    const previousSyllables = previousWord?.querySelectorAll<HTMLElement>(
      '.lyrics-syllable:not(.transliteration)',
    );
    const previousSyllable = previousSyllables?.[previousSyllables.length - 1];
    if (
      previousStart < start &&
      previousEnd > previousStart &&
      start - previousEnd <= NEXT_WORD_PRE_WIPE_MAX_GAP_MS &&
      previousSyllable &&
      (AmLyrics.hasTextBoundaryAfter(previousSyllable) ||
        /^\s/.test(syllables[0].textContent || ''))
    ) {
      epoch = Math.max(
        start - AmLyrics.getWordPreWipeDuration(syllables[0], syllables),
        previousEnd - WORD_PRE_WIPE_HANDOFF_LEAD_MS,
      );
    }
    const wipe: WordWipe = {
      syllables,
      fragments,
      segments,
      width,
      count: Array.from(text).length,
      cjk: /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text),
      start,
      end,
      rtl: syllable.classList.contains('rtl-text'),
      animations: [],
      epoch,
      prepared: false,
      settled: false,
    };
    words.forEach(element => AmLyrics.wordWipes.set(element, wipe));
    return wipe;
  }

  private static startWordWipe(
    wipe: WordWipe,
    time: number,
    epoch = wipe.epoch,
    restore = false,
  ): void {
    if (wipe.animations.length) {
      if (restore) {
        for (const animation of wipe.animations) {
          // eslint-disable-next-line no-continue
          if (animation.playState !== 'idle') continue;
          const effect = animation.effect as KeyframeEffect | null;
          const target = effect?.target;
          const fragment = wipe.fragments.find(item => item.element === target);
          if (target instanceof HTMLElement && fragment) {
            const feather =
              fragment.fontSize *
              Number.parseFloat(
                target.style.getPropertyValue('--wipe-gradient-width'),
              );
            AmLyrics.setWordWipePosition(
              target,
              wipe.rtl
                ? `${(fragment.width + fragment.padding) / fragment.fontSize}em 50%`
                : `${(-wipe.width - feather - fragment.padding) / fragment.fontSize}em 50%`,
            );
          }
          animation.play();
          animation.currentTime = Math.min(
            time - wipe.epoch,
            Number(animation.effect?.getComputedTiming().endTime),
          );
        }
        // eslint-disable-next-line no-param-reassign
        wipe.settled = false;
      }
      return;
    }
    if (wipe.settled && !restore) return;
    const startEpoch = Math.min(epoch, wipe.start);
    const duration = Math.max(1, wipe.end - startEpoch);
    const stops: Array<{ offset: number; progress: number; pre?: boolean }> =
      [];
    if (startEpoch < wipe.start)
      stops.push({ offset: 0, progress: 0, pre: true });
    stops.push({ offset: (wipe.start - startEpoch) / duration, progress: 0 });
    let previousEnd = wipe.start;
    let progress = 0;
    for (const segment of wipe.segments) {
      const start = AmLyrics.clamp(segment.start, previousEnd, wipe.end);
      const end = AmLyrics.clamp(segment.end, start, wipe.end);
      if (start > previousEnd)
        stops.push({ offset: (start - startEpoch) / duration, progress });
      progress += segment.width;
      stops.push({ offset: (end - startEpoch) / duration, progress });
      previousEnd = end;
    }
    stops.push({ offset: 1, progress: wipe.width });
    const wordWipe = wipe;
    wordWipe.epoch = startEpoch;
    wordWipe.prepared = true;
    wordWipe.settled = false;
    wipe.syllables.forEach(syllable => {
      const target = syllable;
      target.style.animation = 'none';
    });
    const enterFromOutside = startEpoch === wipe.start;
    for (const {
      element,
      width,
      offset,
      fontSize,
      padding,
    } of wipe.fragments) {
      AmLyrics.applyWipeShape(element, wipe.count, wipe.cjk);
      // Keep the edge and feather in the same units when the font size changes.
      const wordWidthEm = wipe.width / fontSize;
      element.style.setProperty('--word-wipe-width', `${wordWidthEm}em`);
      if (!AmLyrics.supportsMaskedWipes) {
        element.style.backgroundColor =
          'var(--word-inactive-color, var(--lyplus-text-secondary))';
        element.style.backgroundSize = `calc(${wordWidthEm}em + var(--wipe-gradient-width, 0.75em)) 100%`;
      }
      element.style.animation = 'none';
      element.classList.add('shared-word-wipe');
      element.classList.toggle('word-wipe-rtl', wipe.rtl);
      element.classList.toggle(
        'masked-word-wipe',
        AmLyrics.supportsMaskedWipes,
      );
      if (AmLyrics.supportsMaskedWipes)
        element.setAttribute('data-wipe-text', element.textContent || '');
      const feather =
        fontSize *
        Number.parseFloat(
          element.style.getPropertyValue('--wipe-gradient-width'),
        );
      // Hold invisible/fully lit fragments still. Insert exact crossing times
      // so the shared edge keeps its original speed, softness and syllable stops.
      const lower = offset - feather - padding;
      const upper = offset + width + padding;
      const positions = stops.map(stop => {
        // Without a pre-wipe, the feather must enter from outside the word.
        // Carry that distance through the shared path, not a short onset ramp
        // that races over the first glyphs. An existing pre-wipe keeps its path.
        let edge = stop.progress;
        if (stop.pre) edge -= feather;
        else if (enterFromOutside)
          edge -= feather * (1 - stop.progress / wipe.width);
        return { offset: stop.offset, edge };
      });
      const samples: typeof positions = [];
      positions.forEach((stop, index) => {
        const previous = positions[index - 1];
        if (previous && stop.edge > previous.edge) {
          for (const edge of [lower, upper]) {
            if (edge > previous.edge && edge < stop.edge)
              samples.push({
                offset:
                  previous.offset +
                  ((edge - previous.edge) / (stop.edge - previous.edge)) *
                    (stop.offset - previous.offset),
                edge,
              });
          }
        }
        samples.push(stop);
      });
      const frames = samples.map(stop => {
        const edge = AmLyrics.clamp(stop.edge, lower, upper);
        const x = wipe.rtl
          ? width + offset - edge - feather
          : -offset - wipe.width + edge;
        return {
          offset: stop.offset,
          backgroundPosition: `${x / fontSize}em 50%`,
        };
      });
      const finalPosition = frames[frames.length - 1].backgroundPosition;
      // Keep pending/delayed effects unlit. A fully lit fallback can show
      // through before the native effect reaches its first painted frame.
      const unlitPosition = wipe.rtl
        ? `${(width + padding) / fontSize}em 50%`
        : `${(-wipe.width - feather - padding) / fontSize}em 50%`;
      AmLyrics.setWordWipePosition(element, unlitPosition);
      if (time >= wipe.end && !restore) {
        AmLyrics.setWordWipePosition(element, finalPosition);
        // eslint-disable-next-line no-continue
        continue;
      }
      let first = 0;
      let last = frames.length - 1;
      while (
        first < last &&
        frames[first].backgroundPosition ===
          frames[first + 1].backgroundPosition
      )
        first += 1;
      while (
        last > first &&
        frames[last].backgroundPosition === frames[last - 1].backgroundPosition
      )
        last -= 1;
      if (first === last) {
        AmLyrics.setWordWipePosition(element, finalPosition);
        // eslint-disable-next-line no-continue
        continue;
      }
      const from = frames[first].offset;
      const range = frames[last].offset - from;
      const localFrames =
        range > 0
          ? frames.slice(first, last + 1).map(frame => ({
              ...frame,
              offset: (frame.offset - from) / range,
            }))
          : frames;
      const paintFrames = AmLyrics.supportsMaskedWipes
        ? localFrames.map(frame => ({
            offset: frame.offset,
            maskPosition: frame.backgroundPosition,
            webkitMaskPosition: frame.backgroundPosition,
          }))
        : localFrames;
      const animation = element.animate(paintFrames, {
        delay: range > 0 ? from * duration : 0,
        duration: range > 0 ? range * duration : duration,
        easing: 'linear',
        fill: 'forwards',
        ...(AmLyrics.supportsMaskedWipes ? { pseudoElement: '::before' } : {}),
      });
      const elapsed = Math.min(
        time - startEpoch,
        range > 0 ? frames[last].offset * duration : duration,
      );
      animation.currentTime = elapsed;
      // Anchor every fragment to one document frame. Pending play tasks can
      // otherwise start early glyphs late, then jump when playback catches up.
      const timelineTime = animation.timeline?.currentTime;
      if (typeof timelineTime === 'number')
        animation.startTime = timelineTime - elapsed;
      AmLyrics.wipeClocks.set(animation, startEpoch);
      wipe.animations.push(animation);
      animation.onfinish = () => {
        if (
          !wordWipe.prepared ||
          !wordWipe.animations.includes(animation) ||
          animation.playState !== 'finished'
        )
          return;
        AmLyrics.setWordWipePosition(element, finalPosition);
        animation.cancel();
        wordWipe.settled = wordWipe.animations.every(
          effect => effect.playState === 'idle',
        );
      };
    }
    if (!wipe.animations.length) wordWipe.settled = true;
  }

  private static clearWordWipe(word: HTMLElement): void {
    const wipe = AmLyrics.wordWipes.get(word);
    if (!wipe || !wipe.prepared) return;
    wipe.animations.forEach(animation => animation.cancel());
    wipe.animations = [];
    wipe.prepared = false;
    wipe.settled = false;
    wipe.fragments.forEach(({ element }) => {
      element.classList.remove(
        'shared-word-wipe',
        'word-wipe-rtl',
        'masked-word-wipe',
      );
      element.removeAttribute('data-wipe-text');
      element.style.removeProperty('--word-wipe-position');
      element.style.removeProperty('background-color');
      element.style.removeProperty('background-size');
      element.style.removeProperty('background-position');
      element.style.removeProperty('animation');
    });
  }

  private static getWordElementForSyllable(
    syllable: HTMLElement,
  ): HTMLElement | undefined {
    return syllable.parentElement?.parentElement as HTMLElement | undefined;
  }

  private static getWordPreWipeKey(syllable: HTMLElement): string {
    const wordElement = AmLyrics.getWordElementForSyllable(syllable);
    return (
      wordElement?.dataset.virtualWordId ||
      `${syllable.getAttribute('data-start-time') || ''}:${AmLyrics.getSyllableWordIndex(
        syllable,
      )}`
    );
  }

  private static isPreWipeArmed(syllable: HTMLElement): boolean {
    const wordElement = AmLyrics.getWordElementForSyllable(syllable);
    const target = wordElement as any;
    return Boolean(
      target?._wordPreWipeKey === AmLyrics.getWordPreWipeKey(syllable),
    );
  }

  private static applyWordPreWipe(
    nextSyllable: HTMLElement,
    currentTimeMs: number,
    preWipeStartMs: number,
  ): void {
    if (AmLyrics.isPreWipeArmed(nextSyllable)) return;
    const wipe = AmLyrics.getWordWipe(nextSyllable);
    if (!wipe) return;
    AmLyrics.startWordWipe(wipe, currentTimeMs, preWipeStartMs);
    nextSyllable.classList.add('pre-highlight');
    AmLyrics.getCachedVirtualWordElements(
      AmLyrics.getWordElementForSyllable(nextSyllable),
    ).forEach(element => {
      const target = element as any;
      target._wordPreWipeKey = AmLyrics.getWordPreWipeKey(nextSyllable);
    });
  }

  private static getWordPreWipeDuration(
    syllable: HTMLElement,
    wordSyllables = AmLyrics.getRenderedWordSyllables(syllable),
  ): number {
    const renderedSyllables =
      wordSyllables.length > 0 ? wordSyllables : [syllable];
    const wordElement = AmLyrics.getWordElementForSyllable(syllable);
    const charSpans = AmLyrics.getCachedVirtualWordCharSpans(wordElement, []);
    const charCount =
      charSpans.length ||
      renderedSyllables.reduce(
        (total, wordSyllable) =>
          total + (wordSyllable.textContent || '').replace(/\s/g, '').length,
        0,
      );
    if (charCount <= 0) return 0;

    return AmLyrics.clamp(
      64 + charCount * 9,
      NEXT_WORD_PRE_WIPE_MIN_DURATION_MS,
      NEXT_WORD_PRE_WIPE_MAX_DURATION_MS,
    );
  }

  private static maybePreWipeNextWord(
    syllables: HTMLElement[],
    index: number,
    currentTimeMs: number,
    currentEndTimeMs: number,
  ): void {
    const syllable = syllables[index];
    const currentWipe = AmLyrics.getWordWipe(syllable);
    const wordEndTime = currentWipe?.end ?? currentEndTimeMs;
    if (
      syllable.classList.contains('line-synced') ||
      syllable.classList.contains('transliteration') ||
      syllable.closest('.lyrics-gap')
    ) {
      return;
    }

    const currentWordReady =
      syllable.classList.contains('finished') ||
      currentTimeMs >= wordEndTime - WORD_PRE_WIPE_HANDOFF_LEAD_MS;
    if (!currentWordReady) return;

    const nextSyllable = AmLyrics.getNextWordSyllable(syllables, index);
    if (
      !nextSyllable ||
      nextSyllable.classList.contains('line-synced') ||
      nextSyllable.classList.contains('transliteration') ||
      nextSyllable.closest('.lyrics-gap') ||
      nextSyllable.classList.contains('highlight') ||
      nextSyllable.classList.contains('finished')
    ) {
      return;
    }

    const nextStartTimeMs = (nextSyllable as any)._cachedStartTime;
    if (!Number.isFinite(nextStartTimeMs)) return;

    const gapMs = nextStartTimeMs - wordEndTime;
    if (gapMs > NEXT_WORD_PRE_WIPE_MAX_GAP_MS || gapMs < 0) {
      return;
    }

    const nextWordSyllables = AmLyrics.getRenderedWordSyllables(nextSyllable);
    const preWipeSyllables =
      nextWordSyllables.length > 0 ? nextWordSyllables : [nextSyllable];
    const preWipeDuration = AmLyrics.getWordPreWipeDuration(
      nextSyllable,
      preWipeSyllables,
    );
    if (preWipeDuration <= 0) return;
    const preWipeStart = Math.max(
      nextStartTimeMs - preWipeDuration,
      wordEndTime - WORD_PRE_WIPE_HANDOFF_LEAD_MS,
    );

    if (currentTimeMs < preWipeStart || currentTimeMs >= nextStartTimeMs) {
      return;
    }

    if (AmLyrics.isPreWipeArmed(nextSyllable)) return;

    AmLyrics.applyWordPreWipe(nextSyllable, currentTimeMs, preWipeStart);
  }

  private static getCachedCharSpans(element: HTMLElement): HTMLElement[] {
    const cacheTarget = element as any;
    if (!cacheTarget._cachedCharSpans) {
      cacheTarget._cachedCharSpans = Array.from(
        element.querySelectorAll('span.char'),
      ) as HTMLElement[];
    }
    return cacheTarget._cachedCharSpans as HTMLElement[];
  }

  private static getCachedVirtualWordElements(
    wordElement: HTMLElement | undefined,
  ): HTMLElement[] {
    if (!wordElement) return [];

    const cacheTarget = wordElement as any;
    if (cacheTarget._cachedVirtualWordElements) {
      return cacheTarget._cachedVirtualWordElements as HTMLElement[];
    }

    const { virtualWordId } = wordElement.dataset;
    let wordElements: HTMLElement[] = [wordElement];
    if (virtualWordId && wordElement.parentElement) {
      wordElements = Array.from(
        wordElement.parentElement.querySelectorAll('.lyrics-word'),
      ).filter(
        el => (el as HTMLElement).dataset.virtualWordId === virtualWordId,
      ) as HTMLElement[];
    }

    wordElements.forEach(element => {
      const target = element as any;
      target._cachedVirtualWordElements = wordElements;
    });

    return wordElements;
  }

  private static getCachedVirtualWordCharSpans(
    wordElement: HTMLElement | undefined,
    fallbackCharSpans: HTMLElement[],
  ): HTMLElement[] {
    if (!wordElement) return fallbackCharSpans;

    const cacheTarget = wordElement as any;
    if (cacheTarget._cachedVirtualWordCharSpans) {
      return cacheTarget._cachedVirtualWordCharSpans as HTMLElement[];
    }

    const wordElements = AmLyrics.getCachedVirtualWordElements(wordElement);
    const charSpans = wordElements.flatMap(
      word => Array.from(word.querySelectorAll('span.char')) as HTMLElement[],
    );
    const result = charSpans.length > 0 ? charSpans : fallbackCharSpans;

    wordElements.forEach(element => {
      const target = element as any;
      target._cachedVirtualWordCharSpans = result;
    });

    return result;
  }

  private static updateSyllableAnimation(
    syllable: HTMLElement,
    elapsedTimeMs = 0,
  ): void {
    if (syllable.classList.contains('highlight')) return;

    if (
      !syllable.classList.contains('transliteration') &&
      !syllable.closest('.lyrics-gap')
    ) {
      const wipe = AmLyrics.getWordWipe(syllable);
      if (wipe) {
        AmLyrics.startWordWipe(
          wipe,
          Number(syllable.dataset.startTime) + elapsedTimeMs,
        );
        syllable.classList.remove('pre-highlight');
        syllable.classList.add('highlight');
        return;
      }
    }

    const { classList } = syllable;
    const hadPreHighlight = classList.contains('pre-highlight');
    const isRTL =
      classList.contains('rtl-text') || classList.contains('wipe-rtl');
    const charSpans = AmLyrics.getCachedCharSpans(syllable);
    const isFirstSyllable =
      syllable.getAttribute('data-syllable-index') === '0';
    const isFirstInContainer = isFirstSyllable; // Simplified
    const isGap = syllable.closest('.lyrics-gap') !== null;

    // Get duration from data attribute
    const syllableDurationMs =
      parseFloat(syllable.getAttribute('data-duration') || '0') || 300;
    const charAnimationsMap = new Map<HTMLElement, string>();
    if (charSpans.length > 0) {
      // Every glyph receives the same clock and moving edge. Only its fixed
      // sampling offset differs. Keep explicit syllable timing for joined words.
      AmLyrics.applyWipeShape(syllable, charSpans.length);
      AmLyrics.ensureWordWipeGeometry(charSpans, charSpans.length);
      const animation = `char-word-wipe ${syllableDurationMs}ms linear ${-elapsedTimeMs}ms both`;
      charSpans.forEach(span => {
        AmLyrics.applyWipeShape(span, charSpans.length);
        charAnimationsMap.set(span, animation);
      });
    } else {
      // Syllable-level wipe for regular (non-growable) words without chars
      const wipeRatio = parseFloat(
        syllable.getAttribute('data-wipe-ratio') || '1',
      );
      const wipeCharCount = AmLyrics.getVisibleCharacterCount(syllable);
      const wipeScale = AmLyrics.getLongWordWipeScale(wipeCharCount);
      const nominalVisualDuration = syllableDurationMs * wipeRatio * wipeScale;
      const visualDuration = Math.min(
        syllableDurationMs,
        nominalVisualDuration,
      );
      AmLyrics.applyWipeShape(syllable, wipeCharCount);

      let wipeAnimation = 'wipe';
      if (hadPreHighlight) {
        wipeAnimation = isRTL ? 'wipe-from-pre-rtl' : 'wipe-from-pre';
      } else if (isFirstInContainer) {
        wipeAnimation = isRTL ? 'start-wipe-rtl' : 'start-wipe';
      } else {
        wipeAnimation = isRTL ? 'wipe-rtl' : 'wipe';
      }

      if (syllable.classList.contains('line-synced')) return;

      const currentWipeAnimation = isGap ? 'fade-gap' : wipeAnimation;
      // eslint-disable-next-line no-param-reassign
      syllable.style.animation = `${currentWipeAnimation} ${visualDuration}ms ${isGap ? 'ease-out' : 'linear'} ${-elapsedTimeMs}ms forwards`;
    }

    AmLyrics.getCachedVirtualWordElements(
      AmLyrics.getWordElementForSyllable(syllable),
    ).forEach(element => {
      const target = element as any;
      target._wordPreWipeKey = undefined;
    });

    classList.remove('pre-highlight');
    classList.add('highlight');
    charSpans.forEach(span => AmLyrics.clearPreWipeLead(span));

    // Apply keyframe variables before assigning animation strings so the
    // first painted frame never uses fallback transform values.

    for (const [span, animationString] of charAnimationsMap.entries()) {
      span.style.removeProperty('background-color');
      span.style.animation = animationString;
    }
  }

  /**
   * Reset syllable animation state
   */
  private static resetSyllable(syllable: HTMLElement): void {
    if (!syllable) return;
    // eslint-disable-next-line no-param-reassign
    syllable.style.animation = '';
    syllable.style.removeProperty('--pre-wipe-duration');
    syllable.style.removeProperty('--pre-wipe-delay');
    // Character containers stay transparent; only their glyphs paint the text.
    // eslint-disable-next-line no-param-reassign
    syllable.style.transition = 'none';
    // eslint-disable-next-line no-param-reassign
    syllable.style.backgroundColor = syllable.classList.contains('has-chars')
      ? 'transparent'
      : 'var(--word-inactive-color, var(--lyplus-text-secondary))';

    // Reset character animations — disable transition so finished chars don't slowly fade
    const charSpans = syllable.querySelectorAll('span.char');
    for (let i = 0; i < charSpans.length; i += 1) {
      const el = charSpans[i] as HTMLElement;
      el.style.animation = '';
      AmLyrics.clearCharacterMotion(el);
      el.style.transition = 'none';
      el.style.backgroundColor =
        'var(--word-inactive-color, var(--lyplus-text-secondary))';
      AmLyrics.clearPreWipeLead(el);
    }

    // Immediately remove all state classes
    syllable.classList.remove(
      'highlight',
      'finished',
      'pre-highlight',
      'cleanup',
    );
  }

  private static resetWordAnimationState(
    line: HTMLElement,
    preserveNormalRise = false,
  ): void {
    const wordElements = line.querySelectorAll('.lyrics-word');
    wordElements.forEach(wordElement => {
      AmLyrics.clearWordWipe(wordElement as HTMLElement);
      if (!preserveNormalRise)
        AmLyrics.clearNormalWordMotion(wordElement as HTMLElement);
      if (
        !preserveNormalRise ||
        wordElement.matches('.growable, .char-rise, .char-drag')
      )
        wordElement.classList.remove('word-started');
      const target = wordElement as any;
      target._wordPreWipeKey = undefined;
    });
  }

  /**
   * Reset all syllables in a line — batches deferred cleanup into a single rAF
   */
  private static resetSyllables(line: HTMLElement): void {
    if (!line) return;
    line.classList.remove('persist-highlight');
    AmLyrics.resetWordAnimationState(line);
    // eslint-disable-next-line no-param-reassign
    (line as any)._cachedSyllableElements = null;
    const syllables = line.getElementsByClassName('lyrics-syllable');
    for (let i = 0; i < syllables.length; i += 1) {
      AmLyrics.resetSyllable(syllables[i] as HTMLElement);
    }
    // Batch deferred style cleanup into a single rAF for all syllables in the line
    requestAnimationFrame(() => {
      for (let i = 0; i < syllables.length; i += 1) {
        const syllable = syllables[i] as HTMLElement;
        if (!syllable.classList.contains('shared-word-wipe'))
          syllable.style.removeProperty('background-color');
        syllable.style.removeProperty('transition');
        const chars = syllable.querySelectorAll('span.char');
        for (let j = 0; j < chars.length; j += 1) {
          const el = chars[j] as HTMLElement;
          if (!el.classList.contains('shared-word-wipe'))
            el.style.removeProperty('background-color');
          el.style.removeProperty('transition');
          el.style.removeProperty('will-change');
        }
      }
    });
  }

  /**
   * Retire colour and glow while existing character transforms finish.
   */
  private static unfinishSyllables(line: HTMLElement): void {
    if (!line) return;
    line.classList.remove('persist-highlight');
    AmLyrics.resetWordAnimationState(line, true);
    const syllables = line.getElementsByClassName('lyrics-syllable');
    for (let i = 0; i < syllables.length; i += 1) {
      const s = syllables[i] as HTMLElement;
      s.classList.remove('highlight', 'finished', 'pre-highlight', 'cleanup');
      s.style.animation = '';
      s.style.removeProperty('--pre-wipe-duration');
      s.style.removeProperty('--pre-wipe-delay');
      s.style.removeProperty('background-color');
      s.style.removeProperty('transition');
      const chars = s.querySelectorAll('span.char');
      for (let j = 0; j < chars.length; j += 1) {
        const el = chars[j] as HTMLElement;
        el.style.animation = '';
        AmLyrics.setCharacterGlow(el, false);
        el.style.removeProperty('will-change');
        el.style.removeProperty('background-color');
        el.style.removeProperty('transition');
        el.style.removeProperty('filter');
        AmLyrics.clearPreWipeLead(el);
      }
    }
  }

  /**
   * Update syllables based on current time
   * Uses DOM caching and pre-highlight reset for smooth transitions
   */
  private static motionWords = new WeakMap<
    HTMLElement,
    Array<{
      element: HTMLElement;
      start: number;
      wipe?: WordWipe;
      normal: boolean;
      rise: number;
    }>
  >();

  private static normalWordMotions = new WeakMap<
    HTMLElement,
    NormalWordMotion
  >();

  private static normalRiseClocks = new WeakMap<Animation, number>();

  private static clearNormalWordMotion(word: HTMLElement): void {
    const motion = AmLyrics.normalWordMotions.get(word);
    if (!motion) return;
    motion.animations.forEach(animation => animation.cancel());
    AmLyrics.normalWordMotions.delete(word);
    word.classList.remove('normal-word-motion');
  }

  private static startNormalWordMotion(
    motion: NormalWordMotion,
    elapsed: number,
  ): void {
    const normalMotion = motion;
    const frames = getNormalWordFrames(motion.rise);
    normalMotion.settled = false;
    normalMotion.animations = normalMotion.targets.map(target => {
      const animation = target.animate(frames, {
        duration: NORMAL_WORD_SPRING_DURATION_MS,
        easing: 'linear',
        fill: 'both',
      });
      animation.currentTime = elapsed;
      const timelineTime = animation.timeline?.currentTime;
      if (typeof timelineTime === 'number')
        animation.startTime = timelineTime - elapsed;
      AmLyrics.normalRiseClocks.set(animation, normalMotion.start);
      return animation;
    });
    // The CSS holds the final lift, so finished effects need no compositor layer.
    const last = normalMotion.animations[normalMotion.animations.length - 1];
    last.onfinish = () => {
      if (normalMotion.animations[normalMotion.animations.length - 1] !== last)
        return;
      normalMotion.animations.forEach(animation => animation.cancel());
      normalMotion.animations = [];
      normalMotion.settled = true;
    };
  }

  private static updateNormalWordMotion(
    word: HTMLElement,
    start: number,
    time: number,
    rise: number,
  ): void {
    const elapsed = time - start;
    if (elapsed < -WORD_WIPE_LOOKAHEAD_MS) {
      AmLyrics.clearNormalWordMotion(word);
      return;
    }
    let motion = AmLyrics.normalWordMotions.get(word);
    if (!motion) {
      // Inline words retain wrapping; their syllables share the same spring clock.
      const targets = word.classList.contains('allow-break')
        ? Array.from(
            word.querySelectorAll<HTMLElement>(
              '.lyrics-syllable.no-chars:not(.line-synced)',
            ),
          )
        : [word];
      if (!targets.length) return;
      motion = {
        targets,
        animations: [],
        start,
        settled: false,
        rise,
      };
      AmLyrics.normalWordMotions.set(word, motion);
      word.classList.add('normal-word-motion');
    }
    if (motion.settled && elapsed >= NORMAL_WORD_SPRING_DURATION_MS - 200)
      return;
    if (elapsed >= NORMAL_WORD_SPRING_DURATION_MS) {
      motion.animations.forEach(animation => animation.cancel());
      motion.animations = [];
      motion.settled = true;
      return;
    }
    if (!motion.animations.length) {
      AmLyrics.startNormalWordMotion(motion, elapsed);
    } else {
      for (const animation of motion.animations) {
        if (Math.abs(Number(animation.currentTime) - elapsed) > 200) {
          animation.currentTime = elapsed;
          if (animation.playState === 'finished') animation.play();
        }
      }
    }
  }

  private static motionSyllables = new WeakMap<HTMLElement, HTMLElement[]>();

  private static motionParameters = new WeakMap<
    HTMLElement,
    {
      chars: HTMLElement[];
      duration: number;
      start: number;
      cjk: boolean;
      metrics: MotionMetrics;
    }
  >();

  private static characterAnimations = new WeakMap<
    HTMLElement,
    {
      animation: Animation;
      start: number;
      end: number;
      key: object;
      glowEpoch: number;
      settled: boolean;
      finalTransform: string;
    }
  >();

  private static clearCharacterMotion(char: HTMLElement): void {
    const entry = AmLyrics.characterAnimations.get(char);
    if (!entry) return;
    entry.animation.cancel();
    const target = char.parentElement?.classList.contains('char-motion')
      ? char.parentElement
      : char;
    target.classList.remove('is-rising');
    if (entry.settled) target.style.removeProperty('transform');
    AmLyrics.characterAnimations.delete(char);
    char.classList.remove('native-motion');
    AmLyrics.setCharacterGlow(char, false);
  }

  private static setCharacterGlow(char: HTMLElement, enabled: boolean): void {
    char.toggleAttribute('data-glow', enabled);
    const layer = char.parentElement;
    if (!layer?.classList.contains('char-motion')) return;
    layer.toggleAttribute('data-glow', enabled);
    if (enabled) {
      layer.setAttribute('data-glyph', char.textContent || '');
      for (const propertyName of [
        '--char-glow-max',
        '--char-glow-duration',
        '--char-glow-delay',
      ])
        layer.style.setProperty(
          propertyName,
          char.style.getPropertyValue(propertyName),
        );
    }
  }

  private static resumeCharacterMotion(
    char: HTMLElement,
    elapsed: number,
  ): void {
    const entry = AmLyrics.characterAnimations.get(char);
    if (!entry?.settled) return;
    const target = char.parentElement?.classList.contains('char-motion')
      ? char.parentElement
      : char;
    target.style.removeProperty('transform');
    target.classList.add('is-rising');
    entry.settled = false;
    entry.animation.play();
    entry.animation.currentTime = elapsed;
    if (Number(char.style.getPropertyValue('--char-glow-max')) > 0) {
      char.style.setProperty(
        '--char-glow-delay',
        `${Number(entry.animation.effect?.getTiming().delay) - elapsed}ms`,
      );
      AmLyrics.setCharacterGlow(char, true);
      entry.glowEpoch = elapsed;
    }
  }

  private static updateCharacterMotion(
    line: HTMLElement,
    timeMs: number,
  ): void {
    // Timing VM RVA 0x34722d0, emphasis VM 0x34723b0; CJK rise spring
    // mass 1, stiffness 14, damping 7 in 0x2f4e46 / 0x2f510b.
    let syllables = AmLyrics.motionSyllables.get(line);
    if (!syllables) {
      const seen = new Set<HTMLElement>();
      syllables = Array.from(
        line.querySelectorAll<HTMLElement>('.lyrics-syllable.has-chars'),
      ).filter(syllable => {
        const track = syllable.closest(
          '[data-bg-suspended], [data-bg-carried]',
        );
        if (track && track !== line) return false;
        const word = AmLyrics.getWordElementForSyllable(syllable);
        // CJK has no reliable whitespace word boundaries. Keep each timed
        // segment's clock; only non-CJK split words share a motion clock.
        const key = word?.classList.contains('char-rise')
          ? syllable
          : AmLyrics.getCachedVirtualWordElements(word)[0] || syllable;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      AmLyrics.motionSyllables.set(line, syllables);
    }
    const motionParameters = syllables.map(syllable => {
      let parameters = AmLyrics.motionParameters.get(syllable);
      if (!parameters) {
        const word = AmLyrics.getWordElementForSyllable(syllable);
        const cjk = word?.classList.contains('char-rise') ?? false;
        const localChars = AmLyrics.getCachedCharSpans(syllable);
        const chars = cjk
          ? localChars
          : AmLyrics.getCachedVirtualWordCharSpans(word, localChars);
        const start = Number(
          cjk
            ? syllable.dataset.startTime
            : (word?.dataset.virtualWordStart ?? syllable.dataset.startTime),
        );
        const end = Number(
          cjk
            ? syllable.dataset.endTime
            : (word?.dataset.virtualWordEnd ?? syllable.dataset.endTime),
        );
        parameters = {
          chars,
          duration: Math.max(0.001, (end - start) / 1000),
          start,
          cjk,
          metrics: getMotionMetrics(syllable),
        };
        AmLyrics.motionParameters.set(syllable, parameters);
      }
      return parameters;
    });
    // Finish all geometry reads before creating effects or changing classes.
    motionParameters.forEach(parameters => {
      const { chars, duration, start, cjk, metrics } = parameters;
      const count = chars.length;
      if (!count) return;
      const elapsed = timeMs - start;
      const staggerMs = ((duration * 1000) / count) * (cjk ? 0.4 : 0.35);
      const delayMs = cjk
        ? Math.min(staggerMs, 50, 200 / count)
        : Math.min(staggerMs, 350);
      const hold = (2 * duration) / count;
      const response = Math.min(3, duration);
      const glow = cjk ? 0 : 0.45 * AmLyrics.clamp((duration - 1) / 0.5, 0, 1);
      const spanDuration = Math.max(hold + response * 2, cjk ? 3 : 0);
      chars.forEach((char, index) => {
        const startDelay = (index + 1) * delayMs;
        // Schedule before the stagger starts so host timestamp updates cannot
        // delay its first frames. Backward fill holds the waiting glyph at identity.
        if (elapsed < -WORD_WIPE_LOOKAHEAD_MS) {
          AmLyrics.clearCharacterMotion(char);
          return;
        }
        const end = spanDuration * 1000 + startDelay;
        const key = parameters;
        let entry = AmLyrics.characterAnimations.get(char);
        if (!entry || entry.key !== key) {
          AmLyrics.clearCharacterMotion(char);
          const frames = getCharacterFrames(
            duration,
            count,
            index,
            cjk,
            metrics,
          );
          if (glow) {
            char.setAttribute('data-glyph', char.textContent || '');
            char.style.setProperty('--char-glow-max', `${glow}`);
            char.style.setProperty(
              '--char-glow-duration',
              `${spanDuration * 1000}ms`,
            );
            char.style.setProperty(
              '--char-glow-delay',
              `${startDelay - elapsed}ms`,
            );
            AmLyrics.setCharacterGlow(char, true);
          }
          char.classList.add('native-motion');
          // Transform a separate wrapper. WebKit can expose rectangular clip
          // edges when the gradient-clipped glyph itself is transformed.
          const motionTarget = char.parentElement?.classList.contains(
            'char-motion',
          )
            ? char.parentElement
            : char;
          motionTarget.classList.add('is-rising');
          const animation = motionTarget.animate(frames, {
            duration: spanDuration * 1000,
            delay: startDelay,
            fill: 'both',
            easing: 'linear',
          });
          const timelineTime = animation.timeline?.currentTime;
          if (typeof timelineTime === 'number')
            animation.startTime = timelineTime - Math.min(elapsed, end);
          else animation.currentTime = Math.min(elapsed, end);
          entry = {
            animation,
            start,
            end,
            key,
            glowEpoch: elapsed,
            settled: false,
            finalTransform: `translateY(${metrics.rise}px)`,
          };
          AmLyrics.characterAnimations.set(char, entry);
          const motion = entry;
          animation.onfinish = () => {
            if (
              AmLyrics.characterAnimations.get(char) !== motion ||
              animation.playState !== 'finished'
            )
              return;
            motionTarget.style.transform = motion.finalTransform;
            motionTarget.classList.remove('is-rising');
            motion.settled = true;
            AmLyrics.setCharacterGlow(char, false);
            animation.cancel();
          };
        } else if (entry.settled) {
          // Match the drift tolerance above: a completed rise must not restart
          // just because playback trails the native clock by a few frames.
          if (elapsed < entry.end - 200)
            AmLyrics.resumeCharacterMotion(char, elapsed);
        } else if (
          Math.abs(
            Number(entry.animation.currentTime) - Math.min(elapsed, entry.end),
          ) > 200
        ) {
          // Correct seeks/drift, not every playback tick: repeated currentTime
          // writes pin compositor motion to the host's timestamp frequency.
          entry.animation.currentTime = Math.min(elapsed, entry.end);
          if (glow) {
            const glowLayer = char.parentElement?.classList.contains(
              'char-motion',
            )
              ? char.parentElement
              : char;
            for (const effect of glowLayer.getAnimations()) {
              if (
                'animationName' in effect &&
                effect.animationName === 'char-glow'
              ) {
                effect.currentTime = elapsed - entry.glowEpoch;
                if (elapsed < entry.end) effect.play();
              }
            }
          }
          if (elapsed < entry.end && entry.animation.playState === 'finished')
            entry.animation.play();
        }
      });
    });
  }

  private static seekLineWipes(line: HTMLElement, time: number): void {
    for (const word of AmLyrics.motionWords.get(line) || []) {
      if (
        word.wipe &&
        time < word.wipe.end &&
        (word.wipe.settled ||
          word.wipe.animations.some(
            animation => animation.playState === 'idle',
          ))
      )
        AmLyrics.startWordWipe(word.wipe, time, word.wipe.epoch, true);
    }
    line.getAnimations({ subtree: true }).forEach(animation => {
      const epoch = AmLyrics.wipeClocks.get(animation);
      if (epoch !== undefined) {
        const timeline = animation;
        const end = Number(animation.effect?.getComputedTiming().endTime);
        const elapsed = time - epoch;
        timeline.currentTime = Math.min(elapsed, end);
        if (elapsed < end && animation.playState !== 'running') {
          animation.play();
          timeline.currentTime = elapsed;
        }
        return;
      }
      if (
        !('animationName' in animation) ||
        !String(animation.animationName).includes('wipe')
      )
        return;
      const effect = animation.effect as KeyframeEffect;
      const syllable = (effect.target as HTMLElement)?.closest<HTMLElement>(
        '.lyrics-syllable',
      );
      if (!syllable) return;
      const elapsed =
        time -
        Number(syllable.dataset.startTime) +
        Number(effect.getTiming().delay);
      const end = Number(effect.getComputedTiming().endTime);
      const timeline = animation;
      timeline.currentTime = Math.min(elapsed, end);
      if (elapsed < end && animation.playState !== 'running') {
        animation.play();
        timeline.currentTime = elapsed;
      }
    });
  }

  private static updateSyllablesForLine(
    line: HTMLElement,
    currentTimeMs: number,
    reduceMotion = false,
  ): void {
    let words = AmLyrics.motionWords.get(line);
    if (!words) {
      words = Array.from(
        line.querySelectorAll<HTMLElement>(
          '.lyrics-word[data-virtual-word-start]',
        ),
      )
        .filter(element => {
          const track = element.closest(
            '[data-bg-suspended], [data-bg-carried]',
          );
          return !track || track === line;
        })
        .map(element => {
          const syllable =
            element.querySelector<HTMLElement>('.lyrics-syllable');
          const normal = Boolean(
            syllable &&
              !syllable.matches('.has-chars, .line-synced') &&
              !element.matches('.growable, .char-rise, .char-drag'),
          );
          return {
            element,
            start: Number(element.dataset.virtualWordStart),
            wipe: syllable ? AmLyrics.getWordWipe(syllable) : undefined,
            normal,
            // Read metrics together, before any word changes its paint classes.
            rise: normal ? getMotionMetrics(element).rise : 0,
          };
        });
      AmLyrics.motionWords.set(line, words);
    }
    words.forEach(({ element, start, wipe, normal, rise }) => {
      const started = currentTimeMs >= start;
      if (element.classList.contains('word-started') !== started)
        element.classList.toggle('word-started', started);
      if (normal && !reduceMotion)
        AmLyrics.updateNormalWordMotion(element, start, currentTimeMs, rise);
      // Native delays preserve the opening frames between sparse player ticks.
      // Only prepare the nearby words, keeping long lines cheap to animate.
      if (wipe && currentTimeMs >= wipe.epoch - WORD_WIPE_LOOKAHEAD_MS)
        AmLyrics.startWordWipe(wipe, currentTimeMs);
    });
    if (!reduceMotion) AmLyrics.updateCharacterMotion(line, currentTimeMs);
    // DOM cache: avoid querySelectorAll on every frame
    let syllables: HTMLElement[] = (line as any)._cachedSyllableElements;
    if (!syllables) {
      syllables = Array.from(
        line.querySelectorAll<HTMLElement>('.lyrics-syllable'),
      ).filter(syllable => {
        const track = syllable.closest(
          '[data-bg-suspended], [data-bg-carried]',
        );
        return !track || track === line;
      });
      for (let i = 0; i < syllables.length; i += 1) {
        const syllable = syllables[i];
        (syllable as any)._cachedStartTime = parseFloat(
          syllable.getAttribute('data-start-time') || '0',
        );
        (syllable as any)._cachedEndTime = parseFloat(
          syllable.getAttribute('data-end-time') || '0',
        );
      }
      // eslint-disable-next-line no-param-reassign
      (line as any)._cachedSyllableElements = syllables;
    }

    for (let i = 0; i < syllables.length; i += 1) {
      const syllable = syllables[i];
      const startTime = (syllable as any)._cachedStartTime;
      const endTime = (syllable as any)._cachedEndTime;

      if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
        const { classList } = syllable;
        const hasHighlight = classList.contains('highlight');
        const hasFinished = classList.contains('finished');
        const hasPreHighlight = classList.contains('pre-highlight');
        const hasActiveState = hasHighlight || hasFinished || hasPreHighlight;

        // Early exit check
        if (!(currentTimeMs < startTime - 1000 && !hasActiveState)) {
          let preHighlightReset = false;

          // Before the syllable starts, pre-highlight only belongs beside a
          // previous active word. Once the syllable starts, updateSyllableAnimation
          // consumes the class so the actual wipe can continue from the pre-wipe
          // pose instead of restarting from the beginning.
          if (hasPreHighlight && currentTimeMs < startTime) {
            const prevSyllable = AmLyrics.getPreviousNonTransliterationSyllable(
              syllables,
              i,
            );
            const previousCarriesHighlight =
              prevSyllable?.classList.contains('highlight') ||
              prevSyllable?.classList.contains('finished');
            const preview = AmLyrics.getWordWipe(syllable);
            if (
              !previousCarriesHighlight ||
              (preview && currentTimeMs < preview.epoch)
            ) {
              AmLyrics.clearPreHighlight(syllable);
              preHighlightReset = true;
            }
          }

          if (!preHighlightReset) {
            if (currentTimeMs >= startTime && currentTimeMs <= endTime) {
              // Currently active
              if (!hasHighlight) {
                AmLyrics.updateSyllableAnimation(
                  syllable,
                  currentTimeMs - startTime,
                );
              }
              if (hasFinished) {
                classList.remove('finished');
              }
            } else if (currentTimeMs > endTime) {
              // Finished
              if (!hasFinished) {
                if (!hasHighlight) {
                  AmLyrics.updateSyllableAnimation(
                    syllable,
                    currentTimeMs - startTime,
                  );
                }
                classList.add('finished');
                // The shared edge owns the fill, including joined syllables.
                // Keep its dim base underneath as individual segments finish.
              }
            } else if (hasHighlight || hasFinished) {
              // Not yet started
              const wipe = AmLyrics.getWordWipe(syllable);
              if (wipe && currentTimeMs >= wipe.start) {
                classList.remove('highlight', 'finished', 'cleanup');
              } else {
                const word = AmLyrics.getWordElementForSyllable(syllable);
                if (word) AmLyrics.clearWordWipe(word);
                AmLyrics.resetSyllable(syllable);
              }
            }

            AmLyrics.maybePreWipeNextWord(syllables, i, currentTimeMs, endTime);
          }
        }
      }
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

  private generatePlain(): string {
    if (!this.lyrics) return '';
    return this.lyrics
      .flatMap(line => {
        const main = line.text
          .map(syllable => syllable.text)
          .join('')
          .trim();
        const backing = (line.backgroundText || [])
          .map(syllable => syllable.text)
          .join('')
          .trim();
        // eslint-disable-next-line no-nested-ternary
        const background = backing
          ? backing.startsWith('(') && backing.endsWith(')')
            ? backing
            : `(${backing})`
          : '';
        return (
          AmLyrics.getBackgroundTextPlacement(line) === 'before'
            ? [background, main]
            : [main, background]
        ).filter(Boolean);
      })
      .join('\n');
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
    let extension: 'auto' | 'lrc' | 'ttml' | 'plain' | 'txt' =
      this.downloadFormat;
    if (extension === 'auto') {
      extension = isWordSynced ? 'ttml' : 'lrc';
    }
    let mimeType = '';

    if (extension === 'ttml') {
      const source = this.availableSources[this.currentSourceIndex];
      content =
        (source?.source === this.lyricsSource && source.originalTTML) ||
        this.generateTTML();
      mimeType = 'application/xml';
    } else if (extension === 'plain') {
      content = this.generatePlain();
      extension = 'txt';
      mimeType = 'text/plain;charset=utf-8';
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

  private renderSourceDetails() {
    const source = this.availableSources[this.currentSourceIndex];
    if (!source) return nothing;
    if (source.byModel)
      return html`<span class="source-badge model-generated"
        ><svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="lucide lucide-sparkles preview-icon"
        >
          <path
            d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"
          />
          <path d="M20 2v4" />
          <path d="M22 4h-4" />
          <circle cx="4" cy="20" r="2" /></svg
        >Model-generated</span
      >`;
    if (!source.source.startsWith('Unison')) return nothing;
    const author = source.contributors?.[0];
    return html`
      ${author
        ? html`<span class="source-badge unison-author"
            >by
            <a
              href=${author.url || nothing}
              target="_blank"
              rel="noopener noreferrer"
              >${author.username}</a
            ></span
          >`
        : nothing}
      ${source.confidence
        ? html`<span
            class="source-badge unison-confidence"
            title="Unison community confidence"
            >${source.confidence} confidence</span
          >`
        : nothing}
    `;
  }

  private renderContributors() {
    if (this.lyricsSource?.startsWith('Unison')) return nothing;
    const people = this.availableSources[this.currentSourceIndex]?.contributors;
    if (!people?.length) return nothing;
    const portrait = (person: LyricsContributor) => html`
      <span aria-hidden="true">${Array.from(person.username)[0]}</span>
      ${person.avatar
        ? html`<img
            src=${person.avatar}
            alt=""
            width="32"
            height="32"
            loading="lazy"
            decoding="async"
            @error=${(event: Event) => {
              const image = event.currentTarget as HTMLImageElement;
              image.hidden = true;
            }}
            @load=${(event: Event) => {
              const image = event.currentTarget as HTMLImageElement;
              image.hidden = false;
            }}
          />`
        : nothing}
    `;
    return html`<div class="contributor-stack">
      ${people
        .slice(0, 3)
        .map(
          person =>
            html`<a
              class="contributor-avatar"
              href=${person.url || nothing}
              target="_blank"
              rel="noopener noreferrer"
              tabindex="0"
              aria-label=${`${person.username} — ${person.roles.join(', ')}`}
              >${portrait(person)}<span
                class="contributor-tooltip"
                aria-hidden="true"
                >${person.username} · ${person.roles.join(', ')}</span
              ></a
            >`,
        )}
      ${people.length > 3
        ? html`<details class="contributor-overflow">
            <summary aria-label=${`${people.length - 3} more contributors`}>
              +${people.length - 3}
            </summary>
            <div class="contributor-menu">
              ${people.slice(3).map(
                person =>
                  html`<a
                    href=${person.url || nothing}
                    target="_blank"
                    rel="noopener noreferrer"
                    tabindex="0"
                    ><span class="contributor-avatar">${portrait(person)}</span
                    ><span
                      >${person.username}<br />${person.roles.join(', ')}</span
                    ></a
                  >`,
              )}
            </div>
          </details>`
        : nothing}
    </div>`;
  }

  private static renderTimedRomanization(
    groups: Syllable[][],
    trackId: string,
  ) {
    const hasReading = (syllable: Syllable) =>
      syllable.romanizedText?.trim() &&
      syllable.romanizedText.trim() !== syllable.text.trim();
    if (!groups.some(group => group.some(hasReading))) return nothing;
    let previousReading: string | undefined;
    return html`<span class="lyrics-timed-romanization" dir="ltr"
      >${groups.map((group, groupIndex) => {
        const readings = group.filter(hasReading);
        if (!readings.length) return nothing;
        const wordSpace =
          previousReading !== undefined &&
          !/\s$/.test(previousReading) &&
          !/^\s/.test(readings[0].romanizedText || '');
        previousReading = readings[readings.length - 1].romanizedText;
        return html`${wordSpace ? ' ' : nothing}<span
            class="lyrics-word"
            data-virtual-word-id="${trackId}:reading:${groupIndex}"
            data-virtual-word-start="${Math.min(
              ...group.map(s => s.timestamp),
            )}"
            data-virtual-word-end="${Math.max(...group.map(s => s.endtime))}"
            >${readings.map(
              syllable =>
                html`<span class="lyrics-syllable-wrap"
                  ><span
                    dir="ltr"
                    class="lyrics-syllable transliteration no-chars"
                    data-start-time="${syllable.timestamp}"
                    data-end-time="${syllable.endtime}"
                    data-duration="${syllable.endtime - syllable.timestamp}"
                    data-syllable-index="0"
                    data-word-index="${groupIndex}"
                    data-wipe-ratio="1"
                    >${syllable.romanizedText}</span
                  ></span
                >`,
            )}</span
          >`;
      })}</span
    >`;
  }

  render() {
    if (this.fontFamily) {
      this.style.fontFamily = this.fontFamily;
    }

    // Set both old internal CSS variables (for backward compatibility)
    // and new public CSS variables (which take precedence)
    this.style.setProperty('--highlight-color', this.highlightColor);

    const sourceLabel = this.lyricsSource ?? 'Unavailable';

    const isUnsynced = this.cachedIsUnsynced;
    const hasLeftAlignedLines = this.lyrics?.some(
      line => !AmLyrics.isOppositeAgent(line),
    );
    const hasRightAlignedLines = this.lyrics?.some(line =>
      AmLyrics.isOppositeAgent(line),
    );
    const hasDuetLines = hasLeftAlignedLines && hasRightAlignedLines;

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

      // Build a lookup map of ALL gaps so they are always in the DOM
      const allGaps = this.findAllInstrumentalGaps();
      const gapByIndex = new Map(
        allGaps.map(g => [g.insertBeforeIndex, g] as const),
      );

      return this.lyrics.map((line, lineIndex) => {
        const lineId = `lyrics-line-${lineIndex}`;

        // Calculate line timing
        const lineStartTime = line.text[0]?.timestamp || 0;
        const lineEndTime = line.text[line.text.length - 1]?.endtime || 0;

        // Always render background vocals in the DOM so the syllable cache
        // includes them and the wipe effect applies correctly.
        const hasBackground =
          line.backgroundText && line.backgroundText.length > 0;
        const bgPlacement = hasBackground
          ? AmLyrics.getBackgroundTextPlacement(line)
          : 'after';

        const backingWords: Array<{
          text: string;
          start: number;
          end: number;
        }> = [];
        const backingGroups: Syllable[][] = [];
        const backing = line.backgroundText || [];
        for (let first = 0; first < backing.length; ) {
          let last = first;
          while (
            last + 1 < backing.length &&
            !/\s$/.test(backing[last].text) &&
            !/^\s/.test(backing[last + 1].text)
          )
            last += 1;
          const group = backing.slice(first, last + 1);
          backingGroups.push(group);
          const word = {
            text: group.map(syllable => syllable.text).join(''),
            start: backing[first].timestamp,
            end: backing[last].endtime,
          };
          for (let index = first; index <= last; index += 1)
            backingWords[index] = word;
          first = last + 1;
        }

        const lineIsRTL = this.cachedLineData?.[lineIndex]?.lineIsRTL ?? false;
        const separateRomanization =
          lineIsRTL &&
          this.showRomanization &&
          !AmLyrics.isLineSyncedLine(line);

        // Create background vocals container (with romanization support)
        const backgroundVocalElement = hasBackground
          ? html`<p
              class="background-vocal-container background-${bgPlacement}"
            >
              <span class="background-vocal-wrap">
                ${line.backgroundText!.map((syllable, syllableIndex) => {
                  const startTimeMs = syllable.timestamp;
                  const endTimeMs = syllable.endtime;
                  const durationMs = endTimeMs - startTimeMs;

                  const bgRomanizedText =
                    this.showRomanization &&
                    !separateRomanization &&
                    syllable.romanizedText &&
                    syllable.romanizedText.trim() !== syllable.text.trim()
                      ? html`<span
                          dir="auto"
                          class="lyrics-syllable transliteration no-chars ${lineIsRTL
                            ? 'wipe-rtl'
                            : ''} ${syllable.lineSynced ? 'line-synced' : ''}"
                          data-start-time="${startTimeMs}"
                          data-end-time="${endTimeMs}"
                          data-duration="${durationMs}"
                          data-syllable-index="0"
                          data-wipe-ratio="1"
                          >${syllable.romanizedText}</span
                        >`
                      : '';

                  const backingWord = backingWords[syllableIndex];
                  const bgChars =
                    !syllable.lineSynced &&
                    AmLyrics.characterMotionMode(
                      backingWord.text,
                      backingWord.end - backingWord.start,
                      true,
                    ) !== 'none'
                      ? Array.from(syllable.text.replace(/\s/g, ''))
                      : [];
                  let bgCharIndex = 0;
                  return html`<span
                    class="lyrics-word${bgChars.length ? ' char-rise' : ''}"
                    data-virtual-word-id="bg-${lineIndex}-${backingWord.start}"
                    data-virtual-word-start="${backingWord.start}"
                    data-virtual-word-end="${backingWord.end}"
                    ><span
                      class="lyrics-syllable-wrap${bgRomanizedText
                        ? ' has-transliteration'
                        : ''}"
                      ><span
                        class="lyrics-syllable${lineIsRTL
                          ? ' rtl-text'
                          : ''} ${bgChars.length
                          ? 'has-chars'
                          : 'no-chars'}${syllable.lineSynced
                          ? ' line-synced'
                          : ''}"
                        data-start-time="${startTimeMs}"
                        data-end-time="${endTimeMs}"
                        data-duration="${durationMs}"
                        data-syllable-index="0"
                        data-word-index="${syllableIndex}"
                        data-word-length="${syllable.text.replace(/\s/g, '')
                          .length}"
                        data-wipe-ratio="1"
                        >${bgChars.length
                          ? Array.from(syllable.text).map(char => {
                              if (/\s/.test(char)) return char;
                              const index = bgCharIndex;
                              bgCharIndex += 1;
                              return html`<span class="char-motion"
                                ><span
                                  class="char"
                                  data-syllable-char-index="${index}"
                                  data-wipe-start="${index / bgChars.length}"
                                  data-wipe-duration="${1 / bgChars.length}"
                                  >${char}</span
                                ></span
                              >`;
                            })
                          : syllable.text}</span
                      >${bgRomanizedText}</span
                    ></span
                  >`;
                })}
                ${separateRomanization
                  ? AmLyrics.renderTimedRomanization(
                      backingGroups,
                      `bg-${lineIndex}`,
                    )
                  : nothing}
              </span>
            </p>`
          : '';

        // Background vocals share the same line.translation and line.romanizedText
        // as the main vocal, so we intentionally do NOT render a separate
        // translation/romanization block for background — it would just duplicate
        // the main line's text.

        const lineData = this.cachedLineData?.[lineIndex];
        const wordGroups = lineData?.wordGroups ?? [];
        const groupGrowable = lineData?.groupGrowable ?? [];
        const groupGlowing = lineData?.groupGlowing ?? [];
        const groupCharRise = lineData?.groupCharRise ?? [];
        const groupCharDrag = lineData?.groupCharDrag ?? [];
        const vwFullDuration = lineData?.vwFullDuration ?? [];
        const vwCharOffset = lineData?.vwCharOffset ?? [];
        const vwStartMs = lineData?.vwStartMs ?? [];
        const vwEndMs = lineData?.vwEndMs ?? [];

        const mainVocalElement = html`<p
          class="main-vocal-container ${lineIsRTL ? 'rtl-text' : ''}"
        >
          ${wordGroups.map((group, groupIdx) => {
            const isGrowable = groupGrowable[groupIdx];
            const isGlowing = groupGlowing[groupIdx];
            const isCharRise = groupCharRise[groupIdx];
            const isCharDrag = groupCharDrag[groupIdx];
            const isAnimatedByChar = isGrowable || isCharRise || isCharDrag;
            const groupLineSynced =
              line.isWordSynced === false || group.some(s => s.lineSynced);

            const wordDuration = isAnimatedByChar
              ? vwFullDuration[groupIdx]
              : 0;
            const groupCharOffset = isAnimatedByChar
              ? vwCharOffset[groupIdx]
              : 0;
            const virtualWordId = `${lineIndex}:${vwStartMs[groupIdx]}:${vwEndMs[groupIdx]}`;
            const virtualWordStart = vwStartMs[groupIdx];
            const virtualWordEnd = vwEndMs[groupIdx];

            let sylCharAccumulator = 0;

            const groupText = group.map(s => s.text).join('');
            const visibleWordLength = groupText.replace(/\s/g, '').length;
            const shouldAllowBreak =
              groupText.trim().length >= 16 ||
              /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(
                groupText,
              );

            return html`<span
              class="lyrics-word${isGrowable ? ' growable' : ''}${isCharRise
                ? ' char-rise'
                : ''}${isCharDrag ? ' char-drag' : ''}${isGlowing
                ? ' glowing'
                : ''}${shouldAllowBreak ? ' allow-break' : ''}"
              data-virtual-word-id="${virtualWordId}"
              data-virtual-word-start="${virtualWordStart}"
              data-virtual-word-end="${virtualWordEnd}"
              >${group.map((syllable, sylIdx) => {
                const startTimeMs = syllable.timestamp;
                const endTimeMs = syllable.endtime;
                const durationMs = endTimeMs - startTimeMs;
                const text = syllable.text || '';

                const romanizedText =
                  this.showRomanization &&
                  !separateRomanization &&
                  syllable.romanizedText &&
                  syllable.romanizedText.trim() !== syllable.text.trim()
                    ? html`<span
                        dir="auto"
                        class="lyrics-syllable transliteration no-chars ${lineIsRTL
                          ? 'wipe-rtl'
                          : ''} ${groupLineSynced ? 'line-synced' : ''}"
                        data-start-time="${startTimeMs}"
                        data-end-time="${endTimeMs}"
                        data-duration="${durationMs}"
                        data-syllable-index="0"
                        data-wipe-ratio="1"
                        >${syllable.romanizedText}</span
                      >`
                    : '';

                const animateSyllable = isAnimatedByChar && !groupLineSynced;

                let syllableContent: any = text;

                if (animateSyllable) {
                  syllableContent = html`${Array.from(text).map(char => {
                    if (char === ' ') return ' ';

                    const charIndexInsideWord =
                      groupCharOffset + sylCharAccumulator;
                    sylCharAccumulator += 1;

                    return html`<span class="char-motion"
                      ><span
                        class="char"
                        data-char-index="${charIndexInsideWord}"
                        data-syllable-char-index="${charIndexInsideWord}"
                        >${char}</span
                      ></span
                    >`;
                  })}`;
                }

                return html`<span
                  class="lyrics-syllable-wrap${romanizedText
                    ? ' has-transliteration'
                    : ''}"
                  ><span
                    class="lyrics-syllable${lineIsRTL
                      ? ' rtl-text'
                      : ''}${groupLineSynced
                      ? ' line-synced'
                      : ''}${animateSyllable ? ' has-chars' : ' no-chars'}"
                    data-start-time="${startTimeMs}"
                    data-end-time="${endTimeMs}"
                    data-duration="${durationMs}"
                    data-word-duration="${wordDuration}"
                    data-syllable-index="${sylIdx}"
                    data-word-index="${groupIdx}"
                    data-word-length="${visibleWordLength}"
                    data-wipe-ratio="1"
                    >${syllableContent}</span
                  >${romanizedText}</span
                >`;
              })}</span
            >`;
          })}
          ${separateRomanization
            ? AmLyrics.renderTimedRomanization(wordGroups, `${lineIndex}`)
            : nothing}
        </p>`;

        // Translation container (if enabled)
        // Hide translation if it matches the original line text
        const fullLineText = line.text
          .map(s => s.text)
          .join('')
          .trim();
        const translationElement =
          this.showTranslation &&
          line.translation &&
          line.translation.trim() !== fullLineText
            ? html`<div class="lyrics-translation-container">
                ${line.translation}
              </div>`
            : '';

        // Line-synced romanization (fallback if no word-level romanization)
        // Hide if the romanized text matches the original line text
        const lineRomanizationElement =
          this.showRomanization &&
          line.romanizedText &&
          !line.text.some(s => s.romanizedText) &&
          line.romanizedText.trim() !== fullLineText
            ? html`<div class="lyrics-romanization-container" dir="auto">
                ${line.romanizedText}
              </div>`
            : '';

        // Check for instrumental gap before this line
        let maybeInstrumentalBlock: unknown = null;
        const gapForLine = gapByIndex.get(lineIndex);
        if (gapForLine) {
          const gapDuration = gapForLine.gapEnd - gapForLine.gapStart;
          // Calculate dot timing for fill-up animation (3 dots)
          const dotDuration = gapDuration / 3;

          // Gap starts without 'active' — _onTimeChanged toggles it imperatively
          maybeInstrumentalBlock = html`<div
            id="gap-${lineIndex}"
            class="lyrics-line lyrics-gap"
            aria-hidden="true"
            data-start-time="${gapForLine.gapStart}"
            data-end-time="${gapForLine.gapEnd}"
          >
            <p class="main-vocal-container">
              <span class="lyrics-word"
                ><span class="lyrics-syllable-wrap"
                  ><span
                    class="lyrics-syllable"
                    data-start-time="${gapForLine.gapStart}"
                    data-end-time="${gapForLine.gapStart + dotDuration}"
                    data-duration="${dotDuration}"
                    data-wipe-ratio="1"
                    data-syllable-index="0"
                  ></span></span
                ><span class="lyrics-syllable-wrap"
                  ><span
                    class="lyrics-syllable"
                    data-start-time="${gapForLine.gapStart + dotDuration}"
                    data-end-time="${gapForLine.gapStart + dotDuration * 2}"
                    data-duration="${dotDuration}"
                    data-wipe-ratio="1"
                    data-syllable-index="1"
                  ></span></span
                ><span class="lyrics-syllable-wrap"
                  ><span
                    class="lyrics-syllable"
                    data-start-time="${gapForLine.gapStart + dotDuration * 2}"
                    data-end-time="${gapForLine.gapEnd}"
                    data-duration="${dotDuration}"
                    data-wipe-ratio="1"
                    data-syllable-index="2"
                  ></span></span
              ></span>
            </p>
          </div>`;
        }

        return html`
          ${maybeInstrumentalBlock}
          <div
            id="${lineId}"
            class="lyrics-line ${AmLyrics.isOppositeAgent(line)
              ? 'singer-right'
              : 'singer-left'} ${lineIsRTL ? 'rtl-text' : ''} ${hasBackground
              ? `bg-${bgPlacement}`
              : ''}"
            role="${isUnsynced ? 'paragraph' : 'button'}"
            aria-label="${isUnsynced
              ? fullLineText
              : `Seek to lyric: ${fullLineText}`}"
            data-start-time="${lineStartTime}"
            data-end-time="${lineEndTime}"
            @click=${() => this.handleLineClick(line)}
            tabindex="${isUnsynced ? -1 : 0}"
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                this.handleLineClick(line);
              }
            }}
          >
            <div class="lyrics-line-container ${lineIsRTL ? 'rtl-text' : ''}">
              ${bgPlacement === 'before' ? backgroundVocalElement : ''}
              ${mainVocalElement}
              ${bgPlacement === 'after' ? backgroundVocalElement : ''}
              ${lineRomanizationElement} ${translationElement}
            </div>
          </div>
        `;
      });
    };

    return html`
      <div
        class="lyrics-container ${isUnsynced
          ? 'is-unsynced'
          : ''} ${!isUnsynced && !this.noBlur
          ? 'blur-inactive-enabled'
          : ''} ${hasDuetLines ? 'has-duet-lines' : ''} ${this
          .shouldReduceMotion
          ? 'reduced-motion'
          : ''}"
        role="region"
        aria-label=${isUnsynced ? 'Lyrics' : 'Synced lyrics'}
      >
        ${!this.isLoading && this.lyrics && this.lyrics.length > 0
          ? html`
              <div class="lyrics-header">
                <div class="header-controls">
                  <button
                    type="button"
                    class="download-button ${this.showRomanization
                      ? 'active'
                      : ''}"
                    @click=${this.toggleRomanization}
                    title="Toggle Romanization"
                    aria-label="Toggle romanization"
                    aria-pressed="${this.showRomanization}"
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
                      class="lucide lucide-speech-icon lucide-speech"
                    >
                      <path
                        d="M8.8 20v-4.1l1.9.2a2.3 2.3 0 0 0 2.164-2.1V8.3A5.37 5.37 0 0 0 2 8.25c0 2.8.656 3.054 1 4.55a5.77 5.77 0 0 1 .029 2.758L2 20"
                      />
                      <path d="M19.8 17.8a7.5 7.5 0 0 0 .003-10.603" />
                      <path d="M17 15a3.5 3.5 0 0 0-.025-4.975" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="download-button ${this.showTranslation
                      ? 'active'
                      : ''}"
                    @click=${this.toggleTranslation}
                    title="Toggle Translation"
                    aria-label="Toggle translation"
                    aria-pressed="${this.showTranslation}"
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
                      class="lucide lucide-languages-icon lucide-languages"
                    >
                      <path d="m5 8 6 6" />
                      <path d="m4 14 6-6 2-3" />
                      <path d="M2 5h12" />
                      <path d="M7 2h1" />
                      <path d="m22 22-5-10-5 10" />
                      <path d="M14 18h6" />
                    </svg>
                  </button>
                </div>
                <div class="download-controls">
                  <select
                    class="format-select"
                    aria-label="Lyrics download format"
                    @change=${(e: Event) => {
                      this.downloadFormat = (e.target as HTMLSelectElement)
                        .value as typeof this.downloadFormat;
                    }}
                    .value=${this.downloadFormat}
                    @click=${(e: Event) => e.stopPropagation()}
                  >
                    <option value="auto">Auto</option>
                    <option value="lrc">LRC</option>
                    <option value="ttml">TTML</option>
                    <option value="plain">Plain</option>
                  </select>
                  <button
                    type="button"
                    class="download-button"
                    @click=${this.downloadLyrics}
                    title="Download Lyrics"
                    aria-label="Download lyrics"
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
              <footer class="lyrics-footer lyrics-line">
                <div class="footer-content">
                  <div class="source-info">
                    <b style="font-weight: 750;">Source</b> ${sourceLabel}
                    ${this.renderSourceDetails()} ${this.renderContributors()}
                    ${(this.availableSources &&
                      this.availableSources.length > 1) ||
                    !this.hasFetchedAllProviders
                      ? html`
                          <button
                            type="button"
                            class="download-button source-switch-btn"
                            title="Switch Lyrics Source"
                            aria-label="Switch lyrics source"
                            @click=${this.switchSource}
                            ?disabled=${this.sourceSwitchPending}
                            aria-busy=${this.sourceSwitchPending}
                          >
                            <svg
                              class="source-switch-svg lucide lucide-arrow-down-up-icon lucide-arrow-down-up ${this
                                .sourceSwitchPending
                                ? 'is-loading'
                                : ''}"
                              xmlns="http://www.w3.org/2000/svg"
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            >
                              ${this.sourceSwitchPending
                                ? svg`<path
                                    d="M21 12a9 9 0 1 1-6.219-8.56"
                                  ></path>`
                                : svg`<path d="m3 16 4 4 4-4"></path
                                    ><path d="M7 20V4"></path
                                    ><path d="m21 8-4-4-4 4"></path
                                    ><path d="M17 4v16"></path>`}
                            </svg>
                            <span class="source-switch-label"
                              >${this.sourceSwitchPending
                                ? 'Searching...'
                                : 'Switch'}</span
                            >
                          </button>
                        `
                      : ''}
                  </div>
                  ${this.songwriters
                    ? html`<span
                        class="songwriters-info"
                        style="margin-top: 4px; font-weight: normal; font-size: 0.9em;"
                      >
                        <b style="font-weight: 750;">Songwriters</b> ${this
                          .songwriters}
                      </span>`
                    : ''}
                  <span class="version-info" style="margin-top: 8px;">
                    <b style="font-weight: 750;">am-lyrics</b> v${VERSION} •

                    <a
                      href="https://github.com/uimaxbai/apple-music-web-components"
                      target="_blank"
                      rel="noopener noreferrer"
                      style="display: inline-flex; align-items: center; gap: 4px;"
                      >Star me on GitHub
                    </a>
                  </span>
                </div>
              </footer>
            `
          : ''}
      </div>
    `;
  }
}

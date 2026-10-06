import { css, html, LitElement, svg } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { GoogleService } from './GoogleService.js';

const VERSION = '1.8.0';
const INSTRUMENTAL_THRESHOLD_MS = 7000; // Show dots for gaps >= 7s
const FETCH_TIMEOUT_MS = 8000; // Default timeout for lyrics fetch requests
const LRC_RED_TIMEOUT_MS = 3000;
const SEEK_THRESHOLD_MS = 500;
const SCROLL_ANIMATION_DURATION_MS = 350;
const BACKGROUND_EXIT_DURATION_MS = 450;
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
const NEXT_LINE_BASE_BLUR_EM = 0.02;
const NEXT_LINE_UNBLUR_DURATION_MS = 2000;
const NORMAL_WORD_SPRING_DURATION_MS = 2000;

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

interface Syllable {
  text: string;
  part: boolean;
  timestamp: number;
  endtime: number;
  romanizedText?: string;
  lineSynced?: boolean; // New flag for line-synced lyrics
}

interface WordWipe {
  syllables: HTMLElement[];
  fragments: Array<{ element: HTMLElement; width: number; offset: number }>;
  segments: Array<{ start: number; end: number; width: number }>;
  width: number;
  count: number;
  cjk: boolean;
  start: number;
  end: number;
  rtl: boolean;
  animations: Animation[];
  epoch: number;
}

interface NormalWordMotion {
  targets: HTMLElement[];
  animations: Animation[];
  start: number;
  settled: boolean;
}

interface LyricLayout {
  tops: Map<HTMLElement, number>;
  contents: Map<HTMLElement, number>;
  scrollTop: number;
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
  agentId?: string;
  direction?: 'ltr' | 'rtl';
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
  originalTTML?: string;
  lines: LyricsLine[];
  source: string;
  songwriters?: string;
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
      --lyplus-lyrics-palette: var(
        --am-lyrics-highlight-color,
        var(--highlight-color, #ffffff)
      );
      --lyplus-text-primary: var(--lyplus-lyrics-palette);
      /* Use color-mix with the text color rather than just opacity so it adapts */
      --lyplus-text-secondary: color-mix(
        in srgb,
        var(--lyplus-lyrics-palette),
        transparent 45%
      );

      --lyplus-padding-base: 1em;
      --lyplus-padding-line: 10px;
      --lyplus-padding-gap: 0.3em;
      --lyplus-border-radius-base: 0.6em;
      --lyplus-gap-dot-size: 0.4em;
      --lyplus-gap-dot-margin: 0.08em;

      --lyplus-font-size-base: 34px;
      --lyplus-font-size-base-grow: 24.5;
      --lyplus-font-size-subtext: 0.6em;
      --am-lyrics-line-height: 1.2;
      --am-lyrics-line-spacing: 25px;
      --am-lyrics-background-vocal-spacing: 15px;
      --am-lyrics-background-vocal-font-size: 0.65em;
      --am-lyrics-background-vocal-stack-shift: 7.5px;
      --am-lyrics-background-vocal-max-height: 8em;
      --am-lyrics-background-vocal-enter-duration: 650ms;
      --am-lyrics-background-vocal-exit-duration: 450ms;
      --am-lyrics-instrumental-height: 40px;
      --am-lyrics-instrumental-spacing: 16px;
      --am-lyrics-instrumental-enter-duration: 400ms;
      --am-lyrics-instrumental-collapse-duration: 500ms;
      --am-lyrics-instrumental-exit-duration: 350ms;
      --am-lyrics-instrumental-exit-scale: 0;
      --am-lyrics-inactive-scale: 0.98;
      --am-lyrics-background-vocal-scale: 0.96;
      --am-lyrics-touch-scale: 0.96;
      --am-lyrics-highlight-radius: 16px;
      --am-lyrics-highlight-surface: rgba(255, 255, 255, 0.08);
      --am-lyrics-progression-feather: 30px;
      --am-lyrics-glow-radius: 5px;
      --am-lyrics-inline-padding: 20px;
      --am-lyrics-lift: 1;
      --char-rise-y: -3px;
      --am-lyrics-character-rise-peak: -1.25px;

      --lyplus-blur-amount: 0.07em;
      --lyplus-blur-amount-near: 0.035em;
      --lyplus-fade-gap-timing-function: ease-out;
      --wipe-gradient-width: var(--am-lyrics-progression-feather);
      --wipe-gradient-half: calc(var(--am-lyrics-progression-feather) / 2);

      --lyrics-scroll-padding-top: 12%;

      display: block;
      font-family:
        -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu,
        Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      background: transparent;
      height: 100%;
      overflow: hidden;
      font-weight: bold;
      color: var(--lyplus-text-primary);
      container-type: inline-size;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Container & scroll behavior */
    .lyrics-container {
      position: relative;
      padding: 60px var(--am-lyrics-inline-padding)
        calc(
          var(--am-lyrics-instrumental-height) +
            var(--am-lyrics-instrumental-spacing)
        );
      background-color: transparent;
      width: 100%;
      height: 100%;
      max-height: 100vh;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
      box-sizing: border-box;
      scrollbar-width: none;
      overflow-anchor: none;
      overscroll-behavior-y: contain;
      scroll-padding-block-start: var(--lyrics-scroll-padding-top);
    }

    .lyrics-container::-webkit-scrollbar {
      display: none;
    }

    /* Disable transitions during touch-scrolling for 1:1 feedback */
    .lyrics-container.touch-scrolling .lyrics-line,
    .lyrics-container.touch-scrolling .lyrics-plus-metadata {
      transition: none !important;
      filter: none !important;
    }

    /* Apply smooth gliding transition for mouse-wheel scrolling */
    .lyrics-container.wheel-scrolling .lyrics-line {
      transition: transform 0.3s ease-out !important;
      filter: none !important;
    }

    .lyrics-container.user-scrolling .lyrics-line {
      --lyrics-line-delay: 0ms !important;
      transition-delay: 0ms !important;
    }

    /* Lyrics line base styles */
    .lyrics-line {
      position: relative;
      isolation: isolate;
      padding: 0 var(--lyplus-padding-line);
      margin-block-end: var(--am-lyrics-line-spacing);
      opacity: 0.8;
      color: var(--lyplus-text-secondary);
      font-size: var(--lyplus-font-size-base);
      line-height: var(--am-lyrics-line-height);
      cursor: pointer;
      transform-origin: left;
      /* Graceful 0.7 s fade so the line stays mostly bright while the
         0.4 s scroll animation runs, then settles into the inactive state. */
      transition:
        opacity 0.7s ease,
        transform 0.4s cubic-bezier(0.41, 0, 0.12, 0.99)
          var(--lyrics-line-delay, 0ms),
        filter 0.7s ease;
      /* Keep line geometry stable in WebKit; content-visibility:auto can
         change offsetTop as Safari reveals an offscreen lyric. */
      contain: layout style;
      text-rendering: optimizeLegibility;
    }

    .lyrics-line::before {
      content: '';
      position: absolute;
      z-index: -1;
      inset: -6px -8px;
      border-radius: var(--am-lyrics-highlight-radius);
      background: var(--am-lyrics-highlight-surface);
      box-shadow: 0 0 0 1px transparent;
      opacity: 0;
      transform: scale(0.98);
      transition:
        opacity 180ms cubic-bezier(0.2, 0, 0, 1),
        transform 180ms cubic-bezier(0.2, 0, 0, 1),
        box-shadow 180ms ease-out;
      pointer-events: none;
    }

    .lyrics-line:focus-visible {
      outline: none;
    }

    .lyrics-line:focus-visible::before {
      opacity: 1;
      transform: scale(1);
      box-shadow: 0 0 0 2px
        color-mix(in srgb, var(--lyplus-text-primary) 72%, transparent);
    }

    .lyrics-line {
      animation: none;
    }

    /* --- Line Container & Vocal Containers --- */
    .lyrics-line-container {
      position: relative;
      overflow-wrap: break-word;
      transform-origin: left;
      transform: translateZ(0) scale(var(--am-lyrics-inactive-scale));
      transition:
        transform 0.7s ease,
        background-color 0.7s,
        color 0.7s;
    }

    .lyrics-line.active .lyrics-line-container,
    .lyrics-line.pre-active .lyrics-line-container {
      transform: translateZ(0) scale(1);
      transition:
        transform 0.5s ease,
        background-color 0.18s,
        color 0.18s;
    }

    .main-vocal-container {
      transform-origin: 5% 50%;
      margin: 0;
      transition: transform var(--scroll-duration, 400ms)
        cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    .background-vocal-container {
      --word-inactive-color: color-mix(
        in srgb,
        var(--lyplus-text-secondary) 50%,
        #888888
      );
      --word-wipe-color: color-mix(
        in srgb,
        var(--lyplus-text-primary) 50%,
        #888888
      );
      position: relative;
      height: 0;
      overflow: visible;
      font-size: var(--am-lyrics-background-vocal-font-size);
      line-height: 1.22;
      padding: 0;
      box-sizing: border-box;
      color: color-mix(in srgb, var(--lyplus-text-secondary) 80%, transparent);
      /* Layout commits once; the line spring animates the displacement. */
      margin: 0;
      pointer-events: none;
    }

    .background-vocal-wrap {
      display: block;
      padding-top: 0.08em;
      padding-bottom: 0.14em;
      opacity: 0;
      transform: translateY(var(--background-vocal-offset, 6px))
        scale(var(--am-lyrics-background-vocal-scale));
      transform-origin: left center;
    }

    .lyrics-line.singer-right .background-vocal-container,
    .lyrics-line.rtl-text .background-vocal-container {
      margin-left: auto;
      margin-right: 0;
    }

    /* Stable padding keeps the text's anchor fixed while space opens below it.
       Opacity/transform run independently of the lyric scroll look-ahead. */
    .lyrics-line.bg-expanded .background-vocal-container {
      height: var(
        --am-lyrics-background-vocal-height,
        var(--am-lyrics-background-vocal-max-height)
      );
    }

    .lyrics-line.bg-expanded .background-vocal-wrap {
      opacity: 1;
      transform: translateY(0) scale(1);
    }

    .lyrics-line.bg-collapsing .background-vocal-container {
      height: 0;
    }

    .lyrics-line.bg-collapsing .background-vocal-wrap {
      opacity: 0;
      transform: translateY(var(--background-vocal-offset, 6px))
        scale(var(--am-lyrics-background-vocal-scale));
    }

    .background-vocal-container.background-after .background-vocal-wrap {
      padding-top: calc(var(--am-lyrics-background-vocal-spacing) + 0.08em);
    }

    .background-vocal-container.background-before .background-vocal-wrap {
      --background-vocal-offset: -6px;
      padding-bottom: calc(var(--am-lyrics-background-vocal-spacing) + 0.14em);
    }

    .lyrics-line.singer-right .background-vocal-wrap,
    .lyrics-line.rtl-text .background-vocal-wrap {
      transform-origin: right center;
    }

    .lyrics-container.user-scrolling .background-vocal-container,
    .lyrics-container.user-scrolling .background-vocal-wrap,
    .lyrics-container.touch-scrolling .background-vocal-container,
    .lyrics-container.touch-scrolling .background-vocal-wrap {
      transition-duration: 1ms !important;
    }

    /* --- Line States & Modifiers --- */
    .lyrics-line.active {
      opacity: 1;
      color: var(--lyplus-text-primary);
    }

    .lyrics-line.pre-active {
      opacity: 1;
      transition:
        opacity 0.7s ease,
        transform 0.4s cubic-bezier(0.41, 0, 0.12, 0.99)
          var(--lyrics-line-delay, 0ms);
    }

    /* Non-overlapping phrases start receding with predictive scrolling. */
    .lyrics-line.scroll-exiting {
      opacity: 0.8;
      color: var(--lyplus-text-secondary);
      filter: blur(var(--lyplus-blur-amount-near));
      transition:
        opacity var(--scroll-duration, 400ms) cubic-bezier(0.41, 0, 0.12, 0.99),
        transform var(--scroll-duration, 400ms)
          cubic-bezier(0.41, 0, 0.12, 0.99) var(--lyrics-line-delay, 0ms),
        filter var(--scroll-duration, 400ms) ease;
    }

    .lyrics-line.persist-highlight .lyrics-syllable.finished,
    .lyrics-line.persist-highlight .lyrics-syllable.finished span.char {
      transition: none !important;
    }

    .lyrics-line.singer-right {
      text-align: end;
    }

    .lyrics-line.singer-right .lyrics-line-container,
    .lyrics-line.singer-right .main-vocal-container {
      transform-origin: right;
    }

    .lyrics-line.rtl-text {
      direction: rtl;
      text-align: right !important;
      transform-origin: right;
    }

    .lyrics-line.rtl-text .lyrics-line-container,
    .lyrics-line.rtl-text .main-vocal-container {
      transform-origin: right;
    }

    .lyrics-line.rtl-text .lyrics-romanization-container,
    .lyrics-line.rtl-text .lyrics-translation-container {
      text-align: right;
    }

    /* Preserve a clear duet lane without forcing every line into a narrow
       column. Logical padding keeps the spacing correct for RTL content. */
    .lyrics-container.has-duet-lines .lyrics-line.singer-left {
      padding-inline-end: max(var(--lyplus-padding-line), 15%);
    }

    .lyrics-container.has-duet-lines .lyrics-line.singer-right {
      padding-inline-start: max(var(--lyplus-padding-line), 15%);
    }

    /* --- Unsynced (Plain Text) Lyrics Overrides --- */
    .lyrics-container.is-unsynced .lyrics-line {
      opacity: 1 !important;
      color: var(--lyplus-text-primary) !important;
      filter: none !important;
      transform: none !important;
      cursor: default;
    }

    .lyrics-container.is-unsynced .lyrics-line-container {
      transform: none !important;
      background-color: transparent !important;
    }

    .lyrics-container.is-unsynced .lyrics-syllable {
      color: var(--lyplus-text-primary) !important;
      background-color: transparent !important;
      -webkit-background-clip: unset !important;
      background-clip: unset !important;
      -webkit-text-fill-color: unset !important;
      text-fill-color: unset !important;
      text-shadow: none !important;
      filter: none !important;
      opacity: 1 !important;
      transform: none !important;
    }

    @media (hover: hover) and (pointer: fine) {
      .lyrics-line:hover {
        filter: none !important;
      }

      .lyrics-container.is-unsynced .lyrics-line:hover {
        background: transparent !important;
      }
    }

    .lyrics-line:not(.lyrics-gap):active .lyrics-line-container {
      transform: translateZ(0) scale(var(--am-lyrics-touch-scale));
      transition-duration: 120ms;
    }

    /* --- Blur Effect for Inactive Lines --- */
    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap) {
      filter: blur(var(--lyplus-blur-amount));
    }

    /* Viewport Virtualization: Strip expensive filters and animations from
       offscreen lines.  IntersectionObserver toggles this class. */
    .lyrics-line.far-line {
      filter: none !important;
      will-change: auto !important;
      animation: none !important;
    }

    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.post-active-line:not(.lyrics-gap):not(.active):not(
        .pre-active
      ),
    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.next-active-line:not(.lyrics-gap):not(.active):not(
        .pre-active
      ),
    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.lyrics-activest:not(.active):not(.lyrics-gap):not(
        .pre-active
      ) {
      filter: blur(var(--lyplus-blur-amount-near));
    }

    /* Distance falloff mirrors the native lyric stack: neighbouring lines
       remain legible while lines farther from the focus gently recede. */
    .lyrics-line.prev-2,
    .lyrics-line.next-2 {
      opacity: 0.7;
    }

    .lyrics-line.prev-3,
    .lyrics-line.next-3 {
      opacity: 0.58;
    }

    .lyrics-line.prev-4,
    .lyrics-line.next-4 {
      opacity: 0.46;
    }

    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.next-active-line:not(.lyrics-gap):not(.active):not(
        .pre-active
      ) {
      filter: blur(0.028em);
    }

    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.next-2:not(.lyrics-gap):not(.active):not(.pre-active) {
      filter: blur(0.028em);
    }

    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.next-3:not(.lyrics-gap):not(.active):not(.pre-active) {
      filter: blur(0.05em);
    }

    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.next-4:not(.lyrics-gap):not(.active):not(.pre-active) {
      filter: blur(var(--lyplus-blur-amount));
    }

    /* Unblur all lines when user is scrolling */
    .lyrics-container.user-scrolling .lyrics-line {
      transition: none !important;
      filter: none !important;
      opacity: 0.8 !important;
    }

    /* Keep the same playback-driven blur as the upcoming line enters focus. */
    .lyrics-container.blur-inactive-enabled .lyrics-line.pre-active {
      filter: none !important;
      opacity: 1;
    }

    .lyrics-line.progressive-unblur {
      transition:
        opacity 0.7s ease,
        transform 0.4s cubic-bezier(0.41, 0, 0.12, 0.99)
          var(--lyrics-line-delay, 0ms),
        filter 0ms linear;
    }

    /* Word & syllable styles */
    .lyrics-word:not(.allow-break) {
      display: inline-block;
      vertical-align: baseline;
      white-space: nowrap;
    }

    .lyrics-word.allow-break {
      display: inline;
    }

    .lyrics-line .lyrics-word .lyrics-syllable.has-chars {
      transform: none !important;
    }

    .lyrics-line .lyrics-word.normal-word-motion .lyrics-syllable.no-chars {
      transition-property: color, background-color, opacity !important;
    }

    .lyrics-line
      .lyrics-word.normal-word-motion:not(.allow-break)
      .lyrics-syllable.no-chars {
      transform: none !important;
    }

    .lyrics-word.normal-word-motion.word-started:not(.allow-break) {
      transform: translate3d(
        0,
        calc(var(--char-rise-y) * var(--am-lyrics-lift)),
        0
      );
    }

    .lyrics-line .lyrics-word .lyrics-syllable .char.native-motion {
      transform-origin: 50% 80%;
      transition-property: color, background-color !important;
    }

    .reduced-motion
      .lyrics-line
      .lyrics-word
      .lyrics-syllable
      .char.native-motion {
      transform: none !important;
      text-shadow: none !important;
    }

    .lyrics-word.char-rise {
      display: inline-block;
      vertical-align: baseline;
      white-space: nowrap;
    }

    .lyrics-word.char-drag {
      display: inline-block;
      vertical-align: baseline;
      white-space: nowrap;
    }

    .lyrics-word.char-rise.allow-break {
      display: inline;
      white-space: normal;
    }

    .lyrics-word.char-drag.allow-break {
      display: inline;
      white-space: normal;
    }

    .lyrics-syllable-wrap {
      display: inline;
    }

    .lyrics-syllable-wrap.has-transliteration {
      display: inline-flex;
      flex-direction: column;
      align-items: start;
    }

    .lyrics-syllable {
      display: inline-block;
      vertical-align: baseline;
      color: transparent;
      background-color: var(--lyplus-text-secondary);
      white-space: pre-wrap;
      font-variant-ligatures: none;
      font-feature-settings: 'liga' 0;
      background-clip: text;
      -webkit-background-clip: text;
      transition:
        color 0.7s,
        background-color 0.7s,
        transform 0.7s ease;
    }

    /* --- Syllable States --- */
    .lyrics-syllable.finished {
      background-color: var(--lyplus-text-primary);
      /* Transform and colour have independent exit timings. */
      transition:
        transform 1s ease,
        background-color 0.7s ease,
        color 0.7s ease;
    }

    .lyrics-syllable.finished.has-chars {
      background-color: transparent;
    }

    .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable {
      transition:
        transform 1s ease,
        background-color 0.5s,
        color 0.5s;
    }

    .lyrics-line .lyrics-word .lyrics-syllable.line-synced {
      transform: none !important;
    }

    /* --- Wipe Highlight Effect --- */
    .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.highlight.no-chars,
    .lyrics-line.active:not(.lyrics-gap)
      .lyrics-syllable.pre-highlight.no-chars {
      background-repeat: no-repeat;
      background-image: linear-gradient(
        90deg,
        var(--lyplus-text-primary, #fff) 0%,
        var(--lyplus-text-primary, #fff)
          calc(100% - var(--wipe-gradient-width, 0.75em)),
        #0000 100%
      );
      background-size: 0% 100%;
      background-position: left;
    }

    .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.highlight.rtl-text,
    .lyrics-line.active:not(.lyrics-gap)
      .lyrics-syllable.pre-highlight.rtl-text {
      direction: rtl;
      background-image: linear-gradient(
        -90deg,
        var(--lyplus-text-primary) 0%,
        var(--lyplus-text-primary)
          calc(100% - var(--wipe-gradient-width, 0.75em)),
        transparent 100%
      );
      background-size: 0% 100%;
      background-position: right 0%;
    }

    /* Background vocals: muted gray wipe instead of white.
       Must match specificity of the main .active .highlight rule (0,3,1). */
    .lyrics-line.active
      .background-vocal-container
      .lyrics-syllable.highlight.no-chars,
    .lyrics-line.active
      .background-vocal-container
      .lyrics-syllable.pre-highlight.no-chars,
    .lyrics-line.pre-active
      .background-vocal-container
      .lyrics-syllable.highlight.no-chars,
    .lyrics-line.pre-active
      .background-vocal-container
      .lyrics-syllable.pre-highlight.no-chars {
      background-image: linear-gradient(
        90deg,
        color-mix(in srgb, var(--lyplus-text-primary, #fff) 50%, #888888) 0%,
        color-mix(in srgb, var(--lyplus-text-primary, #fff) 50%, #888888)
          calc(100% - var(--wipe-gradient-width, 0.75em)),
        #0000 100%
      );
    }

    .lyrics-line.active
      .background-vocal-container
      .lyrics-syllable.highlight.rtl-text,
    .lyrics-line.active
      .background-vocal-container
      .lyrics-syllable.pre-highlight.rtl-text,
    .lyrics-line.pre-active
      .background-vocal-container
      .lyrics-syllable.highlight.rtl-text,
    .lyrics-line.pre-active
      .background-vocal-container
      .lyrics-syllable.pre-highlight.rtl-text {
      background-image: linear-gradient(
        -90deg,
        color-mix(in srgb, var(--lyplus-text-primary) 50%, #888888) 0%,
        color-mix(in srgb, var(--lyplus-text-primary) 50%, #888888)
          calc(100% - var(--wipe-gradient-width, 0.75em)),
        transparent 100%
      );
    }

    /* Normal words keep their lift while the retired line fades. */
    .lyrics-line:not(.lyrics-gap)
      .lyrics-word.word-started:not(.growable):not(.char-rise):not(.char-drag)
      .lyrics-syllable.no-chars,
    .lyrics-line.active:not(.lyrics-gap)
      .lyrics-word.word-started
      .lyrics-syllable.no-chars {
      transform: translate3d(
        0,
        calc(var(--char-rise-y, -1.12px) * var(--am-lyrics-lift)),
        0
      );
    }

    .lyrics-line.persist-highlight:not(.lyrics-gap)
      .lyrics-word
      .lyrics-syllable.no-chars.finished {
      transform: translate3d(
        0,
        calc(var(--char-rise-y, -1.12px) * var(--am-lyrics-lift)),
        0
      );
    }

    .lyrics-word.growable .lyrics-syllable.cleanup .char {
      transform: translate3d(
        0,
        calc(var(--char-rise-y, -1.12px) * var(--am-lyrics-lift)),
        0
      );
    }

    .lyrics-word.char-drag .lyrics-syllable.cleanup .char {
      transform: translate3d(
        0,
        calc(var(--char-rise-y, -1.12px) * var(--am-lyrics-lift)),
        0
      );
    }

    .lyrics-line.persist-highlight
      .lyrics-word.growable
      .lyrics-syllable.finished
      .char,
    .lyrics-line.persist-highlight
      .lyrics-word.char-drag
      .lyrics-syllable.finished
      .char {
      transform: translate3d(
        0,
        calc(var(--char-rise-y, -1.12px) * var(--am-lyrics-lift)),
        0
      );
    }

    /* Background vocal overrides — placed AFTER main rules so they win
       on equal specificity. */
    .background-vocal-container .lyrics-syllable {
      background-color: color-mix(
        in srgb,
        var(--lyplus-text-secondary) 50%,
        #888888
      );
    }

    .lyrics-line.active:not(.lyrics-gap)
      .background-vocal-container
      .lyrics-syllable.finished,
    .lyrics-line.pre-active
      .background-vocal-container
      .lyrics-syllable.finished {
      background-color: color-mix(
        in srgb,
        var(--lyplus-text-primary) 50%,
        #888888
      );
    }

    .background-vocal-container .lyrics-syllable.line-synced {
      color: color-mix(
        in srgb,
        var(--lyplus-text-secondary) 50%,
        #888888
      ) !important;
    }

    .lyrics-line.active:not(.lyrics-gap)
      .background-vocal-container
      .lyrics-syllable.line-synced,
    .lyrics-line.pre-active
      .background-vocal-container
      .lyrics-syllable.line-synced {
      color: color-mix(
        in srgb,
        var(--lyplus-text-primary) 50%,
        #888888
      ) !important;
    }

    .lyrics-line.active:not(.lyrics-gap)
      .background-vocal-container
      .lyrics-syllable.line-synced.finished,
    .lyrics-line.pre-active
      .background-vocal-container
      .lyrics-syllable.line-synced.finished {
      color: color-mix(
        in srgb,
        var(--lyplus-text-primary) 50%,
        #888888
      ) !important;
    }

    .lyrics-line.active:not(.lyrics-gap)
      .background-vocal-container
      .lyrics-word.word-started
      .lyrics-syllable.no-chars,
    .lyrics-line.persist-highlight:not(.lyrics-gap)
      .background-vocal-container
      .lyrics-word
      .lyrics-syllable.no-chars.finished {
      transform: translate3d(
        0,
        calc(var(--char-rise-y) * var(--am-lyrics-lift)),
        0
      );
    }

    /* CJK phrases need no spaces, so their virtual word can cover several
       timed segments. Each supplied reading should wait for its own segment,
       rather than rising with every other reading at the phrase's start.
       Non-CJK split words retain their shared word motion. */
    .lyrics-line.active:not(.lyrics-gap)
      .lyrics-word.char-rise.word-started
      .lyrics-syllable.transliteration:not(.highlight):not(.finished) {
      transform: none;
    }

    .lyrics-syllable.pre-highlight {
      animation-name: pre-wipe-universal;
      animation-duration: var(--pre-wipe-duration);
      animation-delay: var(--pre-wipe-delay);
      animation-timing-function: linear;
      animation-fill-mode: forwards;
    }

    .lyrics-syllable.pre-highlight.rtl-text {
      animation-name: pre-wipe-universal-rtl;
    }

    .lyrics-syllable.transliteration {
      font-size: var(--lyplus-font-size-subtext);
      white-space: pre-wrap;
      pointer-events: none;
      user-select: none;
    }

    /* Syllable with chars: make syllable transparent, chars handle color */
    .lyrics-line .lyrics-syllable.has-chars:not(.finished) {
      background-color: transparent;
      color: transparent;
    }

    .char-motion {
      display: inline-block;
      vertical-align: baseline;
      transform-origin: 50% 80%;
    }

    .lyrics-syllable .char-motion > .char {
      transform: none !important;
    }

    .reduced-motion .char-motion {
      transform: none !important;
    }

    .lyrics-syllable span.char {
      display: inline-block;
      background-color: var(--lyplus-text-secondary);
      white-space: break-spaces;
      font-variant-ligatures: none;
      font-feature-settings: 'liga' 0;
      background-clip: text;
      -webkit-background-clip: text;
      position: relative;
      padding-inline: 0.04em;
      margin-inline: -0.04em;
      background-origin: content-box;
      -webkit-text-fill-color: transparent;
      transform-origin: 50% 80%;
      transition:
        color 0.7s,
        background-color 0.7s,
        transform 0.7s ease;
    }

    /* Paint the glow once, then composite its opacity. Animating text-shadow
       on every glyph forces text rasterization throughout the rise. */
    .lyrics-line.active .char.native-motion[data-glow]::after {
      content: attr(data-glyph);
      position: absolute;
      inset: 0;
      padding-inline: 0.04em;
      pointer-events: none;
      color: transparent;
      -webkit-text-fill-color: transparent;
      text-shadow: 0 0 0.3em var(--lyplus-text-primary);
      animation: char-glow var(--char-glow-duration) linear
        var(--char-glow-delay) both;
    }

    @keyframes char-glow {
      0%,
      100% {
        opacity: 0;
      }
      15% {
        opacity: calc(0.8 * var(--char-glow-max, 0));
      }
      30% {
        opacity: var(--char-glow-max, 0);
      }
      60% {
        opacity: calc(0.3 * var(--char-glow-max, 0));
      }
    }

    .reduced-motion .char::after {
      display: none;
    }

    .lyrics-syllable.finished span.char {
      background-color: var(--lyplus-text-primary);
      transition:
        color 0.7s,
        background-color 0.7s,
        transform 0.7s ease;
    }

    .lyrics-word.char-drag span.char {
      transition: color 0.18s;
    }

    /* Active char spans: structural only, wipe animation sets gradient */
    .lyrics-line.active .lyrics-syllable span.char {
      background-clip: text;
      -webkit-background-clip: text;
      background-repeat: no-repeat;
      /* Each glyph samples the same segment-wide gradient at its own x offset. */
      background-image: linear-gradient(
        90deg,
        var(--lyplus-text-primary, #fff) 0%,
        var(--lyplus-text-primary, #fff)
          calc(100% - var(--wipe-gradient-width, 0.75em)),
        #0000 100%
      );
      background-size: calc(
          var(--word-wipe-width, 1ch) + var(--wipe-gradient-width, 0.75em)
        )
        100%;
      background-position: calc(
          var(--char-wipe-position, 0px) - var(--word-wipe-width, 1ch) - var(
              --wipe-gradient-width,
              0.75em
            )
        )
        0%;
      transition:
        transform 0.7s ease,
        color 0.18s;
    }

    .lyrics-line.active .lyrics-syllable span.char.highlight {
      background-image: linear-gradient(
        -90deg,
        var(--lyplus-text-primary, #fff) 0%,
        var(--lyplus-text-primary, #fff)
          calc(100% - var(--wipe-gradient-width, 0.75em)),
        #0000 100%
      );
      background-size: 0% 100%;
      background-position: right 0%;
    }

    .lyrics-line.active .lyrics-syllable span.char.pre-wipe-lead {
      animation-name: char-word-wipe;
      animation-duration: var(--pre-wipe-duration);
      animation-delay: var(--pre-wipe-delay);
      animation-timing-function: linear;
      animation-fill-mode: forwards;
    }

    /* Joined syllables share one gradient edge. */
    .lyrics-line .lyrics-word .lyrics-syllable.shared-word-wipe,
    .lyrics-line .lyrics-word .lyrics-syllable span.char.shared-word-wipe {
      color: var(--word-wipe-color, var(--lyplus-text-primary));
      -webkit-text-fill-color: transparent;
      background-repeat: no-repeat;
      background-image: linear-gradient(
        90deg,
        currentColor 0%,
        currentColor calc(100% - var(--wipe-gradient-width, 0.75em)),
        transparent 100%
      ) !important;
      background-size: calc(
          var(--word-wipe-width) + var(--wipe-gradient-width, 0.75em)
        )
        100%;
      transition:
        color 0ms,
        background-color 0.7s,
        transform 1s ease;
    }

    .lyrics-line .lyrics-word .lyrics-syllable.shared-word-wipe.word-wipe-rtl,
    .lyrics-line
      .lyrics-word
      .lyrics-syllable
      span.char.shared-word-wipe.word-wipe-rtl {
      background-image: linear-gradient(
        -90deg,
        currentColor 0%,
        currentColor calc(100% - var(--wipe-gradient-width, 0.75em)),
        transparent 100%
      ) !important;
    }

    /* Colour recedes with the scroll; character transforms keep their clocks. */
    .lyrics-container:not(.is-unsynced)
      .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap),
    .lyrics-container:not(.is-unsynced) .lyrics-line.scroll-exiting {
      transition:
        opacity var(--scroll-duration, 350ms) ease-out,
        transform 0.4s cubic-bezier(0.41, 0, 0.12, 0.99)
          var(--lyrics-line-delay, 0ms),
        filter var(--scroll-duration, 350ms) ease-out;
    }

    .lyrics-container:not(.is-unsynced)
      .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap)
      .lyrics-syllable,
    .lyrics-container:not(.is-unsynced)
      .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap)
      .lyrics-syllable
      span.char,
    .lyrics-container:not(.is-unsynced)
      .lyrics-line.scroll-exiting
      .lyrics-syllable,
    .lyrics-container:not(.is-unsynced)
      .lyrics-line.scroll-exiting
      .lyrics-syllable
      span.char {
      transition:
        color var(--scroll-duration, 350ms) ease-out,
        background-color var(--scroll-duration, 350ms) ease-out,
        opacity var(--scroll-duration, 350ms) ease-out,
        transform 0.7s ease;
    }

    .lyrics-container:not(.is-unsynced)
      .lyrics-line.scroll-exiting
      .lyrics-syllable.no-chars:not(.line-synced),
    .lyrics-container:not(.is-unsynced)
      .lyrics-line.scroll-exiting
      .lyrics-syllable
      span.char {
      color: transparent !important;
      background-color: var(
        --word-inactive-color,
        var(--lyplus-text-secondary)
      ) !important;
    }

    .lyrics-line.scroll-exiting .char::after {
      opacity: 0 !important;
    }

    .lyrics-container:not(.is-unsynced)
      .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap)
      .lyrics-syllable.no-chars:not(.line-synced),
    .lyrics-container:not(.is-unsynced)
      .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap)
      .lyrics-syllable
      span.char {
      background-image: none !important;
      background-color: var(
        --word-inactive-color,
        var(--lyplus-text-secondary)
      ) !important;
    }

    /* Instrumental gap styles */
    .lyrics-gap {
      --gap-scale: 0;
      --gap-opacity: 0;
      display: flex;
      align-items: center;
      height: 0;
      padding: 0 var(--lyplus-padding-line);
      margin-block-end: 0;
      overflow: visible;
      opacity: 1;
      box-sizing: border-box;
      background-clip: unset;
      transform-origin: top;
      content-visibility: visible !important;
      contain: none !important;
      transition: transform var(--scroll-duration, 280ms);
    }

    .lyrics-gap.active {
      height: calc(
        var(--am-lyrics-instrumental-height) +
          var(--am-lyrics-instrumental-spacing)
      );
      transition: transform var(--scroll-duration, 280ms);
    }

    /* Reclaim the row from the first predictive-scroll frame, after the dot
       pop has finished, so the reflow and scroll share one curve. */
    .lyrics-gap.gap-collapsing {
      height: 0;
      transition: transform var(--scroll-duration, 280ms);
    }

    .lyrics-gap .main-vocal-container {
      position: absolute;
      inset-block-start: calc(0px - var(--am-lyrics-line-spacing));
      inset-inline-start: var(--lyplus-padding-line);
      display: flex;
      align-items: center;
      /* The preceding lyric already owns the normal line spacing. Include it
         in the dot layer so the dots sit midway between the surrounding lyric
         boxes, including while the instrumental row expands or collapses. */
      height: calc(
        var(--am-lyrics-instrumental-height) +
          var(--am-lyrics-instrumental-spacing) + var(--am-lyrics-line-spacing)
      );
      margin: 0;
      line-height: 1;
      opacity: 0;
      transform: scale(0);
      transform-origin: center center;
      transition:
        opacity var(--scroll-duration, 400ms) cubic-bezier(0.4, 0, 0.6, 1),
        transform var(--scroll-duration, 400ms) cubic-bezier(0.2, 0, 0.2, 1);
      will-change: transform, opacity;
    }

    .lyrics-gap.active .main-vocal-container {
      opacity: var(--gap-opacity);
      transform: scale(var(--gap-scale));
      transition: none;
    }

    .lyrics-gap.gap-collapsing .main-vocal-container,
    .lyrics-gap.gap-exiting .main-vocal-container {
      height: calc(
        var(--am-lyrics-instrumental-height) +
          var(--am-lyrics-instrumental-spacing) + var(--am-lyrics-line-spacing)
      );
    }

    .lyrics-gap.gap-exiting .main-vocal-container {
      opacity: var(--gap-exit-opacity, 0);
      transform: scale(
        var(--gap-exit-scale, var(--am-lyrics-instrumental-exit-scale))
      );
      transition: none;
    }

    .lyrics-gap .lyrics-word,
    .lyrics-gap .lyrics-syllable-wrap {
      display: flex;
      align-items: center;
      height: 100%;
    }

    .lyrics-gap .lyrics-syllable {
      display: inline-block;
      width: var(--lyplus-gap-dot-size);
      height: var(--lyplus-gap-dot-size);
      background-color: var(--lyplus-text-primary);
      border-radius: 50%;
      margin: 0 var(--lyplus-gap-dot-margin);
    }

    /* Line-synced lyrics should fade in instantly/quickly instead of wiping */
    .lyrics-syllable.line-synced {
      background: transparent !important;
      color: var(--lyplus-lyrics-palette) !important;
      opacity: 55%;
    }

    /* Line-timed text lights up with predictive scrolling. Keeping the same
       animation in both states avoids restarting the fade at its timestamp. */
    .lyrics-line:is(.active, .pre-active) .lyrics-syllable.line-synced {
      animation: fade-in-line 0.2s ease-out forwards !important;
      color: var(--lyplus-text-primary) !important;
    }

    .lyrics-line:is(.active, .pre-active)
      .lyrics-syllable.line-synced
      span.char {
      background-image: none !important;
      background-color: var(--lyplus-text-primary) !important;
      transition: background-color 120ms ease-out !important;
    }

    @keyframes fade-in-line {
      from {
        opacity: 0.5;
        color: var(--lyplus-text-secondary);
      }
      to {
        opacity: 1;
        color: var(--lyplus-lyrics-palette);
      }
    }

    .lyrics-gap .lyrics-syllable {
      background-color: var(--lyplus-text-primary);
      background-clip: unset;
      opacity: var(--gap-dot-opacity, 0.25);
    }

    .lyrics-gap.active .lyrics-syllable.finished,
    .lyrics-gap.gap-exiting .lyrics-syllable.finished,
    .lyrics-gap:not(.active):not(.gap-exiting).post-active-line
      .lyrics-syllable,
    .lyrics-gap:not(.active):not(.gap-exiting).lyrics-activest
      .lyrics-syllable {
      background-color: var(--lyplus-text-primary);
      animation: none !important;
    }

    /* Metadata & footer styles */
    .lyrics-plus-metadata {
      display: block;
      position: relative;
      box-sizing: border-box;
      font-weight: normal;
      transform: translateY(var(--lyrics-scroll-offset, 0px));
      transition:
        opacity 0.3s ease,
        transform 0.6s cubic-bezier(0.23, 1, 0.32, 1)
          var(--lyrics-line-delay, 0ms),
        filter 0.3s ease;
    }

    .lyrics-plus-empty {
      display: block;
      height: 100vh;
      transform: translateY(var(--lyrics-scroll-offset, 0px));
    }

    .lyrics-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      text-align: left;
      font-size: calc(var(--lyplus-font-size-base) * 0.5);
      color: var(--lyplus-text-secondary);
      padding: 20px 0 50vh 0;
      margin-top: 10px;
      font-weight: 400;
      opacity: 0.8;
      transition:
        opacity 0.3s ease,
        transform 0.5s cubic-bezier(0.41, 0, 0.12, 0.99),
        filter 0.3s ease;
      transform-origin: left;
    }

    .lyrics-footer.lyrics-line {
      font-size: calc(var(--lyplus-font-size-base) * 0.5);
      padding: 20px var(--lyplus-padding-line) 50vh var(--lyplus-padding-line);
      margin-top: 0;
      margin-block-end: 0;
    }

    .lyrics-footer.active {
      opacity: 1;
      color: rgba(255, 255, 255, 0.5); /* Grey instead of primary */
    }

    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-footer:not(.active) {
      filter: blur(var(--lyplus-blur-amount));
      opacity: 0.5;
    }

    .lyrics-container.user-scrolling .lyrics-footer {
      transition: none !important;
      filter: none !important;
      opacity: 0.8 !important;
    }

    .lyrics-footer p {
      margin: 5px 0;
    }

    .lyrics-footer a {
      color: var(--lyplus-text-primary); /* Stand out using primary color */
      text-underline-offset: 2px;
      opacity: 0.8;
      transition: opacity 0.2s;
    }

    .lyrics-footer a:hover {
      opacity: 1;
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

    /* Header & controls */
    .lyrics-header {
      display: flex;
      position: absolute;
      z-index: 2;
      inset: 10px var(--am-lyrics-inline-padding) auto;
      height: 40px;
      padding: 0;
      margin: 0;
      gap: 10px;
      justify-content: space-between;
      align-items: center;
    }

    .lyrics-header .download-button {
      position: relative;
      width: 40px;
      height: 40px;
      justify-content: center;
      background: transparent;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      color: color-mix(in srgb, var(--lyplus-text-primary) 62%, transparent);
      padding: 0;
      margin: 0;
      vertical-align: middle;
      display: inline-flex;
      align-items: center;
      font-family: inherit;
      box-shadow: none;
      transition:
        color 160ms ease-out,
        background-color 160ms ease-out,
        box-shadow 160ms ease-out,
        transform 120ms ease-out;
    }

    .lyrics-header .download-button:hover {
      color: var(--lyplus-text-primary);
      background: transparent;
      box-shadow: none;
    }

    .lyrics-header .download-button.active {
      color: var(--lyplus-text-primary);
      background: transparent;
    }

    .lyrics-header .download-button:active:not(:disabled) {
      transform: scale(0.96);
    }

    .lyrics-header .download-button:focus-visible,
    .source-switch-btn:focus-visible,
    .format-select:focus-visible {
      outline: 2px solid
        color-mix(in srgb, var(--lyplus-text-primary) 72%, transparent);
      outline-offset: 2px;
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

    .source-switch-btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      box-sizing: border-box;
      height: 26px;
      padding: 0 8px;
      border: 0;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      color: #aaa;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
      transition:
        color 0.2s ease,
        border-color 0.2s ease,
        background-color 0.2s ease,
        transform 0.12s ease;
    }

    .source-switch-btn:active:not(:disabled) {
      transform: scale(0.96);
    }

    .source-switch-btn:disabled {
      cursor: default;
      opacity: 0.7;
    }

    .source-switch-svg {
      flex: 0 0 12px;
      width: 12px;
      height: 12px;
      margin-right: 4px;
    }

    .source-switch-svg.is-loading {
      animation: source-switch-spin 1s linear infinite;
    }

    .control-button {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 0.8em;
      color: rgba(255, 255, 255, 0.6);
      cursor: pointer;
      transition:
        color 0.2s,
        border-color 0.2s,
        background-color 0.2s;
      font-weight: normal;
    }

    .control-button:hover {
      color: rgba(255, 255, 255, 0.9);
      border-color: rgba(255, 255, 255, 0.5);
    }

    .control-button.active {
      background-color: var(--lyplus-text-primary);
      border-color: var(--lyplus-text-primary);
      color: #000;
    }

    .format-select {
      box-sizing: border-box;
      flex: 0 0 auto;
      height: 28px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      color: rgba(255, 255, 255, 0.6);
      font-size: 12px;
      line-height: normal;
      margin-left: 0;
      padding: 0 6px;
      cursor: pointer;
      font-weight: normal;
      font-family: inherit;
    }

    .format-select:hover {
      color: rgba(255, 255, 255, 0.9);
      border-color: rgba(255, 255, 255, 0.5);
    }

    .format-select option {
      background: #1a1a1a;
      color: #fff;
    }

    /* Translation & romanization */
    .lyrics-translation-container,
    .lyrics-romanization-container {
      padding-top: 0.2em;
      opacity: 0.8;
      font-size: var(--lyplus-font-size-subtext);
      overflow-wrap: break-word;
      pointer-events: none;
      user-select: none;
      transition:
        opacity 0.3s ease,
        color 0.3s;
      font-weight: normal;
    }

    .lyrics-romanization-container {
      direction: ltr !important;
    }

    .lyrics-romanization-container.rtl-text {
      direction: rtl !important;
      text-align: right;
    }

    .lyrics-romanization-container .lyrics-syllable {
      white-space: pre-wrap;
    }

    .lyrics-translation-container {
      opacity: 0.5;
    }

    .main-line-wrapper.small {
      font-size: 0.5em;
      opacity: 0.8;
      display: block;
      margin-bottom: 0px;
    }

    .translation-line {
      font-size: 1em;
      font-weight: bold;
      display: block;
      margin-top: 0px;
      line-height: 1.1;
    }

    .romanized-line {
      font-size: 0.5em;
      color: rgba(255, 255, 255, 0.5);
      display: block;
      margin-top: 2px;
      font-weight: normal;
    }

    /* Skeleton loading */
    @keyframes skeleton-loading {
      0% {
        background-color: rgba(255, 255, 255, 0.1);
      }
      100% {
        background-color: rgba(255, 255, 255, 0.2);
      }
    }

    .skeleton-line {
      height: 2.5em;
      margin: 0 0 var(--am-lyrics-line-spacing);
      border-radius: 16px;
      animation: skeleton-loading 1s linear infinite alternate;
      opacity: 0.7;
      width: 60%;
    }

    .skeleton-line:nth-child(even) {
      width: 80%;
    }
    .skeleton-line:nth-child(3n) {
      width: 50%;
    }
    .skeleton-line:nth-child(5n) {
      width: 70%;
    }

    .no-lyrics {
      color: rgba(255, 255, 255, 0.5);
      font-size: 1.2em;
      text-align: center;
      padding: 2em;
      font-weight: normal;
    }

    /* Keyframe animations */

    @keyframes source-switch-spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* Wipe animation for syllables */
    @keyframes wipe {
      from {
        background-size: 0% 100%;
        background-position: left;
      }
      to {
        background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
        background-position: left;
      }
    }

    @keyframes wipe-from-pre {
      from {
        background-size: var(--wipe-gradient-width, 0.75em) 100%;
        background-position: left;
      }
      to {
        background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
        background-position: left;
      }
    }

    @keyframes start-wipe {
      0% {
        background-size: 0% 100%;
        background-position: left;
      }
      100% {
        background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
        background-position: left;
      }
    }

    @keyframes wipe-rtl {
      from {
        background-size: 0% 100%;
        background-position: right 0%;
      }
      to {
        background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
        background-position: right 0%;
      }
    }

    @keyframes wipe-from-pre-rtl {
      from {
        background-size: var(--wipe-gradient-width, 0.75em) 100%;
        background-position: right 0%;
      }
      to {
        background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
        background-position: right 0%;
      }
    }

    @keyframes start-wipe-rtl {
      0% {
        background-size: 0% 100%;
        background-position: right 0%;
      }
      100% {
        background-size: calc(100% + var(--wipe-gradient-width, 0.75em)) 100%;
        background-position: right 0%;
      }
    }

    @keyframes pre-wipe-universal {
      from {
        background-size: 0% 100%;
        background-position: left;
      }
      to {
        background-size: var(--wipe-gradient-width, 0.75em) 100%;
        background-position: left;
      }
    }

    @keyframes pre-wipe-universal-rtl {
      from {
        background-size: 0% 100%;
        background-position: right 0%;
      }
      to {
        background-size: var(--wipe-gradient-width, 0.75em) 100%;
        background-position: right 0%;
      }
    }

    /* One moving edge in text coordinates, independent of glyph rise/scale.
       LyricsBlossom's glyph draw loop (RVA 0x2f6aa0) likewise reuses the paint
       prepared before the loop instead of restarting a wipe for each glyph. */
    @keyframes char-word-wipe {
      from {
        background-position: calc(
            var(--char-wipe-position, 0px) - var(--word-wipe-width, 1ch) - var(
                --wipe-gradient-width,
                0.75em
              )
          )
          0%;
      }
      to {
        background-position: var(--char-wipe-position, 0px) 0%;
      }
    }

    @keyframes fade-gap {
      from {
        background-color: var(--lyplus-text-secondary);
      }
      to {
        background-color: var(--lyplus-text-primary);
      }
    }

    /* Character grow animation — translate3d+scale3d for smooth transform,
       drop-shadow for glow */
    @keyframes grow-static {
      0%,
      100% {
        transform: scale3d(1.01, 1.01, 1.1) translateY(-0.05%);
        text-shadow: 0 0 0
          color-mix(in srgb, var(--lyplus-lyrics-palette), transparent 100%);
      }
      30%,
      40% {
        transform: scale3d(1.1, 1.1, 1.1) translateY(-0.05%);
        text-shadow: 0 0 0.3em
          color-mix(in srgb, var(--lyplus-lyrics-palette), transparent 50%);
      }
    }

    /* Fade in animation */
    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 0.7;
        transform: translateY(0);
      }
    }

    /* Legacy support */
    .opposite-turn {
      text-align: right;
    }

    .singer-right {
      text-align: right;
      justify-content: flex-end;
    }

    .singer-left {
      text-align: left;
      justify-content: flex-start;
    }

    /* Legacy progress-text for backward compatibility */
    .progress-text {
      position: relative;
      display: inline-block;
      background: linear-gradient(
        to right,
        var(--lyplus-text-primary) 0%,
        var(--lyplus-text-primary) var(--line-progress, 0%),
        var(--lyplus-text-secondary) var(--line-progress, 0%),
        var(--lyplus-text-secondary) 100%
      );
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: var(--lyplus-text-secondary);
      transform: translate3d(0, 0, 0);
    }

    .progress-text::before {
      display: none;
    }

    .active-line {
      font-weight: bold;
    }

    .background-text {
      display: block;
      color: var(--lyplus-text-secondary);
      font-size: 0.8em;
      font-style: normal;
      margin: 0;
      flex-shrink: 0;
      line-height: 1.1;
    }

    .background-text.before {
      order: -1;
    }

    .background-text.after {
      order: 1;
    }

    .instrumental-line {
      display: inline-flex;
      align-items: baseline;
      gap: 8px;
      color: var(--lyplus-text-secondary);
      font-size: 0.9em;
      padding: 4px 10px;
      animation: fadeInUp 220ms ease;
      font-weight: normal;
    }

    .instrumental-duration {
      color: var(--lyplus-text-secondary);
      font-size: 0.8em;
    }

    @container (max-width: 519px) {
      .lyrics-container {
        --lyplus-font-size-base: var(--am-lyrics-compact-font-size, 28px);
        --am-lyrics-line-spacing: var(--am-lyrics-compact-line-spacing, 20px);
        --am-lyrics-background-vocal-font-size: var(
          --am-lyrics-compact-background-vocal-font-size,
          0.857em
        );
        --lyrics-scroll-padding-top: var(
          --am-lyrics-compact-selected-position,
          18%
        );
        --am-lyrics-inline-padding: 14px;
      }
    }

    @container (min-width: 900px) {
      .lyrics-container {
        --lyplus-font-size-base: var(--am-lyrics-wide-font-size, 48px);
        --am-lyrics-line-height: 1.17;
        --am-lyrics-line-spacing: var(--am-lyrics-wide-line-spacing, 32px);
        --am-lyrics-background-vocal-font-size: var(
          --am-lyrics-wide-background-vocal-font-size,
          0.667em
        );
        --lyrics-scroll-padding-top: var(
          --am-lyrics-wide-selected-position,
          20%
        );
        --am-lyrics-inline-padding: 32px;
      }
    }

    @media (prefers-contrast: more) {
      :host {
        --lyplus-text-secondary: color-mix(
          in srgb,
          var(--lyplus-lyrics-palette),
          transparent 24%
        );
      }

      .lyrics-line:focus-visible::before {
        box-shadow: 0 0 0 3px var(--lyplus-text-primary);
      }
    }

    :host([no-blur]) .lyrics-line {
      filter: none !important;
      transition-property: opacity, transform !important;
    }

    /* Keep geometry and keyboard seeking intact when played lines fade out. */
    :host([hide-played-lines])
      .lyrics-container:not(.user-scrolling):not(.touch-scrolling)
      .lyrics-line.played:not(:focus-within) {
      opacity: 0;
      pointer-events: none;
    }

    .lyrics-container.reduced-motion .lyrics-line,
    .lyrics-container.reduced-motion .lyrics-line::before,
    .lyrics-container.reduced-motion .lyrics-line-container,
    .lyrics-container.reduced-motion .main-vocal-container,
    .lyrics-container.reduced-motion .background-vocal-container,
    .lyrics-container.reduced-motion .background-vocal-wrap,
    .lyrics-container.reduced-motion .lyrics-plus-metadata,
    .lyrics-container.reduced-motion .lyrics-footer {
      animation: none !important;
      transition: none !important;
    }

    .lyrics-container.reduced-motion .lyrics-line,
    .lyrics-container.reduced-motion .lyrics-line-container,
    .lyrics-container.reduced-motion .main-vocal-container,
    .lyrics-container.reduced-motion .background-vocal-wrap,
    .lyrics-container.reduced-motion .lyrics-syllable,
    .lyrics-container.reduced-motion .lyrics-word.normal-word-motion,
    .lyrics-container.reduced-motion .lyrics-syllable span.char {
      transform: none !important;
    }

    /* Word wipes carry timing information; only disable character decoration. */
    .lyrics-container.reduced-motion .lyrics-syllable span.char {
      filter: none !important;
      transition: none !important;
    }
  `;

  @property({ type: String })
  query?: string;

  @property({ type: String })
  musicId?: string;

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
          target.style.backgroundColor = 'var(--lyplus-text-secondary)';
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
    const oldValue = this._currentTime;

    if (oldValue - value > 32 && !this.shouldReduceMotion) {
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
    if (oldValue !== value && this.lyrics) {
      this._onTimeChanged(oldValue, value);
    }
  }

  get currentTime(): number {
    return this._currentTime;
  }

  @state()
  private isLoading = false;

  @state()
  private lyrics?: LyricsLine[];

  private activeLineIndices: number[] = [];

  @state()
  private lyricsSource: string | null = null;

  @state()
  private availableSources: YouLyPlusLyricsResult[] = [];

  @state()
  private currentSourceIndex = 0;

  private isFetchingAlternatives = false;

  private hasFetchedAllProviders = false;

  private _updateFooter() {
    const footer = this.shadowRoot?.querySelector('.lyrics-footer');
    if (!footer) return;
    const switchBtn = footer.querySelector('.source-switch-btn');
    const svgEl = footer.querySelector('.source-switch-svg');
    const labelEl = footer.querySelector('.source-switch-label');
    if (switchBtn) {
      (switchBtn as HTMLButtonElement).disabled = this.isFetchingAlternatives;
    }
    if (svgEl) {
      svgEl.classList.toggle('is-loading', this.isFetchingAlternatives);
    }
    if (labelEl) {
      labelEl.textContent = this.isFetchingAlternatives
        ? 'Switching...'
        : 'Switch';
    }
  }

  @query('.lyrics-container')
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
  }> | null = null;

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

  private positionedLineElements: HTMLElement[] = [];

  private activeGapLineElements: HTMLElement[] = [];

  // Bound handler references for proper event listener removal
  private _boundHandleUserScroll = this.handleUserScroll.bind(this);

  connectedCallback() {
    super.connectedCallback();
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
    // Cancel any in-flight fetch to prevent stale results from racing
    this.fetchAbortController?.abort();
    const controller = new AbortController();
    this.fetchAbortController = controller;

    this.isLoading = true;
    this.lyrics = undefined;
    this.lyricsSource = null;
    this.availableSources = [];
    this.currentSourceIndex = 0;
    this.isFetchingAlternatives = false;
    this.hasFetchedAllProviders = false;
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
      );
      if (controller.signal.aborted) return;
      if (lrcRedResult) {
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

      const resolvedMetadata = await this.resolveSongMetadata();
      // If a newer fetch was triggered while we awaited, bail out
      if (controller.signal.aborted) return;

      const isMusicIdOnlyRequest =
        Boolean(this.musicId) &&
        !this.songTitle &&
        !this.songArtist &&
        !this.query &&
        !this.isrc;

      const collectedSources: YouLyPlusLyricsResult[] = [];

      if (resolvedMetadata?.metadata && !isMusicIdOnlyRequest) {
        const title = resolvedMetadata.metadata.title?.trim() || '';
        const artist = resolvedMetadata.metadata.artist?.trim() || '';

        const biniResult = await AmLyrics.fetchLyricsFromBiniLyrics(
          title,
          artist,
          resolvedMetadata.catalogIsrc,
          resolvedMetadata.metadata,
        );
        if (biniResult && biniResult.lines.length > 0) {
          collectedSources.push(biniResult);
        }

        const hasWordSync = (sources: YouLyPlusLyricsResult[]) =>
          sources.some(s =>
            s.lines.some(l => l.isWordSynced || (l.text && l.text.length > 1)),
          );

        if (collectedSources.length === 0 || !hasWordSync(collectedSources)) {
          const unisonResult = await AmLyrics.fetchLyricsFromUnison(
            resolvedMetadata.metadata,
          );
          if (unisonResult && unisonResult.lines.length > 0) {
            collectedSources.push(unisonResult);
          }
        }

        if (collectedSources.length === 0 || !hasWordSync(collectedSources)) {
          const youLyResults = await AmLyrics.fetchLyricsFromYouLyPlus(
            title,
            artist,
            resolvedMetadata.catalogIsrc,
            resolvedMetadata.metadata,
            true,
          );

          if (youLyResults && youLyResults.length > 0) {
            collectedSources.push(...youLyResults);
          }
        }
      }

      const hasLineSync = (sources: YouLyPlusLyricsResult[]) =>
        sources.some(s => s.lines.some(l => l.timestamp > 0 || l.endtime > 0));

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

      this.hasFetchedAllProviders =
        collectedSources.length === 0 ||
        collectedSources.some(
          s => s.source === 'LRCLIB' || s.source === 'Genius',
        );
      this._updateFooter();

      if (collectedSources.length > 0) {
        this.availableSources = AmLyrics.mergeAndSortSources(collectedSources);

        this.currentSourceIndex = 0;
        const sourceResult = this.availableSources[0];
        this.lyrics = sourceResult.lines;
        this.lyricsSource = sourceResult.source;
        if (sourceResult.songwriters) {
          this.songwriters = sourceResult.songwriters;
        }
        await this.onLyricsLoaded();
        return;
      }

      this.lyrics = undefined;
      this.lyricsSource = null;
    } finally {
      // Only update loading state if this fetch wasn't superseded
      if (!controller.signal.aborted) {
        this.isLoading = false;
      }
    }
  }

  private async onLyricsLoaded() {
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

    if (!this.noAutoAlternates) await this.autoProcessLyrics();
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

  private static getRankForCollected(
    sourceLabel: string,
    parsedLines: any[],
  ): number {
    const lower = sourceLabel.toLowerCase();
    if (lower === 'lrc.red') return 0;
    const hasWordSync = parsedLines.some(
      (line: any) =>
        line.text && Array.isArray(line.text) && line.text.length > 1,
    );
    const isUnsynced =
      parsedLines.length > 0 &&
      parsedLines.every(
        (line: any) => line.timestamp === 0 && line.endtime === 0,
      );
    const isQQ = lower.includes('qq') || lower.includes('lyricsplus');

    if (lower.includes('apple') && hasWordSync) return 1;
    if (lower.includes('bini') && hasWordSync) return 2;
    if (lower.includes('unison') && hasWordSync) return 3;
    if (isQQ && hasWordSync) return 4;
    if (lower.includes('musixmatch') && hasWordSync) return 5;
    if (lower.includes('lrclib') && hasWordSync) return 6;
    if (hasWordSync) return 7;

    if (lower.includes('apple') && !hasWordSync && !isUnsynced) return 8;
    if (lower.includes('bini') && !hasWordSync && !isUnsynced) return 9;
    if (lower.includes('unison') && !hasWordSync && !isUnsynced) return 10;
    if (isQQ && !hasWordSync && !isUnsynced) return 11;
    if (lower.includes('musixmatch') && !hasWordSync && !isUnsynced) return 12;
    if (lower.includes('lrclib') && !hasWordSync && !isUnsynced) return 13;
    if (!hasWordSync && !isUnsynced) return 14;

    if (lower.includes('apple') && isUnsynced) return 15;
    if (lower.includes('bini') && isUnsynced) return 16;
    if (lower.includes('unison') && isUnsynced) return 17;
    if (isQQ && isUnsynced) return 18;
    if (lower.includes('musixmatch') && isUnsynced) return 19;
    if (lower.includes('lrclib') && isUnsynced) return 20;
    if (lower.includes('genius')) return 21;

    return 30;
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

    for (const source of collectedSources) {
      const normalizedSource = AmLyrics.getDisplaySourceLabel(source.source);

      if (!uniqueSourcesMap.has(normalizedSource)) {
        uniqueSourcesMap.set(normalizedSource, {
          ...source,
          source: normalizedSource,
        });
      }
    }

    return Array.from(uniqueSourcesMap.values()).sort(
      (a, b) =>
        AmLyrics.getRankForCollected(a.source, a.lines) -
        AmLyrics.getRankForCollected(b.source, b.lines),
    );
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
    this.lyrics = sourceResult.lines;
    this.lyricsSource = sourceResult.source;
    if (sourceResult.songwriters) {
      this.songwriters = sourceResult.songwriters;
    }
    await this.onLyricsLoaded();
  }

  private async switchSource() {
    if (this.isFetchingAlternatives) return;

    const currentSourceLabel = this.lyricsSource;
    const currentLines = this.lyrics;

    if (!this.hasFetchedAllProviders) {
      this.isFetchingAlternatives = true;
      this._updateFooter();
      try {
        const resolvedMetadata = await this.resolveSongMetadata();
        if (resolvedMetadata?.metadata) {
          const newSources: YouLyPlusLyricsResult[] = [];

          if (!this.availableSources.some(s => s.source === 'BiniLyrics')) {
            const biniResult = await AmLyrics.fetchLyricsFromBiniLyrics(
              resolvedMetadata.metadata.title,
              resolvedMetadata.metadata.artist,
              resolvedMetadata.catalogIsrc,
              resolvedMetadata.metadata,
            );
            if (biniResult) newSources.push(biniResult);
          }

          // Try Unison if not fetched
          if (
            !this.availableSources.some(s =>
              s.source.toLowerCase().includes('unison'),
            )
          ) {
            const unisonResult = await AmLyrics.fetchLyricsFromUnison(
              resolvedMetadata.metadata,
            );
            if (unisonResult && unisonResult.lines.length > 0) {
              newSources.push(unisonResult);
            }
          }

          // Try YouLyPlus (KPoe) if we don't have Apple or QQ
          if (
            !this.availableSources.some(
              s =>
                s.source.toLowerCase().includes('apple') ||
                s.source.toLowerCase().includes('qq'),
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
            if (youLyResults && youLyResults.length > 0) {
              newSources.push(...youLyResults);
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
            if (lrclibResult && lrclibResult.lines.length > 0) {
              newSources.push({ lines: lrclibResult.lines, source: 'LRCLIB' });
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
            if (geniusResult && geniusResult.lines.length > 0) {
              newSources.push({ lines: geniusResult.lines, source: 'Genius' });
            }
          }

          if (newSources.length > 0) {
            this.availableSources = AmLyrics.mergeAndSortSources([
              ...this.availableSources,
              ...newSources,
            ]);
            // Re-sync current index since sorting or label normalization can
            // shift the currently displayed source underneath the old index.
            this.currentSourceIndex = this.findCurrentSourceIndex(
              this.availableSources,
              currentSourceLabel,
              currentLines,
            );
          }
        }
      } finally {
        this.hasFetchedAllProviders = true;
        this.isFetchingAlternatives = false;
        this._updateFooter();
      }
    }

    if (this.availableSources.length > 1) {
      const currentIndex = this.findCurrentSourceIndex(
        this.availableSources,
        currentSourceLabel,
        currentLines,
      );
      const nextIndex = AmLyrics.getNextSourceIndex(
        this.availableSources,
        currentIndex,
        currentSourceLabel,
        currentLines,
      );
      if (nextIndex !== -1) {
        await this.applySourceAtIndex(nextIndex);
      }
    }
  }

  private async resolveSongMetadata(): Promise<ResolvedMetadata> {
    const metadata: SongMetadata = {
      title: this.songTitle?.trim() ?? '',
      artist: this.songArtist?.trim() ?? '',
      album: this.songAlbum?.trim() || undefined,
      songwriters: this.songwriters?.trim() || undefined,
      durationMs: undefined,
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
  ): Promise<YouLyPlusLyricsResult | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LRC_RED_TIMEOUT_MS);
    try {
      const fetchTTML = async (trackIsrc: string) => {
        try {
          const response = await fetch(
            `https://lrc.red/s/${encodeURIComponent(trackIsrc)}.ttml`,
            { signal: controller.signal },
          );
          if (!response.ok) return null;
          const originalTTML = await response.text();
          const parsed = AmLyrics.parseTTML(originalTTML);
          if (!parsed?.lines.length) return null;
          return {
            lines: parsed.lines,
            source: 'lrc.red',
            originalTTML,
            songwriters: parsed.songwriters,
          };
        } catch {
          return null;
        }
      };

      if (isrc) {
        const result = await fetchTTML(isrc);
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
          return await fetchTTML(hit.isrc.trim());
        }
      } catch {
        // Continue with the existing providers when lrc.red is unavailable.
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
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

    const getRank = (sourceLabel: string, parsedLines: any[]): number => {
      const lower = sourceLabel.toLowerCase();
      const hasWordSync = parsedLines.some(
        (line: any) =>
          line.text && Array.isArray(line.text) && line.text.length > 1,
      );

      const isUnsynced =
        parsedLines.length > 0 &&
        parsedLines.every(
          (line: any) => line.timestamp === 0 && line.endtime === 0,
        );

      const isQQ = lower.includes('qq') || lower.includes('lyricsplus');

      if (lower.includes('apple') && hasWordSync) return 1;
      if (lower.includes('bini') && hasWordSync) return 2;
      if (lower.includes('unison') && hasWordSync) return 3;
      if (isQQ && hasWordSync) return 4;
      if (lower.includes('musixmatch') && hasWordSync) return 5;
      if (hasWordSync) return 6;

      if (lower.includes('apple') && !hasWordSync && !isUnsynced) return 7;
      if (lower.includes('bini') && !hasWordSync && !isUnsynced) return 8;
      if (lower.includes('unison') && !hasWordSync && !isUnsynced) return 9;
      if (isQQ && !hasWordSync && !isUnsynced) return 10;
      if (lower.includes('musixmatch') && !hasWordSync && !isUnsynced)
        return 11;
      if (!hasWordSync && !isUnsynced) return 12;

      if (lower.includes('apple') && isUnsynced) return 13;
      if (lower.includes('bini') && isUnsynced) return 14;
      if (lower.includes('unison') && isUnsynced) return 15;
      if (isQQ && isUnsynced) return 16;
      if (lower.includes('musixmatch') && isUnsynced) return 17;

      return 30;
    };

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

          const rank = getRank(sourceLabel, lines);
          const result = { lines, source: sourceLabel };

          allResults.push(result);

          // If source is Apple synced, we have the best so we can just immediately break the sweep
          if (rank === 1) {
            break;
          }
        }
      }
    }

    // If we haven't found a completely synced result (rank 1 or 2) among the servers,
    // force an explicit query against lyricsplus.binimum.org looking for word lyrics
    const hasHighRankResult = allResults.some(
      r => getRank(r.source, r.lines) <= 2,
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
            const hasWordSync = lines?.some(
              (line: any) =>
                line.text && Array.isArray(line.text) && line.text.length > 1,
            );
            if (lines && lines.length > 0 && hasWordSync) {
              allResults.push({ lines, source: sourceLabel });
            }
          }
        }
      } catch (error) {
        // Explicit fallback failed, ignore
      }
    }

    return allResults;
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
            'User-Agent': `apple-music-web-components/${VERSION}`,
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
    metadata: SongMetadata,
  ): Promise<YouLyPlusLyricsResult | null> {
    const title = metadata.title?.trim();
    const artist = metadata.artist?.trim();
    if (!title || !artist) return null;

    const params = new URLSearchParams();
    params.append('song', title);
    params.append('artist', artist);
    if (metadata.album) {
      params.append('album', metadata.album);
    }
    if (metadata.durationMs && metadata.durationMs > 0) {
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
            return { lines, source: 'Unison (unsynced)' };
          }
        } else {
          const lines = AmLyrics.parseLrcSubtitles(lyricsText);
          if (lines.length > 0) {
            return { lines, source: 'Unison' };
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
  private _onTimeChanged(oldTime: number, newTime: number): void {
    if (this.hidePlayedLines) this.updatePlayedLines(newTime);
    const timeDiff = Math.abs(newTime - oldTime);
    const isSeek = timeDiff > SEEK_THRESHOLD_MS;

    const newActiveLines = this.findActiveLineIndices(newTime);
    const oldActiveLines = this.activeLineIndices;

    // Reset animation if active lines change or if we skip time.
    const linesChanged = !AmLyrics.arraysEqual(newActiveLines, oldActiveLines);

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
              if (!oldActiveLines.includes(lineIndex)) {
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
        this.updateInstrumentalGap(gap, newTime);
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
    if (changedProperties.has('lyrics')) {
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
      this._updateCachedIsUnsynced();
      // Recalculate timing data for accurate animations whenever lyrics change
      this._updateCharTimingData();

      // Apply 'active' classes imperatively after lyrics first render,
      // since the template no longer binds the 'active' class (to avoid
      // clobbering imperative scroll-animate classes on re-render).
      if (this.lyricsContainer && this.lyrics) {
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
    }

    if (lyricsDomBecameRenderable || changedProperties.has('hidePlayedLines')) {
      this.updatePlayedLines(this.currentTime);
    }
    if (this.pendingRenderLayout && !lyricsDomBecameRenderable) {
      this._updateCharTimingData();
      for (const line of this.backgroundExpandedLines) {
        const wrap = line.querySelector<HTMLElement>('.background-vocal-wrap');
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
      (changedProperties.has('query') ||
        changedProperties.has('musicId') ||
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
    if (!this.lyricsContainer || !this.lyrics || this.lyrics.length === 0) {
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
    let currentAudioIndex = -1;
    for (let i = 0; i < this.lyrics.length; i += 1) {
      if (this.lyrics[i].timestamp > this.currentTime) {
        currentAudioIndex = i - 1;
        break;
      }
    }
    if (currentAudioIndex === -1 && this.lyrics.length > 0) {
      if (this.currentTime >= this.lyrics[this.lyrics.length - 1].timestamp) {
        currentAudioIndex = this.lyrics.length - 1;
      }
    }

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
      }
      const remainingTime = Math.max(
        0,
        this.lyrics[nextLineIndex].timestamp - this.currentTime,
      );
      const blurEm =
        NEXT_LINE_BASE_BLUR_EM *
        AmLyrics.clamp(remainingTime / NEXT_LINE_UNBLUR_DURATION_MS, 0, 1);
      const blurValue = `blur(${blurEm.toFixed(4)}em)`;
      if (nextLineElement.style.filter !== blurValue) {
        nextLineElement.style.setProperty('filter', blurValue, 'important');
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
    }

    // Commit backing spacing before measuring the destination. Its displacement
    // and scrolling share the same spring rather than competing height tweens.
    const layoutChanged = this.setBackgroundExpandedLine(
      targetElement,
      true,
      predictiveActiveIndices,
      predictiveTime,
    );
    this.focusLine(targetElement, forceScroll || layoutChanged, scrollDuration);
    if (this.pendingLayoutOffsets.size)
      this.finishLyricLayout(this.captureLyricLayout());
  }

  private _rebuildDomCache() {
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
        this.lineElementCache.set(i, lineEl);
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
    this.cachedIsUnsynced = false;
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

  private _ensureLineDataCache() {
    if (this.cachedLineData || !this.lyrics) return;
    this.cachedLineData = this.lyrics.map(line => {
      const wordGroups: Syllable[][] = [];
      let group: Syllable[] = [];
      line.text.forEach((syllable, index) => {
        group.push(syllable);
        const next = line.text[index + 1];
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
      return {
        wordGroups,
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
      const syllable = group[0].querySelector<HTMLElement>('.lyrics-syllable');
      if (syllable) AmLyrics.getWordWipe(syllable);
    });
  }

  private static arraysEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((val, i) => val === b[i]);
  }

  private static isLineSyncedLine(line: LyricsLine | undefined): boolean {
    if (!line) return false;
    return line.isWordSynced === false || line.text.some(s => s.lineSynced);
  }

  private getLineHighlightEndTime(index: number): number {
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

  private updateInstrumentalGap(gap: HTMLElement, timeMs: number): void {
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
      animations.forEach(effect => {
        const timeline = effect;
        timeline.currentTime = elapsed;
      });
      motion = { animations, end };
      this.gapAnimations.set(gap, motion);
    } else if (
      Math.abs(
        Number(motion.animations[0].currentTime) -
          Math.min(elapsed, motion.end),
      ) > 200
    ) {
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
      Array.from(line.querySelectorAll<HTMLElement>('.main-vocal-container')),
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
        ? AmLyrics.sampleSpring(
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
        AmLyrics.createLineSpringFrames(position, pose.velocity),
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
        line?.querySelector('.background-vocal-wrap') &&
        this.lyrics?.[index].backgroundText.some(
          note => note.endtime > visibilityTime,
        )
      )
        desired.add(line);
    }
    if (lineElement?.querySelector('.background-vocal-wrap'))
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
      const wrap = line.querySelector<HTMLElement>('.background-vocal-wrap')!;
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
    for (const { line, wrap, pose, expanded, duration, height } of changes) {
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
      const destination = getComputedStyle(wrap);
      if (duration > 0) {
        const animation = wrap.animate(
          [
            pose,
            { opacity: destination.opacity, transform: destination.transform },
          ],
          { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
        );
        this.backgroundAnimations.set(line, animation);
        animation.onfinish = () => {
          if (this.backgroundAnimations.get(line) !== animation) return;
          animation.cancel();
          this.backgroundAnimations.delete(line);
          line.classList.remove('bg-collapsing');
        };
      }
    }
    this.finishLyricLayout(before, deferScroll);
    return true;
  }

  private clearBackgroundExpandedLine(): void {
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

    const primaryIndex = activeIndices.length
      ? activeIndices[activeIndices.length - 1]
      : this.getLineIndexAtTime(time, this.lastActiveIndex);
    if (primaryIndex === -1) return null;

    // Guard: if new primary is ahead of current but they share the same
    // end time, keep current to prevent bounce during overlaps.
    const currentPrimaryIndex = AmLyrics.getLineIndexFromElement(
      this.currentPrimaryActiveLine,
    );
    if (
      currentPrimaryIndex !== null &&
      primaryIndex > currentPrimaryIndex &&
      this.lyrics[currentPrimaryIndex] &&
      this.lyrics[primaryIndex] &&
      this.lyrics[currentPrimaryIndex].endtime ===
        this.lyrics[primaryIndex].endtime
    ) {
      const activeCount = this.findActiveLineIndices(time).length;
      if (activeCount <= 3) {
        return currentPrimaryIndex;
      }
    }

    return primaryIndex;
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
    const activeLines: number[] = [];

    for (let i = 0; i < this.lyrics.length; i += 1) {
      const line = this.lyrics[i];
      const highlightEndTime = this.getLineHighlightEndTime(i);

      if (line.timestamp > time) break;
      if (time >= line.timestamp && time < highlightEndTime) {
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

  /**
   * Find ALL instrumental gaps in the song, regardless of current time.
   * Used by the template to always render gap elements in the DOM.
   */
  private findAllInstrumentalGaps(): Array<{
    insertBeforeIndex: number;
    gapStart: number;
    gapEnd: number;
  }> {
    if (this.cachedAllGaps.length > 0) return this.cachedAllGaps;
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

  private static sampleSpring(
    position: number,
    velocity: number,
    time: number,
    frequency: number,
    damping = 0.9 * frequency,
  ): { position: number; velocity: number } {
    const omega = Math.sqrt(frequency * frequency - damping * damping);
    const decay = Math.exp(-damping * time);
    const cos = Math.cos(omega * time);
    const sin = Math.sin(omega * time);
    return {
      position:
        decay *
        (position * cos + ((velocity + damping * position) / omega) * sin),
      velocity:
        decay *
        (velocity * cos -
          ((damping * velocity + frequency * frequency * position) / omega) *
            sin),
    };
  }

  private static createLineSpringFrames(
    position: number,
    velocity: number,
    frequency = 10,
  ): Array<{ offset: number; translate: string }> {
    return Array.from({ length: 97 }, (_, frame) => {
      const offset = frame / 96;
      const y =
        frame === 96
          ? 0
          : AmLyrics.sampleSpring(position, velocity, 1.2 * offset, frequency)
              .position;
      return { offset, translate: `0 ${y}px` };
    });
  }

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
    const lines = Array.from(
      parent.querySelectorAll<HTMLElement>('.lyrics-line'),
    );
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
    const poses = lines.map((line, index) => {
      const previous = this.lineSprings.get(line);
      const age = previous
        ? Math.max(
            0,
            Number(previous.animation.currentTime || 0) / 1000 - previous.delay,
          )
        : 0;
      const pose = previous
        ? AmLyrics.sampleSpring(
            previous.position,
            previous.velocity,
            age,
            previous.frequency,
          )
        : { position: 0, velocity: 0 };
      const steps = requestedDelta >= 0 ? index - reference : reference - index;
      // Keep an in-flight cascade's remaining delays. A row that settled
      // early must not start a fresh stagger while its neighbours are moving.
      let delay = 0;
      if (this.lineMotion !== 'uniform') {
        if (retargeting && previous) {
          delay = Math.max(
            0,
            previous.delay - Number(previous.animation.currentTime || 0) / 1000,
          );
        } else if (!retargeting) {
          delay = Math.max(0, Math.min(4, steps)) * 0.05;
        }
      }
      return {
        line,
        index,
        position: pose.position + (this.pendingLayoutOffsets.get(line) || 0),
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
    parent.scrollTop = target;
    this.currentScrollOffset = -target;
    poses.forEach(
      ({ line, index, position: previousPosition, velocity, delay }) => {
        const position = previousPosition + delta;
        if (
          Math.abs(index - reference) > 20 ||
          (Math.abs(position) < 0.1 && Math.abs(velocity) < 0.1)
        )
          return;
        const duration = 1.2;
        const frames = AmLyrics.createLineSpringFrames(
          position,
          velocity,
          frequency,
        );
        line.style.setProperty('will-change', 'translate');
        const animation = line.animate(frames, {
          duration: duration * 1000,
          delay: delay * 1000,
          fill: 'both',
          easing: 'linear',
        });
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
        const fragmentWidth = Number.parseFloat(
          getComputedStyle(element).width,
        );
        // eslint-disable-next-line no-continue
        if (!Number.isFinite(fragmentWidth) || fragmentWidth <= 0) continue;
        fragments.push({ element, width: fragmentWidth, offset: width });
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
      epoch: start,
    };
    words.forEach(element => AmLyrics.wordWipes.set(element, wipe));
    return wipe;
  }

  private static startWordWipe(
    wipe: WordWipe,
    time: number,
    epoch = wipe.start,
  ): void {
    if (wipe.animations.length) return;
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
    wipe.syllables.forEach(syllable => {
      const target = syllable;
      target.style.animation = 'none';
    });
    for (const { element, width, offset } of wipe.fragments) {
      AmLyrics.applyWipeShape(element, wipe.count, wipe.cjk);
      element.style.setProperty('--word-wipe-width', `${wipe.width}px`);
      element.style.backgroundColor = 'var(--lyplus-text-secondary)';
      element.style.backgroundSize = `calc(${wipe.width}px + var(--wipe-gradient-width, 0.75em)) 100%`;
      element.style.animation = 'none';
      element.classList.add('shared-word-wipe');
      element.classList.toggle('word-wipe-rtl', wipe.rtl);
      const frames = stops.map(stop => {
        const x = wipe.rtl
          ? width + offset - stop.progress
          : -offset - wipe.width + stop.progress;
        const feather = (wipe.rtl ? !stop.pre : stop.pre)
          ? ' - var(--wipe-gradient-width, 0.75em)'
          : '';
        return {
          offset: stop.offset,
          backgroundPosition: `calc(${x}px${feather}) 0%`,
        };
      });
      const animation = element.animate(frames, {
        duration,
        easing: 'linear',
        fill: 'both',
      });
      animation.currentTime = Math.max(
        0,
        Math.min(time - startEpoch, duration),
      );
      AmLyrics.wipeClocks.set(animation, startEpoch);
      wipe.animations.push(animation);
    }
  }

  private static clearWordWipe(word: HTMLElement): void {
    const wipe = AmLyrics.wordWipes.get(word);
    if (!wipe || !wipe.animations.length) return;
    wipe.animations.forEach(animation => animation.cancel());
    wipe.animations = [];
    wipe.fragments.forEach(({ element }) => {
      element.classList.remove('shared-word-wipe', 'word-wipe-rtl');
      element.style.removeProperty('background-color');
      element.style.removeProperty('background-size');
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
    const isRTL = classList.contains('rtl-text');
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
      : 'var(--lyplus-text-secondary)';

    // Reset character animations — disable transition so finished chars don't slowly fade
    const charSpans = syllable.querySelectorAll('span.char');
    for (let i = 0; i < charSpans.length; i += 1) {
      const el = charSpans[i] as HTMLElement;
      el.style.animation = '';
      AmLyrics.clearCharacterMotion(el);
      el.style.transition = 'none';
      el.style.backgroundColor = 'var(--lyplus-text-secondary)';
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
        el.removeAttribute('data-glow');
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
    }>
  >();

  private static normalWordMotions = new WeakMap<
    HTMLElement,
    NormalWordMotion
  >();

  private static normalRiseClocks = new WeakMap<Animation, number>();

  private static normalWordFrames?: Array<{
    offset: number;
    transform: string;
  }>;

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
    if (!AmLyrics.normalWordFrames) {
      // Native whole-word spring: RVA 0x2f4efd, mass 1, stiffness 14, damping 7.
      AmLyrics.normalWordFrames = Array.from({ length: 65 }, (_, frame) => {
        const rise =
          frame === 64
            ? 1
            : 1 -
              AmLyrics.sampleSpring(
                1,
                0,
                ((NORMAL_WORD_SPRING_DURATION_MS / 1000) * frame) / 64,
                Math.sqrt(14),
                3.5,
              ).position;
        return {
          offset: frame / 64,
          transform: `translate3d(0, calc(var(--char-rise-y) * ${rise} * var(--am-lyrics-lift)), 0)`,
        };
      });
    }
    normalMotion.settled = false;
    normalMotion.animations = normalMotion.targets.map(target => {
      const animation = target.animate(AmLyrics.normalWordFrames!, {
        duration: NORMAL_WORD_SPRING_DURATION_MS,
        easing: 'linear',
        fill: 'both',
      });
      animation.currentTime = elapsed;
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
  ): void {
    const elapsed = time - start;
    if (elapsed < 0) {
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
      motion = { targets, animations: [], start, settled: false };
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
    }
  >();

  // Repeated syllable durations share sampled curves; bound memory across songs.
  private static characterFrames = new Map<
    string,
    Array<{ offset: number; transform: string; textShadow?: string }>
  >();

  private static characterAnimations = new WeakMap<
    HTMLElement,
    {
      animation: Animation;
      start: number;
      end: number;
      key: object;
      glowEpoch: number;
    }
  >();

  private static clearCharacterMotion(char: HTMLElement): void {
    const entry = AmLyrics.characterAnimations.get(char);
    if (!entry) return;
    entry.animation.cancel();
    AmLyrics.characterAnimations.delete(char);
    char.classList.remove('native-motion');
    char.removeAttribute('data-glow');
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
    syllables.forEach(syllable => {
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
        };
        AmLyrics.motionParameters.set(syllable, parameters);
      }
      const { chars, duration, start, cjk } = parameters;
      const count = chars.length;
      if (!count) return;
      const elapsed = timeMs - start;
      const staggerMs = ((duration * 1000) / count) * (cjk ? 0.4 : 0.35);
      const delayMs = cjk
        ? Math.min(staggerMs, 50, 200 / count)
        : Math.min(staggerMs, 350);
      const hold = (2 * duration) / count;
      const response = Math.min(3, duration);
      const emphasis = cjk ? 0 : AmLyrics.clamp(duration - 1, 0, 1);
      const glow = cjk ? 0 : 0.45 * AmLyrics.clamp((duration - 1) / 0.5, 0, 1);
      const spanDuration = Math.max(hold + response * 2, cjk ? 3 : 0);
      chars.forEach((char, index) => {
        const startDelay = (index + 1) * delayMs;
        // A backwards-filled delayed transform changes Chromium's glyph paint
        // before the character moves. Attach motion only when its stagger starts.
        if (elapsed < startDelay) {
          AmLyrics.clearCharacterMotion(char);
          return;
        }
        const end = spanDuration * 1000 + startDelay;
        const key = parameters;
        let entry = AmLyrics.characterAnimations.get(char);
        if (!entry || entry.key !== key) {
          AmLyrics.clearCharacterMotion(char);
          const frameKey = `${duration}:${count}:${emphasis ? index : 0}:${cjk}`;
          let frames = AmLyrics.characterFrames.get(frameKey);
          if (!frames) {
            frames = Array.from({ length: 61 }, (_, frame) => {
              const time = (spanDuration * frame) / 60;
              let rise = cjk
                ? 1 -
                  AmLyrics.sampleSpring(1, 0, time, Math.sqrt(14), 3.5).position
                : AmLyrics.springProgress(time, response);
              if (frame === 60) rise = 1;
              const envelope =
                frame === 60
                  ? 0
                  : AmLyrics.springProgress(time, response) *
                    (1 - AmLyrics.springProgress(time - hold, response));
              const x =
                (index - (count - 1) / 2) * 0.5 * 0.1 * emphasis * envelope;
              const lift = 2.5 * emphasis * envelope;
              return {
                offset: frame / 60,
                transform: `translate(calc(${x}em * var(--am-lyrics-lift)), calc((var(--char-rise-y) * ${rise} - ${lift}px) * var(--am-lyrics-lift))) scale(${1 + 0.1 * emphasis * envelope})`,
              };
            });
            if (AmLyrics.characterFrames.size >= 64) {
              AmLyrics.characterFrames.delete(
                AmLyrics.characterFrames.keys().next().value!,
              );
            }
            AmLyrics.characterFrames.set(frameKey, frames);
          }
          if (glow) {
            char.setAttribute('data-glyph', char.textContent || '');
            char.setAttribute('data-glow', '');
            char.style.setProperty('--char-glow-max', `${glow}`);
            char.style.setProperty(
              '--char-glow-duration',
              `${spanDuration * 1000}ms`,
            );
            char.style.setProperty(
              '--char-glow-delay',
              `${startDelay - elapsed}ms`,
            );
          }
          char.classList.add('native-motion');
          // Transform a separate wrapper. WebKit can expose rectangular clip
          // edges when the gradient-clipped glyph itself is transformed.
          const motionTarget = char.parentElement?.classList.contains(
            'char-motion',
          )
            ? char.parentElement
            : char;
          const animation = motionTarget.animate(frames, {
            duration: spanDuration * 1000,
            delay: startDelay,
            fill: 'both',
            easing: 'linear',
          });
          animation.currentTime = Math.min(elapsed, end);
          entry = { animation, start, end, key, glowEpoch: elapsed };
          AmLyrics.characterAnimations.set(char, entry);
        } else if (
          Math.abs(
            Number(entry.animation.currentTime) - Math.min(elapsed, entry.end),
          ) > 200
        ) {
          // Correct seeks/drift, not every playback tick: repeated currentTime
          // writes pin compositor motion to the host's timestamp frequency.
          entry.animation.currentTime = Math.min(elapsed, entry.end);
          if (glow) {
            for (const effect of char.getAnimations()) {
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

  private static springProgress(time: number, response: number): number {
    if (time <= 0) return 0;
    // Unit-mass critically damped spring, omega = 2 pi / response.
    // Native constructor: RVA 0x1559b0. Exact step response, no frame integration.
    const phase = (2 * Math.PI * time) / Math.max(0.001, response);
    return 1 - (1 + phase) * Math.exp(-phase);
  }

  private static seekLineWipes(line: HTMLElement, time: number): void {
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
      ).map(element => {
        const syllable = element.querySelector<HTMLElement>('.lyrics-syllable');
        return {
          element,
          start: Number(element.dataset.virtualWordStart),
          wipe: syllable ? AmLyrics.getWordWipe(syllable) : undefined,
          normal: Boolean(
            syllable &&
              !syllable.matches('.has-chars, .line-synced') &&
              !element.matches('.growable, .char-rise, .char-drag'),
          ),
        };
      });
      AmLyrics.motionWords.set(line, words);
    }
    words.forEach(({ element, start, wipe, normal }) => {
      const started = currentTimeMs >= start;
      if (element.classList.contains('word-started') !== started)
        element.classList.toggle('word-started', started);
      if (normal && !reduceMotion)
        AmLyrics.updateNormalWordMotion(element, start, currentTimeMs);
      if (!started) return;
      if (wipe) AmLyrics.startWordWipe(wipe, currentTimeMs);
    });
    if (!reduceMotion) AmLyrics.updateCharacterMotion(line, currentTimeMs);
    // DOM cache: avoid querySelectorAll on every frame
    let syllables: HTMLElement[] = (line as any)._cachedSyllableElements;
    if (!syllables) {
      syllables = Array.from(
        line.querySelectorAll('.lyrics-syllable'),
      ) as HTMLElement[];
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
                if (syllable.classList.contains('shared-word-wipe'))
                  syllable.style.removeProperty('background-color');
                AmLyrics.getCachedCharSpans(syllable).forEach(char => {
                  if (char.classList.contains('shared-word-wipe'))
                    char.style.removeProperty('background-color');
                });
                // Keep the completed wipe state until user scroll resets it.
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
      line => line.alignment !== 'end',
    );
    const hasRightAlignedLines = this.lyrics?.some(
      line => line.alignment === 'end',
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
        const backing = line.backgroundText || [];
        for (let first = 0; first < backing.length; ) {
          let last = first;
          while (
            last + 1 < backing.length &&
            !/\s$/.test(backing[last].text) &&
            !/^\s/.test(backing[last + 1].text)
          )
            last += 1;
          const word = {
            text: backing
              .slice(first, last + 1)
              .map(syllable => syllable.text)
              .join(''),
            start: backing[first].timestamp,
            end: backing[last].endtime,
          };
          for (let index = first; index <= last; index += 1)
            backingWords[index] = word;
          first = last + 1;
        }

        const lineIsRTL = this.cachedLineData?.[lineIndex]?.lineIsRTL ?? false;

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
                    syllable.romanizedText &&
                    syllable.romanizedText.trim() !== syllable.text.trim()
                      ? html`<span
                          class="lyrics-syllable transliteration no-chars ${syllable.lineSynced
                            ? 'line-synced'
                            : ''}"
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
                  syllable.romanizedText &&
                  syllable.romanizedText.trim() !== syllable.text.trim()
                    ? html`<span
                        class="lyrics-syllable transliteration no-chars ${groupLineSynced
                          ? 'line-synced'
                          : ''}"
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
                  const numCharsInSyllable =
                    Array.from(text.replace(/\s/g, '')).length || 1;
                  let charIndexInsideSyllable = 0;

                  syllableContent = html`${Array.from(text).map(char => {
                    if (char === ' ') return ' ';

                    const charIndexInsideWord =
                      groupCharOffset + sylCharAccumulator;
                    const localCharIndex = charIndexInsideSyllable;
                    sylCharAccumulator += 1;
                    charIndexInsideSyllable += 1;

                    return html`<span class="char-motion"
                      ><span
                        class="char"
                        data-char-index="${charIndexInsideWord}"
                        data-syllable-char-index="${charIndexInsideWord}"
                        style="--word-wipe-width: ${numCharsInSyllable}ch; --char-wipe-position: -${localCharIndex}ch"
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
            ? html`<div
                class="lyrics-romanization-container ${lineIsRTL
                  ? 'rtl-text'
                  : ''}"
              >
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
            class="lyrics-line ${line.alignment === 'end'
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
        aria-label="Synced lyrics"
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
                  <span
                    class="source-info"
                    style="display: flex; align-items: center; gap: 8px;"
                  >
                    <b style="font-weight: 750;">Source</b> ${sourceLabel}
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
                            ?disabled=${this.isFetchingAlternatives}
                          >
                            <svg
                              class="source-switch-svg lucide lucide-arrow-down-up-icon lucide-arrow-down-up ${this
                                .isFetchingAlternatives
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
                              ${this.isFetchingAlternatives
                                ? svg`<path
                                    d="M21 12a9 9 0 1 1-6.219-8.56"
                                  ></path>`
                                : svg`<path d="m3 16 4 4 4-4"></path
                                    ><path d="M7 20V4"></path
                                    ><path d="m21 8-4-4-4 4"></path
                                    ><path d="M17 4v16"></path>`}
                            </svg>
                            <span class="source-switch-label"
                              >${this.isFetchingAlternatives
                                ? 'Switching...'
                                : 'Switch'}</span
                            >
                          </button>
                        `
                      : ''}
                  </span>
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

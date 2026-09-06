import { css, html, LitElement, svg } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { GoogleService } from './GoogleService.js';

const VERSION = '1.6.2';
const INSTRUMENTAL_THRESHOLD_MS = 7000; // Show dots for gaps >= 7s
const FETCH_TIMEOUT_MS = 8000; // Timeout for all lyrics fetch requests
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
const LONG_WORD_WIPE_EXTRA_EM = 0.45;
const LONG_WORD_WIPE_EXTRA_RATIO = 0.35;
const SHORT_WORD_DRAG_MIN_DURATION_MS = 760;
const SHORT_WORD_GLOW_MIN_DURATION_MS = 1360;

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
      --am-lyrics-background-vocal-exit-duration: 450ms;
      --am-lyrics-instrumental-height: 40px;
      --am-lyrics-instrumental-spacing: 16px;
      --am-lyrics-instrumental-enter-duration: 400ms;
      --am-lyrics-instrumental-collapse-duration: 500ms;
      --am-lyrics-instrumental-exit-duration: 350ms;
      --am-lyrics-instrumental-exit-scale: 0;
      --am-lyrics-inactive-scale: 0.98;
      --am-lyrics-background-vocal-scale: 0.9;
      --am-lyrics-touch-scale: 0.96;
      --am-lyrics-highlight-radius: 16px;
      --am-lyrics-highlight-surface: rgba(255, 255, 255, 0.08);
      --am-lyrics-progression-feather: 30px;
      --am-lyrics-glow-radius: 5px;
      --am-lyrics-inline-padding: 20px;
      --char-rise-y: -2px;
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

    /* ==========================================================================
       CONTAINER & SCROLL BEHAVIOR
       ========================================================================== */
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

    .lyrics-line.scroll-animate {
      /* Preserve the graceful fade duration; the keyframe handles the
         transform, so we only need to keep opacity/filter transitions
         alive without !important overriding the base rule. */
      transition:
        opacity 0.7s ease,
        filter 0.7s ease,
        transform 0.4s cubic-bezier(0.41, 0, 0.12, 0.99)
          var(--lyrics-line-delay, 0ms);
      animation-name: lyrics-scroll;
      animation-duration: var(--scroll-duration, 400ms);
      animation-timing-function: cubic-bezier(0.41, 0, 0.12, 0.99);
      animation-fill-mode: both;
      animation-delay: var(--lyrics-line-delay, 0ms);
    }

    .lyrics-container.user-scrolling .lyrics-line {
      --lyrics-line-delay: 0ms !important;
      transition-delay: 0ms !important;
    }

    /* ==========================================================================
       LYRICS LINE BASE STYLES
       ========================================================================== */
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

    .lyrics-line:not(.scroll-animate) {
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
      position: relative;
      height: 0;
      overflow: visible;
      font-size: var(--am-lyrics-background-vocal-font-size);
      line-height: 1.22;
      padding: 0;
      box-sizing: border-box;
      color: color-mix(in srgb, var(--lyplus-text-secondary) 80%, transparent);
      transition: height var(--scroll-duration, 400ms)
        cubic-bezier(0.41, 0, 0.12, 0.99);
      margin: 0;
      pointer-events: none;
    }

    .background-vocal-wrap {
      display: block;
      padding-top: 0.08em;
      padding-bottom: 0.14em;
      opacity: 0;
      filter: blur(var(--lyplus-blur-amount));
      transform: scale(var(--am-lyrics-background-vocal-scale));
      transform-origin: left center;
      transition:
        padding-top var(--scroll-duration, 400ms) cubic-bezier(0.2, 0.8, 0.2, 1),
        padding-bottom var(--scroll-duration, 400ms)
          cubic-bezier(0.2, 0.8, 0.2, 1),
        opacity 320ms cubic-bezier(0.2, 0, 0, 1),
        filter 320ms cubic-bezier(0.2, 0, 0, 1),
        transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    .lyrics-line.singer-right .background-vocal-container,
    .lyrics-line.rtl-text .background-vocal-container {
      margin-left: auto;
      margin-right: 0;
    }

    /* Background vocals expand only when .bg-expanded is present.
       This is separate from .active so bg vocals can collapse immediately
       while .active stays to keep text white until the scroll passes. */
    .lyrics-line.bg-expanded .background-vocal-container {
      height: calc(
        var(
            --am-lyrics-background-vocal-height,
            var(--am-lyrics-background-vocal-max-height)
          ) +
          var(--am-lyrics-background-vocal-spacing)
      );
    }

    .lyrics-line.bg-expanded .background-vocal-wrap {
      opacity: 1;
      filter: blur(0);
      transform: scale(1);
      will-change: opacity, filter, transform;
    }

    /* During exit, collapse the layout shell with the lyric scroll while an
       absolutely positioned copy of its normal wrapper remains unclipped and
       scales away in place. This lets following lines reclaim the space in the
       same motion instead of after the background vocal has disappeared. */
    .lyrics-line.bg-collapsing .background-vocal-container {
      display: flex;
      align-items: center;
      height: 0;
    }

    .lyrics-line.bg-collapsing .background-vocal-wrap {
      position: relative;
      flex: 0 0 auto;
      width: 100%;
      opacity: 0;
      filter: blur(var(--lyplus-blur-amount));
      transform: scale(var(--am-lyrics-background-vocal-scale));
      animation: background-vocal-scale-out
        var(
          --background-vocal-exit-duration,
          var(--am-lyrics-background-vocal-exit-duration)
        )
        linear both;
      transition:
        padding-top var(--scroll-duration, 400ms) cubic-bezier(0.2, 0.8, 0.2, 1),
        padding-bottom var(--scroll-duration, 400ms)
          cubic-bezier(0.2, 0.8, 0.2, 1);
      will-change: opacity, filter, transform;
    }

    .lyrics-line.bg-expanded.bg-after .main-vocal-container {
      transform: translateY(
        calc(0px - var(--am-lyrics-background-vocal-stack-shift))
      );
    }

    .lyrics-line.bg-expanded.bg-before .main-vocal-container {
      transform: translateY(var(--am-lyrics-background-vocal-stack-shift));
    }

    .lyrics-line:is(.bg-expanded, .bg-collapsing)
      .background-vocal-container.background-after
      .background-vocal-wrap {
      padding-top: calc(var(--am-lyrics-background-vocal-spacing) + 0.08em);
    }

    .lyrics-line:is(.bg-expanded, .bg-collapsing)
      .background-vocal-container.background-before
      .background-vocal-wrap {
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
    }

    /* Predictive scrolling begins before the next timestamp. Start dimming
       the outgoing line at the same moment so it settles with the scroll. */
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
    .lyrics-line.far-line:not(.scroll-animate) {
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
      .lyrics-line.next-active-line:not(.active):not(.pre-active) {
      filter: blur(0.008em);
    }

    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.next-2:not(.active):not(.pre-active) {
      filter: blur(0.028em);
    }

    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.next-3:not(.active):not(.pre-active) {
      filter: blur(0.05em);
    }

    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.next-4:not(.active):not(.pre-active) {
      filter: blur(var(--lyplus-blur-amount));
    }

    /* Unblur all lines when user is scrolling */
    .lyrics-container.user-scrolling .lyrics-line {
      transition: none !important;
      filter: none !important;
      opacity: 0.8 !important;
    }

    /* Unblur early for pre-active lines */
    .lyrics-container.blur-inactive-enabled .lyrics-line.pre-active {
      filter: blur(0px) !important;
      opacity: 1;
    }

    /* ==========================================================================
       WORD & SYLLABLE STYLES
       ========================================================================== */
    .lyrics-word:not(.allow-break) {
      display: inline-block;
      vertical-align: baseline;
      white-space: nowrap;
    }

    .lyrics-word.allow-break {
      display: inline;
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
      /* Unified transition: transform keeps its 1s glow decay, while
         background-color and color fade at 0.7s so everything dims
         together when the line becomes inactive. */
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

    /* Non-growable words float up with a gentle curve */
    .lyrics-line.active:not(.lyrics-gap)
      .lyrics-word:not(.growable):not(.char-drag)
      .lyrics-syllable.highlight {
      transform: translate3d(0, var(--char-rise-y, -1.12px), 0);
    }

    .lyrics-line.persist-highlight:not(.lyrics-gap)
      .lyrics-word:not(.growable):not(.char-drag)
      .lyrics-syllable.finished {
      transform: translate3d(0, var(--char-rise-y, -1.12px), 0);
    }

    .lyrics-word.growable .lyrics-syllable.cleanup .char {
      transform: translate3d(0, var(--char-rise-y, -1.12px), 0);
    }

    .lyrics-word.char-drag .lyrics-syllable.cleanup .char {
      transform: translate3d(0, var(--char-rise-y, -1.12px), 0);
    }

    .lyrics-line.persist-highlight
      .lyrics-word.growable
      .lyrics-syllable.finished
      .char,
    .lyrics-line.persist-highlight
      .lyrics-word.char-drag
      .lyrics-syllable.finished
      .char {
      transform: translate3d(0, var(--char-rise-y, -1.12px), 0);
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
      .lyrics-word:not(.growable):not(.char-drag)
      .lyrics-syllable.highlight,
    .lyrics-line.persist-highlight:not(.lyrics-gap)
      .background-vocal-container
      .lyrics-word:not(.growable):not(.char-drag)
      .lyrics-syllable.finished {
      transform: translate3d(0, calc(var(--char-rise-y) * 1.5), 0);
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

    .lyrics-syllable span.char {
      display: inline-block;
      background-color: var(--lyplus-text-secondary);
      white-space: break-spaces;
      font-variant-ligatures: none;
      font-feature-settings: 'liga' 0;
      background-clip: text;
      -webkit-background-clip: text;
      backface-visibility: hidden;
      transform-origin: 50% 80%;
      transition:
        color 0.7s,
        background-color 0.7s,
        transform 0.7s ease;
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
      background-image:
        linear-gradient(
          90deg,
          #ffffff00 0%,
          var(--lyplus-text-primary, #fff) 50%,
          #0000 100%
        ),
        linear-gradient(
          90deg,
          var(--lyplus-text-primary, #fff) 100%,
          #0000 100%
        );
      background-size:
        var(--wipe-gradient-width, 0.75em) 100%,
        0% 100%;
      background-position:
        calc(-1 * var(--wipe-gradient-width, 0.75em)) 0%,
        left;
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
      animation-name: char-pre-wipe;
      animation-duration: var(--pre-wipe-duration);
      animation-delay: var(--pre-wipe-delay);
      animation-timing-function: linear;
      animation-fill-mode: forwards;
    }

    /* ==========================================================================
       INSTRUMENTAL GAP STYLES
       ========================================================================== */
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
      transition:
        height var(--am-lyrics-instrumental-enter-duration)
          cubic-bezier(0.41, 0, 0.12, 0.99),
        transform var(--scroll-duration, 280ms) var(--lyrics-line-delay, 0ms);
    }

    .lyrics-gap.active {
      height: calc(
        var(--am-lyrics-instrumental-height) +
          var(--am-lyrics-instrumental-spacing)
      );
      transition:
        height var(--am-lyrics-instrumental-enter-duration)
          cubic-bezier(0.41, 0, 0.12, 0.99),
        transform var(--scroll-duration, 280ms);
    }

    /* Reclaim the row from the first predictive-scroll frame, after the dot
       pop has finished, so the reflow and scroll share one curve. */
    .lyrics-gap.gap-collapsing {
      height: 0;
      transition:
        height var(--am-lyrics-instrumental-collapse-duration)
          cubic-bezier(0.41, 0, 0.12, 0.99),
        transform var(--scroll-duration, 280ms);
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
      height: calc(100% + var(--am-lyrics-line-spacing));
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

    .lyrics-line.active .lyrics-syllable.line-synced {
      animation: fade-in-line 0.2s ease-out forwards !important;
      color: var(--lyplus-text-primary) !important;
    }

    .lyrics-line.active .lyrics-syllable.line-synced span.char {
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
      background-color: var(--lyplus-text-secondary);
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

    /* ==========================================================================
       METADATA & FOOTER STYLES
       ========================================================================== */
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

    .lyrics-footer.scroll-animate {
      transition: none !important;
      animation-name: lyrics-scroll;
      animation-duration: var(--scroll-duration, 280ms);
      animation-timing-function: cubic-bezier(0.41, 0, 0.12, 0.99);
      animation-fill-mode: both;
      animation-delay: var(--lyrics-line-delay, 0ms);
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

    /* ==========================================================================
       HEADER & CONTROLS
       ========================================================================== */
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
      padding: 0 12px;
      border: 0;
      min-height: 40px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      color: #aaa;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
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
      min-height: 40px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 12px;
      color: rgba(255, 255, 255, 0.6);
      font-size: 0.8em;
      margin-left: 0;
      padding: 0 28px 0 12px;
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

    /* ==========================================================================
       TRANSLATION & ROMANIZATION
       ========================================================================== */
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

    /* ==========================================================================
       SKELETON LOADING
       ========================================================================== */
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

    /* ==========================================================================
       KEYFRAME ANIMATIONS
       ========================================================================== */

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

    /* Character-rendered words use a separate moving gradient in front of
       their solid fill. This makes the individual glyph wipes read as one
       continuous word-level wipe. */
    @keyframes char-pre-wipe {
      from {
        background-size:
          var(--wipe-gradient-width, 0.75em) 100%,
          0% 100%;
        background-position:
          calc(-1 * var(--wipe-gradient-width, 0.75em)) 0%,
          left;
      }
      to {
        background-size:
          var(--wipe-gradient-width, 0.75em) 100%,
          0% 100%;
        background-position:
          calc(-1 * var(--wipe-gradient-half, 0.375em)) 0%,
          left;
      }
    }

    @keyframes char-start-wipe {
      from {
        background-size:
          var(--wipe-gradient-width, 0.75em) 100%,
          0% 100%;
        background-position:
          calc(-1 * var(--wipe-gradient-width, 0.75em)) 0%,
          left;
      }
      to {
        background-size:
          var(--wipe-gradient-width, 0.75em) 100%,
          100% 100%;
        background-position:
          calc(100% + var(--wipe-gradient-half, 0.375em)) 0%,
          left;
      }
    }

    @keyframes char-wipe {
      from {
        background-size:
          var(--wipe-gradient-width, 0.75em) 100%,
          0% 100%;
        background-position:
          calc(-1 * var(--wipe-gradient-half, 0.375em)) 0%,
          left;
      }
      to {
        background-size:
          var(--wipe-gradient-width, 0.75em) 100%,
          100% 100%;
        background-position:
          calc(100% + var(--wipe-gradient-half, 0.375em)) 0%,
          left;
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

    @keyframes background-vocal-scale-out {
      0%,
      18% {
        opacity: 1;
        filter: blur(0);
        transform: scale(1);
      }
      100% {
        opacity: 0;
        filter: blur(var(--lyplus-blur-amount));
        transform: scale(var(--am-lyrics-background-vocal-scale));
      }
    }

    /* Scroll animation — class is removed and re-added (with a forced
       reflow in between) to reliably restart the animation each time */
    @keyframes lyrics-scroll {
      from {
        transform: translate3d(0, var(--scroll-delta), 0);
      }
      to {
        transform: translate3d(0, 0, 0);
      }
    }

    /* Character grow animation — translate3d+scale3d for smooth transform,
       drop-shadow for glow */
    @keyframes grow-dynamic {
      0% {
        transform: translate3d(0, 0, 0) scale3d(1, 1, 1);
        filter: drop-shadow(
          0 0 0
            color-mix(in srgb, var(--lyplus-lyrics-palette), transparent 100%)
        );
      }
      25%,
      30% {
        transform: translate3d(
            var(--char-offset-x, 0px),
            var(--translate-y-peak, -2px),
            0
          )
          scale3d(var(--matrix-scale, 1.1), var(--matrix-scale, 1.1), 1);
        filter: drop-shadow(
          0 0 var(--am-lyrics-glow-radius)
            color-mix(
              in srgb,
              var(--lyplus-lyrics-palette),
              transparent calc((1 - var(--shadow-intensity, 1)) * 100%)
            )
        );
      }
      75%,
      100% {
        transform: translate3d(0, var(--char-rise-y, -1.12px), 0)
          scale3d(1, 1, 1);
        filter: drop-shadow(
          0 0 0
            color-mix(in srgb, var(--lyplus-lyrics-palette), transparent 100%)
        );
      }
    }

    @keyframes rise-char {
      0%,
      100% {
        transform: translate3d(0, 0, 0);
      }
      55% {
        transform: translate3d(
          0,
          var(--am-lyrics-character-rise-peak, -1.25px),
          0
        );
      }
    }

    @keyframes drag-char {
      0% {
        transform: translate3d(0, 0, 0);
      }
      100% {
        transform: translate3d(0, var(--char-rise-y, -1.12px), 0);
      }
    }

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

    @media (prefers-reduced-motion: reduce) {
      .lyrics-line,
      .lyrics-line::before,
      .lyrics-line-container,
      .background-vocal-container,
      .background-vocal-wrap,
      .lyrics-syllable,
      .lyrics-syllable span.char,
      .lyrics-gap .main-vocal-container,
      .lyrics-plus-metadata,
      .lyrics-footer,
      .download-button,
      .source-switch-btn {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
        transition-delay: 0ms !important;
      }
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
  private downloadFormat: 'auto' | 'lrc' | 'ttml' = 'auto';

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

  private _currentTime = 0;

  @property({ type: Number, attribute: 'currenttime', hasChanged: () => false })
  set currentTime(value: number) {
    const oldValue = this._currentTime;

    // If the new time is significantly smaller than the old time (e.g. song looped)
    if (value < oldValue && oldValue - value > 1000 && this.lyrics) {
      this.activeLineIndices = [];
      this.activeMainWordIndices.clear();
      this.activeBackgroundWordIndices.clear();
      this.mainWordProgress.clear();
      this.backgroundWordProgress.clear();
      this.mainWordAnimations.clear();
      this.backgroundWordAnimations.clear();
      this.preActiveLineElements = [];
      this.positionedLineElements = [];
      this.activeGapLineElements = [];
      this.clearBackgroundExpandedLine();

      // Stop all running animations and clear highlights immediately
      if (this.lyricsContainer) {
        const activeLines = this.lyricsContainer.querySelectorAll(
          '.lyrics-line.active, .lyrics-line.pre-active, .lyrics-line.bg-expanded, .lyrics-line.scroll-exiting',
        );
        activeLines.forEach(line => {
          line.classList.remove(
            'active',
            'pre-active',
            'bg-expanded',
            'scroll-exiting',
          );
          AmLyrics.resetSyllables(line as HTMLElement);
        });

        const activeGaps = this.lyricsContainer.querySelectorAll(
          '.lyrics-gap.active, .lyrics-gap.gap-collapsing, .lyrics-gap.gap-exiting',
        );
        activeGaps.forEach(gap =>
          gap.classList.remove('active', 'gap-collapsing', 'gap-exiting'),
        );

        // Reset gap cache since we manually messed with the elements
        this.gapElementCache.clear();
      }
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

  private activeMainWordIndices: Map<number, number> = new Map();

  private activeBackgroundWordIndices: Map<number, number> = new Map();

  private mainWordProgress: Map<number, number> = new Map();

  private backgroundWordProgress: Map<number, number> = new Map();

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
    vwFullText: string[];
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

  private backgroundExpandedLine: HTMLElement | null = null;

  private backgroundCollapseTimeouts = new Map<HTMLElement, number>();

  private backgroundExpandFrameId?: number;

  // Scroll animation state
  private scrollAnimationState: {
    isAnimating: boolean;
    pendingUpdate: number | null;
    pendingReferenceElement: HTMLElement | null;
    pendingScrollDuration: number | undefined;
  } | null = null;

  private currentScrollOffset = 0;

  private animatingLines: HTMLElement[] = [];

  private scrollAnimationTimeout?: ReturnType<typeof setTimeout>;

  private scrollUnlockTimeout?: ReturnType<typeof setTimeout>;

  // AbortController for cancelling in-flight lyrics fetches
  private fetchAbortController?: AbortController;

  // Syllable animation tracking
  private lastActiveIndex = 0;

  private visibleLineIds: Set<string> = new Set();

  // IntersectionObserver for viewport virtualization
  private visibilityObserver?: IntersectionObserver;

  // Cached element tracking to avoid repeated querySelectorAll calls
  private preActiveLineElements: HTMLElement[] = [];

  private positionedLineElements: HTMLElement[] = [];

  private activeGapLineElements: HTMLElement[] = [];

  // Bound handler references for proper event listener removal
  private _boundHandleUserScroll = this.handleUserScroll.bind(this);

  private _boundAnimateProgress = this.animateProgress.bind(this);

  connectedCallback() {
    super.connectedCallback();
    this.fetchLyrics();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
      this.userScrollTimeoutId = undefined;
    }
    if (this.clickSeekTimeout) {
      clearTimeout(this.clickSeekTimeout);
      this.clickSeekTimeout = undefined;
    }
    if (this.scrollAnimationTimeout) {
      clearTimeout(this.scrollAnimationTimeout);
      this.scrollAnimationTimeout = undefined;
    }
    if (this.scrollUnlockTimeout) {
      clearTimeout(this.scrollUnlockTimeout);
      this.scrollUnlockTimeout = undefined;
    }
    for (const timeoutId of this.backgroundCollapseTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.backgroundCollapseTimeouts.clear();
    if (this.backgroundExpandFrameId !== undefined) {
      cancelAnimationFrame(this.backgroundExpandFrameId);
      this.backgroundExpandFrameId = undefined;
    }
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
    this.activeMainWordIndices.clear();
    this.activeBackgroundWordIndices.clear();
    this.mainWordProgress.clear();
    this.backgroundWordProgress.clear();
    this.mainWordAnimations.clear();
    this.backgroundWordAnimations.clear();
    this.preActiveLineElements = [];
    this.positionedLineElements = [];
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

  private static getRankForCollected(
    sourceLabel: string,
    parsedLines: any[],
  ): number {
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
        const key = p.getAttribute('itunes:key');
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
    const timeDiff = Math.abs(newTime - oldTime);
    const isSeek = timeDiff > SEEK_THRESHOLD_MS;

    const newActiveLines = this.findActiveLineIndices(newTime);
    const oldActiveLines = this.activeLineIndices;

    // Reset animation if active lines change or if we skip time.
    const linesChanged = !AmLyrics.arraysEqual(newActiveLines, oldActiveLines);

    if (linesChanged || isSeek) {
      if (this.lyricsContainer) {
        // Remove .active and .bg-expanded immediately when a line drops.
        // All visual fading is handled by CSS transitions — no JS delays,
        // so overlapping lyrics never get stuck with multiple .active lines.
        for (const lineIndex of oldActiveLines) {
          if (!newActiveLines.includes(lineIndex)) {
            const lineElement = this._getLineElement(lineIndex);
            if (lineElement) {
              if (
                isSeek ||
                this.isUserScrolling ||
                AmLyrics.isLineSyncedLine(this.lyrics?.[lineIndex])
              ) {
                AmLyrics.unfinishSyllables(lineElement);
              } else {
                AmLyrics.finishSyllablesUpToTime(lineElement, newTime);
              }

              lineElement.classList.remove('active', 'scroll-exiting');
              lineElement.removeAttribute('aria-current');

              if (lineElement.classList.contains('pre-active')) {
                lineElement.classList.remove('pre-active');
              }
              const preIdx = this.preActiveLineElements.indexOf(lineElement);
              if (preIdx !== -1) this.preActiveLineElements.splice(preIdx, 1);
            }
          }
        }

        // Add 'active' to newly active lines. Background expansion is driven
        // separately by the current scroll target.
        for (const lineIndex of newActiveLines) {
          if (!oldActiveLines.includes(lineIndex)) {
            const lineElement = this._getLineElement(lineIndex);
            if (lineElement) {
              lineElement.classList.add('active');
              lineElement.setAttribute('aria-current', 'true');
              lineElement.classList.remove('pre-active', 'scroll-exiting');
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
          }
        }
        this.preActiveLineElements = this.preActiveLineElements.filter(el =>
          el.classList.contains('pre-active'),
        );
      }

      this.startAnimationFromTime(newTime);
    }

    // Predictive scroll: run on every tick so we scroll *before* the next
    // line starts, matching YouLyPlus behaviour.
    this._handleActiveLineScroll(oldActiveLines, isSeek);
    if (linesChanged || isSeek) {
      this.clearPastLineHighlights();
    }

    if (this.lyricsContainer) {
      // Update syllables in active lines using cached elements
      for (const lineIndex of this.activeLineIndices) {
        const lineElement = this._getLineElement(lineIndex);
        if (lineElement) {
          AmLyrics.updateSyllablesForLine(lineElement, newTime);
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
      this.preActiveLineElements = [];
      this.positionedLineElements = [];
      this.activeGapLineElements = [];
      this.clearBackgroundExpandedLine();
      this.setUserScrolling(false);

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
      if (this.scrollUnlockTimeout) {
        clearTimeout(this.scrollUnlockTimeout);
        this.scrollUnlockTimeout = undefined;
      }
      if (this.scrollAnimationTimeout) {
        clearTimeout(this.scrollAnimationTimeout);
        this.scrollAnimationTimeout = undefined;
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
  private _handleActiveLineScroll(
    _oldActiveIndices: number[],
    forceScroll = false,
  ): void {
    if (!this.lyricsContainer || !this.lyrics || this.lyrics.length === 0) {
      return;
    }

    // If the footer is already active, it set up its own scroll.
    // Don't override it with a scroll back to the last lyric.
    const footer = this.lyricsContainer.querySelector('.lyrics-footer');
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

    // 2. Find scroll target at predictive time
    const predictiveTime = this.currentTime + scrollLookAheadMs;
    const predictiveActiveIndices = this.findActiveLineIndices(predictiveTime);

    let targetElement: HTMLElement | null = null;

    if (predictiveActiveIndices.length > 0) {
      const targetLineIdx = this.getPrimaryScrollLineIndex(
        predictiveActiveIndices,
        predictiveTime,
      );
      if (targetLineIdx !== null && targetLineIdx !== -1) {
        targetElement = this._getLineElement(targetLineIdx);
      }
    }

    if (!targetElement) {
      // Fallback: closest line before predictiveTime
      const targetLineIdx = this.getLineIndexAtTime(predictiveTime, 0);
      if (targetLineIdx !== null && targetLineIdx !== -1) {
        targetElement = this._getLineElement(targetLineIdx);
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
    if (!targetElement.classList.contains('active')) {
      targetElement.classList.add('pre-active');
      if (!this.preActiveLineElements.includes(targetElement)) {
        this.preActiveLineElements.push(targetElement);
      }
    }

    this.focusLine(targetElement, forceScroll, scrollDuration);
    // focusLine synchronously assigns each moving line its actual staggered
    // duration. Hand background-vocal ownership over afterwards so its exit
    // begins in the same frame and settles with that line's scroll.
    this.setBackgroundExpandedLine(targetElement);
  }

  private _textWidthCanvas: HTMLCanvasElement | undefined;

  private _textWidthCtx: CanvasRenderingContext2D | null | undefined;

  private _getTextWidth(text: string, font: string): number {
    if (!this._textWidthCanvas) {
      this._textWidthCanvas = document.createElement('canvas');
      this._textWidthCtx = this._textWidthCanvas.getContext('2d', {
        willReadFrequently: true,
      });
    }
    if (this._textWidthCtx) {
      this._textWidthCtx.font = font;
      return this._textWidthCtx.measureText(text).width;
    }
    return 0;
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
      .querySelectorAll<HTMLElement>(
        '.main-vocal-container, .background-vocal-container',
      )
      .forEach(vocalTrack => {
        const target = vocalTrack as any;
        target._cachedTimedSyllables = undefined;
      });
    this.lyricsContainer
      .querySelectorAll<HTMLElement>('.lyrics-word')
      .forEach(wordElement => {
        const target = wordElement as any;
        target._cachedVirtualWordElements = undefined;
        target._cachedVirtualWordCharSpans = undefined;
        target._cachedWipeHandoffEndTime = undefined;
        target._wordPreWipeKey = undefined;
        target._wordWipeStarted = false;
      });
    this.lyricsContainer
      .querySelectorAll<HTMLElement>('.lyrics-syllable')
      .forEach(syllable => {
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

  private _invalidateCaches() {
    this.cachedAllGaps = [];
    this.cachedIsUnsynced = false;
    this.cachedLineData = null;
    this.lineElementCache.clear();
    this.gapElementCache.clear();
    this.footerElement = undefined;
    this.cachedLineArray = [];
    this.preActiveLineElements = [];
    this.positionedLineElements = [];
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

  private _ensureLineDataCache() {
    if (this.cachedLineData || !this.lyrics) return;

    this.cachedLineData = this.lyrics.map(line => {
      const wordGroups: Syllable[][] = [];
      let currentGroupBuffer: Syllable[] = [];

      line.text.forEach((syllable, idx) => {
        currentGroupBuffer.push(syllable);
        const nextSyllable = line.text[idx + 1];

        const endsWithDelimiter =
          !nextSyllable ||
          syllable.part === false ||
          /\s$/.test(syllable.text) ||
          (nextSyllable &&
            (syllable as any).isBackground !==
              (nextSyllable as any).isBackground);

        if (endsWithDelimiter) {
          wordGroups.push(currentGroupBuffer);
          currentGroupBuffer = [];
        }
      });

      if (currentGroupBuffer.length > 0) {
        wordGroups.push(currentGroupBuffer);
      }

      const groupGrowable: boolean[] = new Array(wordGroups.length).fill(false);
      const groupGlowing: boolean[] = new Array(wordGroups.length).fill(false);
      const groupCharRise: boolean[] = new Array(wordGroups.length).fill(false);
      const groupCharDrag: boolean[] = new Array(wordGroups.length).fill(false);
      const vwFullText: string[] = new Array(wordGroups.length).fill('');
      const vwFullDuration: number[] = new Array(wordGroups.length).fill(0);
      const vwCharOffset: number[] = new Array(wordGroups.length).fill(0);
      const vwStartMs: number[] = new Array(wordGroups.length).fill(0);
      const vwEndMs: number[] = new Array(wordGroups.length).fill(0);

      let lineIsRTL = line.direction === 'rtl';
      let vwStart = 0;
      while (vwStart < wordGroups.length) {
        let vwEnd = vwStart;
        while (vwEnd < wordGroups.length - 1) {
          const grp = wordGroups[vwEnd];
          const lastText = grp[grp.length - 1].text;
          if (/\s$/.test(lastText)) break;
          vwEnd += 1;
        }

        const combinedText = wordGroups
          .slice(vwStart, vwEnd + 1)
          .flatMap(g => g.map(s => s.text))
          .join('')
          .trim();
        const combinedStart = wordGroups[vwStart][0].timestamp;
        const lastGrp = wordGroups[vwEnd];
        const combinedEnd = lastGrp[lastGrp.length - 1].endtime;
        const combinedDuration = combinedEnd - combinedStart;

        const isCJK =
          /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(
            combinedText,
          );
        const isRTL =
          /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0590-\u05FF]/.test(
            combinedText,
          );
        if (isRTL) lineIsRTL = true;
        const hasHyphen = combinedText.includes('-');

        const wordLen = combinedText.length;
        const canAnimateByChar = !isCJK && !isRTL && !hasHyphen && wordLen > 0;
        const isLineSynced =
          line.isWordSynced === false || line.text.some(s => s.lineSynced);
        let isGrowableVW = canAnimateByChar && wordLen > 0 && wordLen <= 7;
        if (isGrowableVW) {
          if (wordLen <= 1) {
            isGrowableVW =
              combinedDuration >= 1100 && combinedDuration >= wordLen * 550;
          } else if (wordLen <= 3) {
            isGrowableVW =
              combinedDuration >=
              SHORT_WORD_GLOW_MIN_DURATION_MS + (wordLen - 2) * 140;
          } else if (wordLen === 4) {
            isGrowableVW = combinedDuration >= 1050;
          } else {
            isGrowableVW =
              combinedDuration >= 900 && combinedDuration >= wordLen * 200;
          }
        }

        const hasCharRiseDuration =
          combinedDuration >= Math.max(1600, wordLen * 135);
        const hasTinyWordDragDuration =
          wordLen >= 2 &&
          wordLen <= 3 &&
          combinedDuration >=
            Math.max(SHORT_WORD_DRAG_MIN_DURATION_MS, wordLen * 150);
        const isCharRiseVW =
          canAnimateByChar &&
          !isLineSynced &&
          !isGrowableVW &&
          wordLen >= 12 &&
          hasCharRiseDuration;
        const isCharDragVW =
          canAnimateByChar &&
          !isLineSynced &&
          !isGrowableVW &&
          hasTinyWordDragDuration;

        const isGlowingVW = isGrowableVW && !isLineSynced;

        let charOff = 0;
        for (let gi = vwStart; gi <= vwEnd; gi += 1) {
          groupGrowable[gi] = isGrowableVW;
          groupGlowing[gi] = isGlowingVW;
          groupCharRise[gi] = isCharRiseVW;
          groupCharDrag[gi] = isCharDragVW;
          vwFullText[gi] = combinedText;
          vwFullDuration[gi] = combinedDuration;
          vwCharOffset[gi] = charOff;
          vwStartMs[gi] = combinedStart;
          vwEndMs[gi] = combinedEnd;
          const grpText = wordGroups[gi].map(s => s.text).join('');
          charOff += grpText.replace(/\s/g, '').length;
        }

        vwStart = vwEnd + 1;
      }

      return {
        wordGroups,
        groupGrowable,
        groupGlowing,
        groupCharRise,
        groupCharDrag,
        vwFullText,
        vwFullDuration,
        vwCharOffset,
        vwStartMs,
        vwEndMs,
        lineIsRTL,
      };
    });
  }

  private _updateCharTimingData() {
    if (!this.shadowRoot) return;

    this._rebuildDomCache();

    // Get the computed font from the first syllable to ensure accuracy
    const referenceSyllable = this.shadowRoot.querySelector('.lyrics-syllable');
    if (!referenceSyllable) return;

    const computedStyle = getComputedStyle(referenceSyllable);
    const { font } = computedStyle; // Full font string
    const fontSize = Number.parseFloat(computedStyle.fontSize) || 16;

    const charTimedWords = Array.from(
      this.shadowRoot.querySelectorAll(
        '.lyrics-word.growable, .lyrics-word.char-rise, .lyrics-word.char-drag',
      ),
    ) as HTMLElement[];
    if (charTimedWords.length === 0) return;

    const wordsByVirtualId = new Map<string, HTMLElement[]>();
    charTimedWords.forEach((wordSpan, index) => {
      const virtualWordId = wordSpan.dataset.virtualWordId || `word-${index}`;
      const words = wordsByVirtualId.get(virtualWordId);
      if (words) {
        words.push(wordSpan);
      } else {
        wordsByVirtualId.set(virtualWordId, [wordSpan]);
      }
    });

    wordsByVirtualId.forEach(wordSpans => {
      const syllables: HTMLElement[] = [];
      wordSpans.forEach(wordSpan => {
        const syllableWraps = wordSpan.querySelectorAll(
          '.lyrics-syllable-wrap',
        );
        syllableWraps.forEach(wrap => {
          const syl = wrap.querySelector('.lyrics-syllable');
          if (syl) syllables.push(syl as HTMLElement);
        });
      });

      const charSpans = syllables.flatMap(syl => {
        const spans = Array.from(
          syl.querySelectorAll('.char'),
        ) as HTMLElement[];
        const target = syl as any;
        target._cachedCharSpans = spans;
        return spans;
      });
      if (charSpans.length === 0) return;

      wordSpans.forEach(wordSpan => {
        const target = wordSpan as any;
        target._cachedVirtualWordElements = wordSpans;
        target._cachedVirtualWordCharSpans = charSpans;
      });

      const syllableEntries = syllables.map(syl => {
        const spans = (syl as any)._cachedCharSpans as HTMLElement[];
        const charWidths = spans.map(span =>
          this._getTextWidth(span.textContent || '', font),
        );
        const totalWidth = charWidths.reduce((a, b) => a + b, 0);
        return {
          syl,
          spans,
          charWidths,
          totalWidth,
          start: parseFloat(syl.getAttribute('data-start-time') || ''),
          end: parseFloat(syl.getAttribute('data-end-time') || ''),
        };
      });
      const totalWordWidth = syllableEntries.reduce(
        (total, entry) => total + entry.totalWidth,
        0,
      );
      if (totalWordWidth <= 0) return;

      const virtualWordStart = Math.min(
        ...syllableEntries
          .map(entry => entry.start)
          .filter(start => Number.isFinite(start)),
      );
      const virtualWordEnd = Math.max(
        ...syllableEntries
          .map(entry => entry.end)
          .filter(end => Number.isFinite(end)),
      );
      const virtualWordDuration = virtualWordEnd - virtualWordStart;
      const hasTimedSyllables =
        Number.isFinite(virtualWordStart) &&
        Number.isFinite(virtualWordEnd) &&
        virtualWordDuration > 0;
      const wordVelocityPxPerMs = hasTimedSyllables
        ? totalWordWidth / virtualWordDuration
        : 0;
      const gradientLeadWidthPx =
        (BASE_WIPE_GRADIENT_EM * Math.max(1, fontSize)) / 2;
      const measuredPreWipeDuration =
        wordVelocityPxPerMs > 0
          ? gradientLeadWidthPx / wordVelocityPxPerMs
          : 100;

      let cumulativeCharWidth = 0;
      syllableEntries.forEach(entry => {
        let cumulativeSyllableWidth = 0;
        const syllableDuration = entry.end - entry.start;
        const useSyllableTiming =
          hasTimedSyllables &&
          Number.isFinite(entry.start) &&
          Number.isFinite(entry.end) &&
          syllableDuration > 0 &&
          entry.totalWidth > 0;

        entry.spans.forEach((span, index) => {
          const charWidth = entry.charWidths[index];
          let startPercent = cumulativeCharWidth / totalWordWidth;
          let durationPercent = charWidth / totalWordWidth;
          if (useSyllableTiming) {
            const charStartMs =
              entry.start -
              virtualWordStart +
              (cumulativeSyllableWidth / entry.totalWidth) * syllableDuration;
            const charDurationMs =
              (charWidth / entry.totalWidth) * syllableDuration;
            startPercent = AmLyrics.clamp(
              charStartMs / virtualWordDuration,
              0,
              1,
            );
            durationPercent = AmLyrics.clamp(
              charDurationMs / virtualWordDuration,
              0,
              1,
            );
          }
          const target = span;

          target.dataset.wipeStart = startPercent.toFixed(4);
          target.dataset.wipeDuration = durationPercent.toFixed(4);
          target.dataset.preWipeDuration = measuredPreWipeDuration.toFixed(2);
          target.style.setProperty('--word-wipe-width', `${totalWordWidth}px`);
          target.style.setProperty(
            '--char-wipe-position',
            `${-cumulativeCharWidth}px`,
          );

          cumulativeCharWidth += charWidth;
          cumulativeSyllableWidth += charWidth;
        });
      });
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
    const isInGap = timeMs >= gapStartTime && timeMs < gapEndTime;
    const isInExitTrail =
      gap.classList.contains('gap-exiting') &&
      timeMs < gapEndTime + GAP_EXIT_TRAIL_MS;

    if (!isInGap) {
      if (isInExitTrail) {
        gap.style.setProperty('--gap-exit-scale', '0');
        gap.style.setProperty('--gap-exit-opacity', '0');
        return;
      }
      if (
        gap.classList.contains('active') ||
        gap.classList.contains('gap-collapsing') ||
        gap.classList.contains('gap-exiting')
      ) {
        gap.classList.remove('active', 'gap-collapsing', 'gap-exiting');
        gap.style.setProperty('--gap-scale', '0');
        gap.style.setProperty('--gap-opacity', '0');
        gap.style.removeProperty('--gap-exit-scale');
        gap.style.removeProperty('--gap-exit-opacity');
        dots.forEach(dot => {
          dot.style.removeProperty('--gap-dot-opacity');
        });
        const gapIndex = this.activeGapLineElements.indexOf(gap);
        if (gapIndex !== -1) this.activeGapLineElements.splice(gapIndex, 1);
      }
      return;
    }

    const duration = Math.max(1, gapEndTime - gapStartTime);
    const elapsed = AmLyrics.clamp(timeMs - gapStartTime, 0, duration);
    const remaining = Math.max(0, gapEndTime - timeMs);
    const exitStartLeadMs = collapseLeadMs + exitLeadMs;
    const isCollapsing = remaining <= collapseLeadMs;
    const isExiting = remaining <= exitStartLeadMs;

    gap.classList.toggle('active', !isCollapsing);
    gap.classList.toggle('gap-collapsing', isCollapsing);
    gap.classList.toggle('gap-exiting', isExiting);
    if (!this.activeGapLineElements.includes(gap)) {
      this.activeGapLineElements.push(gap);
    }

    /* Preserve the last committed 1.12 -> 0.85 alternate pulse, but derive it
       from playback time so seeks and dropped frames cannot desynchronise it.
       Phase the final inhale to reach its minimum exactly as the exit pop
       begins, matching the old gap-loop/gap-ended hand-off. */
    const pulseCycle = GAP_PULSE_DURATION_MS * 2;
    const exitStart = duration - exitStartLeadMs;
    const normalizedExitStart =
      ((exitStart % pulseCycle) + pulseCycle) % pulseCycle;
    const pulseOffset =
      (((GAP_PULSE_DURATION_MS - normalizedExitStart) % pulseCycle) +
        pulseCycle) %
      pulseCycle;
    const pulsePosition = (elapsed + pulseOffset) % pulseCycle;
    const breathMix =
      (1 - Math.cos((Math.PI * pulsePosition) / GAP_PULSE_DURATION_MS)) / 2;
    const breathingScale =
      GAP_BREATH_MAX_SCALE +
      (GAP_BREATH_MIN_SCALE - GAP_BREATH_MAX_SCALE) * breathMix;
    const entryScale = AmLyrics.easeOutExpo(
      AmLyrics.clamp(elapsed / GAP_ENTRY_SCALE_MS, 0, 1),
    );
    const scale = breathingScale * entryScale;

    const entryOpacity = AmLyrics.clamp(elapsed / GAP_ENTRY_FADE_MS, 0, 1);

    gap.style.setProperty('--gap-scale', scale.toFixed(4));
    gap.style.setProperty('--gap-opacity', entryOpacity.toFixed(4));

    if (isExiting) {
      const exitProgress = AmLyrics.clamp(
        (exitStartLeadMs - remaining) / Math.max(1, exitLeadMs),
        0,
        1,
      );
      let exitScale: number;
      let exitOpacity = 1;
      if (exitProgress <= GAP_EXIT_POP_PROGRESS) {
        const popProgress = AmLyrics.clamp(
          exitProgress / GAP_EXIT_POP_PROGRESS,
          0,
          1,
        );
        const easedPop = popProgress * popProgress * (3 - 2 * popProgress);
        exitScale =
          GAP_BREATH_MIN_SCALE +
          (GAP_EXIT_POP_SCALE - GAP_BREATH_MIN_SCALE) * easedPop;
      } else {
        const disappearProgress = AmLyrics.clamp(
          (exitProgress - GAP_EXIT_POP_PROGRESS) / (1 - GAP_EXIT_POP_PROGRESS),
          0,
          1,
        );
        const easedDisappear =
          disappearProgress * disappearProgress * (3 - 2 * disappearProgress);
        exitScale = GAP_EXIT_POP_SCALE * (1 - easedDisappear);
        exitOpacity = 1 - easedDisappear;
      }
      gap.style.setProperty('--gap-exit-scale', exitScale.toFixed(4));
      gap.style.setProperty('--gap-exit-opacity', exitOpacity.toFixed(4));
    } else {
      gap.style.removeProperty('--gap-exit-scale');
      gap.style.removeProperty('--gap-exit-opacity');
    }

    const sequentialDuration = Math.max(1, duration - exitStartLeadMs);
    const sequenceProgress = AmLyrics.clamp(elapsed / sequentialDuration, 0, 1);
    dots.forEach((dot, index) => {
      const dotProgress = AmLyrics.clamp(sequenceProgress * 3 - index, 0, 1);
      dot.style.setProperty(
        '--gap-dot-opacity',
        (0.25 + dotProgress * 0.75).toFixed(3),
      );
    });

    AmLyrics.updateSyllablesForLine(gap, timeMs);
  }

  private clearPreActiveClasses(exceptLineIndex: number | null = null): void {
    if (!this.lyricsContainer) return;

    const keptLines: HTMLElement[] = [];
    for (const lineElement of this.preActiveLineElements) {
      const lineIndex = AmLyrics.getLineIndexFromElement(lineElement);
      if (lineIndex === exceptLineIndex) {
        keptLines.push(lineElement);
      } else {
        lineElement.classList.remove('pre-active');
      }
    }
    this.preActiveLineElements = keptLines;
  }

  private setBackgroundExpandedLine(lineElement: HTMLElement | null): void {
    const target =
      lineElement &&
      !lineElement.classList.contains('lyrics-gap') &&
      lineElement.querySelector('.background-vocal-container')
        ? lineElement
        : null;

    if (this.backgroundExpandedLine === target) {
      if (target && !target.classList.contains('bg-expanded')) {
        const timeoutId = this.backgroundCollapseTimeouts.get(target);
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        this.backgroundCollapseTimeouts.delete(target);
        target.classList.remove('bg-collapsing');
        target.style.removeProperty('--background-vocal-exit-duration');
        this.scheduleBackgroundExpansion(target);
      }
      return;
    }

    if (this.backgroundExpandFrameId !== undefined) {
      cancelAnimationFrame(this.backgroundExpandFrameId);
      this.backgroundExpandFrameId = undefined;
    }

    const previousLine = this.backgroundExpandedLine;
    if (previousLine) {
      previousLine.classList.remove('bg-expanded');
      const oldTimeoutId = this.backgroundCollapseTimeouts.get(previousLine);
      if (oldTimeoutId !== undefined) clearTimeout(oldTimeoutId);
      const exitDuration = AmLyrics.getCssTimeMs(
        previousLine,
        '--scroll-duration',
        AmLyrics.getCssTimeMs(
          previousLine,
          '--am-lyrics-background-vocal-exit-duration',
          BACKGROUND_EXIT_DURATION_MS,
        ),
      );
      previousLine.style.setProperty(
        '--background-vocal-exit-duration',
        `${exitDuration}ms`,
      );
      previousLine.classList.add('bg-collapsing');
      const timeoutId = window.setTimeout(() => {
        previousLine.classList.remove('bg-collapsing');
        previousLine.style.removeProperty('--background-vocal-exit-duration');
        this.backgroundCollapseTimeouts.delete(previousLine);
      }, exitDuration);
      this.backgroundCollapseTimeouts.set(previousLine, timeoutId);
    }

    this.backgroundExpandedLine = target;
    if (target) {
      const timeoutId = this.backgroundCollapseTimeouts.get(target);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      this.backgroundCollapseTimeouts.delete(target);
      target.classList.remove('bg-collapsing');
      target.style.removeProperty('--background-vocal-exit-duration');
      this.scheduleBackgroundExpansion(target);
    }
  }

  private scheduleBackgroundExpansion(target: HTMLElement): void {
    if (this.backgroundExpandFrameId !== undefined) return;

    const backgroundVocal = target.querySelector(
      '.background-vocal-container',
    ) as HTMLElement | null;
    if (!backgroundVocal) return;

    target.style.setProperty(
      '--am-lyrics-background-vocal-height',
      `${Math.ceil(backgroundVocal.scrollHeight + 4)}px`,
    );
    target.classList.remove('bg-expanded');

    // Two frames guarantee that the collapsed geometry is painted before the
    // expansion begins, including when lyrics are first rendered mid-line.
    this.backgroundExpandFrameId = requestAnimationFrame(() => {
      this.backgroundExpandFrameId = requestAnimationFrame(() => {
        this.backgroundExpandFrameId = undefined;
        if (this.backgroundExpandedLine === target) {
          target.classList.add('bg-expanded');
        }
      });
    });
  }

  private clearBackgroundExpandedLine(): void {
    if (this.backgroundExpandFrameId !== undefined) {
      cancelAnimationFrame(this.backgroundExpandFrameId);
      this.backgroundExpandFrameId = undefined;
    }
    this.backgroundExpandedLine?.classList.remove(
      'bg-expanded',
      'bg-collapsing',
    );
    this.backgroundExpandedLine?.style.removeProperty(
      '--background-vocal-exit-duration',
    );
    for (const [line, timeoutId] of this.backgroundCollapseTimeouts) {
      clearTimeout(timeoutId);
      line.classList.remove('bg-collapsing');
      line.style.removeProperty('--background-vocal-exit-duration');
    }
    this.backgroundCollapseTimeouts.clear();
    this.backgroundExpandedLine = null;
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
    _activeIndices: number[],
    time: number,
  ): number | null {
    if (!this.lyrics || this.lyrics.length === 0) return null;

    // YouLyPlus-style: primary is simply the line at predictive time.
    const primaryIndex = this.getLineIndexAtTime(time, this.lastActiveIndex);
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

  private getOverlapClusterForActiveIndices(
    activeIndices: number[],
    time: number,
  ): {
    start: number;
    end: number;
    startedEnd: number;
    startedEndTime: number;
  } | null {
    if (!this.lyrics || activeIndices.length === 0) return null;

    let start = activeIndices[0];
    while (
      start > 0 &&
      this.lyrics[start - 1].endtime >= this.lyrics[start].timestamp
    ) {
      start -= 1;
    }

    let end = start;
    let clusterEndTime = this.lyrics[start].endtime;
    while (
      end + 1 < this.lyrics.length &&
      this.lyrics[end + 1].timestamp <= clusterEndTime
    ) {
      end += 1;
      clusterEndTime = Math.max(clusterEndTime, this.lyrics[end].endtime);
    }

    let startedEnd = start;
    let startedEndTime = this.lyrics[start].endtime;
    for (let i = start; i <= end; i += 1) {
      if (this.lyrics[i].timestamp <= time) {
        startedEnd = i;
        startedEndTime = Math.max(startedEndTime, this.lyrics[i].endtime);
      } else {
        break;
      }
    }

    return { start, end, startedEnd, startedEndTime };
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
      // .active is now managed solely by findActiveLineIndices (which uses
      // effectiveEndTimes).  Lines stay active until their extended end,
      // so we no longer need to remove .active here.
      this.lastPrimaryActiveLine = this.currentPrimaryActiveLine;
      if (this.lastPrimaryActiveLine) {
        this.lastPrimaryActiveLine.style.setProperty(
          '--scroll-duration',
          `${scrollDuration ?? SCROLL_ANIMATION_DURATION_MS}ms`,
        );
        this.lastPrimaryActiveLine.classList.add('scroll-exiting');
      }
      this.currentPrimaryActiveLine = lineElement;
      this.currentPrimaryActiveLine.classList.remove('scroll-exiting');
      const lineIndex = AmLyrics.getLineIndexFromElement(lineElement);
      if (lineIndex !== null) {
        this.lastActiveIndex = lineIndex;
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
        this._handleActiveLineScroll([], true);
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
    const containerRect = this.lyricsContainer.getBoundingClientRect();
    const anchorY = containerRect.top + this.getScrollPaddingTop();

    for (let i = 0; i < lineElements.length; i += 1) {
      const lineElement = lineElements[i];
      if (
        lineElement.classList.contains('active') ||
        !lineElement.classList.contains('persist-highlight')
      ) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const lineRect = lineElement.getBoundingClientRect();
      const hasScrolledPast = lineRect.bottom < anchorY - 2;
      if (hasScrolledPast) {
        AmLyrics.unfinishSyllables(lineElement);
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

  private startAnimationFromTime(time: number) {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    if (!this.lyrics) return;

    const activeLineIndices = this.findActiveLineIndices(time);
    if (!AmLyrics.arraysEqual(activeLineIndices, this.activeLineIndices)) {
      this.activeLineIndices = activeLineIndices;
    }

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
    if (!AmLyrics.arraysEqual(activeLineIndices, this.activeLineIndices)) {
      this.activeLineIndices = activeLineIndices;
    }

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

    // Cancel any ongoing scroll animations
    if (this.scrollAnimationState) {
      this.scrollAnimationState.isAnimating = false;
      this.scrollAnimationState.pendingUpdate = null;
      this.scrollAnimationState.pendingReferenceElement = null;
      this.scrollAnimationState.pendingScrollDuration = undefined;
    }

    // Clear scroll animation timeouts
    if (this.scrollAnimationTimeout) {
      clearTimeout(this.scrollAnimationTimeout);
      this.scrollAnimationTimeout = undefined;
    }

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
    this.animatingLines = [];
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

  /**
   * Animate scroll with staggered delay for smooth YouLyPlus-style scrolling
   */
  private animateScrollYouLy(
    newTranslateY: number,
    forceScroll = false,
    scrollDuration: number | undefined = undefined,
    referenceElement: HTMLElement | null = null,
  ): void {
    if (!this.lyricsContainer) return;
    const parent = this.lyricsContainer;
    const maxScrollTop = Math.max(0, parent.scrollHeight - parent.clientHeight);
    const targetTop = AmLyrics.clamp(-newTranslateY, 0, maxScrollTop);

    if (!this.scrollAnimationState) {
      this.scrollAnimationState = {
        isAnimating: false,
        pendingUpdate: null,
        pendingReferenceElement: null,
        pendingScrollDuration: undefined,
      };
      this.animatingLines = [];
    }

    const animState = this.scrollAnimationState;

    if (animState.isAnimating && !forceScroll) {
      const pendingTop =
        animState.pendingUpdate === null
          ? null
          : Math.max(0, -animState.pendingUpdate);
      if (
        Math.abs(parent.scrollTop - targetTop) < 2 ||
        (pendingTop !== null && Math.abs(pendingTop - targetTop) < 2)
      ) {
        return;
      }
      animState.pendingUpdate = newTranslateY;
      animState.pendingReferenceElement = referenceElement;
      animState.pendingScrollDuration = scrollDuration;
      return;
    }

    if (this.scrollAnimationTimeout) {
      clearTimeout(this.scrollAnimationTimeout);
      this.scrollAnimationTimeout = undefined;
    }
    if (this.scrollUnlockTimeout) {
      clearTimeout(this.scrollUnlockTimeout);
      this.scrollUnlockTimeout = undefined;
    }

    const { animatingLines } = this;

    const appliedTranslateY = -targetTop;
    // Safari can expose negative or beyond-the-end scrollTop values during
    // elastic overscroll. Never feed those transient values into the visual
    // line offset, or the whole stack can animate past the viewport edge.
    const currentTop = AmLyrics.clamp(parent.scrollTop, 0, maxScrollTop);
    const prevOffset = -currentTop;
    const delta = prevOffset - appliedTranslateY;
    const maxVisualDelta = Math.max(120, parent.clientHeight * 0.75);
    const visualDelta = AmLyrics.clamp(delta, -maxVisualDelta, maxVisualDelta);
    this.currentScrollOffset = appliedTranslateY;

    // Skip animation if already at the target position (e.g., first lines at top)
    if (Math.abs(currentTop - targetTop) < 1 && Math.abs(delta) < 1) {
      animState.isAnimating = false;
      animState.pendingUpdate = null;
      animState.pendingReferenceElement = null;
      animState.pendingScrollDuration = undefined;
      return;
    }

    if (forceScroll) {
      // Clean up any lingering scroll animations before smooth scroll
      for (const line of animatingLines) {
        line.classList.remove('scroll-animate');
        line.style.removeProperty('--scroll-delta');
        line.style.removeProperty('--lyrics-line-delay');
        line.style.removeProperty('--scroll-duration');
      }
      animatingLines.length = 0;
      parent.scrollTo({ top: targetTop, behavior: 'smooth' });
      animState.isAnimating = false;
      animState.pendingUpdate = null;
      animState.pendingReferenceElement = null;
      animState.pendingScrollDuration = undefined;
      return;
    }

    // --- Step 1: Remove scroll-animate and custom properties from ALL
    // previously animating lines so stale deltas don't interfere. ---
    for (const line of animatingLines) {
      line.classList.remove('scroll-animate');
      line.style.removeProperty('--scroll-delta');
      line.style.removeProperty('--lyrics-line-delay');
      line.style.removeProperty('--scroll-duration');
    }
    animatingLines.length = 0;

    // Get lines for staggered animation — use cached array
    if (this.cachedLineArray.length === 0) {
      const lineElements =
        this.lyricsContainer.querySelectorAll('.lyrics-line');
      this.cachedLineArray = Array.from(lineElements) as HTMLElement[];
    }
    const lineArray = this.cachedLineArray;

    const referenceLine =
      referenceElement ||
      this.currentPrimaryActiveLine ||
      this.lastPrimaryActiveLine ||
      lineArray[0];

    if (!referenceLine) return;

    const referenceIndex = lineArray.indexOf(referenceLine);
    if (referenceIndex === -1) return;

    const duration = Math.min(
      450,
      scrollDuration ?? SCROLL_ANIMATION_DURATION_MS,
    );
    const delayIncrement = duration * 0.1;
    const maxStaggerSteps = 4;
    const lookAhead = 20;
    const len = lineArray.length;

    const start = Math.max(0, referenceIndex - lookAhead);
    const end = Math.min(len, referenceIndex + lookAhead);

    let maxAnimationDuration = 0;
    const newAnimatingLines: HTMLElement[] = [];
    const lineDelays = new Map<HTMLElement, number>();
    const scrollingDown = delta >= 0;

    if (scrollingDown) {
      let delayCounter = 0;
      for (let i = start; i < end; i += 1) {
        const line = lineArray[i];
        const delay =
          i >= referenceIndex
            ? Math.min(delayCounter, maxStaggerSteps) * delayIncrement
            : 0;

        if (i >= referenceIndex && !line.classList.contains('lyrics-gap')) {
          delayCounter += 1;
        }

        line.style.setProperty('--scroll-delta', `${visualDelta}px`);
        line.style.setProperty('--lyrics-line-delay', `${delay}ms`);
        lineDelays.set(line, delay);

        newAnimatingLines.push(line);

        const lineDuration = duration + 100 + delay;
        if (lineDuration > maxAnimationDuration) {
          maxAnimationDuration = lineDuration;
        }
      }
    } else {
      let delayCounter = 0;
      for (let i = end - 1; i >= start; i -= 1) {
        const line = lineArray[i];
        const delay =
          i <= referenceIndex
            ? Math.min(delayCounter, maxStaggerSteps) * delayIncrement
            : 0;

        if (i <= referenceIndex && !line.classList.contains('lyrics-gap')) {
          delayCounter += 1;
        }

        line.style.setProperty('--scroll-delta', `${visualDelta}px`);
        line.style.setProperty('--lyrics-line-delay', `${delay}ms`);
        lineDelays.set(line, delay);

        newAnimatingLines.push(line);

        const lineDuration = duration + 100 + delay;
        if (lineDuration > maxAnimationDuration) {
          maxAnimationDuration = lineDuration;
        }
      }
    }

    /* Preserve the staggered starts, but make every line settle together.
       This keeps the selected line from drifting after its neighbours. */
    for (const line of newAnimatingLines) {
      const delay = lineDelays.get(line) ?? 0;
      line.style.setProperty(
        '--scroll-duration',
        `${Math.max(100, maxAnimationDuration - delay)}ms`,
      );
    }

    // Commit the real scroll position before starting the visual FLIP. Unlike
    // scrollTo({ behavior: 'instant' }), assigning scrollTop is synchronous in
    // WebKit, so Safari cannot paint an intermediate frame above the viewport.
    parent.scrollTop = targetTop;

    // --- Step 3: Force reflow so the browser sees the class removal and the
    // synchronous scroll position before the animation begins. ---
    // Use offsetHeight which is cheaper than getBoundingClientRect.
    // eslint-disable-next-line no-void
    void parent.offsetHeight;

    // --- Step 4: Re-add scroll-animate class to start fresh animations ---
    for (const line of newAnimatingLines) {
      line.classList.add('scroll-animate');
      animatingLines.push(line);
    }

    animState.isAnimating = true;

    this.scrollUnlockTimeout = setTimeout(() => {
      animState.isAnimating = false;
      if (animState.pendingUpdate !== null) {
        const pendingValue = animState.pendingUpdate;
        const pendingReference = animState.pendingReferenceElement;
        const pendingDuration = animState.pendingScrollDuration;
        animState.pendingUpdate = null;
        animState.pendingReferenceElement = null;
        animState.pendingScrollDuration = undefined;
        this.animateScrollYouLy(
          pendingValue,
          false,
          pendingDuration,
          pendingReference,
        );
      }
    }, maxAnimationDuration);

    this.scrollAnimationTimeout = setTimeout(() => {
      for (let i = 0; i < animatingLines.length; i += 1) {
        const line = animatingLines[i];
        line.classList.remove('scroll-animate');
        line.style.removeProperty('--scroll-delta');
        line.style.removeProperty('--lyrics-line-delay');
        line.style.removeProperty('--scroll-duration');
      }
      animatingLines.length = 0;
      this.scrollAnimationTimeout = undefined;
    }, maxAnimationDuration + 50);
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
    const previousSibling = activeLine.previousElementSibling;
    const precedingGap =
      previousSibling instanceof HTMLElement &&
      previousSibling.classList.contains('lyrics-gap') &&
      (previousSibling.classList.contains('active') ||
        previousSibling.classList.contains('gap-collapsing') ||
        previousSibling.classList.contains('gap-exiting'))
        ? previousSibling
        : null;
    /* The gap starts collapsing during this predictive scroll. Aim at the
       lyric's post-collapse offset so the scroll transform and layout reflow
       do not both apply the same vertical distance. */
    const targetOffsetTop =
      activeLine.offsetTop - (precedingGap?.offsetHeight ?? 0);
    const targetTop = Math.max(0, targetOffsetTop - paddingTop);
    const targetTranslateY = -targetTop;

    // Skip if already at target position
    if (
      !forceScroll &&
      Math.abs(this.lyricsContainer.scrollTop - targetTop) < 1
    ) {
      return;
    }

    // Skip scroll if near the bottom of content and we aren't trying to scroll back up
    if (!forceScroll && !activeLine.classList.contains('lyrics-footer')) {
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

    this.animateScrollYouLy(targetTranslateY, forceScroll, scrollDuration);
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

  private static applyWipeShape(element: HTMLElement, charCount: number): void {
    const extra =
      AmLyrics.clamp((charCount - 6) / 10, 0, 1) * LONG_WORD_WIPE_EXTRA_EM;
    const width = BASE_WIPE_GRADIENT_EM + extra;
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
        const startPct = Number.parseFloat(
          span.dataset.wipeStart || `${index / Math.max(1, charSpans.length)}`,
        );
        span.style.setProperty(
          '--char-wipe-position',
          `${-(AmLyrics.clamp(startPct, 0, 1) * approxWidthCh)}ch`,
        );
      }
    });
  }

  private static clearPreHighlight(syllable: HTMLElement): void {
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
        !AmLyrics.hasTextBoundaryAfter(previousSyllable)
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
    wordSyllables: HTMLElement[],
    currentTimeMs: number,
    preWipeStartMs: number,
    preWipeDurationMs: number,
  ): void {
    if (AmLyrics.isPreWipeArmed(nextSyllable)) return;

    const wordElement = AmLyrics.getWordElementForSyllable(nextSyllable);
    const wordElements = AmLyrics.getCachedVirtualWordElements(wordElement);
    const isCharacterRiseWord = wordElements.some(element =>
      element.classList.contains('char-rise'),
    );
    const charSpans = AmLyrics.getCachedVirtualWordCharSpans(wordElement, []);
    const elapsedPreWipe = currentTimeMs - preWipeStartMs;
    const charCount =
      charSpans.length ||
      wordSyllables.reduce(
        (total, wordSyllable) =>
          total + (wordSyllable.textContent || '').replace(/\s/g, '').length,
        0,
      ) ||
      (nextSyllable.textContent || '').replace(/\s/g, '').length;
    AmLyrics.ensureWordWipeGeometry(charSpans, charCount);
    const leadChar = charSpans[0];
    const leadCharSyllable = leadChar?.closest(
      '.lyrics-syllable',
    ) as HTMLElement | null;
    const preWipeSyllable =
      leadCharSyllable || wordSyllables[0] || nextSyllable;

    AmLyrics.applyWipeShape(preWipeSyllable, charCount);
    preWipeSyllable.style.setProperty(
      '--pre-wipe-duration',
      `${preWipeDurationMs}ms`,
    );
    preWipeSyllable.style.setProperty(
      '--pre-wipe-delay',
      `${-elapsedPreWipe}ms`,
    );
    preWipeSyllable.classList.add('pre-highlight');

    // Character-animated words still need a single word-leading gradient.
    // Giving every glyph this state creates one gradient per character and
    // makes the whole word enter the pre-wipe continuation simultaneously.
    if (leadChar && !isCharacterRiseWord) {
      AmLyrics.applyWipeShape(leadChar, charCount);
      leadChar.style.setProperty(
        '--pre-wipe-duration',
        `${preWipeDurationMs}ms`,
      );
      leadChar.style.setProperty('--pre-wipe-delay', `${-elapsedPreWipe}ms`);
      leadChar.classList.add('pre-wipe-lead');
    }

    wordElements.forEach(element => {
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
    if (
      AmLyrics.getCachedVirtualWordElements(wordElement).some(element =>
        element.classList.contains('char-rise'),
      )
    ) {
      return 0;
    }
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

  private static getWipeHandoffEndTime(syllable: HTMLElement): number | null {
    const wordElement = AmLyrics.getWordElementForSyllable(syllable);
    if (!wordElement) return null;

    const cacheTarget = wordElement as any;
    if (cacheTarget._cachedWipeHandoffEndTime !== undefined) {
      return cacheTarget._cachedWipeHandoffEndTime as number | null;
    }

    const wordElements = AmLyrics.getCachedVirtualWordElements(wordElement);
    const wordSyllables = AmLyrics.getRenderedWordSyllables(syllable);
    const lastSyllable = wordSyllables[wordSyllables.length - 1] || syllable;
    const vocalTrack = AmLyrics.getVocalTrack(syllable) as HTMLElement | null;
    let handoffEndTime: number | null = null;

    if (
      vocalTrack &&
      !syllable.classList.contains('line-synced') &&
      AmLyrics.hasTextBoundaryAfter(lastSyllable)
    ) {
      const trackTarget = vocalTrack as any;
      if (!trackTarget._cachedTimedSyllables) {
        trackTarget._cachedTimedSyllables = Array.from(
          vocalTrack.querySelectorAll('.lyrics-syllable'),
        ).filter(
          element =>
            !(element as HTMLElement).classList.contains('transliteration'),
        ) as HTMLElement[];
      }
      const trackSyllables = trackTarget._cachedTimedSyllables as HTMLElement[];
      const lastIndex = trackSyllables.indexOf(lastSyllable);
      const nextSyllable = trackSyllables[lastIndex + 1];

      if (nextSyllable && !nextSyllable.classList.contains('line-synced')) {
        const currentEndTimeMs = Number.parseFloat(
          wordElement.dataset.virtualWordEnd ||
            `${(lastSyllable as any)._cachedEndTime}`,
        );
        const currentStartTimeMs = Number.parseFloat(
          wordElement.dataset.virtualWordStart ||
            `${(wordSyllables[0] as any)?._cachedStartTime}`,
        );
        const finalSyllableStartTimeMs = Number.parseFloat(
          `${(lastSyllable as any)._cachedStartTime}`,
        );
        const nextStartTimeMs = Number.parseFloat(
          `${(nextSyllable as any)._cachedStartTime}`,
        );
        const gapMs = nextStartTimeMs - currentEndTimeMs;
        const preWipeDuration = AmLyrics.getWordPreWipeDuration(nextSyllable);
        const candidateEndTime = nextStartTimeMs - preWipeDuration;

        if (
          Number.isFinite(currentStartTimeMs) &&
          Number.isFinite(currentEndTimeMs) &&
          Number.isFinite(finalSyllableStartTimeMs) &&
          Number.isFinite(nextStartTimeMs) &&
          gapMs >= 0 &&
          gapMs <= NEXT_WORD_PRE_WIPE_MAX_GAP_MS &&
          preWipeDuration > 0 &&
          candidateEndTime -
            Math.max(currentStartTimeMs, finalSyllableStartTimeMs) >=
            NEXT_WORD_PRE_WIPE_MIN_DURATION_MS
        ) {
          handoffEndTime = candidateEndTime;
        }
      }
    }

    wordElements.forEach(element => {
      const target = element as any;
      target._cachedWipeHandoffEndTime = handoffEndTime;
    });
    return handoffEndTime;
  }

  private static maybePreWipeNextWord(
    syllables: HTMLElement[],
    index: number,
    currentTimeMs: number,
    currentEndTimeMs: number,
  ): void {
    const syllable = syllables[index];
    if (
      syllable.classList.contains('line-synced') ||
      syllable.classList.contains('transliteration') ||
      syllable.closest('.lyrics-gap')
    ) {
      return;
    }

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

    const gapMs = nextStartTimeMs - currentEndTimeMs;
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
    const preWipeStart = nextStartTimeMs - preWipeDuration;
    const currentWordElement = AmLyrics.getWordElementForSyllable(syllable);
    const currentWordStartMs = Number.parseFloat(
      currentWordElement?.dataset.virtualWordStart ||
        `${(syllable as any)._cachedStartTime}`,
    );
    const currentSyllableStartMs = Number.parseFloat(
      `${(syllable as any)._cachedStartTime}`,
    );

    // Reserve the complete pre-wipe window. If the source timestamps leave no
    // room for both words, skip only that impossible handoff rather than
    // overlapping two independent wipe gradients.
    if (
      !Number.isFinite(currentWordStartMs) ||
      !Number.isFinite(currentSyllableStartMs) ||
      preWipeStart - Math.max(currentWordStartMs, currentSyllableStartMs) <
        NEXT_WORD_PRE_WIPE_MIN_DURATION_MS ||
      currentTimeMs < preWipeStart ||
      currentTimeMs >= nextStartTimeMs
    ) {
      return;
    }

    if (AmLyrics.isPreWipeArmed(nextSyllable)) return;

    AmLyrics.applyWordPreWipe(
      nextSyllable,
      preWipeSyllables,
      currentTimeMs,
      preWipeStart,
      preWipeDuration,
    );
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

    const { classList } = syllable;
    const hadPreHighlight = classList.contains('pre-highlight');
    const isRTL = classList.contains('rtl-text');
    const charSpans = AmLyrics.getCachedCharSpans(syllable);
    const wordElement = syllable.parentElement?.parentElement; // syllable-wrap -> word
    const typedWordElement = wordElement as HTMLElement | undefined;
    const allWordElements =
      AmLyrics.getCachedVirtualWordElements(typedWordElement);
    const allWordCharSpans = AmLyrics.getCachedVirtualWordCharSpans(
      typedWordElement,
      charSpans,
    );
    const isGrowable = typedWordElement?.classList.contains('growable');
    const isCharRise = typedWordElement?.classList.contains('char-rise');
    const isCharDrag = typedWordElement?.classList.contains('char-drag');
    const isFirstSyllable =
      syllable.getAttribute('data-syllable-index') === '0';
    const syllableStartMs = parseFloat(
      syllable.getAttribute('data-start-time') || '0',
    );
    const virtualWordStartMs = parseFloat(
      typedWordElement?.dataset.virtualWordStart || '',
    );
    const isFirstInVirtualWord =
      isFirstSyllable &&
      (!Number.isFinite(virtualWordStartMs) ||
        Math.abs(syllableStartMs - virtualWordStartMs) < 0.5);
    const isFirstInContainer = isFirstSyllable; // Simplified
    const isGap = syllable.closest('.lyrics-gap') !== null;

    // Get duration from data attribute
    const syllableDurationMs =
      parseFloat(syllable.getAttribute('data-duration') || '0') || 300;
    const wordDurationMs =
      parseFloat(
        syllable.getAttribute('data-word-duration') ||
          syllable.getAttribute('data-duration') ||
          '0',
      ) || syllableDurationMs;
    const wordElapsedTimeMs = Number.isFinite(virtualWordStartMs)
      ? elapsedTimeMs + (syllableStartMs - virtualWordStartMs)
      : elapsedTimeMs;
    const nominalCharWipeDurationMs = Math.max(
      wordDurationMs,
      syllableDurationMs,
    );
    const handoffEndTimeMs = AmLyrics.getWipeHandoffEndTime(syllable);
    const wipeTimelineStartMs = Number.isFinite(virtualWordStartMs)
      ? virtualWordStartMs
      : syllableStartMs;
    const charWipeDurationMs =
      handoffEndTimeMs === null
        ? nominalCharWipeDurationMs
        : Math.min(
            nominalCharWipeDurationMs,
            Math.max(1, handoffEndTimeMs - wipeTimelineStartMs),
          );

    const charAnimationsMap = new Map<HTMLElement, string>();
    const styleUpdates: Array<{
      element: HTMLElement;
      property: string;
      value: string;
    }> = [];

    // Step 1: Grow Pass
    if (isGrowable && isFirstInVirtualWord && allWordCharSpans.length > 0) {
      const finalDuration = wordDurationMs;
      const baseDelayPerChar = finalDuration * 0.09;
      const growDurationMs = finalDuration * 1.5;

      allWordCharSpans.forEach(span => {
        const matrixScale = span.dataset.matrixScale || '1.1';
        const charOffsetX = span.dataset.charOffsetX || '0';
        const shadowIntensity = span.dataset.shadowIntensity || '0.6';
        const translateYPeak = span.dataset.translateYPeak || '-2';

        const syllableCharIndex = parseFloat(
          span.dataset.syllableCharIndex || '0',
        );
        const growDelay = baseDelayPerChar * syllableCharIndex;

        charAnimationsMap.set(
          span,
          `grow-dynamic ${growDurationMs}ms ease-in-out ${growDelay}ms forwards`,
        );

        styleUpdates.push({
          element: span,
          property: '--matrix-scale',
          value: matrixScale,
        });
        styleUpdates.push({
          element: span,
          property: '--char-offset-x',
          value: `${charOffsetX}px`,
        });
        styleUpdates.push({
          element: span,
          property: '--shadow-intensity',
          value: shadowIntensity,
        });
        styleUpdates.push({
          element: span,
          property: '--translate-y-peak',
          value: `${translateYPeak}px`,
        });
      });
    }

    if (isCharRise && isFirstInVirtualWord && allWordCharSpans.length > 0) {
      const finalDuration = Math.max(wordDurationMs, syllableDurationMs);
      const baseDelayPerChar = finalDuration * 0.06;
      const riseDurationMs = finalDuration * 1.2;

      allWordCharSpans.forEach(span => {
        const charIndex = parseFloat(span.dataset.syllableCharIndex || '0');
        const riseDelay = baseDelayPerChar * charIndex;
        charAnimationsMap.set(
          span,
          `rise-char ${riseDurationMs}ms ease-in-out ${riseDelay}ms forwards`,
        );
      });
    }

    if (isCharDrag && isFirstInVirtualWord && allWordCharSpans.length > 0) {
      const finalDuration = Math.max(wordDurationMs, syllableDurationMs);
      const baseDelayPerChar = AmLyrics.clamp(finalDuration * 0.15, 64, 118);
      const dragDurationMs = AmLyrics.clamp(finalDuration * 0.82, 560, 900);

      allWordCharSpans.forEach(span => {
        const charIndex = parseFloat(span.dataset.syllableCharIndex || '0');
        const dragDelay = baseDelayPerChar * charIndex;

        charAnimationsMap.set(
          span,
          `drag-char ${dragDurationMs}ms ease ${dragDelay}ms forwards`,
        );
      });
    }

    // Step 2: Wipe Pass
    if (charSpans.length > 0) {
      const wipeCharCount =
        allWordCharSpans.length ||
        charSpans.length ||
        AmLyrics.getVisibleCharacterCount(syllable);
      const wipeScale = AmLyrics.getLongWordWipeScale(wipeCharCount);
      AmLyrics.applyWipeShape(syllable, wipeCharCount);
      AmLyrics.ensureWordWipeGeometry(allWordCharSpans, wipeCharCount);
      allWordCharSpans.forEach(span =>
        AmLyrics.applyWipeShape(span, wipeCharCount),
      );

      const hasWordLevelWipe =
        !isFirstInVirtualWord &&
        (Boolean((typedWordElement as any)?._wordWipeStarted) ||
          allWordCharSpans.some(span => span.style.animation.includes('wipe')));
      let charSpansToAnimate = charSpans;
      if (isFirstInVirtualWord) {
        charSpansToAnimate = allWordCharSpans;
      } else if (hasWordLevelWipe) {
        charSpansToAnimate = [];
      }

      if (charSpansToAnimate.length > 0 && allWordElements.length > 0) {
        allWordElements.forEach(element => {
          const target = element as any;
          target._wordWipeStarted = true;
          target._wordPreWipeKey = undefined;
        });
      }

      charSpansToAnimate.forEach((span, charIndex) => {
        const startPct = parseFloat(span.dataset.wipeStart || '0');
        const durationPct = parseFloat(span.dataset.wipeDuration || '0');
        const globalCharIndex = parseFloat(
          span.dataset.syllableCharIndex || `${charIndex}`,
        );

        const hadCharPreWipe =
          span.classList.contains('pre-wipe-lead') ||
          (hadPreHighlight && globalCharIndex === 0);
        const charStartMs = charWipeDurationMs * startPct;
        const remainingWordWipeMs = Math.max(
          0,
          charWipeDurationMs - charStartMs,
        );
        const wipeDelay = charStartMs - wordElapsedTimeMs;
        const wipeDuration = Math.min(
          charWipeDurationMs * durationPct * wipeScale,
          remainingWordWipeMs,
        );
        const useStartAnimation =
          isFirstInContainer && globalCharIndex === 0 && !hadCharPreWipe;
        let charWipeAnimation = 'char-wipe';
        if (hadCharPreWipe) {
          charWipeAnimation = 'char-wipe';
        } else if (useStartAnimation) {
          charWipeAnimation = 'char-start-wipe';
        }

        const existingAnimation =
          charAnimationsMap.get(span) || span.style.animation || '';

        const animationParts = [];

        if (
          existingAnimation &&
          (existingAnimation.includes('grow-dynamic') ||
            existingAnimation.includes('rise-char') ||
            existingAnimation.includes('drag-char'))
        ) {
          animationParts.push(existingAnimation.split(',')[0].trim());
        }
        if (
          globalCharIndex > 0 &&
          !hadCharPreWipe &&
          wipeDelay > 0 &&
          wipeDuration > 0
        ) {
          const measuredDuration = Number.parseFloat(
            span.dataset.preWipeDuration || '100',
          );
          const preWipeDuration = Math.min(
            measuredDuration,
            wipeDuration * 0.9,
            charWipeDurationMs * 0.08,
            wipeDelay,
          );

          if (preWipeDuration >= 16) {
            animationParts.push(
              `char-pre-wipe ${preWipeDuration}ms linear ${wipeDelay - preWipeDuration}ms none`,
            );
          }
        }
        if (wipeDuration > 0) {
          const wipeFillMode = hadCharPreWipe ? 'both' : 'forwards';
          animationParts.push(
            `${charWipeAnimation} ${wipeDuration}ms linear ${wipeDelay}ms ${wipeFillMode}`,
          );
        }

        if (animationParts.length > 0) {
          charAnimationsMap.set(span, animationParts.join(', '));
        }
      });
    } else {
      // Syllable-level wipe for regular (non-growable) words without chars
      const wipeRatio = parseFloat(
        syllable.getAttribute('data-wipe-ratio') || '1',
      );
      const wipeCharCount = AmLyrics.getVisibleCharacterCount(syllable);
      const wipeScale = AmLyrics.getLongWordWipeScale(wipeCharCount);
      const nominalVisualDuration = syllableDurationMs * wipeRatio * wipeScale;
      const visualDuration =
        handoffEndTimeMs === null
          ? nominalVisualDuration
          : Math.min(
              nominalVisualDuration,
              Math.max(1, handoffEndTimeMs - syllableStartMs),
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

    // --- WRITE PHASE ---
    if (allWordElements.length > 0) {
      allWordElements.forEach(element => {
        const target = element as any;
        target._wordPreWipeKey = undefined;
      });
    }

    classList.remove('pre-highlight');
    classList.add('highlight');
    allWordCharSpans.forEach(span => AmLyrics.clearPreWipeLead(span));

    // Apply keyframe variables before assigning animation strings so the
    // first painted frame never uses fallback transform values.
    for (const update of styleUpdates) {
      update.element.style.setProperty(update.property, update.value);
    }

    for (const [span, animationString] of charAnimationsMap.entries()) {
      span.style.willChange = 'transform';
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
    // Force background to secondary and disable transition to prevent lingering white
    // eslint-disable-next-line no-param-reassign
    syllable.style.transition = 'none';
    // eslint-disable-next-line no-param-reassign
    syllable.style.backgroundColor = 'var(--lyplus-text-secondary)';

    // Reset character animations — disable transition so finished chars don't slowly fade
    const charSpans = syllable.querySelectorAll('span.char');
    for (let i = 0; i < charSpans.length; i += 1) {
      const el = charSpans[i] as HTMLElement;
      el.style.animation = '';
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

  private static resetWordAnimationState(line: HTMLElement): void {
    const wordElements = line.querySelectorAll('.lyrics-word');
    wordElements.forEach(wordElement => {
      const target = wordElement as any;
      target._wordPreWipeKey = undefined;
      target._wordWipeStarted = false;
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
        syllable.style.removeProperty('background-color');
        syllable.style.removeProperty('transition');
        const chars = syllable.querySelectorAll('span.char');
        for (let j = 0; j < chars.length; j += 1) {
          const el = chars[j] as HTMLElement;
          el.style.removeProperty('background-color');
          el.style.removeProperty('transition');
          el.style.removeProperty('will-change');
        }
      }
    });
  }

  /**
   * Gentle reset for normal playback: remove highlight/finished classes
   * without forcing inline styles. Lets CSS transition fade syllables
   * back to secondary colour smoothly.
   */
  private static unfinishSyllables(line: HTMLElement): void {
    if (!line) return;
    line.classList.remove('persist-highlight');
    AmLyrics.resetWordAnimationState(line);
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
        el.style.removeProperty('will-change');
        el.style.removeProperty('background-color');
        el.style.removeProperty('transition');
        el.style.removeProperty('filter');
        AmLyrics.clearPreWipeLead(el);
      }
    }
  }

  private static finishSyllablesUpToTime(
    line: HTMLElement,
    currentTimeMs: number,
  ): void {
    if (!line) return;
    let hasFinishedSyllable = false;

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
      if (Number.isFinite(startTime) && currentTimeMs >= startTime) {
        const { classList } = syllable;
        if (!classList.contains('finished')) {
          if (!classList.contains('highlight')) {
            AmLyrics.updateSyllableAnimation(
              syllable,
              Math.max(0, currentTimeMs - startTime),
            );
          }
          classList.add('finished');
        }
        hasFinishedSyllable = true;
        classList.remove('highlight');
        classList.remove('pre-highlight');
        classList.add('cleanup');
        syllable.style.animation = '';
        syllable.style.removeProperty('--pre-wipe-duration');
        syllable.style.removeProperty('--pre-wipe-delay');
        syllable.style.removeProperty('background-color');
        AmLyrics.applyWipeShape(
          syllable,
          AmLyrics.getVisibleCharacterCount(syllable),
        );
        const chars = syllable.querySelectorAll('span.char');
        for (let ci = 0; ci < chars.length; ci += 1) {
          const charEl = chars[ci] as HTMLElement;
          const currentAnim = charEl.style.animation || '';
          if (
            currentAnim.includes('grow-dynamic') ||
            currentAnim.includes('rise-char') ||
            currentAnim.includes('drag-char')
          ) {
            const parts = currentAnim.split(',').map(p => p.trim());
            const transformAnim = parts.find(
              p =>
                p.includes('grow-dynamic') ||
                p.includes('rise-char') ||
                p.includes('drag-char'),
            );
            charEl.style.animation = transformAnim || '';
          } else {
            charEl.style.animation = '';
          }
          charEl.style.backgroundColor = 'var(--lyplus-text-primary)';
          AmLyrics.clearPreWipeLead(charEl);
        }
      }
    }

    if (hasFinishedSyllable) {
      line.classList.add('persist-highlight');
    } else {
      line.classList.remove('persist-highlight');
    }
  }

  /**
   * Update syllables based on current time
   * Uses DOM caching and pre-highlight reset for smooth transitions
   */
  private static updateSyllablesForLine(
    line: HTMLElement,
    currentTimeMs: number,
  ): void {
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
            if (!previousCarriesHighlight) {
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
                // Keep the completed wipe state until user scroll resets it.
              }
            } else if (hasHighlight || hasFinished) {
              // Not yet started
              AmLyrics.resetSyllable(syllable);
            }

            AmLyrics.maybePreWipeNextWord(syllables, i, currentTimeMs, endTime);
          }
        }
      }
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
      this.animationFrameId = requestAnimationFrame(this._boundAnimateProgress);
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

                  return html`<span class="lyrics-word"
                    ><span
                      class="lyrics-syllable-wrap${bgRomanizedText
                        ? ' has-transliteration'
                        : ''}"
                      ><span
                        class="lyrics-syllable no-chars${syllable.lineSynced
                          ? ' line-synced'
                          : ''}"
                        data-start-time="${startTimeMs}"
                        data-end-time="${endTimeMs}"
                        data-duration="${durationMs}"
                        data-syllable-index="${syllableIndex}"
                        data-word-index="${syllableIndex}"
                        data-word-length="${syllable.text.replace(/\s/g, '')
                          .length}"
                        data-wipe-ratio="1"
                        >${syllable.text}</span
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
        const vwFullText = lineData?.vwFullText ?? [];
        const vwFullDuration = lineData?.vwFullDuration ?? [];
        const vwCharOffset = lineData?.vwCharOffset ?? [];
        const vwStartMs = lineData?.vwStartMs ?? [];
        const vwEndMs = lineData?.vwEndMs ?? [];
        const lineIsRTL = lineData?.lineIsRTL ?? false;

        const mainVocalElement = html`<p
          class="main-vocal-container ${lineIsRTL ? 'rtl-text' : ''}"
        >
          ${wordGroups.map((group, groupIdx) => {
            const isGrowable = groupGrowable[groupIdx];
            const isGlowing = groupGlowing[groupIdx];
            const isCharRise = groupCharRise[groupIdx];
            const isCharDrag = groupCharDrag[groupIdx];
            const isAnimatedByChar = isGrowable || isCharRise || isCharDrag;
            const groupLineSynced = group.some(s => s.lineSynced);

            const wordText = isAnimatedByChar ? vwFullText[groupIdx] : '';
            const wordDuration = isAnimatedByChar
              ? vwFullDuration[groupIdx]
              : 0;
            const wordNumChars = wordText.replace(/\s/g, '').length;
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

            // Calculate dynamic rise duration based on the audio duration of the word
            const wordStartTimeMs = group[0].timestamp;
            const wordEndTimeMs = group[group.length - 1].endtime;
            const actualDurationMs = wordEndTimeMs - wordStartTimeMs;
            // Base float is 0.8s, plus a portion of the audio duration, capped between 1.0s and 2.5s
            const riseDuration = Math.max(
              1.2,
              Math.min(2.5, 1.2 + (actualDurationMs / 1000) * 0.6),
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
              style="--rise-duration: ${riseDuration}s"
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

                let syllableContent: any = text;

                if (isAnimatedByChar) {
                  const numCharsInSyllable =
                    text.replace(/\s/g, '').length || 1;
                  const hasVirtualTiming =
                    wordDuration > 0 && Number.isFinite(virtualWordStart);
                  const syllableStartRatio = hasVirtualTiming
                    ? AmLyrics.clamp(
                        (startTimeMs - virtualWordStart) / wordDuration,
                        0,
                        1,
                      )
                    : 0;
                  const syllableDurationRatio = hasVirtualTiming
                    ? AmLyrics.clamp(durationMs / wordDuration, 0, 1)
                    : 1;
                  let charIndexInsideSyllable = 0;

                  syllableContent = html`${text.split('').map(char => {
                    if (char === ' ') return ' ';

                    const charIndexInsideWord =
                      groupCharOffset + sylCharAccumulator;
                    const localCharIndex = charIndexInsideSyllable;
                    const visibleWordChars = Math.max(1, wordNumChars);
                    const charStartPercentVal = AmLyrics.clamp(
                      syllableStartRatio +
                        (localCharIndex / numCharsInSyllable) *
                          syllableDurationRatio,
                      0,
                      1,
                    );
                    const charDurationPercentVal =
                      syllableDurationRatio / numCharsInSyllable ||
                      1 / visibleWordChars;

                    sylCharAccumulator += 1;
                    charIndexInsideSyllable += 1;

                    const minDuration = 400;
                    const maxDuration = 3000;
                    const easingPower = 3;
                    const progress = Math.min(
                      1,
                      Math.max(
                        0,
                        (wordDuration - minDuration) /
                          (maxDuration - minDuration),
                      ),
                    );
                    const easedProgress = progress ** easingPower;

                    const isLongWord = wordNumChars > 5;
                    const isShortDuration = wordDuration < 1200;
                    let maxDecayRate = 0;
                    if (isLongWord || isShortDuration) {
                      let decayStrength = 0;
                      if (isLongWord)
                        decayStrength +=
                          Math.min((wordNumChars - 5) / 5, 1.0) * 0.4;
                      if (isShortDuration && wordNumChars > 3)
                        decayStrength +=
                          Math.max(0, 1.0 - (wordDuration - 800) / 400) * 0.3;
                      else if (isShortDuration && wordNumChars <= 3)
                        decayStrength +=
                          Math.max(0, 1.0 - (wordDuration - 800) / 400) * 0.1;
                      maxDecayRate = Math.min(decayStrength, 0.7);
                    }

                    const positionInWord =
                      wordNumChars > 1
                        ? charIndexInsideWord / (wordNumChars - 1)
                        : 0;
                    const decayFactor = 1.0 - positionInWord * maxDecayRate;
                    const charProgress = easedProgress * decayFactor;

                    const baseGrowth = wordNumChars <= 3 ? 0.05 : 0.04;
                    const charMaxScale = 1.0 + baseGrowth + charProgress * 0.08;
                    const glowDurFactor = Math.min(1.1, wordDuration / 1500);
                    let glowLenFactor = 1.0;
                    if (wordNumChars <= 3) {
                      glowLenFactor = 0.85;
                    } else if (wordNumChars >= 6) {
                      glowLenFactor = 1.1;
                    }
                    const glowIntensityScale = glowDurFactor * glowLenFactor;
                    const charShadowIntensity = isGlowing
                      ? (0.35 + charProgress * 0.45) * glowIntensityScale
                      : 0;
                    const normalizedGrowth = (charMaxScale - 1.0) / 0.1;
                    const effectiveDuration =
                      (wordDuration + durationMs * 2) / 3;
                    const peakMultiplier = Math.min(
                      1,
                      Math.max(0.3, effectiveDuration / 2000),
                    );
                    const baseTranslateYPeak =
                      -normalizedGrowth * (2 * peakMultiplier); // Further dampened lift peak

                    const position = (charIndexInsideWord + 0.5) / wordNumChars;
                    const horizontalOffset =
                      (position - 0.5) * 2 * ((charMaxScale - 1.0) * 25);
                    const isDragMotion = isCharDrag;
                    let charTranslateYPeak = baseTranslateYPeak;
                    if (isCharRise) {
                      charTranslateYPeak = 0;
                    } else if (isDragMotion) {
                      charTranslateYPeak = -0.78;
                    }

                    let motionHorizontalOffset = horizontalOffset;
                    if (isCharRise) {
                      motionHorizontalOffset = 0;
                    } else if (isDragMotion) {
                      motionHorizontalOffset = 0;
                    }
                    return html`<span
                      class="char"
                      data-char-index="${charIndexInsideWord}"
                      data-syllable-char-index="${charIndexInsideWord}"
                      data-wipe-start="${charStartPercentVal.toFixed(4)}"
                      data-wipe-duration="${charDurationPercentVal.toFixed(4)}"
                      data-horizontal-offset="${horizontalOffset.toFixed(2)}"
                      data-max-scale="${charMaxScale.toFixed(3)}"
                      data-matrix-scale="${(charMaxScale * 0.98).toFixed(3)}"
                      data-char-offset-x="${(
                        motionHorizontalOffset * 0.98
                      ).toFixed(2)}"
                      data-shadow-intensity="${charShadowIntensity.toFixed(3)}"
                      data-translate-y-peak="${charTranslateYPeak.toFixed(3)}"
                      style="--word-wipe-width: ${visibleWordChars}ch; --char-wipe-position: -${charIndexInsideWord}ch"
                      >${char}</span
                    >`;
                  })}`;
                }

                return html`<span
                  class="lyrics-syllable-wrap${romanizedText
                    ? ' has-transliteration'
                    : ''}"
                  ><span
                    class="lyrics-syllable${groupLineSynced
                      ? ' line-synced'
                      : ''}${isAnimatedByChar ? ' has-chars' : ' no-chars'}"
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
          : 'blur-inactive-enabled'} ${hasDuetLines ? 'has-duet-lines' : ''}"
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

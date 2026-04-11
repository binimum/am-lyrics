import { css, html, LitElement, svg } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { GoogleService } from './GoogleService.js';

const VERSION = '1.2.3';
const INSTRUMENTAL_THRESHOLD_MS = 7000; // Show dots for gaps >= 7s
const FETCH_TIMEOUT_MS = 8000; // Timeout for all lyrics fetch requests
const SEEK_THRESHOLD_MS = 500;
const PRE_SCROLL_LEAD_MS = 500;
const SCROLL_ANIMATION_DURATION_MS = 280;
const SCROLL_DELAY_INCREMENT_MS = 24;
const GAP_PULSE_DURATION_MS = 4000;
const GAP_PULSE_CYCLE_MS = GAP_PULSE_DURATION_MS * 2;
const GAP_EXIT_LEAD_MS = 360;
const GAP_MIN_SCALE = 0.85;

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
  'https://lyricsplus.atomix.one',
  'https://lyricsplus-seven.vercel.app',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyrics-plus-backend.vercel.app',
];
const DEFAULT_KPOE_SOURCE_ORDER =
  'apple,lyricsplus,musixmatch,spotify,qq,deezer,musixmatch-word';

const TIDAL_SERVERS = [
  'https://arran.monochrome.tf',
  'https://api.monochrome.tf/',
  'https://triton.squid.wtf',
  'https://wolf.qqdl.site',
  'https://maus.qqdl.site',
  'https://vogel.qqdl.site',
  'https://katze.qqdl.site',
  'https://hund.qqdl.site',
  'https://tidal.kinoplus.online',
  'https://hifi-one.spotisaver.net',
  'https://hifi-two.spotisaver.net',
];
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
  source: string;
}

interface ResolvedMetadata {
  metadata?: SongMetadata;
  appleId?: string;
  appleSong?: any;
  catalogIsrc?: string;
}

export class AmLyrics extends LitElement {
  static styles = css`
    /* ==========================================================================
       YOULYPLUS-INSPIRED STYLING - Design Tokens & Variables
       ========================================================================== */
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

      --lyplus-font-size-base: 32px;
      --lyplus-font-size-base-grow: 24.5;
      --lyplus-font-size-subtext: 0.6em;

      --lyplus-blur-amount: 0.07em;
      --lyplus-blur-amount-near: 0.035em;
      --lyplus-fade-gap-timing-function: ease-out;

      --lyrics-scroll-padding-top: 25%;

      display: block;
      font-family:
        -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu,
        Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      background: transparent;
      height: 100%;
      overflow: hidden;
      font-weight: bold;
      color: var(--lyplus-text-primary);
    }

    /* ==========================================================================
       CONTAINER & SCROLL BEHAVIOR
       ========================================================================== */
    .lyrics-container {
      padding: 20px;
      padding-top: 80px;
      border-radius: 8px;
      background-color: transparent;
      width: 100%;
      height: 100%;
      max-height: 100vh;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      box-sizing: border-box;
      scrollbar-width: none;
      transform: translateZ(0);
    }

    .lyrics-container::-webkit-scrollbar {
      display: none;
    }

    /* Disable transitions during touch-scrolling for 1:1 feedback */
    .lyrics-container.touch-scrolling .lyrics-line,
    .lyrics-container.touch-scrolling .lyrics-plus-metadata {
      transition: none !important;
    }

    /* Apply smooth gliding transition for mouse-wheel scrolling */
    .lyrics-container.wheel-scrolling .lyrics-line {
      transition: transform 0.3s ease-out !important;
    }

    .lyrics-line.scroll-animate {
      transition: none !important; /* Prevent conflict with scroll animation */
      animation-name: lyrics-scroll;
      animation-duration: var(--scroll-duration, 280ms);
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
      padding: var(--lyplus-padding-line);
      opacity: 0.8;
      color: var(--lyplus-text-secondary);
      font-size: var(--lyplus-font-size-base);
      cursor: pointer;
      transform-origin: left;
      transform: translateZ(1px);
      transition:
        opacity 0.3s ease,
        transform 0.4s cubic-bezier(0.41, 0, 0.12, 0.99)
          var(--lyrics-line-delay, 0ms),
        filter 0.3s ease;
      will-change: transform, filter, opacity;
      content-visibility: auto;
      text-rendering: optimizeLegibility;
      overflow-wrap: break-word;
      mix-blend-mode: lighten;
      border-radius: var(--lyplus-border-radius-base);
    }

    .lyrics-line:not(.scroll-animate) {
      animation: none;
    }

    /* --- Line Container & Vocal Containers --- */
    .lyrics-line-container {
      overflow-wrap: break-word;
      transform-origin: left;
      transform: scale3d(0.93, 0.93, 0.95);
      transition:
        transform 0.7s ease,
        background-color 0.7s,
        color 0.7s;
    }

    .lyrics-line.active .lyrics-line-container,
    .lyrics-line.pre-active .lyrics-line-container {
      transform: scale3d(1.001, 1.001, 1);
      will-change: transform;
      transition:
        transform 0.5s ease,
        background-color 0.18s,
        color 0.18s;
    }

    .main-vocal-container {
      transform-origin: 5% 50%;
      margin: 0;
    }

    .background-vocal-container {
      max-height: 0;
      padding-top: 0.2em;
      overflow: visible;
      opacity: 0;
      font-size: var(--lyplus-font-size-subtext);
      transition:
        max-height 350ms cubic-bezier(0.33, 1, 0.68, 1),
        opacity 300ms ease-out,
        padding 350ms cubic-bezier(0.33, 1, 0.68, 1);
      margin: 0;
    }

    .lyrics-line.active .background-vocal-container,
    .lyrics-line.pre-active .background-vocal-container {
      max-height: 4em;
      opacity: 1;
      transition:
        max-height 350ms cubic-bezier(0.22, 1, 0.36, 1),
        opacity 300ms ease-out,
        padding 350ms cubic-bezier(0.22, 1, 0.36, 1);
      will-change: max-height, opacity, padding;
    }

    /* --- Line States & Modifiers --- */
    .lyrics-line.active {
      opacity: 1;
      color: var(--lyplus-text-primary);
      will-change: transform, opacity;
    }

    .lyrics-line.pre-active {
      opacity: 1;
      will-change: transform, opacity;
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
        background: var(--hover-background-color, rgba(255, 255, 255, 0.13));
      }
      .lyrics-container.is-unsynced .lyrics-line:hover {
        background: transparent !important;
      }
    }

    /* --- Blur Effect for Inactive Lines --- */
    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap) {
      filter: blur(var(--lyplus-blur-amount));
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

    /* Unblur all lines when user is scrolling */
    .lyrics-container.user-scrolling .lyrics-line {
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
    }

    .lyrics-word.allow-break {
      display: inline;
    }

    .lyrics-syllable-wrap {
      display: inline;
    }

    .lyrics-syllable-wrap:has(.lyrics-syllable.transliteration) {
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
      transition: transform 1s ease !important;
    }

    .lyrics-syllable.finished:has(.char) {
      background-color: transparent;
    }

    .lyrics-line:not(.active) .lyrics-syllable.finished {
      transition: color 0.18s;
    }

    .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable {
      transform: translateY(0.001%) translateZ(1px);
      transition:
        transform 1s ease,
        background-color 0.5s,
        color 0.5s;
      will-change: transform, background;
    }

    /* --- Wipe Highlight Effect --- */
    .lyrics-line.active:not(.lyrics-gap)
      .lyrics-syllable.highlight:not(:has(.char)),
    .lyrics-line.active:not(.lyrics-gap)
      .lyrics-syllable.pre-highlight:not(:has(.char)) {
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
        0.5em 100%,
        0% 100%;
      background-position:
        -0.5em 0%,
        -0.25em 0%;
    }

    .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.highlight.rtl-text,
    .lyrics-line.active:not(.lyrics-gap)
      .lyrics-syllable.pre-highlight.rtl-text {
      direction: rtl;
      background-image:
        linear-gradient(
          -90deg,
          var(--lyplus-text-primary) 0%,
          transparent 100%
        ),
        linear-gradient(
          -90deg,
          var(--lyplus-text-primary) 100%,
          transparent 100%
        );
      background-position:
        calc(100% + 0.5em) 0%,
        right;
    }

    .lyrics-line.active:not(.lyrics-gap)
      .lyrics-word:not(.growable)
      .lyrics-syllable.highlight,
    .lyrics-word.growable .lyrics-syllable.cleanup .char {
      transform: translateY(-3.5%) translateZ(1px);
    }

    .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.highlight.finished {
      background-image: none;
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
    .lyrics-line .lyrics-syllable:has(span.char):not(.finished) {
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
      transition:
        color 0.7s,
        background-color 0.7s,
        transform 0.7s ease;
    }

    .lyrics-syllable.finished span.char {
      transition: color 0.18s;
      background-color: var(--lyplus-text-primary);
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
        0.5em 100%,
        0% 100%;
      background-position:
        -0.5em 0%,
        -0.25em 0%;
      transform-origin: 50% 80%;
      transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      transition:
        transform 0.7s ease,
        color 0.18s;
      will-change: background, transform;
    }

    .lyrics-line.active .lyrics-syllable span.char.highlight {
      background-image:
        linear-gradient(
          -90deg,
          var(--lyplus-text-primary, #fff) 0%,
          #0000 100%
        ),
        linear-gradient(
          -90deg,
          var(--lyplus-text-primary, #fff) 100%,
          #0000 100%
        );
      background-position:
        calc(100% + 0.5em) 0%,
        calc(100% + 0.25em) 0%;
    }

    .lyrics-line.active .lyrics-syllable.pre-highlight span.char {
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
        0.75em 100%,
        0% 100%;
      background-position:
        -0.85em 0%,
        -0.25em 0%;
    }

    /* ==========================================================================
       INSTRUMENTAL GAP STYLES
       ========================================================================== */
    .lyrics-gap {
      max-height: 0;
      padding: 0 var(--lyplus-padding-gap);
      overflow: hidden;
      opacity: 0;
      box-sizing: content-box;
      background-clip: unset;
      transform-origin: top;
      transition:
        padding 220ms cubic-bezier(0.33, 1, 0.68, 1),
        max-height 220ms cubic-bezier(0.33, 1, 0.68, 1),
        opacity 160ms ease-out,
        transform var(--scroll-duration, 280ms) var(--lyrics-line-delay, 0ms);
    }

    .lyrics-gap.active {
      max-height: 1.6em;
      padding: var(--lyplus-padding-gap);
      opacity: 1;
      overflow: visible;
      transition:
        padding 220ms cubic-bezier(0.22, 1, 0.36, 1),
        max-height 220ms cubic-bezier(0.22, 1, 0.36, 1),
        opacity 160ms ease-out,
        transform var(--scroll-duration, 280ms);
      will-change: max-height, opacity, padding;
    }

    /* Exiting state: quickly collapse width and height so dots don't distort page, or remove max-height transition */
    .lyrics-gap.gap-exiting {
      max-height: 0;
      padding: 0 var(--lyplus-padding-gap);
      opacity: 0;
      overflow: visible;
      transition:
        padding var(--gap-exit-duration, 360ms) cubic-bezier(0.33, 1, 0.68, 1),
        max-height var(--gap-exit-duration, 360ms)
          cubic-bezier(0.33, 1, 0.68, 1),
        opacity 160ms ease-out,
        transform var(--scroll-duration, 280ms);
    }

    .lyrics-gap .main-vocal-container {
      transform: translateY(-25%) scale(1) translateZ(0);
    }

    /* Jump animation plays during exit */
    .lyrics-gap.gap-exiting .main-vocal-container {
      animation: gap-ended var(--gap-exit-duration, 360ms)
        cubic-bezier(0.33, 1, 0.68, 1) forwards;
    }

    .lyrics-gap:not(.active):not(.gap-exiting) .main-vocal-container {
      transform: translateY(-25%) scale(0) translateZ(0);
    }

    .lyrics-gap:not(.active):not(.gap-exiting)
      .main-vocal-container
      .lyrics-word {
      animation-play-state: paused;
    }

    .lyrics-gap.active .main-vocal-container .lyrics-word {
      animation: gap-loop var(--gap-pulse-duration, 4000ms) ease-in-out infinite
        alternate;
      animation-delay: var(--gap-loop-delay, 0ms);
      will-change: transform;
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
      color: var(--lyplus-text-secondary) !important;
    }

    .lyrics-line.active .lyrics-syllable.line-synced {
      animation: fade-in-line 0.2s ease-out forwards !important;
      color: var(--lyplus-text-primary) !important;
    }

    .lyrics-line.pre-active .lyrics-syllable.line-synced {
      animation: fade-in-line 0.14s ease-out forwards !important;
      color: var(--lyplus-text-primary) !important;
    }

    .lyrics-line.active .lyrics-syllable.line-synced span.char,
    .lyrics-line.pre-active .lyrics-syllable.line-synced span.char {
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
    }

    .lyrics-gap.active .lyrics-syllable.highlight,
    .lyrics-gap.active .lyrics-syllable.finished,
    .lyrics-gap.gap-exiting .lyrics-syllable,
    .lyrics-gap:not(.active).post-active-line .lyrics-syllable,
    .lyrics-gap:not(.active).lyrics-activest .lyrics-syllable {
      background-color: var(--lyplus-text-primary);
      animation: none !important;
      opacity: 1;
    }

    .lyrics-gap.active .lyrics-syllable.finished {
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
      transform: translateY(var(--lyrics-scroll-offset, 0px)) translateZ(1px);
      transition:
        opacity 0.3s ease,
        transform 0.6s cubic-bezier(0.23, 1, 0.32, 1)
          var(--lyrics-line-delay, 0ms),
        filter 0.3s ease;
    }

    .lyrics-plus-empty {
      display: block;
      height: 100vh;
      transform: translateY(var(--lyrics-scroll-offset, 0px)) translateZ(1px);
    }

    .lyrics-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      text-align: left;
      font-size: 0.8em;
      color: rgba(255, 255, 255, 0.5);
      padding: 10px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      margin-top: 10px;
      font-weight: normal;
    }

    .lyrics-footer p {
      margin: 5px 0;
    }

    .lyrics-footer a {
      color: rgba(255, 255, 255, 0.7);
      text-decoration: none;
    }

    .lyrics-footer a:hover {
      text-decoration: underline;
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
      padding: 10px 0;
      margin-bottom: 10px;
      gap: 10px;
      justify-content: space-between;
      align-items: center;
    }

    .lyrics-header .download-button {
      background: none;
      border: none;
      cursor: pointer;
      color: #aaa;
      padding: 0;
      margin-left: 10px;
      vertical-align: middle;
      display: inline-flex;
      align-items: center;
      font-family: inherit;
    }

    .lyrics-header .download-button:hover {
      color: rgba(255, 255, 255, 0.9);
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
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 0.8em;
      color: rgba(255, 255, 255, 0.6);
      cursor: pointer;
      transition: all 0.2s;
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
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 4px;
      color: rgba(255, 255, 255, 0.6);
      font-size: 0.8em;
      margin-left: 10px;
      padding: 2px 5px;
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
      margin: 20px 0;
      border-radius: 8px;
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

    /* Wipe animation for syllables */
    @keyframes wipe {
      from {
        background-size:
          0.75em 100%,
          0% 100%;
        background-position:
          -0.375em 0%,
          left;
      }
      to {
        background-size:
          0.75em 100%,
          100% 100%;
        background-position:
          calc(100% + 0.375em) 0%,
          left;
      }
    }

    @keyframes start-wipe {
      0% {
        background-size:
          0.75em 100%,
          0% 100%;
        background-position:
          -0.375em 0%,
          left;
      }
      100% {
        background-size:
          0.75em 100%,
          100% 100%;
        background-position:
          calc(100% + 0.375em) 0%,
          left;
      }
    }

    @keyframes wipe-rtl {
      from {
        background-size:
          0.75em 100%,
          0% 100%;
        background-position:
          calc(100% + 0.375em) 0%,
          calc(100% + 0.36em);
      }
      to {
        background-size:
          0.75em 100%,
          100% 100%;
        background-position:
          -0.75em 0%,
          right;
      }
    }

    @keyframes start-wipe-rtl {
      0% {
        background-size:
          0.75em 100%,
          0% 100%;
        background-position:
          calc(100% + 0.75em) 0%,
          calc(100% + 0.5em);
      }
      100% {
        background-size:
          0.75em 100%,
          100% 100%;
        background-position:
          -0.75em 0%,
          right;
      }
    }

    @keyframes pre-wipe-universal {
      from {
        background-size:
          0.75em 100%,
          0% 100%;
        background-position:
          -0.75em 0%,
          left;
      }
      to {
        background-size:
          0.75em 100%,
          0% 100%;
        background-position:
          -0.375em 0%,
          left;
      }
    }

    @keyframes pre-wipe-universal-rtl {
      from {
        background-size:
          0.75em 100%,
          0% 100%;
        background-position:
          calc(100% + 0.75em) 0%,
          right;
      }
      to {
        background-size:
          0.75em 100%,
          0% 100%;
        background-position:
          calc(100% + 0.375em) 0%,
          right;
      }
    }

    @keyframes pre-wipe-char {
      from {
        background-size:
          0.75em 100%,
          0% 100%;
        background-position:
          -0.85em 0%,
          left;
      }
      to {
        background-size:
          0.75em 100%,
          0% 100%;
        background-position:
          -0.85em 0%,
          left;
      }
    }

    /* Gap dot animations */
    @keyframes gap-loop {
      from {
        transform: scale(1.12);
      }
      to {
        transform: scale(var(--gap-exit-scale, 0.85));
      }
    }

    @keyframes gap-ended {
      0% {
        transform: translateY(-25%) scale(var(--gap-exit-scale, 0.85))
          translateZ(0);
      }
      35% {
        transform: translateY(-5%) scale(1.08) translateZ(0);
      }
      100% {
        transform: translateY(-25%) scale(0) translateZ(0);
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

    /* Scroll animation — class is removed and re-added (with a forced
       reflow in between) to reliably restart the animation each time */
    @keyframes lyrics-scroll {
      from {
        transform: translateY(var(--scroll-delta)) translateZ(1px);
      }
      to {
        transform: translateY(0) translateZ(1px);
      }
    }

    /* Character grow animation - exact copy from YouLyPlus */
    @keyframes grow-dynamic {
      0% {
        transform: matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
        filter: drop-shadow(
          0 0 0
            color-mix(in srgb, var(--lyplus-lyrics-palette), transparent 100%)
        );
      }
      25%,
      30% {
        transform: matrix3d(
          calc(var(--max-scale) * calc(var(--lyplus-font-size-base-grow) / 25)),
          0,
          0,
          0,
          0,
          calc(var(--max-scale) * calc(var(--lyplus-font-size-base-grow) / 25)),
          0,
          0,
          0,
          0,
          1,
          0,
          calc(
            var(--char-offset-x, 0) *
              calc(var(--lyplus-font-size-base-grow) / 25)
          ),
          var(--translate-y-peak, -2),
          0,
          1
        );
        filter: drop-shadow(
          0 0 0.1em
            color-mix(
              in srgb,
              var(--lyplus-lyrics-palette),
              transparent calc((1 - var(--shadow-intensity, 1)) * 100%)
            )
        );
      }
      100% {
        transform: translateY(-3.5%) translateZ(1px);
        filter: drop-shadow(
          0 0 0
            color-mix(in srgb, var(--lyplus-lyrics-palette), transparent 100%)
        );
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
      will-change: background-size;
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
  highlightColor = '#ffffff';

  @property({ type: String, attribute: 'hover-background-color' })
  hoverBackgroundColor = 'rgba(255, 255, 255, 0.13)';

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

  private _currentTime = 0;

  @property({ type: Number, attribute: 'currenttime', hasChanged: () => false })
  set currentTime(value: number) {
    const oldValue = this._currentTime;
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
  private availableSources: { lines: LyricsLine[]; source: string }[] = [];

  @state()
  private currentSourceIndex = 0;

  @state()
  private isFetchingAlternatives = false;

  @state()
  private hasFetchedAllProviders = false;

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

  private isClickSeeking = false;

  private clickSeekTimeout?: ReturnType<typeof setTimeout>;

  // Cached DOM elements for animation updates
  private cachedLyricsLines: HTMLElement[] = [];

  // Active line tracking
  private activeLineIds: Set<string> = new Set();

  private currentPrimaryActiveLine: HTMLElement | null = null;

  private lastPrimaryActiveLine: HTMLElement | null = null;

  // Scroll animation state
  private scrollAnimationState: {
    isAnimating: boolean;
    pendingUpdate: number | null;
  } | null = null;

  private currentScrollOffset = 0;

  private animatingLines: HTMLElement[] = [];

  private scrollUnlockTimeout?: ReturnType<typeof setTimeout>;

  private scrollAnimationTimeout?: ReturnType<typeof setTimeout>;

  // AbortController for cancelling in-flight lyrics fetches
  private fetchAbortController?: AbortController;

  // Syllable animation tracking
  private lastActiveIndex = 0;

  private visibleLineIds: Set<string> = new Set();

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
    if (this.scrollUnlockTimeout) {
      clearTimeout(this.scrollUnlockTimeout);
      this.scrollUnlockTimeout = undefined;
    }
    if (this.scrollAnimationTimeout) {
      clearTimeout(this.scrollAnimationTimeout);
      this.scrollAnimationTimeout = undefined;
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
    try {
      const resolvedMetadata = await this.resolveSongMetadata();
      // If a newer fetch was triggered while we awaited, bail out
      if (controller.signal.aborted) return;

      const isMusicIdOnlyRequest =
        Boolean(this.musicId) &&
        !this.songTitle &&
        !this.songArtist &&
        !this.query &&
        !this.isrc;

      const collectedSources: { lines: LyricsLine[]; source: string }[] = [];

      if (resolvedMetadata?.metadata && !isMusicIdOnlyRequest) {
        const title = resolvedMetadata.metadata.title?.trim() || '';
        const artist = resolvedMetadata.metadata.artist?.trim() || '';

        const youLyResults = await AmLyrics.fetchLyricsFromYouLyPlus(
          title,
          artist,
          resolvedMetadata.catalogIsrc,
          resolvedMetadata.metadata,
        );

        if (youLyResults && youLyResults.length > 0) {
          collectedSources.push(...youLyResults);
        }
      }

      if (collectedSources.length === 0 && resolvedMetadata?.metadata) {
        const tidalResult = await AmLyrics.fetchLyricsFromTidal(
          resolvedMetadata.metadata,
          resolvedMetadata.catalogIsrc,
        );
        if (tidalResult && tidalResult.lines.length > 0) {
          collectedSources.push({
            lines: tidalResult.lines,
            source: 'Tidal',
          });
        }
      }

      // Fallback: LRCLIB
      if (collectedSources.length === 0 && resolvedMetadata?.metadata) {
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
          s =>
            s.source === 'LRCLIB' ||
            s.source === 'Tidal' ||
            s.source === 'Genius',
        );

      if (collectedSources.length > 0) {
        this.availableSources = AmLyrics.mergeAndSortSources(collectedSources);

        this.currentSourceIndex = 0;
        this.lyrics = this.availableSources[0].lines;
        this.lyricsSource = this.availableSources[0].source;
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
    if (isQQ && hasWordSync) return 2;
    if (lower.includes('musixmatch') && hasWordSync) return 3;
    if (lower.includes('tidal') && hasWordSync) return 4;
    if (lower.includes('lrclib') && hasWordSync) return 5;
    if (hasWordSync) return 6;

    if (lower.includes('apple') && !hasWordSync && !isUnsynced) return 7;
    if (isQQ && !hasWordSync && !isUnsynced) return 8;
    if (lower.includes('musixmatch') && !hasWordSync && !isUnsynced) return 9;
    if (lower.includes('tidal') && !hasWordSync && !isUnsynced) return 10;
    if (lower.includes('lrclib') && !hasWordSync && !isUnsynced) return 11;
    if (!hasWordSync && !isUnsynced) return 12;

    if (lower.includes('apple') && isUnsynced) return 13;
    if (isQQ && isUnsynced) return 14;
    if (lower.includes('musixmatch') && isUnsynced) return 15;
    if (lower.includes('tidal') && isUnsynced) return 16;
    if (lower.includes('lrclib') && isUnsynced) return 17;
    if (lower.includes('genius')) return 18;

    return 20;
  }

  private static mergeAndSortSources(
    collectedSources: { lines: LyricsLine[]; source: string }[],
  ): { lines: LyricsLine[]; source: string }[] {
    const uniqueSourcesMap = new Map<
      string,
      { lines: LyricsLine[]; source: string }
    >();

    for (const source of collectedSources) {
      const normalizedSource = source.source
        .toLowerCase()
        .includes('lyricsplus')
        ? 'QQ'
        : source.source;

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

  private async switchSource() {
    if (this.isFetchingAlternatives) return;

    if (!this.hasFetchedAllProviders) {
      this.isFetchingAlternatives = true;
      try {
        const resolvedMetadata = await this.resolveSongMetadata();
        if (resolvedMetadata?.metadata) {
          const newSources: { lines: LyricsLine[]; source: string }[] = [];

          // Try Tidal if not fetched
          if (
            !this.availableSources.some(s =>
              s.source.toLowerCase().includes('tidal'),
            )
          ) {
            const tidalResult = await AmLyrics.fetchLyricsFromTidal(
              resolvedMetadata.metadata,
              resolvedMetadata.catalogIsrc,
            );
            if (tidalResult && tidalResult.lines.length > 0) {
              newSources.push({ lines: tidalResult.lines, source: 'Tidal' });
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
            // Re-sync current index since sorting might shift elements
            this.currentSourceIndex = this.availableSources.findIndex(
              s => s.source === this.lyricsSource,
            );
            if (this.currentSourceIndex === -1) this.currentSourceIndex = 0;
          }
        }
      } finally {
        this.hasFetchedAllProviders = true;
        this.isFetchingAlternatives = false;
      }
    }

    if (this.availableSources.length > 1) {
      this.currentSourceIndex =
        (this.currentSourceIndex + 1) % this.availableSources.length;
      this.lyrics = this.availableSources[this.currentSourceIndex].lines;
      this.lyricsSource = this.availableSources[this.currentSourceIndex].source;
      await this.onLyricsLoaded();
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

  private static async fetchLyricsFromYouLyPlus(
    title: string,
    artist: string,
    isrc?: string,
    metadata: { durationMs?: number; album?: string } = {},
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
      if (isQQ && hasWordSync) return 2;
      if (lower.includes('musixmatch') && hasWordSync) return 3;
      if (hasWordSync) return 4;

      if (lower.includes('apple') && !hasWordSync && !isUnsynced) return 5;
      if (isQQ && !hasWordSync && !isUnsynced) return 6;
      if (lower.includes('musixmatch') && !hasWordSync && !isUnsynced) return 7;
      if (!hasWordSync && !isUnsynced) return 8;

      if (lower.includes('apple') && isUnsynced) return 9;
      if (isQQ && isUnsynced) return 10;
      if (lower.includes('musixmatch') && isUnsynced) return 11;

      return 20;
    };

    const allResults: YouLyPlusLyricsResult[] = [];

    // Try BiniLyrics cache API first
    try {
      let cacheData: any = null;

      // First attempt: Prefer ISRC search if available
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
        } catch (isrcErr) {
          // Fall through to title/artist search
        }
      }

      // Second attempt: Fallback to title and artist search if ISRC search failed or was not available
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
        if (result.timing_type === 'word' && result.lyricsUrl) {
          const ttmlRes = await fetchWithTimeout(result.lyricsUrl);
          if (ttmlRes.ok) {
            const ttmlText = await ttmlRes.text();
            const lines = AmLyrics.parseTTML(ttmlText);
            if (lines && lines.length > 0) {
              allResults.push({ lines, source: 'BiniLyrics' });
              return allResults;
            }
          }
        } else {
          // Not word type, try fetching any word synced lyrics from lyricsplus
          const fallbackParams = new URLSearchParams(params);
          const fallbackUrl = `https://lyricsplus.binimum.org/v2/lyrics/get?${fallbackParams.toString()}`;
          try {
            const fallbackRes = await fetchWithTimeout(fallbackUrl);
            if (fallbackRes.ok) {
              const payload = await fallbackRes.json();
              const lines = AmLyrics.convertKPoeLyrics(payload);
              const hasWordSync = lines?.some(
                (line: any) =>
                  line.text && Array.isArray(line.text) && line.text.length > 1,
              );
              if (lines && lines.length > 0 && hasWordSync) {
                const sourceLabel =
                  payload?.metadata?.source ||
                  payload?.metadata?.provider ||
                  'LyricsPlus (KPoe)';
                allResults.push({ lines, source: sourceLabel });
                return allResults;
              }
            }
          } catch (fallbackError) {
            // Ignore fallback fetch error
          }

          // If fallback fails or has no word sync, fall back to bini lyrics
          if (result.lyricsUrl) {
            const ttmlRes = await fetchWithTimeout(result.lyricsUrl);
            if (ttmlRes.ok) {
              const ttmlText = await ttmlRes.text();
              const lines = AmLyrics.parseTTML(ttmlText);
              if (lines && lines.length > 0) {
                allResults.push({
                  lines,
                  source: 'BiniLyrics',
                });
                return allResults;
              }
            }
          }
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Cache API failed', e);
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
   * Fetch lyrics from Tidal API.
   * Picks 2 random servers, tries search + lyrics on each.
   */
  private static async fetchLyricsFromTidal(
    metadata: SongMetadata,
    isrc?: string,
  ): Promise<YouLyPlusLyricsResult | null> {
    const title = metadata.title?.trim();
    const artist = metadata.artist?.trim();

    if (!title || !artist) return null;

    // Pick 3 random unique servers for better reliability
    const shuffled = [...TIDAL_SERVERS].sort(() => Math.random() - 0.5);
    const serversToTry = shuffled.slice(0, 3);

    for (const base of serversToTry) {
      try {
        const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;

        // Step 1: Search for the track
        const searchQuery = `${title} ${artist}`;
        const searchParams = new URLSearchParams({ s: searchQuery });
        // eslint-disable-next-line no-await-in-loop
        const searchResponse = await fetchWithTimeout(
          `${normalizedBase}/search/?${searchParams.toString()}`,
        );

        if (!searchResponse.ok) {
          // eslint-disable-next-line no-continue
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const searchData = await searchResponse.json();
        const items = searchData?.data?.items;

        if (!Array.isArray(items) || items.length === 0) {
          // eslint-disable-next-line no-continue
          continue;
        }

        // Find best match: prefer ISRC match, then first result
        let bestTrack = items[0];
        if (isrc) {
          const isrcMatch = items.find(
            (item: any) =>
              item.isrc && item.isrc.toLowerCase() === isrc.toLowerCase(),
          );
          if (isrcMatch) {
            bestTrack = isrcMatch;
          }
        }

        const trackId = bestTrack?.id;
        if (!trackId) {
          // eslint-disable-next-line no-continue
          continue;
        }

        // Step 2: Fetch lyrics
        // eslint-disable-next-line no-await-in-loop
        const lyricsResponse = await fetchWithTimeout(
          `${normalizedBase}/lyrics/?id=${trackId}`,
        );

        if (!lyricsResponse.ok) {
          // eslint-disable-next-line no-continue
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const lyricsData = await lyricsResponse.json();
        const subtitles = lyricsData?.lyrics?.subtitles;

        if (subtitles && typeof subtitles === 'string') {
          const lines = AmLyrics.parseLrcSubtitles(subtitles);
          if (lines.length > 0) {
            const provider = lyricsData?.lyrics?.lyricsProvider || 'Tidal';
            return {
              lines,
              source: `Tidal (${provider})`,
            };
          }
        }
      } catch {
        // Try next server
      }
    }

    return null;
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

  private static parseTTML(ttmlString: string): LyricsLine[] | null {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(ttmlString, 'text/xml');

      const translations: Record<string, string> = {};
      const transliterations: Record<string, any> = {};
      const agentMap: Record<string, string> = {};

      const agents = doc.getElementsByTagName('ttm:agent');
      for (let i = 0; i < agents.length; i += 1) {
        const agent = agents[i];
        const id = agent.getAttribute('xml:id');
        const type = agent.getAttribute('type');
        if (id && type) {
          agentMap[id] = type;
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

      const timeToMs = (timeStr: string | null): number => {
        if (!timeStr) return 0;
        const parts = timeStr.split(':');
        let seconds = 0;
        if (parts.length === 2) {
          seconds = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
        } else if (parts.length === 3) {
          seconds =
            parseInt(parts[0], 10) * 3600 +
            parseInt(parts[1], 10) * 60 +
            parseFloat(parts[2]);
        } else {
          seconds = parseFloat(parts[0]);
        }
        return Math.round(seconds * 1000);
      };

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

      const lineSingers: (string | undefined)[] = [];
      for (let i = 0; i < pNodes.length; i += 1) {
        lineSingers.push(pNodes[i].getAttribute('ttm:agent') || undefined);
      }
      const alignments = AmLyrics.calculateLineAlignments(
        lineSingers,
        agentMap,
      );

      for (let i = 0; i < pNodes.length; i += 1) {
        const p = pNodes[i];
        const key = p.getAttribute('itunes:key');
        const beginMs = timeToMs(p.getAttribute('begin'));
        const endMs = timeToMs(p.getAttribute('end'));

        let songPart: string | undefined;
        if (p.parentNode && (p.parentNode as Element).tagName === 'div') {
          songPart =
            (p.parentNode as Element).getAttribute('itunes:songPart') ||
            undefined;
        }

        const mainSyllables: Syllable[] = [];
        const bgSyllables: Syllable[] = [];

        const spans = p.getElementsByTagName('span');
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
                bgSyllables.push({
                  text: bgText,
                  timestamp: timeToMs(bgSpan.getAttribute('begin')),
                  endtime: timeToMs(bgSpan.getAttribute('end')),
                  part: false,
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
            mainSyllables.push({
              text,
              timestamp: timeToMs(span.getAttribute('begin')),
              endtime: timeToMs(span.getAttribute('end')),
              part: false,
            });
          }
        } else {
          mainSyllables.push({
            text: p.textContent?.trim() || '',
            timestamp: beginMs,
            endtime: endMs,
            part: false,
            lineSynced: true,
          });
        }

        const alignment = alignments[i];

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

        lines.push({
          text: mainSyllables,
          background: bgSyllables.length > 0,
          backgroundText: bgSyllables,
          timestamp: beginMs,
          endtime: endMs,
          isWordSynced: spans.length > 0,
          alignment,
          songPart,
          translation: key ? translations[key] : undefined,
          romanizedText: lineTransliterationItem?.text,
          oppositeTurn: alignment === 'end',
        });
      }

      return lines;
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
      const start = AmLyrics.toMilliseconds(entry.time);
      const duration = AmLyrics.toMilliseconds(entry.duration);

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
        endtime: start + duration,
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
      // Imperatively manage 'active' class so that scroll-animate and other
      // imperative classes are never clobbered.
      if (this.lyricsContainer) {
        // Remove 'active' from lines that are no longer active
        for (const lineIndex of oldActiveLines) {
          if (!newActiveLines.includes(lineIndex)) {
            const lineElement = this.lyricsContainer.querySelector(
              `#lyrics-line-${lineIndex}`,
            ) as HTMLElement;
            if (lineElement) {
              lineElement.classList.remove('active');
              AmLyrics.resetSyllables(lineElement);
            }
          }
        }
        // Add 'active' to newly active lines
        for (const lineIndex of newActiveLines) {
          if (!oldActiveLines.includes(lineIndex)) {
            const lineElement = this.lyricsContainer.querySelector(
              `#lyrics-line-${lineIndex}`,
            ) as HTMLElement;
            if (lineElement) {
              lineElement.classList.add('active');
              lineElement.classList.remove('pre-active'); // Cleanup pre-active when fully active
            }
          }
        }

        if (newActiveLines.length > 0) {
          this.clearPreActiveClasses();
        }
      }

      this.startAnimationFromTime(newTime);

      // Trigger scroll imperatively (was previously in updated() via @state)
      this._handleActiveLineScroll(oldActiveLines, isSeek);
    }

    // YouLyPlus-style syllable animation updates
    if (this.lyricsContainer) {
      // Update syllables in active lines
      for (const lineIndex of this.activeLineIndices) {
        const lineElement = this.lyricsContainer.querySelector(
          `#lyrics-line-${lineIndex}`,
        ) as HTMLElement;
        if (lineElement) {
          AmLyrics.updateSyllablesForLine(lineElement, newTime);
        }
      }

      // Also update syllables in active gap lines (breathing dots)
      const activeGaps =
        this.lyricsContainer.querySelectorAll('.lyrics-gap.active');
      activeGaps.forEach(gapLine => {
        AmLyrics.updateSyllablesForLine(gapLine as HTMLElement, newTime);
      });

      // Imperatively manage gap active state (template doesn't re-render on time changes)
      const allGaps = this.lyricsContainer.querySelectorAll('.lyrics-gap');
      allGaps.forEach(gap => {
        const gapStartTime = parseFloat(
          gap.getAttribute('data-start-time') || '0',
        );
        const gapEndTime = parseFloat(gap.getAttribute('data-end-time') || '0');
        const shouldBeActive = newTime >= gapStartTime && newTime < gapEndTime;
        const isActive = gap.classList.contains('active');
        const isExiting = gap.classList.contains('gap-exiting');
        // Start exit animation early so it completes before the next lyric
        const exitLeadMs = GAP_EXIT_LEAD_MS;
        const shouldStartExiting =
          isActive && !isExiting && newTime >= gapEndTime - exitLeadMs;

        if (shouldBeActive && !isActive && !isExiting) {
          // Entering gap: remove any leftover exit state, add active
          gap.classList.remove('gap-exiting');
          gap.classList.add('active');
          // Mark dots whose time has already passed as finished, and
          // trigger highlight on the dot currently in its time window
          // so the first dot always lights up even on late load.
          const dotSyllables = gap.querySelectorAll('.lyrics-syllable');
          dotSyllables.forEach(dot => {
            const dotStart = parseFloat(
              dot.getAttribute('data-start-time') || '0',
            );
            const dotEnd = parseFloat(dot.getAttribute('data-end-time') || '0');
            if (newTime > dotEnd) {
              dot.classList.add('finished');
              // Also ensure the highlight + animation fired so CSS state is correct
              if (!dot.classList.contains('highlight')) {
                AmLyrics.updateSyllableAnimation(dot as HTMLElement);
              }
            } else if (newTime >= dotStart && newTime <= dotEnd) {
              // Currently within this dot's window — trigger its highlight
              AmLyrics.updateSyllableAnimation(dot as HTMLElement);
            }
          });
        } else if (shouldStartExiting) {
          // Exiting gap: keep visible while dots animate out
          gap.classList.add('gap-exiting');
          gap.classList.remove('active');
          // After exit animation completes, remove gap-exiting to collapse
          setTimeout(() => {
            gap.classList.remove('gap-exiting');
          }, GAP_EXIT_LEAD_MS);
        } else if (isActive && !shouldBeActive) {
          // NEW: Immediate cleanup if we seeked out of valid range
          gap.classList.remove('active');
          gap.classList.remove('gap-exiting');
        } else if (isExiting && newTime < gapEndTime - exitLeadMs) {
          // NEW: Cleanup exiting state if we seeked backwards before exit window
          gap.classList.remove('gap-exiting');
        }
      });

      // Track instrumental gap state
      const currentGap = this.findInstrumentalGapAt(newTime);
      if (currentGap) {
        this.lastInstrumentalIndex = currentGap.insertBeforeIndex;
      } else if (this.lastInstrumentalIndex !== null) {
        this.lastInstrumentalIndex = null;
      }

      // Pre-scroll: scroll to upcoming line ~0.5s before it starts
      if (
        this.autoScroll &&
        !this.isUserScrolling &&
        !this.isClickSeeking &&
        this.lyrics
      ) {
        // Condition: ONLY pre-scroll if no other lyric is currently playing.
        // If a lyric is playing, we must wait for it to finish (handled by updated()).
        if (this.activeLineIndices.length === 0) {
          let preActiveLineIndex: number | null = null;

          for (let i = 0; i < this.lyrics.length; i += 1) {
            const line = this.lyrics[i];
            const timeUntilStart = line.timestamp - newTime;

            const nextLineEl = this.lyricsContainer.querySelector(
              `#lyrics-line-${i}`,
            ) as HTMLElement;

            if (timeUntilStart > 0 && timeUntilStart <= PRE_SCROLL_LEAD_MS) {
              // Time to pre-scroll and pre-activate!
              if (nextLineEl) {
                // Apply unblur & zoom effect ahead of lyric start
                preActiveLineIndex = i;
                nextLineEl.classList.add('pre-active');
                this.clearPreActiveClasses(i);
                this.focusLine(nextLineEl);
              }
              break;
            }
          }

          this.clearPreActiveClasses(preActiveLineIndex);
        }
      }
    }
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('lyrics')) {
      // Recalculate timing data for accurate animations whenever lyrics change
      this._updateCharTimingData();

      // Apply 'active' classes imperatively after lyrics first render,
      // since the template no longer binds the 'active' class (to avoid
      // clobbering imperative scroll-animate classes on re-render).
      if (this.lyricsContainer && this.lyrics) {
        const activeLines = this.findActiveLineIndices(this.currentTime);
        for (const lineIndex of activeLines) {
          const lineEl = this.lyricsContainer.querySelector(
            `#lyrics-line-${lineIndex}`,
          ) as HTMLElement;
          if (lineEl) lineEl.classList.add('active');
        }
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
      // currentTime changes are now handled by the custom setter (_onTimeChanged)
      // This block intentionally left empty — only here for backwards compat with
      // any subclasses that might check changedProperties
    }
  }

  /**
   * Handle scrolling when active line indices change.
   * Called imperatively from _onTimeChanged instead of from updated().
   */
  private _handleActiveLineScroll(
    _oldActiveIndices: number[],
    forceScroll = false,
  ): void {
    if (this.activeLineIndices.length === 0 || !this.lyricsContainer) {
      return;
    }

    const targetLineIndex = this.getPrimaryActiveLineIndex(
      this.activeLineIndices,
    );
    if (targetLineIndex === null) return;

    const targetLine = this.lyricsContainer.querySelector(
      `#lyrics-line-${targetLineIndex}`,
    ) as HTMLElement;

    if (targetLine) {
      this.focusLine(targetLine, forceScroll);
    }
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

  private _updateCharTimingData() {
    if (!this.shadowRoot) return;

    // Get the computed font from the first syllable to ensure accuracy
    const referenceSyllable = this.shadowRoot.querySelector('.lyrics-syllable');
    if (!referenceSyllable) return;

    const computedStyle = getComputedStyle(referenceSyllable);
    const { font } = computedStyle; // Full font string
    const fontSize = parseFloat(computedStyle.fontSize);

    const growableWords = this.shadowRoot.querySelectorAll(
      '.lyrics-word.growable',
    );
    if (!growableWords) return;

    growableWords.forEach((wordSpan: any) => {
      const syllableWraps = wordSpan.querySelectorAll('.lyrics-syllable-wrap');

      // Flatten syllables
      const syllables: HTMLElement[] = [];
      syllableWraps.forEach((wrap: HTMLElement) => {
        const syl = wrap.querySelector('.lyrics-syllable');
        if (syl) syllables.push(syl as HTMLElement);
      });

      syllables.forEach(sylSpan => {
        const charSpans = sylSpan.querySelectorAll('.char');
        if (charSpans.length === 0) return;

        // Logic from YouLyPlus renderCharWipes:
        // Use textContent from spans to ensure we measure what is rendered
        const chars = Array.from(charSpans).map(span => span.textContent || '');
        const charWidths = chars.map(c => this._getTextWidth(c, font));
        const totalSyllableWidth = charWidths.reduce((a, b) => a + b, 0);

        const duration = parseFloat(sylSpan.dataset.duration || '0');
        const velocityPxPerMs =
          duration > 0 ? totalSyllableWidth / duration : 0;

        // Gradient width in pixels = 0.375 * fontSize
        // This matches YouLyPlus visual gradient size
        const gradientWidthPx = 0.375 * fontSize;
        const gradientDurationMs =
          velocityPxPerMs > 0 ? gradientWidthPx / velocityPxPerMs : 100;

        let cumulativeCharWidth = 0;

        charSpans.forEach((spanArg: any, i: number) => {
          const charWidth = charWidths[i];
          const span = spanArg;

          if (totalSyllableWidth > 0) {
            const startPercent = cumulativeCharWidth / totalSyllableWidth;
            const durationPercent = charWidth / totalSyllableWidth;

            span.dataset.wipeStart = startPercent.toFixed(4);
            span.dataset.wipeDuration = durationPercent.toFixed(4);

            // The critical missing piece:
            span.dataset.preWipeArrival = (duration * startPercent).toFixed(2);
            span.dataset.preWipeDuration = gradientDurationMs.toFixed(2);
          }

          cumulativeCharWidth += charWidth;
        });
      });
    });
  }

  private static arraysEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((val, i) => val === b[i]);
  }

  private static getLineIndexFromElement(
    lineElement: HTMLElement | null,
  ): number | null {
    if (!lineElement) return null;
    const match = lineElement.id.match(/^lyrics-line-(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  private static getGapLoopDelay(gapDuration: number): number {
    const desiredPhase = GAP_PULSE_DURATION_MS;
    const targetTime = gapDuration - GAP_EXIT_LEAD_MS;
    const normalizedTarget =
      ((targetTime % GAP_PULSE_CYCLE_MS) + GAP_PULSE_CYCLE_MS) %
      GAP_PULSE_CYCLE_MS;

    return (
      (((desiredPhase - normalizedTarget) % GAP_PULSE_CYCLE_MS) +
        GAP_PULSE_CYCLE_MS) %
      GAP_PULSE_CYCLE_MS
    );
  }

  private clearPreActiveClasses(exceptLineIndex: number | null = null): void {
    if (!this.lyricsContainer) return;

    this.lyricsContainer
      .querySelectorAll('.lyrics-line.pre-active')
      .forEach(element => {
        const lineElement = element as HTMLElement;
        const lineIndex = AmLyrics.getLineIndexFromElement(lineElement);
        if (lineIndex !== exceptLineIndex) {
          lineElement.classList.remove('pre-active');
        }
      });
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
      activeIndices.includes(currentPrimaryIndex) &&
      candidateIndex < currentPrimaryIndex
    ) {
      candidateIndex = currentPrimaryIndex;
    }

    return candidateIndex;
  }

  private focusLine(lineElement: HTMLElement, forceScroll = false): void {
    const primaryChanged = lineElement !== this.currentPrimaryActiveLine;

    if (primaryChanged) {
      this.lastPrimaryActiveLine = this.currentPrimaryActiveLine;
      this.currentPrimaryActiveLine = lineElement;
    }

    this.updatePositionClasses(lineElement);

    if (
      (forceScroll || primaryChanged) &&
      this.autoScroll &&
      !this.isUserScrolling &&
      !this.isClickSeeking
    ) {
      this.scrollToActiveLineYouLy(lineElement, forceScroll);
    }
  }

  private handleUserScroll() {
    // Ignore programmatic scrolls and click-seek scrolls
    if (this.isProgrammaticScroll || this.isClickSeeking) {
      return;
    }

    // Mark that user is currently scrolling
    this.isUserScrolling = true;
    this.lyricsContainer?.classList.add('user-scrolling');

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
      const line = this.lyrics[i];
      let effectiveEndTime = line.endtime;

      // Extend the "active" highlight window to abut the next line,
      // leaving a 500ms gap for breathing/scrolling
      if (i < this.lyrics.length - 1) {
        const nextLineStart = this.lyrics[i + 1].timestamp;
        const gapDuration = nextLineStart - line.endtime;

        // If the gap is large enough to trigger the breathing dots,
        // DO NOT extend the highlight. The text should dim when the dots appear.
        if (gapDuration < INSTRUMENTAL_THRESHOLD_MS) {
          if (effectiveEndTime < nextLineStart) {
            effectiveEndTime = Math.max(effectiveEndTime, nextLineStart - 500);
          }
        }
      }

      if (time >= line.timestamp && time <= effectiveEndTime) {
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
    // Reset all syllables to prevent highlighting conflicts during seek
    if (this.lyricsContainer) {
      const allLines = this.lyricsContainer.querySelectorAll('.lyrics-line');
      allLines.forEach(lineEl => {
        AmLyrics.resetSyllables(lineEl as HTMLElement);
        // Remove scroll-animate class and properties to stop any scroll animations
        lineEl.classList.remove('scroll-animate');
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
    }

    // Clear scroll animation timeouts
    if (this.scrollUnlockTimeout) {
      clearTimeout(this.scrollUnlockTimeout);
      this.scrollUnlockTimeout = undefined;
    }
    if (this.scrollAnimationTimeout) {
      clearTimeout(this.scrollAnimationTimeout);
      this.scrollAnimationTimeout = undefined;
    }

    // Also clear user scroll timeout to prevent stale scrollToActiveLine
    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
      this.userScrollTimeoutId = undefined;
    }
    this.isUserScrolling = false;

    // Reset active line tracking to prevent scroll fighting
    this.currentPrimaryActiveLine = null;
    this.lastPrimaryActiveLine = null;
    this.activeLineIds.clear();
    this.animatingLines = [];

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

  private scrollToInstrumental(insertBeforeIndex: number) {
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
      this.animateScrollYouLy(targetTranslateY, false);

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
    const style = getComputedStyle(this);
    const paddingTopValue =
      style.getPropertyValue('--lyrics-scroll-padding-top') || '25%';
    if (paddingTopValue.includes('%')) {
      return (
        this.lyricsContainer.clientHeight * (parseFloat(paddingTopValue) / 100)
      );
    }
    return parseFloat(paddingTopValue) || 0;
  }

  /**
   * Animate scroll with staggered delay for smooth YouLyPlus-style scrolling
   */
  private animateScrollYouLy(newTranslateY: number, forceScroll = false): void {
    if (!this.lyricsContainer) return;
    const parent = this.lyricsContainer;

    if (!this.scrollAnimationState) {
      this.scrollAnimationState = {
        isAnimating: false,
        pendingUpdate: null,
      };
      this.animatingLines = [];
    }

    const animState = this.scrollAnimationState;

    if (animState.isAnimating && !forceScroll) {
      animState.pendingUpdate = newTranslateY;
      return;
    }

    if (this.scrollUnlockTimeout) {
      clearTimeout(this.scrollUnlockTimeout);
      this.scrollUnlockTimeout = undefined;
    }

    if (this.scrollAnimationTimeout) {
      clearTimeout(this.scrollAnimationTimeout);
      this.scrollAnimationTimeout = undefined;
    }

    const { animatingLines } = this;

    const targetTop = Math.max(0, -newTranslateY);
    const appliedTranslateY = -targetTop;
    const prevOffset = -parent.scrollTop;
    const delta = prevOffset - appliedTranslateY;
    this.currentScrollOffset = appliedTranslateY;

    // Skip animation if already at the target position (e.g., first lines at top)
    if (Math.abs(parent.scrollTop - targetTop) < 1 && Math.abs(delta) < 1) {
      animState.isAnimating = false;
      animState.pendingUpdate = null;
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
      return;
    }

    // --- Step 1: Remove scroll-animate from ALL previously animating lines ---
    for (const line of animatingLines) {
      line.classList.remove('scroll-animate');
    }
    animatingLines.length = 0;

    // Get lines for staggered animation
    const lineElements = this.lyricsContainer.querySelectorAll('.lyrics-line');
    const lineArray = Array.from(lineElements) as HTMLElement[];

    const referenceLine =
      this.currentPrimaryActiveLine ||
      this.lastPrimaryActiveLine ||
      lineArray[0];

    if (!referenceLine) return;

    const referenceIndex = lineArray.indexOf(referenceLine);
    if (referenceIndex === -1) return;

    const delayIncrement = SCROLL_DELAY_INCREMENT_MS;
    const lookBehind = 10;
    const lookAhead = 15;
    const len = lineArray.length;

    const start = Math.max(0, referenceIndex - lookBehind);
    const end = Math.min(len, referenceIndex + lookAhead);

    let maxAnimationDuration = 0;
    let delayCounter = 0;

    // --- Step 2: Set CSS custom properties on target lines ---
    const newAnimatingLines: HTMLElement[] = [];

    for (let i = start; i < end; i += 1) {
      const line = lineArray[i];
      if (i >= referenceIndex) delayCounter += 1;
      const delay =
        i >= referenceIndex ? (delayCounter - 1) * delayIncrement : 0;

      line.style.setProperty('--scroll-delta', `${delta}px`);
      line.style.setProperty('--lyrics-line-delay', `${delay}ms`);
      line.style.setProperty(
        '--scroll-duration',
        `${SCROLL_ANIMATION_DURATION_MS}ms`,
      );

      newAnimatingLines.push(line);

      const lineDuration = SCROLL_ANIMATION_DURATION_MS + delay;
      if (lineDuration > maxAnimationDuration) {
        maxAnimationDuration = lineDuration;
      }
    }

    // --- Step 3: Force reflow so the browser sees the class removal ---
    // This guarantees the animation restarts reliably, unlike the
    // CSS-variable-toggle approach which doesn't restart in all browsers.
    parent.getBoundingClientRect(); // force synchronous reflow

    // --- Step 4: Re-add scroll-animate class to start fresh animations ---
    for (const line of newAnimatingLines) {
      line.classList.add('scroll-animate');
      animatingLines.push(line);
    }

    animState.isAnimating = true;
    const BASE_DURATION = SCROLL_ANIMATION_DURATION_MS;

    this.scrollUnlockTimeout = setTimeout(() => {
      animState.isAnimating = false;

      if (animState.pendingUpdate !== null) {
        const pendingValue = animState.pendingUpdate;
        animState.pendingUpdate = null;
        this.animateScrollYouLy(pendingValue, false);
      }
    }, BASE_DURATION);

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

    parent.scrollTo({ top: targetTop, behavior: 'instant' });
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

    // Remove old position classes
    this.lyricsContainer
      .querySelectorAll(`.${positionClasses.join(', .')}`)
      .forEach(el => el.classList.remove(...positionClasses));

    // Add new position classes
    lineToScroll.classList.add('lyrics-activest');

    const lineElements = Array.from(
      this.lyricsContainer.querySelectorAll('.lyrics-line'),
    ) as HTMLElement[];
    const scrollLineIndex = lineElements.indexOf(lineToScroll);

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
      }
    }
  }

  /**
   * Scroll to active line with YouLyPlus-style animation
   */
  private scrollToActiveLineYouLy(
    activeLine: HTMLElement,
    forceScroll = false,
  ): void {
    if (!activeLine || !this.lyricsContainer) return;

    const paddingTop = this.getScrollPaddingTop();
    const targetTranslateY = paddingTop - activeLine.offsetTop;

    const scrollContainerTop = this.lyricsContainer.getBoundingClientRect().top;

    // Skip if already at target position
    if (
      !forceScroll &&
      Math.abs(
        activeLine.getBoundingClientRect().top -
          scrollContainerTop -
          paddingTop,
      ) < 1
    ) {
      return;
    }

    // Skip scroll if near the bottom of content (prevents footer jitter)
    if (!forceScroll) {
      const parent = this.lyricsContainer;
      const atBottom =
        parent.scrollTop + parent.clientHeight >= parent.scrollHeight - 50;
      if (atBottom) {
        return;
      }
    }

    this.lyricsContainer.classList.remove('not-focused', 'user-scrolling');
    this.isProgrammaticScroll = true;
    this.isUserScrolling = false;

    if (this.userScrollTimeoutId) {
      clearTimeout(this.userScrollTimeoutId);
      this.userScrollTimeoutId = undefined;
    }

    setTimeout(() => {
      this.isProgrammaticScroll = false;
    }, SCROLL_ANIMATION_DURATION_MS + 160);

    this.animateScrollYouLy(targetTranslateY, forceScroll);
  }

  /**
   * Update syllable highlight animation - apply CSS wipe animation
   * (Exact copy from YouLyPlus _updateSyllableAnimation)
   */
  private static updateSyllableAnimation(syllable: HTMLElement): void {
    if (syllable.classList.contains('highlight')) return;

    const { classList } = syllable;
    const isRTL = classList.contains('rtl-text');
    const charSpans = Array.from(
      syllable.querySelectorAll('span.char'),
    ) as HTMLElement[];
    const wordElement = syllable.parentElement?.parentElement; // syllable-wrap -> word
    const allWordCharSpans = wordElement
      ? (Array.from(wordElement.querySelectorAll('span.char')) as HTMLElement[])
      : [];
    const isGrowable = wordElement?.classList.contains('growable');
    const isFirstSyllable =
      syllable.getAttribute('data-syllable-index') === '0';
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

    // Use a Map to collect animations like YouLyPlus
    const charAnimationsMap = new Map<HTMLElement, string>();
    const styleUpdates: Array<{
      element: HTMLElement;
      property: string;
      value: string;
    }> = [];

    // Step 1 & 2: Apply animations
    if (isGrowable && isFirstSyllable && allWordCharSpans.length > 0) {
      // Glow AND wipe applied to ALL characters simultaneously from the first syllable
      // This prevents CSS animation restarts because the `animation` property is set once.

      const firstSyllableStartTime = parseFloat(
        syllable.getAttribute('data-start-time') || '0',
      );

      allWordCharSpans.forEach((span, charIndexInWord) => {
        const horizontalOffset = parseFloat(
          span.dataset.horizontalOffset || '0',
        );

        const maxScale = span.dataset.maxScale || '1.1';
        const shadowIntensity = span.dataset.shadowIntensity || '0.6';
        const translateYPeak = span.dataset.translateYPeak || '-2';

        const animationParts: string[] = [];

        const parentSyllable = span.closest('.lyrics-syllable');
        if (parentSyllable) {
          const parentDuration = parseFloat(
            parentSyllable.getAttribute('data-duration') || '0',
          );
          const parentStartTime = parseFloat(
            parentSyllable.getAttribute('data-start-time') || '0',
          );

          const startPct = parseFloat(span.dataset.wipeStart || '0');
          const durationPct = parseFloat(span.dataset.wipeDuration || '0');

          const relativeStartOffset = Math.max(
            0,
            parentStartTime - firstSyllableStartTime,
          );
          const wipeDelay = relativeStartOffset + parentDuration * startPct;
          const wipeDuration = parentDuration * durationPct;

          const useStartAnimation = isFirstInContainer && charIndexInWord === 0;
          let charWipeAnimation = 'wipe';
          if (useStartAnimation)
            charWipeAnimation = isRTL ? 'start-wipe-rtl' : 'start-wipe';
          else charWipeAnimation = isRTL ? 'wipe-rtl' : 'wipe';

          // Blend word and syllable durations to let the gradient flow smoothly
          // while still responding to syllable pacing (no strict exactness, just natural flow)
          const growDelay = wipeDelay;
          const growDurationMs = Math.max(
            600,
            wordDurationMs * 0.8 + parentDuration * 1.5,
          );

          animationParts.push(
            `grow-dynamic ${growDurationMs}ms ease-in-out ${growDelay}ms forwards`,
          );

          if (wipeDuration > 0) {
            animationParts.push(
              `${charWipeAnimation} ${wipeDuration}ms linear ${wipeDelay}ms forwards`,
            );
          }
        }

        charAnimationsMap.set(span, animationParts.join(', '));

        styleUpdates.push({
          element: span,
          property: '--char-offset-x',
          value: `${horizontalOffset}`,
        });
        styleUpdates.push({
          element: span,
          property: '--max-scale',
          value: maxScale,
        });
        styleUpdates.push({
          element: span,
          property: '--shadow-intensity',
          value: shadowIntensity,
        });
        styleUpdates.push({
          element: span,
          property: '--translate-y-peak',
          value: `${translateYPeak}`,
        });
      });
    } else if (isGrowable && !isFirstSyllable && charSpans.length > 0) {
      // For subsequent syllables of a growable word:
      // If they already have `grow-dynamic`, it means the first syllable correctly took care of BOTH grow and wipe!
      // Otherwise, they scrubbed directly into this syllable, so let's at least do the wipe.
      charSpans.forEach(span => {
        const existingAnimation =
          charAnimationsMap.get(span) || span.style.animation || '';
        if (existingAnimation.includes('grow-dynamic')) return;

        const startPct = parseFloat(span.dataset.wipeStart || '0');
        const durationPct = parseFloat(span.dataset.wipeDuration || '0');
        const wipeDelay = syllableDurationMs * startPct;
        const wipeDuration = syllableDurationMs * durationPct;

        const charWipeAnimation = isRTL ? 'wipe-rtl' : 'wipe';

        if (wipeDuration > 0) {
          charAnimationsMap.set(
            span,
            `${charWipeAnimation} ${wipeDuration}ms linear ${wipeDelay}ms forwards`,
          );
        }
      });
    } else if (charSpans.length > 0) {
      // Per-character wipe for non-growable words (matching YouLyPlus)
      charSpans.forEach((span, charIndex) => {
        const startPct = parseFloat(span.dataset.wipeStart || '0');
        const durationPct = parseFloat(span.dataset.wipeDuration || '0');

        const wipeDelay = syllableDurationMs * startPct;
        const wipeDuration = syllableDurationMs * durationPct;

        const useStartAnimation = isFirstInContainer && charIndex === 0;
        let charWipeAnimation = 'wipe';
        if (useStartAnimation) {
          charWipeAnimation = isRTL ? 'start-wipe-rtl' : 'start-wipe';
        } else {
          charWipeAnimation = isRTL ? 'wipe-rtl' : 'wipe';
        }

        if (wipeDuration > 0) {
          charAnimationsMap.set(
            span,
            `${charWipeAnimation} ${wipeDuration}ms linear ${wipeDelay}ms forwards`,
          );
        }
      });
    } else {
      // Syllable-level wipe for regular (non-growable) words without chars
      const wipeRatio = parseFloat(
        syllable.getAttribute('data-wipe-ratio') || '1',
      );
      const visualDuration = syllableDurationMs * wipeRatio;

      let wipeAnimation = 'wipe';
      if (isFirstInContainer) {
        wipeAnimation = isRTL ? 'start-wipe-rtl' : 'start-wipe';
      } else {
        wipeAnimation = isRTL ? 'wipe-rtl' : 'wipe';
      }

      if (syllable.classList.contains('line-synced')) return;

      const currentWipeAnimation = isGap ? 'fade-gap' : wipeAnimation;
      // eslint-disable-next-line no-param-reassign
      syllable.style.animation = `${currentWipeAnimation} ${visualDuration}ms ${isGap ? 'ease-out' : 'linear'} forwards`;
    }

    // --- WRITE PHASE ---
    classList.remove('pre-highlight');
    classList.add('highlight');

    for (const [span, animationString] of charAnimationsMap.entries()) {
      span.style.animation = animationString;
    }

    // Apply style updates
    for (const update of styleUpdates) {
      update.element.style.setProperty(update.property, update.value);
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
    syllable.querySelectorAll('span.char').forEach(span => {
      const el = span as HTMLElement;
      el.style.animation = '';
      el.style.transition = 'none';
      el.style.backgroundColor = 'var(--lyplus-text-secondary)';
    });

    // Immediately remove all state classes
    syllable.classList.remove(
      'highlight',
      'finished',
      'pre-highlight',
      'cleanup',
    );

    // In next frame, clear inline styles so CSS transitions can resume for future use
    requestAnimationFrame(() => {
      syllable.style.removeProperty('background-color');
      syllable.style.removeProperty('transition');
      syllable.querySelectorAll('span.char').forEach(span => {
        const el = span as HTMLElement;
        el.style.removeProperty('background-color');
        el.style.removeProperty('transition');
      });
    });
  }

  /**
   * Reset all syllables in a line
   */
  private static resetSyllables(line: HTMLElement): void {
    if (!line) return;
    // eslint-disable-next-line no-param-reassign
    (line as any)._cachedSyllableElements = null;
    Array.from(line.getElementsByClassName('lyrics-syllable')).forEach(
      syllable => AmLyrics.resetSyllable(syllable as HTMLElement),
    );
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
      // eslint-disable-next-line no-param-reassign
      (line as any)._cachedSyllableElements = syllables;
    }

    for (let i = 0; i < syllables.length; i += 1) {
      const syllable = syllables[i];
      const startTime = parseFloat(
        syllable.getAttribute('data-start-time') || '0',
      );
      const endTime = parseFloat(syllable.getAttribute('data-end-time') || '0');

      if (startTime) {
        const { classList } = syllable;
        const hasHighlight = classList.contains('highlight');
        const hasFinished = classList.contains('finished');
        const hasPreHighlight = classList.contains('pre-highlight');
        const hasActiveState = hasHighlight || hasFinished || hasPreHighlight;

        // Early exit check
        if (!(currentTimeMs < startTime - 1000 && !hasActiveState)) {
          let preHighlightReset = false;

          // Pre-highlight reset logic
          if (hasPreHighlight && i > 0) {
            const prevSyllable = syllables[i - 1];
            if (!prevSyllable.classList.contains('highlight')) {
              classList.remove('pre-highlight');
              syllable.style.removeProperty('--pre-wipe-duration');
              syllable.style.removeProperty('--pre-wipe-delay');
              syllable.style.animation = '';
              preHighlightReset = true;
            }
          }

          if (!preHighlightReset) {
            if (currentTimeMs >= startTime && currentTimeMs <= endTime) {
              // Currently active
              if (!hasHighlight) {
                AmLyrics.updateSyllableAnimation(syllable);
              }
              if (hasFinished) {
                classList.remove('finished');
              }
            } else if (currentTimeMs > endTime) {
              // Finished
              if (!hasFinished) {
                if (!hasHighlight) {
                  AmLyrics.updateSyllableAnimation(syllable);
                }
                classList.add('finished');
              }
            } else if (hasHighlight || hasFinished) {
              // Not yet started
              AmLyrics.resetSyllable(syllable);
            }
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
    this.style.setProperty(
      '--hover-background-color',
      this.hoverBackgroundColor,
    );
    this.style.setProperty('--highlight-color', this.highlightColor);

    const sourceLabel = this.lyricsSource ?? 'Unavailable';

    const isUnsynced =
      this.lyrics && this.lyrics.length > 0
        ? this.lyrics.every(l => l.timestamp === 0 && l.endtime === 0)
        : false;

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

        // Create background vocals container (with romanization support)
        const backgroundVocalElement = hasBackground
          ? html`<p class="background-vocal-container">
              ${line.backgroundText!.map((syllable, syllableIndex) => {
                const startTimeMs = syllable.timestamp;
                const endTimeMs = syllable.endtime;
                const durationMs = endTimeMs - startTimeMs;

                const bgRomanizedText =
                  this.showRomanization &&
                  syllable.romanizedText &&
                  syllable.romanizedText.trim() !== syllable.text.trim()
                    ? html`<span
                        class="lyrics-syllable transliteration ${syllable.lineSynced
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

                return html`<span class="lyrics-word">
                  <span class="lyrics-syllable-wrap">
                    <span
                      class="lyrics-syllable ${syllable.lineSynced
                        ? 'line-synced'
                        : ''}"
                      data-start-time="${startTimeMs}"
                      data-end-time="${endTimeMs}"
                      data-duration="${durationMs}"
                      data-syllable-index="${syllableIndex}"
                      >${syllable.text}</span
                    >
                    ${bgRomanizedText}
                  </span>
                </span>`;
              })}
            </p>`
          : '';

        // Background vocals share the same line.translation and line.romanizedText
        // as the main vocal, so we intentionally do NOT render a separate
        // translation/romanization block for background — it would just duplicate
        // the main line's text.

        // Group syllables by word: when part=true, append to previous word group
        const wordGroups: Syllable[][] = [];
        for (const syllable of line.text) {
          if (syllable.part && wordGroups.length > 0) {
            // Continuation of previous word
            wordGroups[wordGroups.length - 1].push(syllable);
          } else {
            // New word
            wordGroups.push([syllable]);
          }
        }

        // Pre-compute isGrowable per "visual word": adjacent groups whose text
        // doesn't end with whitespace form one visual word (e.g. "a"+"live" = "alive").
        // We evaluate growable on the combined text/duration, then propagate
        // the result to each individual group so it renders through the
        // single-syllable path (which supports char-level glow).
        const groupGrowable: boolean[] = new Array(wordGroups.length).fill(
          false,
        );
        const groupGlowing: boolean[] = new Array(wordGroups.length).fill(
          false,
        );
        // Visual word info for growable char-level glow:
        // Each group stores the combined visual word's text, duration, and
        // the char offset of this group within the visual word.
        const vwFullText: string[] = new Array(wordGroups.length).fill('');
        const vwFullDuration: number[] = new Array(wordGroups.length).fill(0);
        const vwCharOffset: number[] = new Array(wordGroups.length).fill(0);
        const vwStartMs: number[] = new Array(wordGroups.length).fill(0);
        const vwEndMs: number[] = new Array(wordGroups.length).fill(0);
        {
          let vwStart = 0;
          while (vwStart < wordGroups.length) {
            let vwEnd = vwStart;
            while (vwEnd < wordGroups.length - 1) {
              const grp = wordGroups[vwEnd];
              const lastText = grp[grp.length - 1].text;
              if (/\s$/.test(lastText)) break;
              vwEnd += 1;
            }

            // Compute combined properties for this visual word
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
            const hasHyphen = combinedText.includes('-');

            const wordLen = combinedText.length;
            let isGrowableVW =
              !isCJK && !isRTL && !hasHyphen && wordLen > 0 && wordLen <= 12;
            if (isGrowableVW) {
              if (wordLen < 3) {
                isGrowableVW =
                  combinedDuration >= 1110 && combinedDuration >= wordLen * 550;
              } else {
                isGrowableVW =
                  combinedDuration >= 900 && combinedDuration >= wordLen * 300;
              }
            }

            // Glow requirement (more strict)
            const isGlowingVW =
              isGrowableVW &&
              combinedDuration >= 1200 &&
              combinedDuration >= combinedText.length * 300;

            let charOff = 0;
            for (let gi = vwStart; gi <= vwEnd; gi += 1) {
              groupGrowable[gi] = isGrowableVW;
              groupGlowing[gi] = isGlowingVW;
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
        }

        // Create main vocals using YouLyPlus syllable structure
        const mainVocalElement = html`<p class="main-vocal-container">
          ${wordGroups.map((group, groupIdx) => {
            const isGrowable = groupGrowable[groupIdx];
            const isGlowing = groupGlowing[groupIdx];
            const groupLineSynced = group.some(s => s.lineSynced);

            const wordText = isGrowable ? vwFullText[groupIdx] : '';
            const wordDuration = isGrowable ? vwFullDuration[groupIdx] : 0;
            const wordNumChars = wordText.length;
            const groupCharOffset = isGrowable ? vwCharOffset[groupIdx] : 0;

            let sylCharAccumulator = 0;

            return html`<span
              class="lyrics-word ${isGrowable ? 'growable' : ''} ${isGlowing
                ? 'glowing'
                : ''} ${group.length > 1 ? 'allow-break' : ''}"
            >
              ${group.map((syllable, sylIdx) => {
                const startTimeMs = syllable.timestamp;
                const endTimeMs = syllable.endtime;
                const durationMs = endTimeMs - startTimeMs;
                const text = syllable.text || '';

                const romanizedText =
                  this.showRomanization &&
                  syllable.romanizedText &&
                  syllable.romanizedText.trim() !== syllable.text.trim()
                    ? html`<span
                        class="lyrics-syllable transliteration ${groupLineSynced
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

                if (isGrowable) {
                  let charIndexInsideSyllable = 0;
                  const numCharsInSyllable =
                    text.replace(/\s/g, '').length || 1;

                  syllableContent = html`${text.split('').map(char => {
                    if (char === ' ') return ' ';

                    const charIndexInsideWord =
                      groupCharOffset + sylCharAccumulator;
                    const charStartPercentVal =
                      charIndexInsideSyllable / numCharsInSyllable;

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
                    const charTranslateYPeak =
                      -normalizedGrowth * (2 * peakMultiplier); // Further dampened lift peak

                    const position = (charIndexInsideWord + 0.5) / wordNumChars;
                    const horizontalOffset =
                      (position - 0.5) * 2 * ((charMaxScale - 1.0) * 25);

                    return html`<span
                      class="char"
                      data-char-index="${charIndexInsideWord}"
                      data-syllable-char-index="${charIndexInsideWord}"
                      data-wipe-start="${charStartPercentVal.toFixed(4)}"
                      data-wipe-duration="${(1 / numCharsInSyllable).toFixed(
                        4,
                      )}"
                      data-horizontal-offset="${horizontalOffset.toFixed(2)}"
                      data-max-scale="${charMaxScale.toFixed(3)}"
                      data-shadow-intensity="${charShadowIntensity.toFixed(3)}"
                      data-translate-y-peak="${charTranslateYPeak.toFixed(3)}"
                      >${char}</span
                    >`;
                  })}`;
                }

                return html`<span class="lyrics-syllable-wrap">
                  <span
                    class="lyrics-syllable ${groupLineSynced
                      ? 'line-synced'
                      : ''}"
                    data-start-time="${startTimeMs}"
                    data-end-time="${endTimeMs}"
                    data-duration="${durationMs}"
                    data-word-duration="${wordDuration}"
                    data-syllable-index="${sylIdx}"
                    data-wipe-ratio="1"
                    >${syllableContent}</span
                  >
                  ${romanizedText}
                </span>`;
              })}
            </span>`;
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
            ? html`<div class="lyrics-romanization-container">
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
          const gapLoopDelay = AmLyrics.getGapLoopDelay(gapDuration);

          // Gap starts without 'active' — _onTimeChanged toggles it imperatively
          maybeInstrumentalBlock = html`<div
            id="gap-${lineIndex}"
            class="lyrics-line lyrics-gap"
            data-start-time="${gapForLine.gapStart}"
            data-end-time="${gapForLine.gapEnd}"
            style="--gap-pulse-duration: ${GAP_PULSE_DURATION_MS}ms; --gap-loop-delay: -${gapLoopDelay}ms; --gap-exit-duration: ${GAP_EXIT_LEAD_MS}ms; --gap-exit-scale: ${GAP_MIN_SCALE};"
          >
            <div class="lyrics-line-container">
              <p class="main-vocal-container">
                <span class="lyrics-word">
                  <span class="lyrics-syllable-wrap">
                    <span
                      class="lyrics-syllable"
                      data-start-time="${gapForLine.gapStart}"
                      data-end-time="${gapForLine.gapStart + dotDuration}"
                      data-duration="${dotDuration}"
                      data-wipe-ratio="1"
                      data-syllable-index="0"
                    ></span>
                  </span>
                  <span class="lyrics-syllable-wrap">
                    <span
                      class="lyrics-syllable"
                      data-start-time="${gapForLine.gapStart + dotDuration}"
                      data-end-time="${gapForLine.gapStart + dotDuration * 2}"
                      data-duration="${dotDuration}"
                      data-wipe-ratio="1"
                      data-syllable-index="1"
                    ></span>
                  </span>
                  <span class="lyrics-syllable-wrap">
                    <span
                      class="lyrics-syllable"
                      data-start-time="${gapForLine.gapStart + dotDuration * 2}"
                      data-end-time="${gapForLine.gapEnd}"
                      data-duration="${dotDuration}"
                      data-wipe-ratio="1"
                      data-syllable-index="2"
                    ></span>
                  </span>
                </span>
              </p>
            </div>
          </div>`;
        }

        return html`
          ${maybeInstrumentalBlock}
          <div
            id="${lineId}"
            class="lyrics-line ${line.alignment === 'end'
              ? 'singer-right'
              : 'singer-left'}"
            data-start-time="${lineStartTime}"
            data-end-time="${lineEndTime}"
            @click=${() => this.handleLineClick(line)}
            tabindex="0"
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                this.handleLineClick(line);
              }
            }}
          >
            <div class="lyrics-line-container">
              ${mainVocalElement} ${backgroundVocalElement}
              ${translationElement} ${lineRomanizationElement}
            </div>
          </div>
        `;
      });
    };

    return html`
      <div
        class="lyrics-container ${isUnsynced
          ? 'is-unsynced'
          : 'blur-inactive-enabled'} ${this.isUserScrolling
          ? 'user-scrolling'
          : ''}"
      >
        ${!this.isLoading && this.lyrics && this.lyrics.length > 0
          ? html`
              <div class="lyrics-header">
                <div class="header-controls">
                  <button
                    class="download-button ${this.showRomanization
                      ? 'active'
                      : ''}"
                    @click=${this.toggleRomanization}
                    title="Toggle Romanization"
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
                    class="download-button ${this.showTranslation
                      ? 'active'
                      : ''}"
                    @click=${this.toggleTranslation}
                    title="Toggle Translation"
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
                  <span
                    class="source-info"
                    style="display: flex; align-items: center; gap: 8px;"
                  >
                    Source: ${sourceLabel}
                    ${(this.availableSources &&
                      this.availableSources.length > 1) ||
                    !this.hasFetchedAllProviders
                      ? html`
                          <button
                            class="download-button"
                            title="Switch Lyrics Source"
                            style="font-family: inherit; font-size: 11px; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.2); background: transparent; cursor: pointer; color: #aaa; display: inline-flex; align-items: center;"
                            @click=${this.switchSource}
                            ?disabled=${this.isFetchingAlternatives}
                          >
                            <svg
                              style="margin-right: 4px; ${this
                                .isFetchingAlternatives
                                ? 'animation: spin 1s linear infinite;'
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
                              class="lucide lucide-arrow-down-up-icon lucide-arrow-down-up"
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
                            ${this.isFetchingAlternatives
                              ? 'Switching...'
                              : 'Switch'}
                          </button>
                        `
                      : ''}
                  </span>
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

import { html, css, LitElement } from 'lit';
import { property, state, query } from 'lit/decorators.js';
import { GoogleService } from './GoogleService.js';

const VERSION = '1.0.7';
const INSTRUMENTAL_THRESHOLD_MS = 7000; // Show dots for gaps >= 7s

const KPOE_SERVERS = [
  'https://lyricsplus.binimum.org',
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
      animation-duration: 400ms;
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

    .lyrics-line.active .lyrics-line-container {
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
        max-height 0.3s,
        opacity 0.6s,
        padding 0.6s;
      margin: 0;
    }

    .lyrics-line.active .background-vocal-container {
      max-height: 4em;
      opacity: 1;
      transition:
        max-height 0.6s,
        opacity 0.6s,
        padding 0.6s;
      will-change: max-height, opacity, padding;
    }

    /* --- Line States & Modifiers --- */
    .lyrics-line.active {
      opacity: 1;
      color: var(--lyplus-text-primary);
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

    @media (hover: hover) and (pointer: fine) {
      .lyrics-line:hover {
        background: var(--hover-background-color, rgba(255, 255, 255, 0.13));
      }
    }

    /* --- Blur Effect for Inactive Lines --- */
    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line:not(.active):not(.lyrics-gap) {
      filter: blur(var(--lyplus-blur-amount));
    }

    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.post-active-line:not(.lyrics-gap):not(.active),
    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.next-active-line:not(.lyrics-gap):not(.active),
    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.lyrics-activest:not(.active):not(.lyrics-gap) {
      filter: blur(var(--lyplus-blur-amount-near));
    }

    /* Unblur all lines when user is scrolling */
    .lyrics-container.user-scrolling .lyrics-line {
      filter: none !important;
      opacity: 0.8 !important;
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
      height: 0;
      padding: 0 var(--lyplus-padding-gap);
      overflow: hidden;
      opacity: 0;
      box-sizing: content-box;
      background-clip: unset;
      transition:
        padding 0.3s 0.5s,
        height 0.3s 0.5s,
        opacity 0.2s 0.5s,
        transform 0.3s var(--lyrics-line-delay, 0ms);
    }

    .lyrics-gap.active {
      height: 1.3em;
      padding: var(--lyplus-padding-gap);
      opacity: 1;
      overflow: visible;
      transition:
        padding 0.3s,
        height 0.3s,
        opacity 0.2s 0.3s,
        transform 0.3s;
      will-change: height, opacity, padding;
    }

    /* Exiting state: keep gap visible while dots animate out */
    .lyrics-gap.gap-exiting {
      height: 1.3em;
      padding: var(--lyplus-padding-gap);
      opacity: 1;
      overflow: visible;
      transition:
        padding 0.3s 0.5s,
        height 0.3s 0.5s,
        opacity 0.2s 0.5s,
        transform 0.3s;
    }

    .lyrics-gap .main-vocal-container {
      transform: translateY(-25%) scale(1) translateZ(0);
    }

    /* Jump animation plays during exit */
    .lyrics-gap.gap-exiting .main-vocal-container {
      animation: gap-ended 0.8s ease forwards;
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
      animation: gap-loop 4s ease infinite alternate;
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
        transform: scale(1.15);
      }
      to {
        transform: scale(0.85);
      }
    }

    @keyframes gap-ended {
      0% {
        transform: translateY(-25%) scale(1) translateZ(0);
      }
      35% {
        transform: translateY(-25%) scale(1.2) translateZ(0);
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

  // Syllable animation tracking
  private lastActiveIndex = 0;

  private visibleLineIds: Set<string> = new Set();

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

    // If type is 'Line', we revert to line-by-line highlighting by skipping syllabus parsing
    const isLineType = payload.type === 'Line' || payload.type === 'line';

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
          transliteration.syllabus.forEach((s: any, i: number) => {
            if (mainSyllables[i]) {
              mainSyllables[i].romanizedText = s.text;
            }
          });
        }
      }

      // Extract translation from KPoe API if available
      const translationText = entry.translation?.text;

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
        this.handleUserScroll.bind(this),
        { passive: true },
      );
      this.lyricsContainer.addEventListener(
        'touchmove',
        this.handleUserScroll.bind(this),
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

    const newActiveLines = this.findActiveLineIndices(newTime);
    const oldActiveLines = this.activeLineIndices;

    // Reset animation if active lines change or if we skip time.
    // A threshold of 0.5s (500ms) is used to detect a "skip".
    const linesChanged = !AmLyrics.arraysEqual(newActiveLines, oldActiveLines);

    if (linesChanged || timeDiff > 0.5) {
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
            }
          }
        }
      }
      this.startAnimationFromTime(newTime);

      // Update position classes BEFORE scrolling so currentPrimaryActiveLine is current
      if (this.lyricsContainer && this.activeLineIndices.length > 0) {
        const primaryLineIndex = this.activeLineIndices[0];
        const primaryLine = this.lyricsContainer.querySelector(
          `#lyrics-line-${primaryLineIndex}`,
        ) as HTMLElement;

        if (primaryLine && primaryLine !== this.currentPrimaryActiveLine) {
          this.lastPrimaryActiveLine = this.currentPrimaryActiveLine;
          this.currentPrimaryActiveLine = primaryLine;
          this.updatePositionClasses(primaryLine);
        }
      }

      // Trigger scroll imperatively (was previously in updated() via @state)
      this._handleActiveLineScroll(oldActiveLines);
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
        const exitLeadMs = 600;
        const shouldStartExiting =
          isActive && !isExiting && newTime >= gapEndTime - exitLeadMs;

        if (shouldBeActive && !isActive && !isExiting) {
          // Entering gap: remove any leftover exit state, add active
          gap.classList.remove('gap-exiting');
          gap.classList.add('active');
          // Mark any dots whose time has already passed as finished
          // (prevents skipping the first dot when lyrics load mid-gap)
          const dotSyllables = gap.querySelectorAll('.lyrics-syllable');
          dotSyllables.forEach(dot => {
            const dotEnd = parseFloat(dot.getAttribute('data-end-time') || '0');
            if (newTime > dotEnd) {
              dot.classList.add('finished');
            }
          });
        } else if (shouldStartExiting) {
          // Exiting gap: keep visible while dots animate out
          gap.classList.add('gap-exiting');
          gap.classList.remove('active');
          // After exit animation completes, remove gap-exiting to collapse
          setTimeout(() => {
            gap.classList.remove('gap-exiting');
          }, 800);
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

      // Update position classes for YouLyPlus blur/opacity effect
      // (only needed when lines didn't change — when they DID change,
      // position classes are already updated above before scrolling)
      if (!linesChanged && this.activeLineIndices.length > 0) {
        const primaryLineIndex = this.activeLineIndices[0];
        const primaryLine = this.lyricsContainer.querySelector(
          `#lyrics-line-${primaryLineIndex}`,
        ) as HTMLElement;

        if (primaryLine && primaryLine !== this.currentPrimaryActiveLine) {
          this.lastPrimaryActiveLine = this.currentPrimaryActiveLine;
          this.currentPrimaryActiveLine = primaryLine;
          this.updatePositionClasses(primaryLine);
        }
      }

      // Pre-scroll: scroll to upcoming line ~0.5s before it starts
      if (
        this.autoScroll &&
        !this.isUserScrolling &&
        !this.isClickSeeking &&
        this.lyrics
      ) {
        const preScrollLeadMs = 500; // 500ms lead time

        // Condition: ONLY pre-scroll if no other lyric is currently playing.
        // If a lyric is playing, we must wait for it to finish (handled by updated()).
        if (this.activeLineIndices.length === 0) {
          for (let i = 0; i < this.lyrics.length; i += 1) {
            const line = this.lyrics[i];
            const timeUntilStart = line.timestamp - newTime;
            if (timeUntilStart > 0 && timeUntilStart <= preScrollLeadMs) {
              const nextLineEl = this.lyricsContainer.querySelector(
                `#lyrics-line-${i}`,
              ) as HTMLElement;
              // Only trigger if we aren't already targeting this line
              if (nextLineEl && nextLineEl !== this.currentPrimaryActiveLine) {
                // We don't set currentPrimaryActiveLine here to avoid triggering
                // styles, just the YouLy scroll.
                this.scrollToActiveLineYouLy(nextLineEl);
              }
              break;
            }
          }
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
  private _handleActiveLineScroll(oldActiveIndices: number[]): void {
    if (
      !this.autoScroll ||
      this.isUserScrolling ||
      this.isClickSeeking ||
      this.activeLineIndices.length === 0
    ) {
      return;
    }

    // Determine what changed: did we gain new lines or just lose old ones?
    const newlyAdded = this.activeLineIndices.filter(
      idx => !oldActiveIndices.includes(idx),
    );

    if (newlyAdded.length === 0) {
      // Only lost lines (an overlap resolved) — don't scroll
      return;
    }

    // New lines were added — scroll to the latest newly-added line.
    // Previous overlap logic skipped every other line for songs with tiny
    // timing overlaps between consecutive lines, causing a visible glitch.
    const latestNewIndex = newlyAdded[newlyAdded.length - 1];
    const targetLine = this.lyricsContainer?.querySelector(
      `#lyrics-line-${latestNewIndex}`,
    ) as HTMLElement;

    if (targetLine) {
      this.scrollToActiveLineYouLy(targetLine);
    } else if (this.currentPrimaryActiveLine) {
      this.scrollToActiveLineYouLy(this.currentPrimaryActiveLine);
    } else {
      this.scrollToActiveLine();
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
    const clickedLineElement = this.lyricsContainer?.querySelector(
      `.lyrics-line[data-start-time="${line.timestamp * 1000}"]`,
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
    // Always use actual scroll position - don't fall back to stale currentScrollOffset
    // The || operator treats 0 as falsy, which caused bounce when scrollTop was 0
    const prevOffset = -parent.scrollTop;
    const delta = prevOffset - newTranslateY;
    this.currentScrollOffset = newTranslateY;

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

    const delayIncrement = 30;
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

      newAnimatingLines.push(line);

      const lineDuration = 400 + delay;
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
    const BASE_DURATION = 400;

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
    }, 600);

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

    // Step 1: Grow Pass - apply grow-dynamic to ALL word chars on first syllable
    if (isGrowable && isFirstSyllable && allWordCharSpans.length > 0) {
      const finalDuration = wordDurationMs;
      const baseDelayPerChar = finalDuration * 0.09;
      const growDurationMs = finalDuration * 1.5;

      allWordCharSpans.forEach(span => {
        const horizontalOffset = parseFloat(
          span.dataset.horizontalOffset || '0',
        );
        // Use syllableCharIndex like YouLyPlus, not loop index
        const charIndex = parseFloat(span.dataset.syllableCharIndex || '0');
        const growDelay = baseDelayPerChar * charIndex;

        // READ DATA ATTRIBUTES for style values
        const maxScale = span.dataset.maxScale || '1.1';
        const shadowIntensity = span.dataset.shadowIntensity || '0.6';
        const translateYPeak = span.dataset.translateYPeak || '-2';

        charAnimationsMap.set(
          span,
          `grow-dynamic ${growDurationMs}ms ease-in-out ${growDelay}ms forwards`,
        );

        // Push style updates to be applied imperatively
        styleUpdates.push({
          element: span,
          property: '--char-offset-x',
          value: `${horizontalOffset}`, // Fixed: removed px suitable for matrix3d
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
          value: `${translateYPeak}`, // Fixed: removed % because matrix3d expects raw number
        });
      });
    }

    // Step 2: Wipe Pass
    if (charSpans.length > 0) {
      // Per-character wipe for growable words (matching YouLyPlus)
      charSpans.forEach((span, charIndex) => {
        const startPct = parseFloat(span.dataset.wipeStart || '0');
        const durationPct = parseFloat(span.dataset.wipeDuration || '0');

        const wipeDelay = syllableDurationMs * startPct;
        const wipeDuration = syllableDurationMs * durationPct;

        const useStartAnimation = isFirstInContainer && charIndex === 0;
        let charWipeAnimation: string;
        if (useStartAnimation) {
          charWipeAnimation = isRTL ? 'start-wipe-rtl' : 'start-wipe';
        } else {
          charWipeAnimation = isRTL ? 'wipe-rtl' : 'wipe';
        }

        // Get existing animation from map (grow-dynamic) and combine with wipe
        const existingAnimation =
          charAnimationsMap.get(span) || span.style.animation || '';
        const animationParts: string[] = [];

        if (existingAnimation && existingAnimation.includes('grow-dynamic')) {
          animationParts.push(existingAnimation.split(',')[0].trim());
        }

        if (wipeDuration > 0) {
          animationParts.push(
            `${charWipeAnimation} ${wipeDuration}ms linear ${wipeDelay}ms forwards`,
          );
        }

        charAnimationsMap.set(span, animationParts.join(', '));
      });
    } else {
      // Syllable-level wipe for regular (non-growable) words
      const wipeRatio = parseFloat(
        syllable.getAttribute('data-wipe-ratio') || '1',
      );
      const visualDuration = syllableDurationMs * wipeRatio;

      let wipeAnimation: string;
      if (isFirstInContainer) {
        wipeAnimation = isRTL ? 'start-wipe-rtl' : 'start-wipe';
      } else {
        wipeAnimation = isRTL ? 'wipe-rtl' : 'wipe';
      }

      if (syllable.classList.contains('line-synced')) {
        // If line-synced, just add the class for CSS animation, or ensure valid state
        // The CSS rule .lyrics-syllable.line-synced handles the fade
        return;
      }

      const currentWipeAnimation = isGap ? 'fade-gap' : wipeAnimation;
      const syllableAnimation = `${currentWipeAnimation} ${visualDuration}ms ${isGap ? 'ease-out' : 'linear'} forwards`;
      // eslint-disable-next-line no-param-reassign
      syllable.style.animation = syllableAnimation;
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

        // Create main vocals using YouLyPlus syllable structure
        const mainVocalElement = html`<p class="main-vocal-container">
          ${wordGroups.map(group => {
            // Compute combined text and timing for the whole word group
            const groupText = group.map(s => s.text).join('');
            const groupTrimmed = groupText.trim();
            const groupStart = group[0].timestamp;
            const groupEnd = group[group.length - 1].endtime;
            const groupDuration = groupEnd - groupStart;

            // Check if ANY syllable in group is line-synced
            const groupLineSynced = group.some(s => s.lineSynced);

            // YouLyPlus growable criteria applied to the FULL word
            const isCJK =
              /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(
                groupTrimmed,
              );
            const isRTL =
              /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0590-\u05FF]/.test(
                groupTrimmed,
              );
            const hasHyphen = groupTrimmed.includes('-');
            const isGrowable =
              !isCJK &&
              !isRTL &&
              !hasHyphen &&
              groupTrimmed.length <= 7 &&
              groupTrimmed.length > 0 &&
              groupDuration >= 700 &&
              groupDuration >= groupTrimmed.length * 400;

            // For single-syllable groups, use original logic
            if (group.length === 1) {
              const syllable = group[0];
              const startTimeMs = syllable.timestamp;
              const endTimeMs = syllable.endtime;
              const durationMs = endTimeMs - startTimeMs;
              const text = syllable.text || '';
              const trimmedText = text.trim();

              // Optional romanization per syllable (hide if same as the original text)
              const romanizedText =
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

              // For growable words, wrap each character in a span with YouLyPlus applyGrowthStyles
              const syllableContent = isGrowable
                ? html`${text.split('').map((char, charIndex) => {
                    if (char === ' ') {
                      return ' ';
                    }
                    const numChars = trimmedText.length;
                    const charStartPercent = charIndex / text.length;

                    // YouLyPlus emphasisMetrics calculation
                    const minDuration = 1000;
                    const maxDuration = 5000;
                    const easingPower = 3;
                    const progress = Math.min(
                      1,
                      Math.max(
                        0,
                        (durationMs - minDuration) /
                          (maxDuration - minDuration),
                      ),
                    );
                    const easedProgress = progress ** easingPower;

                    // Decay calculation for long/short words
                    const isLongWord = numChars > 5;
                    const isShortDuration = durationMs < 1500;
                    let maxDecayRate = 0;
                    if (isLongWord || isShortDuration) {
                      let decayStrength = 0;
                      if (isLongWord)
                        decayStrength +=
                          Math.min((numChars - 5) / 3, 1.0) * 0.4;
                      if (isShortDuration)
                        decayStrength +=
                          Math.max(0, 1.0 - (durationMs - 1000) / 500) * 0.4;
                      maxDecayRate = Math.min(decayStrength, 0.85);
                    }

                    // Per-character calculations (exact YouLyPlus logic)
                    const positionInWord =
                      numChars > 1 ? charIndex / (numChars - 1) : 0;
                    const decayFactor = 1.0 - positionInWord * maxDecayRate;
                    const charProgress = easedProgress * decayFactor;

                    const baseGrowth = numChars <= 3 ? 0.07 : 0.05;
                    const charMaxScale = 1.0 + baseGrowth + charProgress * 0.1;
                    const charShadowIntensity = 0.4 + charProgress * 0.4;
                    const normalizedGrowth = (charMaxScale - 1.0) / 0.13;
                    const charTranslateYPeak = -normalizedGrowth * 6;

                    // Horizontal offset (simplified - YouLyPlus uses actual text width measurement)
                    const position = (charIndex + 0.5) / numChars;
                    const horizontalOffset =
                      (position - 0.5) * 2 * ((charMaxScale - 1.0) * 25);

                    // MOVED TO DATA ATTRIBUTES and removed style attribute to avoid Lit conflict
                    return html`<span
                      class="char"
                      data-char-index="${charIndex}"
                      data-syllable-char-index="${charIndex}"
                      data-wipe-start="${charStartPercent.toFixed(4)}"
                      data-wipe-duration="${(1 / text.length).toFixed(4)}"
                      data-horizontal-offset="${horizontalOffset.toFixed(2)}"
                      data-max-scale="${charMaxScale.toFixed(3)}"
                      data-shadow-intensity="${charShadowIntensity.toFixed(3)}"
                      data-translate-y-peak="${charTranslateYPeak.toFixed(3)}"
                      >${char}</span
                    >`;
                  })}`
                : text;

              return html`<span
                class="lyrics-word ${isGrowable ? 'growable' : ''}"
              >
                <span class="lyrics-syllable-wrap">
                  <span
                    class="lyrics-syllable ${syllable.lineSynced
                      ? 'line-synced'
                      : ''}"
                    data-start-time="${startTimeMs}"
                    data-end-time="${endTimeMs}"
                    data-duration="${durationMs}"
                    data-syllable-index="0"
                    data-wipe-ratio="1"
                    >${syllableContent}</span
                  >
                  ${romanizedText}
                </span>
              </span>`;
            }

            // Multi-syllable group (part=true): render all syllables inside one lyrics-word
            return html`<span
              class="lyrics-word ${isGrowable ? 'growable' : ''} allow-break"
            >
              ${group.map(
                (syllable, sylIdx) => html`
                  <span class="lyrics-syllable-wrap">
                    <span
                      class="lyrics-syllable ${groupLineSynced
                        ? 'line-synced'
                        : ''}"
                      data-start-time="${syllable.timestamp}"
                      data-end-time="${syllable.endtime}"
                      data-duration="${syllable.endtime - syllable.timestamp}"
                      data-syllable-index="${sylIdx}"
                      data-wipe-ratio="1"
                      >${syllable.text}</span
                    >
                    ${this.showRomanization &&
                    syllable.romanizedText &&
                    syllable.romanizedText.trim() !== syllable.text.trim()
                      ? html`<span
                          class="lyrics-syllable transliteration ${groupLineSynced
                            ? 'line-synced'
                            : ''}"
                          data-start-time="${syllable.timestamp}"
                          data-end-time="${syllable.endtime}"
                          data-duration="${syllable.endtime -
                          syllable.timestamp}"
                          data-syllable-index="0"
                          data-wipe-ratio="1"
                          >${syllable.romanizedText}</span
                        >`
                      : ''}
                  </span>
                `,
              )}
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
          // Calculate dot timing for fill-up animation (3 dots)
          const dotDuration = (gapForLine.gapEnd - gapForLine.gapStart) / 3;

          // Gap starts without 'active' — _onTimeChanged toggles it imperatively
          maybeInstrumentalBlock = html`<div
            id="gap-${lineIndex}"
            class="lyrics-line lyrics-gap"
            data-start-time="${gapForLine.gapStart}"
            data-end-time="${gapForLine.gapEnd}"
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
        class="lyrics-container blur-inactive-enabled ${this.isUserScrolling
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

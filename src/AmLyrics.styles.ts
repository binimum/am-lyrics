import { css } from 'lit';

export const lyricsStyles = css`
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
    transform: translateY(0);
    outline: none;
    -webkit-tap-highlight-color: transparent;
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
    transform-origin: left bottom;
    transform: scale(var(--am-lyrics-inactive-scale));
    transition:
      transform 0.7s ease,
      background-color 0.7s,
      color 0.7s;
  }

  .lyrics-line.active .lyrics-line-container,
  .lyrics-line.pre-active .lyrics-line-container {
    transform: scale(1);
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
    --word-wipe-color: var(
      --am-lyrics-background-vocal-color,
      color-mix(in srgb, var(--lyplus-text-primary) 75%, transparent)
    );
    --word-inactive-color: var(
      --am-lyrics-background-vocal-inactive-color,
      color-mix(in srgb, var(--word-wipe-color) 55%, transparent)
    );
    position: relative;
    height: 0;
    overflow: visible;
    font-size: var(--am-lyrics-background-vocal-font-size);
    line-height: 1.22;
    padding: 0;
    box-sizing: border-box;
    color: var(--word-inactive-color);
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
      transform var(--scroll-duration, 400ms) cubic-bezier(0.41, 0, 0.12, 0.99)
        var(--lyrics-line-delay, 0ms),
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
    transform-origin: right bottom;
  }

  .lyrics-line.rtl-text {
    direction: rtl;
    text-align: right;
    transform-origin: right;
  }

  .lyrics-line.rtl-text .lyrics-line-container,
  .lyrics-line.rtl-text .main-vocal-container {
    transform-origin: right bottom;
  }

  .lyrics-line.rtl-text .lyrics-romanization-container,
  .lyrics-line.rtl-text .lyrics-translation-container {
    text-align: right;
  }

  .lyrics-line.rtl-text.singer-right {
    text-align: left;
    transform-origin: left;
  }
  .lyrics-line.rtl-text.singer-right .lyrics-line-container,
  .lyrics-line.rtl-text.singer-right .main-vocal-container,
  .lyrics-line.rtl-text.singer-right .background-vocal-wrap {
    transform-origin: left bottom;
  }
  .lyrics-line.rtl-text.singer-right .background-vocal-container {
    margin-left: 0;
    margin-right: auto;
  }
  .lyrics-line.rtl-text.singer-right .lyrics-romanization-container,
  .lyrics-line.rtl-text.singer-right .lyrics-translation-container {
    text-align: left;
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
    transform: scale(var(--am-lyrics-touch-scale));
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
  .lyrics-container.blur-inactive-enabled
    .lyrics-line.pre-active:not(.progressive-unblur) {
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
    transform: translateY(0);
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
    transform: translateY(calc(var(--char-rise-y) * var(--am-lyrics-lift)));
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

  /* The gradient owns word-timed text; a colour transition must not fill it. */
  .lyrics-syllable:not(.line-synced) {
    -webkit-text-fill-color: transparent;
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
  .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.pre-highlight.no-chars {
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
  .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.pre-highlight.rtl-text {
    direction: rtl;
    background-image: linear-gradient(
      -90deg,
      var(--lyplus-text-primary) 0%,
      var(--lyplus-text-primary) calc(100% - var(--wipe-gradient-width, 0.75em)),
      transparent 100%
    );
    background-size: 0% 100%;
    background-position: right 0%;
  }

  .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.wipe-rtl.highlight,
  .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.wipe-rtl.pre-highlight {
    background-image: linear-gradient(
      -90deg,
      var(--word-wipe-color, var(--lyplus-text-primary)) 0%,
      var(--word-wipe-color, var(--lyplus-text-primary))
        calc(100% - var(--wipe-gradient-width, 0.75em)),
      transparent 100%
    );
    background-size: 0% 100%;
    background-position: right 0%;
  }

  /* BG vocals use the theme colour with separate upcoming/selected tones. */
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
      var(--word-wipe-color) 0%,
      var(--word-wipe-color) calc(100% - var(--wipe-gradient-width, 0.75em)),
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
      var(--word-wipe-color) 0%,
      var(--word-wipe-color) calc(100% - var(--wipe-gradient-width, 0.75em)),
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
    transform: translateY(
      calc(var(--char-rise-y, -1.12px) * var(--am-lyrics-lift))
    );
  }

  .lyrics-line.persist-highlight:not(.lyrics-gap)
    .lyrics-word
    .lyrics-syllable.no-chars.finished {
    transform: translateY(
      calc(var(--char-rise-y, -1.12px) * var(--am-lyrics-lift))
    );
  }

  .lyrics-word.growable .lyrics-syllable.cleanup .char {
    transform: translateY(
      calc(var(--char-rise-y, -1.12px) * var(--am-lyrics-lift))
    );
  }

  .lyrics-word.char-drag .lyrics-syllable.cleanup .char {
    transform: translateY(
      calc(var(--char-rise-y, -1.12px) * var(--am-lyrics-lift))
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
    transform: translateY(
      calc(var(--char-rise-y, -1.12px) * var(--am-lyrics-lift))
    );
  }

  /* Background vocal overrides — placed AFTER main rules so they win
     on equal specificity. */
  .background-vocal-container .lyrics-syllable {
    background-color: var(--word-inactive-color);
  }

  .lyrics-line.active:not(.lyrics-gap)
    .background-vocal-container
    .lyrics-syllable.finished:not(.has-chars),
  .lyrics-line.pre-active
    .background-vocal-container
    .lyrics-syllable.finished:not(.has-chars) {
    background-color: var(--word-wipe-color);
  }

  .background-vocal-container .lyrics-syllable.line-synced {
    color: var(--word-inactive-color) !important;
  }

  .lyrics-line.active:not(.lyrics-gap)
    .background-vocal-container
    .lyrics-syllable.line-synced,
  .lyrics-line.pre-active
    .background-vocal-container
    .lyrics-syllable.line-synced {
    color: var(--word-wipe-color) !important;
  }

  .lyrics-line.active:not(.lyrics-gap)
    .background-vocal-container
    .lyrics-syllable.line-synced.finished,
  .lyrics-line.pre-active
    .background-vocal-container
    .lyrics-syllable.line-synced.finished {
    color: var(--word-wipe-color) !important;
  }

  .lyrics-line.active:not(.lyrics-gap)
    .background-vocal-container
    .lyrics-word.word-started
    .lyrics-syllable.no-chars,
  .lyrics-line.persist-highlight:not(.lyrics-gap)
    .background-vocal-container
    .lyrics-word
    .lyrics-syllable.no-chars.finished {
    transform: translateY(calc(var(--char-rise-y) * var(--am-lyrics-lift)));
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

  .lyrics-timed-romanization {
    display: block;
    direction: ltr;
    unicode-bidi: isolate;
    font-size: var(--lyplus-font-size-subtext);
  }

  .lyrics-timed-romanization .lyrics-syllable.transliteration {
    font-size: 1em;
  }

  /* Syllable with chars: make syllable transparent, chars handle color */
  .lyrics-line .lyrics-word .lyrics-syllable.has-chars {
    background-color: transparent;
    color: transparent;
  }

  .char-motion {
    position: relative;
    display: inline-block;
    vertical-align: baseline;
    transform-origin: 50% 100%;
    transform: translate(0px, 0px) scale(1);
  }

  .lyrics-line:not(.far-line) .char-motion.is-rising {
    will-change: transform;
  }

  .lyrics-syllable .char-motion > .char {
    transform: none !important;
  }

  .reduced-motion .char-motion {
    transform: none !important;
    will-change: auto !important;
  }

  .lyrics-syllable span.char {
    display: inline-block;
    background-color: var(--word-inactive-color, var(--lyplus-text-secondary));
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
  .lyrics-line.active .char-motion[data-glow]::after,
  .lyrics-line.pre-active .char-motion[data-glow]::after {
    content: attr(data-glyph);
    position: absolute;
    inset: 0;
    pointer-events: none;
    color: transparent;
    -webkit-text-fill-color: transparent;
    text-shadow: 0 0 0.3em var(--lyplus-text-primary);
    animation: char-glow var(--char-glow-duration) linear var(--char-glow-delay)
      both;
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

  .reduced-motion .char-motion::after {
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

  /* Unscheduled glyphs have no edge to paint into their overhang padding. */
  .lyrics-line.active
    .lyrics-syllable:not(.highlight):not(.pre-highlight):not(.finished)
    span.char:not(.shared-word-wipe) {
    background-image: none;
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
      background-color 0ms,
      transform 1s ease;
  }

  .lyrics-line
    .lyrics-word
    .lyrics-syllable.shared-word-wipe.word-wipe-rtl:not(.masked-word-wipe),
  .lyrics-line
    .lyrics-word
    .lyrics-syllable
    span.char.shared-word-wipe.word-wipe-rtl:not(.masked-word-wipe) {
    background-image: linear-gradient(
      -90deg,
      currentColor 0%,
      currentColor calc(100% - var(--wipe-gradient-width, 0.75em)),
      transparent 100%
    ) !important;
  }

  /* Keep ordinary text underneath the independently masked highlight. */
  .lyrics-line .lyrics-word .lyrics-syllable.masked-word-wipe,
  .lyrics-line .lyrics-word .lyrics-syllable span.char.masked-word-wipe {
    --word-base-background: transparent;
    position: relative;
    background-color: transparent !important;
    background-image: none !important;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: var(
      --word-inactive-color,
      var(--lyplus-text-secondary)
    );
  }

  /* Keep the dim glyphs painted while their wipe is still unscheduled. */
  .lyrics-line
    .lyrics-word
    .lyrics-syllable.no-chars:not(.line-synced):not(.shared-word-wipe):not(
      .highlight
    ):not(.pre-highlight):not(.finished),
  .lyrics-line
    .lyrics-word
    .lyrics-syllable:not(.highlight):not(.pre-highlight):not(.finished)
    span.char:not(.shared-word-wipe) {
    background-color: transparent !important;
    background-image: none !important;
    -webkit-text-fill-color: var(
      --word-inactive-color,
      var(--lyplus-text-secondary)
    );
  }

  .masked-word-wipe::before {
    content: attr(data-wipe-text);
    content: attr(data-wipe-text) / '';
    position: absolute;
    inset: 0;
    /* Chromium's mask surface still clips overflowing ink with no-clip. */
    inset-block: -0.25em;
    padding-block: 0.25em;
    padding-inline: inherit;
    box-sizing: border-box;
    white-space: inherit;
    color: inherit;
    -webkit-text-fill-color: currentColor;
    pointer-events: none;
    -webkit-mask-image: linear-gradient(
      90deg,
      #000 0%,
      #000 calc(100% - var(--wipe-gradient-width, 0.75em)),
      transparent 100%
    );
    mask-image: linear-gradient(
      90deg,
      #000 0%,
      #000 calc(100% - var(--wipe-gradient-width, 0.75em)),
      transparent 100%
    );
    /* Repeating masks produce bright tile-edge bands in Chromium. */
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-clip: no-clip;
    mask-clip: no-clip;
    -webkit-mask-origin: content-box;
    mask-origin: content-box;
    /* Cover the ink padding with one centred mask rather than repeated tiles. */
    mask-size: calc(var(--word-wipe-width) + var(--wipe-gradient-width))
      calc(100% + 0.5em);
    -webkit-mask-size: calc(var(--word-wipe-width) + var(--wipe-gradient-width))
      calc(100% + 0.5em);
    mask-position: var(--word-wipe-position);
    -webkit-mask-position: var(--word-wipe-position);
  }

  .masked-word-wipe.word-wipe-rtl::before {
    -webkit-mask-image: linear-gradient(
      -90deg,
      #000 0%,
      #000 calc(100% - var(--wipe-gradient-width, 0.75em)),
      transparent 100%
    );
    mask-image: linear-gradient(
      -90deg,
      #000 0%,
      #000 calc(100% - var(--wipe-gradient-width, 0.75em)),
      transparent 100%
    );
  }

  .lyrics-container:not(.is-unsynced)
    .lyrics-line:not(.active):not(.pre-active):not(.lyrics-gap)
    .masked-word-wipe::before {
    opacity: 0;
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
      --word-base-background,
      var(--word-inactive-color, var(--lyplus-text-secondary))
    ) !important;
  }

  .lyrics-line.scroll-exiting .char-motion::after {
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
    background-color: transparent !important;
    -webkit-text-fill-color: var(
      --word-inactive-color,
      var(--lyplus-text-secondary)
    );
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
  }

  .lyrics-gap.active .main-vocal-container {
    will-change: transform, opacity;
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

  .lyrics-line:is(.active, .pre-active) .lyrics-syllable.line-synced span.char {
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
  .lyrics-gap:not(.active):not(.gap-exiting).post-active-line .lyrics-syllable,
  .lyrics-gap:not(.active):not(.gap-exiting).lyrics-activest .lyrics-syllable {
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

  .contributor-stack {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .contributor-avatar,
  .contributor-overflow > summary {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    box-sizing: border-box;
    border-radius: 50%;
    background: #303030;
    color: #fff;
    font: 500 12px/1 sans-serif;
    text-decoration: none;
    outline: 1px solid rgba(255, 255, 255, 0.16);
    box-shadow: 0 0 0 2px #222;
    cursor: pointer;
  }

  .contributor-stack > * + * {
    margin-inline-start: -8px;
  }

  .contributor-avatar img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    object-fit: cover;
  }

  .contributor-avatar:hover,
  .contributor-avatar:focus-visible,
  .contributor-overflow[open] {
    z-index: 2;
  }

  .contributor-avatar:focus-visible,
  .contributor-overflow > summary:focus-visible {
    outline: 2px solid var(--lyplus-text-primary);
    outline-offset: 3px;
  }

  .contributor-tooltip,
  .contributor-menu {
    position: absolute;
    bottom: calc(100% + 10px);
    inset-inline-start: 0;
    padding: 9px 12px;
    border-radius: 14px;
    background: rgba(32, 32, 32, 0.85);
    color: #fff;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.18),
      0 8px 24px rgba(0, 0, 0, 0.25);
    -webkit-backdrop-filter: blur(18px) saturate(1.4);
    backdrop-filter: blur(18px) saturate(1.4);
    font: 500 12px/1.4 sans-serif;
  }

  .contributor-tooltip {
    width: max-content;
    max-width: 220px;
    opacity: 0;
    transform: translateY(3px);
    pointer-events: none;
    transition:
      opacity 140ms ease-out,
      transform 140ms ease-out;
  }

  .contributor-avatar:hover .contributor-tooltip,
  .contributor-avatar:focus-visible .contributor-tooltip {
    opacity: 1;
    transform: none;
  }

  .contributor-overflow {
    position: relative;
  }

  .contributor-overflow > summary {
    list-style: none;
    font-variant-numeric: tabular-nums;
  }

  .contributor-overflow > summary::-webkit-details-marker {
    display: none;
  }

  .contributor-menu {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: max-content;
    max-width: min(260px, 70vw);
    max-height: 220px;
    overflow: auto;
  }

  .contributor-menu a {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 40px;
    color: inherit;
    text-decoration: none;
  }

  .contributor-menu .contributor-avatar {
    flex-shrink: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .contributor-tooltip {
      transition: none;
    }
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

  .source-info {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .source-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    font-size: 0.8em;
    line-height: 1;
    white-space: nowrap;
  }

  .source-badge svg {
    display: block;
    width: 1em;
    height: 1em;
    flex-shrink: 0;
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
    unicode-bidi: plaintext;
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
      --lyrics-scroll-padding-top: var(--am-lyrics-wide-selected-position, 20%);
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

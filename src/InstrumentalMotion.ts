import type { LyricsLine } from './LyricsSources.js';

export const INSTRUMENTAL_THRESHOLD_MS = 7000;

const GAP_PULSE_DURATION_MS = 4000;
const GAP_ENTRY_FADE_MS = 160;
const GAP_ENTRY_SCALE_MS = 400;
export const GAP_COLLAPSE_LEAD_MS = 500;
export const GAP_EXIT_LEAD_MS = 350;
export const GAP_EXIT_TRAIL_MS = 250;
const GAP_BREATH_MIN_SCALE = 0.85;
const GAP_BREATH_MAX_SCALE = 1.12;
const GAP_EXIT_POP_SCALE = 1.2;
const GAP_EXIT_POP_PROGRESS = 0.35;

export interface InstrumentalGap {
  insertBeforeIndex: number;
  gapStart: number;
  gapEnd: number;
}

export function findInstrumentalGaps(lines: LyricsLine[]): InstrumentalGap[] {
  if (!lines.length) return [];
  const gaps: InstrumentalGap[] = [];
  // Start-of-song gap
  const first = lines[0];
  if (first.timestamp >= INSTRUMENTAL_THRESHOLD_MS) {
    gaps.push({ insertBeforeIndex: 0, gapStart: 0, gapEnd: first.timestamp });
  }

  // Track all vocal tails, including backing lines that overlap a later lead.
  let vocalEnd = 0;
  lines.forEach((line, index) => {
    if (index > 0 && line.timestamp - vocalEnd >= INSTRUMENTAL_THRESHOLD_MS) {
      gaps.push({
        insertBeforeIndex: index,
        gapStart: vocalEnd,
        gapEnd: line.timestamp,
      });
    }
    vocalEnd = Math.max(line.endtime, vocalEnd);
    line.text.forEach(syllable => {
      vocalEnd = Math.max(vocalEnd, syllable.endtime);
    });
    line.backgroundText.forEach(syllable => {
      vocalEnd = Math.max(vocalEnd, syllable.endtime);
    });
  });

  return gaps;
}

export interface InstrumentalMotion {
  animations: Animation[];
  exitStart: number;
  end: number;
}

function easeOutExpo(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return 1 - 2 ** (-10 * progress);
}

function createBreathFrames(exitStart: number, end: number) {
  // Dense samples only around the entrance and exit; the slow breath needs
  // far fewer. The browser interpolates all frames without playback ticks.
  const times = new Set([
    0,
    GAP_ENTRY_FADE_MS,
    GAP_ENTRY_SCALE_MS,
    exitStart,
    end,
  ]);
  for (let t = 25; t < GAP_ENTRY_SCALE_MS; t += 25) times.add(t);
  for (
    let t = GAP_ENTRY_SCALE_MS;
    t < exitStart;
    t += Math.max(400, exitStart / 1000)
  )
    times.add(t);
  for (let t = exitStart; t < end; t += 20) times.add(t);
  return [...times]
    .filter(t => t <= end)
    .sort((a, b) => a - b)
    .map(time => {
      const cycle = GAP_PULSE_DURATION_MS * 2;
      const phase =
        (time + GAP_PULSE_DURATION_MS - (exitStart % cycle) + cycle) % cycle;
      const mix = (1 - Math.cos((Math.PI * phase) / GAP_PULSE_DURATION_MS)) / 2;
      let scale =
        (GAP_BREATH_MAX_SCALE +
          (GAP_BREATH_MIN_SCALE - GAP_BREATH_MAX_SCALE) * mix) *
        easeOutExpo(time / GAP_ENTRY_SCALE_MS);
      let opacity = Math.min(1, time / GAP_ENTRY_FADE_MS);
      if (time >= exitStart) {
        const progress = (time - exitStart) / Math.max(1, end - exitStart);
        const popping = progress <= GAP_EXIT_POP_PROGRESS;
        const phaseProgress = popping
          ? progress / GAP_EXIT_POP_PROGRESS
          : (progress - GAP_EXIT_POP_PROGRESS) / (1 - GAP_EXIT_POP_PROGRESS);
        const ease = phaseProgress * phaseProgress * (3 - 2 * phaseProgress);
        scale = popping
          ? GAP_BREATH_MIN_SCALE +
            (GAP_EXIT_POP_SCALE - GAP_BREATH_MIN_SCALE) * ease
          : GAP_EXIT_POP_SCALE * (1 - ease);
        opacity = popping ? 1 : 1 - ease;
      }
      return {
        offset: time / end,
        transform: `scale(${scale})`,
        opacity,
      };
    });
}

export function createInstrumentalMotion(
  layer: HTMLElement,
  dots: HTMLElement[],
  duration: number,
  collapseLeadMs: number,
  exitLeadMs: number,
  reduceMotion: boolean,
): InstrumentalMotion {
  const exitStart = Math.max(
    GAP_ENTRY_SCALE_MS,
    duration - collapseLeadMs - exitLeadMs,
  );
  const end = Math.min(duration, exitStart + exitLeadMs);
  const layerFrames = reduceMotion
    ? [
        { offset: 0, opacity: 0 },
        { offset: GAP_ENTRY_FADE_MS / end, opacity: 1 },
        { offset: exitStart / end, opacity: 1 },
        { offset: 1, opacity: 0 },
      ]
    : createBreathFrames(exitStart, end);
  const animations = [
    layer.animate(layerFrames, { duration: end, fill: 'both' }),
    ...dots.map((dot, index) =>
      dot.animate([{ opacity: 0.25 }, { opacity: 1 }], {
        duration: exitStart / dots.length,
        delay: (index * exitStart) / dots.length,
        fill: 'both',
      }),
    ),
  ];
  return { animations, exitStart, end };
}

export interface MotionMetrics {
  rise: number;
  lift: number;
  fontSize: number;
}

type MotionFrame = {
  offset: number;
  transform: string;
};

// Remove redundant samples without changing timing or the spring parameters.
// Each coordinate stays within 0.005px of the original piecewise-linear curve.
function simplifyMotionSamples<T extends { offset: number }>(
  samples: T[],
  coordinates: (sample: T) => number[],
): T[] {
  const values = samples.map(coordinates);
  const retained = new Set([0, samples.length - 1]);
  const visit = (first: number, last: number): void => {
    let largestError = 0.005;
    let split = -1;
    for (let index = first + 1; index < last; index += 1) {
      const progress =
        (samples[index].offset - samples[first].offset) /
        (samples[last].offset - samples[first].offset);
      for (let axis = 0; axis < values[index].length; axis += 1) {
        const interpolated =
          values[first][axis] +
          (values[last][axis] - values[first][axis]) * progress;
        const error = Math.abs(values[index][axis] - interpolated);
        if (error > largestError) {
          largestError = error;
          split = index;
        }
      }
    }
    if (split !== -1) {
      retained.add(split);
      visit(first, split);
      visit(split, last);
    }
  };
  visit(0, samples.length - 1);
  return samples.filter((_, index) => retained.has(index));
}

export const NORMAL_WORD_SPRING_DURATION_MS = 2000;

export function sampleSpring(
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

const lineSpringSamples = new Map<
  number,
  Array<{ offset: number; fromPosition: number; fromVelocity: number }>
>();

const lineSpringFrames = new Map<
  string,
  Array<{ offset: number; transform?: string; translate?: string }>
>();

export function createLineSpringFrames(
  position: number,
  velocity: number,
  frequency = 10,
  propertyName: 'transform' | 'translate' = 'transform',
): Array<{ offset: number; transform?: string; translate?: string }> {
  const frameKey = `${position}:${velocity}:${frequency}:${propertyName}`;
  const cachedFrames = lineSpringFrames.get(frameKey);
  if (cachedFrames) return cachedFrames;
  let samples = lineSpringSamples.get(frequency);
  if (!samples) {
    samples = Array.from({ length: 97 }, (_, frame) => {
      const offset = frame / 96;
      const time = 1.2 * offset;
      return {
        offset,
        fromPosition:
          frame === 96 ? 0 : sampleSpring(1, 0, time, frequency).position,
        fromVelocity:
          frame === 96 ? 0 : sampleSpring(0, 1, time, frequency).position,
      };
    });
    lineSpringSamples.set(frequency, samples);
  }
  // A spring is linear in its starting position and velocity. Reuse the
  // two unit curves instead of repeating trigonometry for every moving row.
  const positions = samples.map(({ offset, fromPosition, fromVelocity }) => ({
    offset,
    y: position * fromPosition + velocity * fromVelocity,
  }));
  // Content containers already scale in CSS. Their layout correction must
  // compose with that scale rather than replace it during the spring.
  const frames = simplifyMotionSamples(positions, sample => [sample.y]).map(
    ({ offset, y }) =>
      propertyName === 'translate'
        ? { offset, translate: `0 ${y}px` }
        : { offset, transform: `translate3d(0, ${y}px, 0)` },
  );
  if (lineSpringFrames.size >= 64)
    lineSpringFrames.delete(lineSpringFrames.keys().next().value!);
  lineSpringFrames.set(frameKey, frames);
  return frames;
}

export function getMotionMetrics(element: HTMLElement): MotionMetrics {
  const style = getComputedStyle(element);
  const fontSize = Number.parseFloat(style.fontSize);
  const riseText = style.getPropertyValue('--char-rise-y').trim() || '-3px';
  const liftText = style.getPropertyValue('--am-lyrics-lift').trim() || '1';
  if (/^-?[\d.]+px$/.test(riseText) && /^-?[\d.]+$/.test(liftText)) {
    const lift = Number(liftText);
    return { rise: Number.parseFloat(riseText) * lift, lift, fontSize };
  }
  // Resolve custom lengths/calc() once, outside the native animation frames.
  const probe = document.createElement('span');
  probe.style.cssText =
    'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'transform:translate(calc(1px * var(--am-lyrics-lift)),calc(var(--char-rise-y) * var(--am-lyrics-lift)))';
  element.append(probe);
  const matrix = getComputedStyle(probe)
    .transform.slice(7, -1)
    .split(',')
    .map(Number);
  probe.remove();
  return { rise: matrix[5], lift: matrix[4], fontSize };
}

const normalWordFrames = new Map<number, MotionFrame[]>();

export function getNormalWordFrames(rise: number): MotionFrame[] {
  let frames = normalWordFrames.get(rise);
  if (!frames) {
    // Native whole-word spring: RVA 0x2f4efd, mass 1, stiffness 14, damping 7.
    const samples = Array.from({ length: 65 }, (_, frame) => {
      const progress =
        frame === 64
          ? 1
          : 1 -
            sampleSpring(
              1,
              0,
              ((NORMAL_WORD_SPRING_DURATION_MS / 1000) * frame) / 64,
              Math.sqrt(14),
              3.5,
            ).position;
      return {
        offset: frame / 64,
        y: rise * progress,
      };
    });
    frames = simplifyMotionSamples(samples, sample => [sample.y]).map(
      ({ offset, y }) => ({
        offset,
        transform: `translate3d(0, ${y}px, 0)`,
      }),
    );
    if (normalWordFrames.size >= 32)
      normalWordFrames.delete(normalWordFrames.keys().next().value!);
    normalWordFrames.set(rise, frames);
  }
  return frames;
}

function springProgress(time: number, response: number): number {
  if (time <= 0) return 0;
  // Unit-mass critically damped spring, omega = 2 pi / response.
  // Native constructor: RVA 0x1559b0. Exact step response, no frame integration.
  const phase = (2 * Math.PI * time) / Math.max(0.001, response);
  return 1 - (1 + phase) * Math.exp(-phase);
}

// Repeated durations share sampled curves; bound memory across songs.
const characterFrames = new Map<string, MotionFrame[]>();

export function getCharacterFrames(
  duration: number,
  count: number,
  index: number,
  cjk: boolean,
  metrics: MotionMetrics,
): MotionFrame[] {
  const hold = (2 * duration) / count;
  const response = Math.min(3, duration);
  const emphasis = cjk ? 0 : Math.max(0, Math.min(duration - 1, 1));
  const spanDuration = Math.max(hold + response * 2, cjk ? 3 : 0);
  const frameKey = `${duration}:${count}:${emphasis ? index : 0}:${cjk}:${metrics.rise}:${metrics.lift}:${metrics.fontSize}`;
  let frames = characterFrames.get(frameKey);
  if (!frames) {
    const samples = Array.from({ length: 61 }, (_, frame) => {
      const time = (spanDuration * frame) / 60;
      const finished = frame === 60;
      let rise = cjk
        ? 1 - sampleSpring(1, 0, time, Math.sqrt(14), 3.5).position
        : springProgress(time, response);
      if (finished) rise = 1;
      const envelope = finished
        ? 0
        : springProgress(time, response) *
          (1 - springProgress(time - hold, response));
      const x = (index - (count - 1) / 2) * 0.5 * 0.1 * emphasis * envelope;
      const lift = 2.25 * emphasis * envelope;
      return {
        offset: frame / 60,
        x: x * metrics.fontSize * metrics.lift,
        y: 0.92 * metrics.rise * rise - lift * metrics.lift,
        scale: 1 + 0.1 * emphasis * envelope,
      };
    });
    // Bound scale error in pixels too, allowing for a glyph's full ink height.
    frames = simplifyMotionSamples(samples, sample => [
      sample.x,
      sample.y,
      sample.scale * metrics.fontSize * 2,
    ]).map(({ offset, x, y, scale }) => ({
      offset,
      transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`,
    }));
    if (characterFrames.size >= 64) {
      characterFrames.delete(characterFrames.keys().next().value!);
    }
    characterFrames.set(frameKey, frames);
  }
  return frames;
}

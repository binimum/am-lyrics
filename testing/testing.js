/* eslint no-use-before-define: ["error", { "functions": false }] */
import '../dist/src/am-lyrics.js';

const tracks = [
  {
    title: 'Cold Heart (PNAU Remix)',
    artist: 'Elton John & Dua Lipa',
    isrc: 'GBUM72104705',
    start: 39,
    end: 54,
  },
  {
    title: 'Caramelldansen',
    artist: 'Caramella Girls',
    isrc: 'SERJR0805021',
    start: 24,
    end: 31,
    translation: true,
  },
  {
    title: '大魚',
    artist: '周深',
    isrc: 'CNZ021600012',
    start: 193,
    end: 206,
    romanization: true,
  },
  {
    title: 'יש בי אהבה (ישראל בידור) [feat. Prime Minister Benjamin Netanyahu]',
    artist: 'עדן בן זקן, ישראל בידור',
    isrc: 'IL4432001634',
    start: 85,
    end: 94,
    romanization: true,
    translation: true,
  },
  {
    title: 'Hold Me While You Wait',
    artist: 'Lewis Capaldi',
    isrc: 'DEUM71900680',
    start: 48,
    end: 59,
  },
  {
    title: 'Safe and Sound',
    artist: 'Capital Cities',
    isrc: 'TCABD1246970',
    start: 55,
    end: 66,
  },
  {
    title: 'Finesse (Remix)',
    artist: 'Bruno Mars & Cardi B',
    isrc: 'USAT21705440',
    start: 184,
    end: 203,
  },
  {
    title: 'Rap God',
    artist: 'Eminem',
    isrc: 'USUM71314079',
    start: 262,
    end: 285,
  },
];
const ui = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map(el => [el.id, el]),
);
let selected = 0;
let lyrics;
let observer;
let playing = false;
let anchor = 0;
let stamp = 0;
let hostTimer;
let displayTimer;
let endTimer;
let pendingAlternates = false;

function format(seconds, precise = false) {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const minutes = Math.floor(tenths / 600);
  const remainder = String(Math.floor(tenths / 10) % 60).padStart(2, '0');
  return `${minutes}:${remainder}${precise ? `.${tenths % 10}` : ''}`;
}

function position() {
  return Math.min(
    tracks[selected].end,
    anchor + (playing ? (performance.now() - stamp) / 1000 : 0),
  );
}

function drawPosition() {
  const time = position();
  ui.position.value = format(time, true);
  ui.seek.value = String(time);
}

function stopTimers() {
  clearInterval(hostTimer);
  clearInterval(displayTimer);
  clearTimeout(endTimer);
}

function pause() {
  anchor = position();
  playing = false;
  stopTimers();
  if (lyrics) {
    lyrics.paused = true;
    lyrics.currentTime = anchor * 1000;
  }
  ui.play.textContent = 'Play clip';
  drawPosition();
}

function scheduleTimers() {
  stopTimers();
  hostTimer = setInterval(() => {
    lyrics.currentTime = position() * 1000;
  }, Number(ui.cadence.value));
  displayTimer = setInterval(drawPosition, 100);
  endTimer = setTimeout(
    () => {
      pause();
      if (ui['auto-next'].checked)
        loadTrack((selected + 1) % tracks.length, true);
      else if (ui.loop.checked) {
        seek(tracks[selected].start);
        play();
      }
    },
    (tracks[selected].end - anchor) * 1000,
  );
}

function play() {
  if (ui.play.disabled) return;
  if (position() >= tracks[selected].end) anchor = tracks[selected].start;
  stamp = performance.now();
  lyrics.currentTime = anchor * 1000;
  playing = true;
  lyrics.paused = false;
  scheduleTimers();
  ui.play.textContent = 'Pause';
}

function seek(seconds) {
  stopTimers();
  anchor = Math.max(
    tracks[selected].start,
    Math.min(tracks[selected].end, seconds),
  );
  stamp = performance.now();
  lyrics.currentTime = anchor * 1000;
  drawPosition();
  if (playing) scheduleTimers();
}

function applyAlternates() {
  if (!pendingAlternates) return;
  const romanization = lyrics.shadowRoot?.querySelector(
    '[aria-label="Toggle romanization"]',
  );
  const translation = lyrics.shadowRoot?.querySelector(
    '[aria-label="Toggle translation"]',
  );
  if (!romanization || !translation) return;
  if (
    (romanization.getAttribute('aria-pressed') === 'true') !==
    ui.romanization.checked
  ) {
    romanization.click();
    return;
  }
  if (
    (translation.getAttribute('aria-pressed') === 'true') !==
    ui.translation.checked
  ) {
    translation.click();
    return;
  }
  pendingAlternates = false;
}

async function loadTrack(index, autoplay = false) {
  pause();
  observer?.disconnect();
  selected = index;
  const track = tracks[index];
  anchor = track.start;
  ui['case-number'].textContent =
    `Test ${index + 1} / ${tracks.length} · ${track.isrc}`;
  ui['song-title'].textContent = track.title;
  ui['song-artist'].textContent = track.artist;
  ui['clip-range'].textContent = `${format(track.start)}–${format(track.end)}`;
  ui['clip-end'].textContent = format(track.end);
  ui.seek.min = String(track.start);
  ui.seek.max = String(track.end);
  ui.romanization.checked = !!track.romanization;
  ui.translation.checked = !!track.translation;
  ui.play.disabled = true;
  ui.status.textContent = 'Loading lyrics…';
  ui.tracks
    .querySelectorAll('button')
    .forEach((button, i) =>
      button.setAttribute('aria-current', String(i === index)),
    );
  window.history.replaceState(null, '', `#${index + 1}`);
  lyrics = document.createElement('am-lyrics');
  lyrics.paused = true;
  lyrics.isrc = track.isrc;
  lyrics.songTitle = track.title;
  lyrics.songArtist = track.artist;
  lyrics.autoScroll = true;
  lyrics.interpolate = true;
  lyrics.currentTime = anchor * 1000;
  ui.preview.replaceChildren(lyrics);
  pendingAlternates = true;
  drawPosition();
  const current = lyrics;
  await current.updateComplete;
  if (lyrics !== current) return;
  let started = false;
  const updateStatus = () => {
    if (lyrics !== current) return;
    const root = current.shadowRoot;
    applyAlternates();
    const ready = !!root.querySelector('#lyrics-line-0') && !pendingAlternates;
    ui.play.disabled = !ready;
    if (ready)
      ui.status.textContent =
        'Ready · use the source switch in the preview to compare providers.';
    else if (
      root.querySelector('.skeleton-line') ||
      root.querySelector('#lyrics-line-0')
    )
      ui.status.textContent = 'Loading lyrics and alternates…';
    else
      ui.status.textContent = 'No lyrics found. Reload sources to try again.';
    if (!ready && playing) pause();
    if (ready && autoplay && !started) {
      started = true;
      play();
    }
  };
  observer = new MutationObserver(updateStatus);
  observer.observe(current.shadowRoot, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-pressed'],
  });
  updateStatus();
}

tracks.forEach((track, index) => {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.className = 'track';
  const number = document.createElement('span');
  number.className = 'track-number';
  number.textContent = String(index + 1).padStart(2, '0');
  const description = document.createElement('span');
  const title = document.createElement('span');
  title.className = 'track-title';
  title.textContent = track.title;
  const detail = document.createElement('span');
  detail.className = 'track-details';
  detail.textContent = `${format(track.start)}–${format(track.end)} · ${[track.romanization && 'pronunciations', track.translation && 'translations'].filter(Boolean).join(' + ') || 'original lyrics'}`;
  description.append(title, detail);
  button.append(number, description);
  button.addEventListener('click', () => loadTrack(index));
  item.append(button);
  ui.tracks.append(item);
});

ui.play.addEventListener('click', () => (playing ? pause() : play()));
ui.previous.addEventListener('click', () =>
  loadTrack((selected + tracks.length - 1) % tracks.length, playing),
);
ui.next.addEventListener('click', () =>
  loadTrack((selected + 1) % tracks.length, playing),
);
ui.replay.addEventListener('click', () => {
  seek(tracks[selected].start);
  if (!playing) play();
});
ui.rewind.addEventListener('click', () => seek(position() - 3));
ui.seek.addEventListener('input', () => seek(Number(ui.seek.value)));
ui.reload.addEventListener('click', () => loadTrack(selected));
ui.cadence.addEventListener('change', () => {
  if (playing) {
    anchor = position();
    stamp = performance.now();
    scheduleTimers();
  }
});
function changeAlternates() {
  pause();
  pendingAlternates = true;
  applyAlternates();
}
ui.romanization.addEventListener('change', changeAlternates);
ui.translation.addEventListener('change', changeAlternates);
ui['font-size'].addEventListener('change', () => {
  const value = Math.max(
    24,
    Math.min(120, Number(ui['font-size'].value) || 48),
  );
  ui.preview.style.setProperty('--am-lyrics-wide-font-size', `${value}px`);
  ui.preview.style.setProperty('--am-lyrics-compact-font-size', `${value}px`);
  loadTrack(selected, playing);
});
ui.width.addEventListener('change', () => {
  ui.preview.style.width = ui.width.value;
});
ui.preview.addEventListener('line-click', event =>
  seek(event.detail.timestamp / 1000),
);
window.addEventListener('pagehide', () => {
  pause();
  observer?.disconnect();
});
window.addEventListener('hashchange', () => {
  const index = Number(window.location.hash.slice(1)) - 1;
  if (Number.isInteger(index) && tracks[index] && index !== selected)
    loadTrack(index);
});
const initialIndex = Number(window.location.hash.slice(1)) - 1;
loadTrack(
  Number.isInteger(initialIndex) && tracks[initialIndex] ? initialIndex : 0,
);

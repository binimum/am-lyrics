export interface Syllable {
  text: string;
  part: boolean;
  timestamp: number;
  endtime: number;
  romanizedText?: string;
  lineSynced?: boolean;
}

export interface LyricsLine {
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

export interface LyricsContributor {
  username: string;
  url?: string;
  avatar?: string;
  roles: string[];
}

export interface LyricsSourceResult {
  originalTTML?: string;
  lines: LyricsLine[];
  source: string;
  songwriters?: string;
  byModel?: boolean;
  isrc?: string;
  metadata?: {
    title: string;
    artist: string;
    album?: string;
    durationMs?: number;
  };
  contributors?: LyricsContributor[];
  confidence?: string;
  matchScore?: number;
  matchedBy?: string;
}

// These providers express every timestamp in seconds, including whole numbers.
export function secondsToMs(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value * 1000))
    : fallback;
}

function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function spicyContributors(attribution: any): LyricsContributor[] {
  if (!attribution || typeof attribution !== 'object') return [];
  const people = new Map<string, LyricsContributor>();
  Object.entries(attribution).forEach(([role, value]) => {
    const entries = Array.isArray(value) ? value : [value];
    entries.forEach(person => {
      if (typeof person?.username !== 'string' || !person.username.trim())
        return;
      const url = webUrl(person.url);
      const key = person.id || url || person.username;
      const existing = people.get(key);
      if (existing) {
        if (!existing.roles.includes(role)) existing.roles.push(role);
      } else {
        people.set(key, {
          username: person.username,
          url,
          avatar: webUrl(person.avatar),
          roles: [role],
        });
      }
    });
  });
  return [...people.values()];
}

export function parseSpicyLyrics(payload: any): LyricsSourceResult | null {
  const body = payload?.Body;
  if (!body || !['Syllable', 'Line', 'Static'].includes(body.Type)) return null;
  const wordSynced = body.Type === 'Syllable';
  const untimed = body.Type === 'Static';
  const content = untimed ? body.Lines : body.Content;
  if (!Array.isArray(content)) return null;

  const syllables = (group: any): Syllable[] => {
    if (!Array.isArray(group?.Syllables)) return [];
    const entries = group.Syllables.filter(
      (s: any) => typeof s?.Text === 'string' && s.Text.length,
    );
    return entries.map((s: any, index: number) => {
      const space = !s.IsPartOfWord && index < entries.length - 1 ? ' ' : '';
      return {
        text: s.Text + space,
        part: Boolean(s.IsPartOfWord),
        timestamp: secondsToMs(s.StartTime, secondsToMs(group.StartTime)),
        endtime: secondsToMs(s.EndTime, secondsToMs(group.EndTime)),
        romanizedText:
          typeof s.TransliteratedText === 'string'
            ? s.TransliteratedText + space
            : undefined,
      };
    });
  };

  const lines: LyricsLine[] = [];
  content.forEach((entry: any) => {
    if (!entry || (!untimed && entry.Type !== 'Vocal')) return;
    const lead = wordSynced ? entry.Lead : entry;
    if (!lead) return;
    let text: Syllable[] = [];
    if (wordSynced) text = syllables(lead);
    else if (typeof lead.Text === 'string' && lead.Text.trim()) {
      text = [
        {
          text: lead.Text,
          part: false,
          timestamp: untimed ? 0 : secondsToMs(lead.StartTime),
          endtime: untimed ? 0 : secondsToMs(lead.EndTime),
          lineSynced: true,
        },
      ];
    }
    if (!text.length) return;
    const backgrounds = Array.isArray(entry.Background)
      ? entry.Background.map(syllables).filter((s: Syllable[]) => s.length)
      : [];
    const backgroundText: Syllable[] = [];
    backgrounds.forEach((group: Syllable[], index: number) => {
      if (index && backgroundText.length) {
        const previous = backgroundText[backgroundText.length - 1];
        previous.text += ' ';
        previous.part = false;
      }
      backgroundText.push(...group);
    });
    const timestamp = untimed
      ? 0
      : secondsToMs(lead.StartTime, Math.min(...text.map(s => s.timestamp)));
    const endtime = untimed
      ? 0
      : secondsToMs(lead.EndTime, Math.max(...text.map(s => s.endtime)));
    lines.push({
      text,
      background: backgroundText.length > 0,
      backgroundText,
      oppositeTurn: Boolean(entry.OppositeAligned),
      alignment: entry.OppositeAligned ? 'end' : 'start',
      timestamp,
      endtime: Math.max(timestamp, endtime),
      isWordSynced: wordSynced,
      romanizedText: lead.TransliteratedText,
      translation: lead.TranslatedText,
    });
  });
  if (!lines.length) return null;
  const catalogues: Record<string, string> = {
    apple_music: ' (Apple Music)',
    spotify: ' (Spotify)',
  };
  const catalogue = catalogues[body.source] || '';
  return {
    lines,
    source: `Spicy Lyrics${catalogue}`,
    songwriters: Array.isArray(body.SongWriters)
      ? body.SongWriters.filter((s: unknown) => typeof s === 'string').join(
          ', ',
        )
      : undefined,
    contributors:
      body.source === 'spicy_lyrics'
        ? spicyContributors(body.UploadAttribution)
        : undefined,
  };
}

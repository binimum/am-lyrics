/**
 * Config for GoogleService
 */
const CONFIG = {
  GOOGLE: {
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,
    FETCH_TIMEOUT_MS: 6000,
  },
};

interface RomanizableLine {
  text?: { text: string; romanizedText?: string }[] | string;
  romanizedText?: string;
  isWordSynced?: boolean;
}

/**
 * Service for translating and romanizing text using Google Translate (unofficial API)
 */
export class GoogleService {
  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  private static fetchWithTimeout(
    url: string,
    timeoutMs = CONFIG.GOOGLE.FETCH_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal }).finally(() =>
      clearTimeout(timeoutId),
    );
  }

  private static isPurelyLatinScript(text: string): boolean {
    // Basic check for Latin script characters plus common punctuation and numbers
    // eslint-disable-next-line no-control-regex
    return /^[\u0000-\u007F\u0080-\u00FF\u0100-\u017F\u0180-\u024F]*$/.test(
      text,
    );
  }

  static async translate(
    textOrArray: string | string[],
    targetLang: string,
  ): Promise<string | string[]> {
    if (
      !textOrArray ||
      (Array.isArray(textOrArray) && textOrArray.length === 0)
    ) {
      return Array.isArray(textOrArray) ? [] : '';
    }

    const isArray = Array.isArray(textOrArray);
    const texts = isArray ? (textOrArray as string[]) : [textOrArray as string];

    // Check for empty strings to preserve indices
    const nonEmptyIndices: number[] = [];
    const textsToTranslate: string[] = [];

    texts.forEach((t, i) => {
      if (t && t.trim()) {
        nonEmptyIndices.push(i);
        textsToTranslate.push(t);
      }
    });

    if (textsToTranslate.length === 0) {
      return isArray ? texts : texts[0];
    }

    // Batching logic: Google Translate URL limit is roughly 2000 chars.
    // We'll be conservative with 1500 chars per batch.
    const BATCH_SIZE_CHARS = 1500;
    const translatedResults: string[] = new Array(textsToTranslate.length).fill(
      '',
    );

    let currentBatch: string[] = [];
    let currentBatchIndices: number[] = [];
    let currentBatchLength = 0;

    const processBatch = async (batch: string[], indices: number[]) => {
      if (batch.length === 0) return;
      const joinedText = batch.join('\n');

      let attempt = 0;
      let success = false;

      while (attempt < CONFIG.GOOGLE.MAX_RETRIES && !success) {
        try {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(joinedText)}`;
          // eslint-disable-next-line no-await-in-loop
          const response = await GoogleService.fetchWithTimeout(url);
          if (!response.ok) throw new Error(`Status ${response.status}`);
          // eslint-disable-next-line no-await-in-loop
          const data = await response.json();

          // data[0] contains segments.
          // With batching/newlines, Google sometimes returns one large segment with newlines,
          // or multiple segments. We need to reconstruct the full text first.

          const fullTranslation =
            data?.[0]?.map((seg: any) => seg?.[0]).join('') || '';

          // Split by newline to get individual lines back
          const lines = fullTranslation.split('\n');

          // Edge case: Google might strip trailing newlines or add extra.
          // If we sent N lines, we expect N lines back approx.
          // However, empty lines in input were filtered out before sending.
          // So 'lines' should match 'batch'.

          // If mismatch, try to align? Or just take what we have.
          // If lines.length < batch.length, we might have lost some.
          // If lines.length > batch.length, maybe some line wrap?

          // We'll trust the split for now but ensure we don't overflow.

          indices.forEach((originalIdx, i) => {
            // Safe access
            if (i < lines.length) {
              translatedResults[originalIdx] = lines[i];
            } else {
              // Fallback if response is shorter
              translatedResults[originalIdx] = batch[i];
            }
          });

          success = true;
        } catch (e) {
          attempt += 1;
          if (attempt < CONFIG.GOOGLE.MAX_RETRIES) {
            // eslint-disable-next-line no-await-in-loop
            await GoogleService.delay(
              CONFIG.GOOGLE.RETRY_DELAY_MS * 2 ** (attempt - 1),
            );
          } else {
            // Fail: fill with original
            indices.forEach((originalIdx, i) => {
              translatedResults[originalIdx] = batch[i];
            });
          }
        }
      }
    };

    for (let i = 0; i < textsToTranslate.length; i += 1) {
      const text = textsToTranslate[i];
      if (currentBatchLength + text.length > BATCH_SIZE_CHARS) {
        // eslint-disable-next-line no-await-in-loop
        await processBatch(currentBatch, currentBatchIndices);
        currentBatch = [];
        currentBatchIndices = [];
        currentBatchLength = 0;
      }
      currentBatch.push(text);
      currentBatchIndices.push(i);
      currentBatchLength += text.length;
    }

    if (currentBatch.length > 0) {
      await processBatch(currentBatch, currentBatchIndices);
    }

    // Reconstruct final array
    const finalArray = [...texts];
    nonEmptyIndices.forEach((realIdx, mappedIdx) => {
      finalArray[realIdx] = translatedResults[mappedIdx];
    });

    return isArray ? finalArray : finalArray[0];
  }

  static async romanize<T extends RomanizableLine>(
    originalLyrics: T[] | { data?: T[]; content?: T[] },
  ): Promise<T[]> {
    // Determine if we should treat as word-synced (has syllabus) or line-synced
    const lines: T[] = Array.isArray(originalLyrics)
      ? originalLyrics
      : (originalLyrics as { data?: T[]; content?: T[] }).data ||
        (originalLyrics as { data?: T[]; content?: T[] }).content ||
        [];

    if (!lines || lines.length === 0)
      return Array.isArray(originalLyrics) ? originalLyrics : [];

    // Check if word synced
    const isWordSynced = lines.some(
      (l: RomanizableLine) =>
        l.isWordSynced !== false && Array.isArray(l.text) && l.text.length > 1,
    );

    if (isWordSynced) {
      return this.romanizeWordSynced(lines);
    }

    return this.romanizeLineSynced(lines);
  }

  static async romanizeWordSynced<T extends RomanizableLine>(
    lines: T[],
  ): Promise<T[]> {
    return Promise.all(
      lines.map(async (line: T) => {
        if (
          !line.text ||
          !Array.isArray(line.text) ||
          line.text.length === 0 ||
          line.romanizedText // Skip if already romanized
        )
          return line;

        // Get the entire line text to romanize together for context-aware pronunciation
        const fullText = line.text
          .map((s: { text: string }) => s.text)
          .join('');

        // romanizeTexts expects an array of strings, so we pass an array of one
        const [romanizedFullLine] = await this.romanizeTexts([fullText]);

        const newSyllabus = line.text.map(
          (s: { text: string; romanizedText?: string }) => ({
            ...s,
            romanizedText: s.romanizedText, // Keep any existing syllabus romanization if provided by API natively
          }),
        );

        return {
          ...line,
          text: newSyllabus,
          romanizedText: romanizedFullLine || '',
        };
      }),
    );
  }

  static async romanizeLineSynced<T extends RomanizableLine>(
    lines: T[],
  ): Promise<T[]> {
    const linesToRomanize = lines.map((line: T) => {
      // If already romanized, skip
      if (line.romanizedText) {
        return '';
      }
      // If it's line-synced, it usually has 1 syllable with the full text.
      if (Array.isArray(line.text) && line.text.length > 0) {
        return line.text.map((s: { text: string }) => s.text).join('');
      }
      return '';
    });

    const romanizedLines = await this.romanizeTexts(linesToRomanize);

    return lines.map((line: T, index: number) => ({
      ...line,
      romanizedText: romanizedLines[index] || '',
    }));
  }

  static async romanizeTexts(texts: string[]): Promise<string[]> {
    const contextText = texts.join(' ');

    if (GoogleService.isPurelyLatinScript(contextText)) {
      return texts;
    }

    const romanizedTexts: string[] = [];

    /* eslint-disable no-await-in-loop */
    for (const text of texts) {
      if (!text || GoogleService.isPurelyLatinScript(text)) {
        romanizedTexts.push(text);
      } else {
        let attempt = 0;
        let success = false;
        let lastError = null;

        while (attempt < CONFIG.GOOGLE.MAX_RETRIES && !success) {
          try {
            const romanizeUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=rm&q=${encodeURIComponent(
              text,
            )}`;
            const response = await GoogleService.fetchWithTimeout(romanizeUrl);
            const data = await response.json();

            // Response format is [[["...","...","...","romanization"]],...]
            // or [null, ...] for English/Latin input where no romanization is needed
            const romanized = data?.[0]?.[0]?.[3] || text;

            romanizedTexts.push(romanized);
            success = true;
          } catch (error) {
            lastError = error;
            // eslint-disable-next-line no-console
            console.warn(
              `GoogleService: Error romanizing text "${text}" (attempt ${
                attempt + 1
              }/${CONFIG.GOOGLE.MAX_RETRIES}):`,
              error,
            );
            attempt += 1;
            if (attempt < CONFIG.GOOGLE.MAX_RETRIES) {
              await GoogleService.delay(
                CONFIG.GOOGLE.RETRY_DELAY_MS * 2 ** (attempt - 1),
              ); // Exponential backoff
            }
          }
        }

        if (!success) {
          // eslint-disable-next-line no-console
          console.error(
            `GoogleService: Failed to romanize text "${text}" after ${CONFIG.GOOGLE.MAX_RETRIES} attempts. Last error:`,
            lastError,
          );
          romanizedTexts.push(text); // Fallback to original text
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    return romanizedTexts;
  }
}

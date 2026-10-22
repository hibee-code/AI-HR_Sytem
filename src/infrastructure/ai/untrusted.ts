/**
 * Handling for text we didn't write (résumés, uploaded policies) before it
 * goes into a prompt. Defence in depth, not a guarantee: the model is told
 * fenced text is data, results stay advisory, and suspicious text is flagged
 * for a human.
 */

/** Phrases typical of instruction-injection attempts. */
const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?)/i,
  /\byou are now\b/i,
  /\b(system|developer) (prompt|message|instructions?)\b/i,
  /\b(new|updated|override) instructions?\b/i,
  /\b(give|assign|award|rate|score)\b[^.\n]{0,50}\b(100|10\/10|full marks|maximum|highest|top)\b/i,
  /<\/?\s*(system|instructions?|assistant|resume|excerpt)\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

/**
 * Wraps text in `<tag>…</tag>` and neutralises any `<tag` / `</tag` inside it,
 * so the content can't close the fence and pose as instructions.
 */
export function fence(
  tag: string,
  text: string,
  attrs: Record<string, string | number> = {},
): string {
  const safe = text.replace(new RegExp(`<(/?\\s*${tag})`, 'gi'), '‹$1');
  const attr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, "'")}"`)
    .join('');
  return `<${tag}${attr}>\n${safe}\n</${tag}>`;
}

/**
 * Removes contact details and the given names before text leaves for an AI
 * provider: e-mails, links (incl. bare domain/path), phone numbers (9–15 digits, so date ranges like
 * "2019 - 2023" survive) and each name as a whole word.
 */
export function redactPii(text: string, names: string[] = []): string {
  let out = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b(https?:\/\/|www\.)\S+/gi, '[link]')
    // bare profile URLs: linkedin.com/in/…, github.com/…
    .replace(/\b[\w-]+(\.[\w-]+)+\/\S+/g, '[link]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => {
      const digits = m.replace(/\D/g, '').length;
      return digits >= 9 && digits <= 15 ? '[phone]' : m;
    });
  for (const name of names.map((n) => n.trim()).filter((n) => n.length > 1)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '[candidate]');
  }
  return out;
}

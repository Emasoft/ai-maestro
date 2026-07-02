/**
 * Map of common Cyrillic confusable characters to their Latin equivalents.
 * Attackers use these to bypass regex-based injection detection.
 */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  '\u0430': 'a', // а → a
  '\u0435': 'e', // е → e
  '\u043E': 'o', // о → o
  '\u0440': 'p', // р → p
  '\u0441': 'c', // с → c
  '\u0443': 'y', // у → y
  '\u0445': 'x', // х → x
  '\u0456': 'i', // і → i
  '\u0410': 'A', // А → A
  '\u0415': 'E', // Е → E
  '\u041E': 'O', // О → O
  '\u0420': 'P', // Р → P
  '\u0421': 'C', // С → C
  '\u0423': 'Y', // У → Y
  '\u0425': 'X', // Х → X
  '\u0406': 'I', // І → I
}

/**
 * Zero-width and invisible Unicode characters that can be inserted between
 * letters to break pattern matching without visually changing the text.
 */
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u2060\u2061\u2062\u2063\u2064]/g

/**
 * Normalize text to defeat Unicode confusable bypasses before running
 * injection-detection regexes. The steps are:
 *   1. Strip zero-width / invisible characters
 *   2. Convert full-width ASCII (U+FF01–U+FF5E) to normal ASCII
 *   3. Replace common Cyrillic homoglyphs with Latin equivalents
 *   4. Apply Unicode NFC normalization
 */
function normalizeText(input: string): string {
  // 1. Strip zero-width characters
  let result = input.replace(ZERO_WIDTH_RE, '')

  // 2. Convert full-width ASCII (U+FF01–U+FF5E) to normal ASCII (U+0021–U+007E)
  result = result.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0),
  )

  // 3. Replace Cyrillic confusables with Latin equivalents
  result = result.replace(/[\u0410\u0415\u041E\u0420\u0421\u0423\u0425\u0406\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0456]/g, (ch) =>
    CYRILLIC_TO_LATIN[ch] ?? ch,
  )

  // 4. Unicode NFC normalization (collapses combining sequences)
  result = result.normalize('NFC')

  return result
}

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /ignore\s+(all\s+)?prior\s+instructions?/i,
  /disregard\s+(all\s+)?previous/i,
  /forget\s+(everything|all)\s+(you|we)\s+(know|said|discussed)/i,
  /<<\s*SYSTEM\s*>>/i,
  /<\|endoftext\|>/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /```\s*system\s*\n/i,
  /ADMIN\s+OVERRIDE/i,
  /DEVELOPER\s+MODE\s+ENABLED/i,
  /ACT\s+AS\s+(IF|THOUGH)\s+YOU\s+(ARE|WERE)\s+/i,
  /DO\s+NOT\s+FOLLOW\s+(YOUR|THE)\s+(PREVIOUS|ORIGINAL)\s+INSTRUCTIONS/i,
  /DAN\s+MODE\s+ENABLED/i,
]

export function containsInjection(text: string): boolean {
  const normalized = normalizeText(text)
  return INJECTION_PATTERNS.some(p => p.test(normalized))
}

const SANITIZE_PATTERNS = INJECTION_PATTERNS.map(p => new RegExp(p.source, 'gi'))

export function sanitizeOutput(text: string): string {
  let result = normalizeText(text)
  for (const pattern of SANITIZE_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, '[FILTERED]')
  }
  return result
}

export function validateApiInput(
  fields: Record<string, unknown>,
  fieldNames: string[],
): string | null {
  for (const name of fieldNames) {
    const val = fields[name]
    if (typeof val === 'string' && containsInjection(val)) {
      return `Field "${name}" contains a suspicious pattern`
    }
  }
  return null
}

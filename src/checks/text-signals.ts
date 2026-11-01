/**
 * Risk signals in an event's own texts (brief §4.1 `scanTextForRiskSignals`).
 * Regular expressions over Spanish (and some English) wording: cheap,
 * deterministic and explainable. Each pattern is narrow on purpose: a false
 * `rule` finding would let a request resolve on its own.
 */
export type TextSignalKind =
  | "off_platform_payment"
  | "external_ticketing_link"
  | "abusive_terms"
  | "minors_alcohol"
  | "prompt_injection";

export interface TextSignal {
  kind: TextSignalKind;
  field: string;
  /** Masked: digits hidden, cut short. Organizer text, so never trusted. */
  match: string;
}

export interface ScannedText {
  field: string;
  text: string;
}

const IBAN = /\bES\d{2}(?:[ -]?\d{4}){5}\b/i;
// JavaScript's `\b` only knows ASCII letters: after an accented vowel
// (`devolverá`) it never matches, so those spots use a lookahead instead.

const PATTERNS: Record<TextSignalKind, readonly RegExp[]> = {
  off_platform_payment: [
    /\bbizum\b/i,
    IBAN,
    /\btransferencia(?: bancaria)?\b/i,
    /\bpaypal\b/i,
    /\b(?:paga|pago|pagar|reserva|reservar)\b[^.\n]{0,40}\b(?:whatsapp|efectivo)\b/i,
  ],
  external_ticketing_link: [
    /\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|is\.gd|ow\.ly|shorturl\.at)\/\S+/i,
    /\b(?:ticketmaster|eventbrite|entradas\.com|ticketea|dice\.fm|fever(?:up)?|wegow)\.[a-z]{2,}\S*/i,
  ],
  abusive_terms: [
    /\bno se (?:devolver[áa]|reembolsar[áa]|reintegrar[áa])(?=\s)[^.\n]{0,60}\b(?:aunque|incluso si|ni (?:en caso de|si)|tampoco si)\b[^.\n]{0,30}\bcancel/i,
    /\bsin (?:derecho a )?(?:devoluci[oó]n|reembolso)\b[^.\n]{0,40}\b(?:aunque|incluso si|ni (?:en caso de|si))\b[^.\n]{0,30}\bcancel/i,
  ],
  minors_alcohol: [],
  prompt_injection: [
    /\b(?:ignora|olvida|ignore|disregard|forget)\b[^.\n]{0,40}\b(?:instrucciones|instructions|reglas|rules|prompt)\b/i,
    /\b(?:aprueba|approve)\b[^.\n]{0,20}\b(?:este evento|this event|sin revisar|without review)\b/i,
    /\b(?:system prompt|eres un modelo|you are an ai)\b/i,
  ],
};

const ALCOHOL =
  /\b(?:botell[oó]n|alcohol|barra libre|chupitos?|cervezas?|copas|cubatas?)\b/i;
// `+14`, `menores`, `desde los 16`…; `+18` and up are adults.
const MINORS =
  /(?:\+\s?1[0-7]\b|\bmenores\b|\b(?:desde|a partir de)(?: los)? 1[0-7]\b|\bmayores de 1[0-7]\b)/i;

export function scanTexts(texts: readonly ScannedText[]): TextSignal[] {
  const signals: TextSignal[] = [];
  for (const { field, text } of texts) {
    for (const [kind, patterns] of Object.entries(PATTERNS) as [
      TextSignalKind,
      readonly RegExp[],
    ][]) {
      for (const pattern of patterns) {
        const found = pattern.exec(text);
        if (found) {
          signals.push({ kind, field, match: mask(found[0]) });
          break;
        }
      }
    }
    const alcohol = ALCOHOL.exec(text);
    const minors = MINORS.exec(text);
    if (alcohol && minors) {
      signals.push({
        kind: "minors_alcohol",
        field,
        match: mask(`${alcohol[0]} … ${minors[0]}`),
      });
    }
  }
  return signals;
}

/**
 * Hides long digit runs (phones, IBANs) past their first two digits, and cuts
 * long matches. Short numbers such as `+14` stay readable.
 */
function mask(value: string): string {
  const masked = value.replace(
    /\d(?:[ -]?\d){5,}/g,
    (run) => run.slice(0, 2) + run.slice(2).replace(/\d/g, "•"),
  );
  return masked.length > 40 ? `${masked.slice(0, 39)}…` : masked;
}

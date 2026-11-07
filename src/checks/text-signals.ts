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
    // A bare "transferencia" is also a ticket handed to someone else (#57):
    // only a bank transfer, or one asked for, is a payment.
    /\btransferencia bancaria\b/i,
    /\b(?:haz|hacer|realiza|realizar|mediante|por|v[ií]a)\s+(?:una\s+)?transferencia\b/i,
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

/**
 * "No aceptamos Bizum" warns against the very thing the payment rule looks
 * for. A negation shortly before the match turns the signal off: a false
 * hard signal would let a rejection resolve on its own.
 */
const NEGATED_BEFORE = /\b(?:no|nunca|jam[aá]s|ni)\b[^.\n]{0,30}$/i;
/**
 * So does one right after it, in the same clause ("Bizum no disponible",
 * "PayPal ya no se acepta"): at most two words in between, none of them a
 * conjunction or a clause break. "Paga por Bizum y no pagues gastos" is a
 * request followed by a second clause, and still fires.
 */
const NEGATED_AFTER =
  /^\s*(?:(?!(?:y|e|o|u|pero|sino)(?!\p{L}))[^\s.!?;,]+\s+){0,2}(?:no|nunca|jam[aá]s)(?!\p{L})/iu;
const NEGATABLE: ReadonlySet<TextSignalKind> = new Set([
  "off_platform_payment",
]);

const ALCOHOL =
  /\b(?:botell[oó]n|alcohol|barra libre|chupitos?|cervezas?|copas|cubatas?)\b/i;
// `+14`, `menores`, `desde los 16`…; `+18` and up are adults.
const MINORS =
  /(?:\+\s?1[0-7]\b|\bmenores\b|\b(?:desde|a partir de)(?: los)? 1[0-7]\b|\bmayores de 1[0-7]\b)/i;

// The legal notice most nightlife listings carry says the opposite of an
// offer: "Prohibida la venta de alcohol a menores" (#57).
const PROHIBITION =
  /\b(?:prohibid[ao]s?|no se (?:vende|venden|sirve|sirven|servir[áa]n?|despacha)|no (?:vendemos|servimos)|venta de alcohol a menores)(?!\p{L})/iu;

/**
 * Alcohol and minors in one clause, not inside a prohibition. Across clauses
 * the two are usually about different things ("Entrada con cerveza. Menores
 * acompañados"; "zona infantil para menores, y cerveza para adultos").
 * Returns the matched words, or null.
 */
function alcoholOfferedToMinors(text: string): string | null {
  for (const clause of clauses(text)) {
    const alcohol = ALCOHOL.exec(clause);
    const minors = MINORS.exec(clause);
    if (alcohol && minors && !PROHIBITION.test(clause)) {
      return `${alcohol[0]} … ${minors[0]}`;
    }
  }
  return null;
}

/**
 * Sentences cut at semicolons and commas. A colon doesn't end a clause: what
 * follows it is what its head offers, list commas included ("para +14:
 * música, cervezas y barra libre" is one offer to the +14).
 */
function clauses(text: string): string[] {
  return text.split(/[.!?;\n]+/).flatMap((part) => {
    const colon = part.indexOf(":");
    const head = colon === -1 ? part : part.slice(0, colon);
    const segments = head.split(",");
    if (colon !== -1)
      segments.push(`${segments.pop() ?? ""}${part.slice(colon)}`);
    return segments;
  });
}

export function scanTexts(texts: readonly ScannedText[]): TextSignal[] {
  const signals: TextSignal[] = [];
  for (const { field, text } of texts) {
    for (const [kind, patterns] of Object.entries(PATTERNS) as [
      TextSignalKind,
      readonly RegExp[],
    ][]) {
      const found = firstSignal(kind, patterns, text);
      if (found !== null) signals.push({ kind, field, match: mask(found) });
    }
    const offer = alcoholOfferedToMinors(text);
    if (offer !== null) {
      signals.push({ kind: "minors_alcohol", field, match: mask(offer) });
    }
  }
  return signals;
}

/**
 * Every occurrence counts, not just the first: a text that warns "Bizum no
 * disponible en taquilla" and then asks for Bizum still asks for it.
 */
function firstSignal(
  kind: TextSignalKind,
  patterns: readonly RegExp[],
  text: string,
): string | null {
  for (const pattern of patterns) {
    for (const found of text.matchAll(
      new RegExp(pattern.source, `${pattern.flags}g`),
    )) {
      if (!NEGATABLE.has(kind) || !negated(text, found)) return found[0];
    }
  }
  return null;
}

function negated(text: string, found: RegExpExecArray): boolean {
  const end = found.index + found[0].length;
  const before = text.slice(Math.max(0, found.index - 45), found.index);
  const after = text.slice(end, end + 45);
  return NEGATED_BEFORE.test(before) || NEGATED_AFTER.test(after);
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

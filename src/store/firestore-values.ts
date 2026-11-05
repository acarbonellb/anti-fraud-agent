/**
 * Plain JSON values to and from Firestore's REST `Value` encoding
 * (https://firebase.google.com/docs/firestore/reference/rest/v1/Value).
 * Integers travel as decimal strings (`integerValue`), so a cost in micros
 * stays an integer; an `undefined` field is left out, as JSON does. What is
 * decoded is untyped: the store validates it with Zod afterwards.
 */
export type FirestoreValue = Record<string, unknown>;
export type FirestoreFields = Record<string, FirestoreValue>;

export function encodeValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isSafeInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return value.length === 0
      ? { arrayValue: {} }
      : { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: { fields: encodeFields(value as Record<string, unknown>) },
    };
  }
  throw new TypeError(`cannot store a ${typeof value}`);
}

export function encodeFields(object: Record<string, unknown>): FirestoreFields {
  return Object.fromEntries(
    Object.entries(object)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeValue(value)]),
  );
}

/** Throws a `TypeError` on a value this store never writes. */
export function decodeValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("not a Firestore value");
  }
  const encoded = value as FirestoreValue;
  if ("nullValue" in encoded) return null;
  if (typeof encoded.stringValue === "string") return encoded.stringValue;
  if (typeof encoded.booleanValue === "boolean") return encoded.booleanValue;
  if (typeof encoded.integerValue === "string") {
    const number = Number(encoded.integerValue);
    if (!Number.isSafeInteger(number)) throw new TypeError("unsafe integer");
    return number;
  }
  if (typeof encoded.doubleValue === "number") return encoded.doubleValue;
  if ("arrayValue" in encoded) {
    const values = (encoded.arrayValue as { values?: unknown } | null)?.values;
    return Array.isArray(values) ? values.map(decodeValue) : [];
  }
  if ("mapValue" in encoded) {
    const fields = (encoded.mapValue as { fields?: unknown } | null)?.fields;
    return decodeFields(fields ?? {});
  }
  throw new TypeError("unsupported Firestore value");
}

export function decodeFields(fields: unknown): Record<string, unknown> {
  if (typeof fields !== "object" || fields === null) {
    throw new TypeError("not Firestore fields");
  }
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );
}

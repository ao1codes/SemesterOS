import { createHash } from "node:crypto";

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key,v])=>key!=="revision"&&v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export function stateRevision(state: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(state))).digest("hex");
}
export class StateConflict extends Error {
  constructor() {super("Your semester changed elsewhere. Reload before saving again.");}
}

/** Old releases serialized date-only fields as ISO instants. Preserve their UTC calendar day. */
export function normalizeWireDates(value: unknown): unknown {
  if(Array.isArray(value))return value.map(normalizeWireDates);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,v])=>[
    key,["date","dueDate","semesterStart","semesterEnd"].includes(key)&&typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T/.test(v)?v.slice(0,10):normalizeWireDates(v)
  ]));
  return value;
}

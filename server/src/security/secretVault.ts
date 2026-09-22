import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const PREFIX = "v1";
function key(): Buffer {
  const raw = String(process.env.VERTICE_MASTER_KEY || "").trim();
  if (!raw) throw new Error("VERTICE_MASTER_KEY_REQUIRED");
  const decoded = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES) throw new Error("VERTICE_MASTER_KEY_MUST_BE_256_BIT");
  return decoded;
}
export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}
export function decryptSecret(value: string): string {
  const [version, ivRaw, tagRaw, dataRaw] = String(value).split(".");
  if (version !== PREFIX || !ivRaw || !tagRaw || !dataRaw) throw new Error("INVALID_SECRET_CIPHERTEXT");
  const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
}
export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]").replace(/(access_token|refresh_token|client_secret|authorization|api[_-]?key|token|secret)\s*[:=]\s*["']?[^,"'\s}]+/gi, "$1=[REDACTED]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k,v]) => [/token|secret|password|authorization|api[_-]?key/i.test(k) ? k : k, /token|secret|password|authorization|api[_-]?key/i.test(k) ? "[REDACTED]" : redact(v)]));
  return value;
}

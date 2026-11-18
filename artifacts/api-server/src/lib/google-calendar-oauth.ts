import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const KEY_SALT = Buffer.from("semesteros-google-calendar-token-v1");
const KEY_INFO = Buffer.from("google-calendar-oauth-token-encryption");

export function deriveCalendarEncryptionKey(secret: string) {
  if (!secret.trim()) throw new Error("The application encryption secret is not configured.");
  return Buffer.from(hkdfSync("sha256", secret, KEY_SALT, KEY_INFO, 32));
}

export function encryptCalendarSecret(value: string, key: Buffer) {
  if (key.length !== 32) throw new Error("Calendar token encryption requires a 32-byte key.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptCalendarSecret(encrypted: string, key: Buffer) {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = encrypted.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext || extra) {
    throw new Error("Stored calendar token has an unsupported format.");
  }
  if (key.length !== 32) throw new Error("Calendar token encryption requires a 32-byte key.");
  for (const encoded of [encodedIv,encodedTag,encodedCiphertext]) {
    if(!/^[A-Za-z0-9_-]+$/.test(encoded)||Buffer.from(encoded,"base64url").toString("base64url")!==encoded) {
      throw new Error("Stored calendar token has noncanonical encoding.");
    }
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export function createPkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createOAuthNonce() {
  return randomBytes(32).toString("base64url");
}

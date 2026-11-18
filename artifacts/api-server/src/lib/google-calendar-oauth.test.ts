import assert from "node:assert/strict";
import test from "node:test";
import {
  createOAuthNonce,
  createPkceChallenge,
  decryptCalendarSecret,
  deriveCalendarEncryptionKey,
  encryptCalendarSecret,
  hashOAuthState,
} from "./google-calendar-oauth.ts";

test("OAuth state is unguessable and stored as a one-way hash", () => {
  const state = createOAuthNonce();
  assert.ok(state.length >= 40);
  assert.equal(hashOAuthState(state), hashOAuthState(state));
  assert.notEqual(hashOAuthState(state), state);
  assert.notEqual(hashOAuthState(state), hashOAuthState(createOAuthNonce()));
});

test("PKCE challenge is derived consistently from its verifier", () => {
  assert.equal(createPkceChallenge("verifier"), createPkceChallenge("verifier"));
  assert.notEqual(createPkceChallenge("verifier"), "verifier");
});

test("calendar credentials encrypt and decrypt with authenticated encryption", () => {
  const key = deriveCalendarEncryptionKey("stable application secret");
  const encrypted = encryptCalendarSecret("refresh-token-value", key);
  assert.notEqual(encrypted, "refresh-token-value");
  assert.equal(decryptCalendarSecret(encrypted, key), "refresh-token-value");
  assert.notEqual(key.toString("hex"), deriveCalendarEncryptionKey("different secret").toString("hex"));
});

test("tampered encrypted calendar credentials fail closed", () => {
  const encrypted = encryptCalendarSecret("access-token-value", Buffer.alloc(32, 7));
  const pieces = encrypted.split(".");
  pieces[3] = `${pieces[3][0]==="A"?"B":"A"}${pieces[3].slice(1)}`;
  assert.throws(() => decryptCalendarSecret(pieces.join("."), Buffer.alloc(32, 7)));
});

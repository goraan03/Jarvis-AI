import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

function loadKey(masterKeyBase64: string): Buffer {
  const key = Buffer.from(masterKeyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_MASTER_KEY must decode to exactly 32 bytes (openssl rand -base64 32).");
  }
  return key;
}

/**
 * AES-256-GCM encryption for credentials at rest — docs/security-model.md
 * §4. One static env key for v1; production deployments should move to
 * envelope encryption with a managed KMS (documented, not built yet).
 */
export function encryptCredential(plaintext: string, masterKeyBase64: string): EncryptedPayload {
  const key = loadKey(masterKeyBase64);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decryptCredential(payload: EncryptedPayload, masterKeyBase64: string): string {
  const key = loadKey(masterKeyBase64);
  const decipher = createDecipheriv(ALGORITHM, key, payload.iv);
  decipher.setAuthTag(payload.authTag);
  const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

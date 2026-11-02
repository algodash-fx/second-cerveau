import { pbkdf2Sync, randomBytes, createCipheriv } from "node:crypto";

// Doit rester identique aux valeurs de docs/app.js
const SALT = "second-cerveau-v1";
const ITERATIONS = 250000;

export function encrypt(payload, password) {
  const key = pbkdf2Sync(password, SALT, ITERATIONS, 32, "sha256");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const data = Buffer.concat([body, cipher.getAuthTag()]);
  return { iv: iv.toString("base64"), data: data.toString("base64") };
}

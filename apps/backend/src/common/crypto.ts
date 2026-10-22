import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for small secrets at rest (bank account numbers). Stored as "v1:<iv>:<tag>:<data>" in
// base64, so the format can change later without breaking old rows.

export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(stored: string, key: Buffer): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1') throw new Error('unknown encryption format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

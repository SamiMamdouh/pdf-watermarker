import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const format = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/;

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 1024) {
    throw new Error('Use a password of at least 12 characters and at most 1,024 bytes.');
  }
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export function validateHash(hash) {
  if (!format.test(hash || '')) throw new Error('APP_PASSWORD_HASH is not a valid Ism scrypt hash. Run npm run setup.');
  return hash;
}

export async function verifyPassword(password, encodedHash) {
  const match = format.exec(encodedHash);
  if (!match || typeof password !== 'string' || Buffer.byteLength(password) > 1024) return false;
  const actual = await scrypt(password, match[1], 64);
  return timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}

export function sameUsername(actual, expected) {
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

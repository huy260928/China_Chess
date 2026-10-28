// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - PASSWORD CRYPTOGRAPHY UTILITY
// Uses native bcrypt when C++ N-API bindings are compiled, with automatic
// fallback to Node.js native crypto.scrypt + timingSafeEqual on environments
// where native bindings were skipped.
// ============================================================================

import crypto from 'crypto';

interface BcryptModule {
  hash(data: string, saltOrRounds: string | number): Promise<string>;
  compare(data: string, encrypted: string): Promise<boolean>;
}

let nativeBcrypt: BcryptModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nativeBcrypt = require('bcrypt') as BcryptModule;
} catch {
  nativeBcrypt = null;
}

const SCRYPT_PREFIX = '$scrypt$';
const KEY_LENGTH = 64;

export async function hashPassword(
  password: string,
  saltRounds: number = 12
): Promise<string> {
  if (nativeBcrypt) {
    return nativeBcrypt.hash(password, saltRounds);
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${SCRYPT_PREFIX}${saltRounds}$${salt}$${derivedKey}`;
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  if (passwordHash.startsWith(SCRYPT_PREFIX)) {
    const parts = passwordHash.slice(SCRYPT_PREFIX.length).split('$');
    if (parts.length !== 3) return false;
    const [, salt, storedKeyHex] = parts;
    const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH);
    const storedKey = Buffer.from(storedKeyHex, 'hex');
    if (derivedKey.length !== storedKey.length) return false;
    return crypto.timingSafeEqual(derivedKey, storedKey);
  }

  if (nativeBcrypt) {
    return nativeBcrypt.compare(password, passwordHash);
  }

  return false;
}

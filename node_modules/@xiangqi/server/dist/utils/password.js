"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - PASSWORD CRYPTOGRAPHY UTILITY
// Uses native bcrypt when C++ N-API bindings are compiled, with automatic
// fallback to Node.js native crypto.scrypt + timingSafeEqual on environments
// where native bindings were skipped.
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
const crypto_1 = __importDefault(require("crypto"));
let nativeBcrypt = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nativeBcrypt = require('bcrypt');
}
catch {
    nativeBcrypt = null;
}
const SCRYPT_PREFIX = '$scrypt$';
const KEY_LENGTH = 64;
async function hashPassword(password, saltRounds = 12) {
    if (nativeBcrypt) {
        return nativeBcrypt.hash(password, saltRounds);
    }
    const salt = crypto_1.default.randomBytes(16).toString('hex');
    const derivedKey = crypto_1.default.scryptSync(password, salt, KEY_LENGTH).toString('hex');
    return `${SCRYPT_PREFIX}${saltRounds}$${salt}$${derivedKey}`;
}
async function verifyPassword(password, passwordHash) {
    if (passwordHash.startsWith(SCRYPT_PREFIX)) {
        const parts = passwordHash.slice(SCRYPT_PREFIX.length).split('$');
        if (parts.length !== 3)
            return false;
        const [, salt, storedKeyHex] = parts;
        const derivedKey = crypto_1.default.scryptSync(password, salt, KEY_LENGTH);
        const storedKey = Buffer.from(storedKeyHex, 'hex');
        if (derivedKey.length !== storedKey.length)
            return false;
        return crypto_1.default.timingSafeEqual(derivedKey, storedKey);
    }
    if (nativeBcrypt) {
        return nativeBcrypt.compare(password, passwordHash);
    }
    return false;
}
//# sourceMappingURL=password.js.map
import { Response } from 'express';
export declare const REFRESH_COOKIE_NAME = "xiangqi_rt";
export interface JwtAccessPayload {
    userId: string;
    username: string;
    eloRating: number;
}
/**
 * Signs a short-lived JWT Access Token (default 15 minutes).
 */
export declare function signAccessToken(payload: JwtAccessPayload): string;
/**
 * Verifies a JWT Access Token and returns the decoded payload.
 */
export declare function verifyAccessToken(token: string): JwtAccessPayload;
/**
 * Generates a cryptographically strong opaque Refresh Token and its SHA-256 hash
 * for database storage.
 */
export declare function generateRefreshTokenPair(): {
    rawToken: string;
    tokenHash: string;
    expiresAt: Date;
};
/**
 * Hashes a raw Refresh Token using SHA-256 + secret pepper before storing/looking up in DB.
 */
export declare function hashRefreshToken(rawToken: string): string;
/**
 * Attaches the Refresh Token as a secure HttpOnly cookie on the Express Response.
 */
export declare function setRefreshTokenCookie(res: Response, rawToken: string, expiresAt: Date): void;
/**
 * Clears the HttpOnly Refresh Token cookie.
 */
export declare function clearRefreshTokenCookie(res: Response): void;
//# sourceMappingURL=jwt.d.ts.map
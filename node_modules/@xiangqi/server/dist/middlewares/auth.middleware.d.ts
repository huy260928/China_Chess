import { NextFunction, Request, Response } from 'express';
import { JwtAccessPayload } from '../utils/jwt';
declare global {
    namespace Express {
        interface Request {
            user?: JwtAccessPayload;
        }
    }
}
/**
 * Express middleware that requires a valid Bearer JWT Access Token in the Authorization header.
 */
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.middleware.d.ts.map
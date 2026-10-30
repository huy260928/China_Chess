import { Socket } from 'socket.io';
export declare class SocketSecurityGuard {
    private buckets;
    /**
     * Attaches a per-socket packet rate limiter and coordinate payload validator.
     */
    attachToSocket(socket: Socket): void;
}
export declare const socketSecurityGuard: SocketSecurityGuard;
//# sourceMappingURL=socket-security.middleware.d.ts.map
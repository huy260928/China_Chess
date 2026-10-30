import { RoomStateDto } from '@xiangqi/shared';
declare class RedisStateManager {
    private client;
    private isConnected;
    private memoryFallback;
    constructor();
    private initClient;
    connect(): Promise<void>;
    saveRoomState(roomId: string, state: RoomStateDto): Promise<void>;
    getRoomState(roomId: string): Promise<RoomStateDto | null>;
    deleteRoomState(roomId: string): Promise<void>;
    bindUserToRoom(userId: string, roomId: string): Promise<void>;
    getUserActiveRoomId(userId: string): Promise<string | null>;
    unbindUserFromRoom(userId: string): Promise<void>;
    disconnect(): Promise<void>;
}
export declare const redisStore: RedisStateManager;
export {};
//# sourceMappingURL=redis.d.ts.map
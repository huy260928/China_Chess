"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - REDIS STATE & SESSION STORE
// Stores Active Room State, Server Clock Snapshots, Matchmaking Queue, and
// 60-Second Reconnection Sessions in Redis.
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisStore = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("./env");
const ROOM_KEY_PREFIX = 'xiangqi:room:';
const USER_ROOM_KEY_PREFIX = 'xiangqi:user_room:';
const ROOM_TTL_SECONDS = 6 * 60 * 60; // 6 hours TTL in Redis
class RedisStateManager {
    client = null;
    isConnected = false;
    memoryFallback = new Map();
    constructor() {
        this.initClient();
    }
    initClient() {
        try {
            this.client = new ioredis_1.default(env_1.ENV.REDIS_URL, {
                maxRetriesPerRequest: 3,
                enableReadyCheck: true,
                lazyConnect: true,
                retryStrategy: (times) => {
                    if (times > 5) {
                        return null;
                    }
                    return Math.min(times * 250, 2000);
                },
            });
            this.client.on('connect', () => {
                this.isConnected = true;
                console.log('[Redis] Connected to Redis State Store.');
            });
            this.client.on('error', (err) => {
                if (this.isConnected) {
                    console.warn('[Redis] Connection error, using memory mirror:', err.message);
                }
                this.isConnected = false;
            });
        }
        catch (err) {
            console.warn('[Redis] Failed to initialize ioredis client, using memory mirror:', err);
            this.isConnected = false;
        }
    }
    async connect() {
        if (!this.client)
            return;
        try {
            await this.client.connect();
            this.isConnected = true;
        }
        catch {
            console.warn('[Redis] Could not connect to external Redis daemon; operating with synchronized in-memory store.');
            this.isConnected = false;
        }
    }
    async saveRoomState(roomId, state) {
        const key = `${ROOM_KEY_PREFIX}${roomId}`;
        const serialized = JSON.stringify(state);
        this.memoryFallback.set(key, serialized);
        if (this.client && this.isConnected) {
            try {
                await this.client.set(key, serialized, 'EX', ROOM_TTL_SECONDS);
            }
            catch (err) {
                console.warn('[Redis saveRoomState warning]:', err);
            }
        }
    }
    async getRoomState(roomId) {
        const key = `${ROOM_KEY_PREFIX}${roomId}`;
        if (this.client && this.isConnected) {
            try {
                const raw = await this.client.get(key);
                if (raw) {
                    return JSON.parse(raw);
                }
            }
            catch (err) {
                console.warn('[Redis getRoomState warning]:', err);
            }
        }
        const fallbackRaw = this.memoryFallback.get(key);
        return fallbackRaw ? JSON.parse(fallbackRaw) : null;
    }
    async deleteRoomState(roomId) {
        const key = `${ROOM_KEY_PREFIX}${roomId}`;
        this.memoryFallback.delete(key);
        if (this.client && this.isConnected) {
            try {
                await this.client.del(key);
            }
            catch (err) {
                console.warn('[Redis deleteRoomState warning]:', err);
            }
        }
    }
    async bindUserToRoom(userId, roomId) {
        const key = `${USER_ROOM_KEY_PREFIX}${userId}`;
        this.memoryFallback.set(key, roomId);
        if (this.client && this.isConnected) {
            try {
                await this.client.set(key, roomId, 'EX', ROOM_TTL_SECONDS);
            }
            catch (err) {
                console.warn('[Redis bindUserToRoom warning]:', err);
            }
        }
    }
    async getUserActiveRoomId(userId) {
        const key = `${USER_ROOM_KEY_PREFIX}${userId}`;
        if (this.client && this.isConnected) {
            try {
                const roomId = await this.client.get(key);
                if (roomId)
                    return roomId;
            }
            catch (err) {
                console.warn('[Redis getUserActiveRoomId warning]:', err);
            }
        }
        return this.memoryFallback.get(key) ?? null;
    }
    async unbindUserFromRoom(userId) {
        const key = `${USER_ROOM_KEY_PREFIX}${userId}`;
        this.memoryFallback.delete(key);
        if (this.client && this.isConnected) {
            try {
                await this.client.del(key);
            }
            catch (err) {
                console.warn('[Redis unbindUserFromRoom warning]:', err);
            }
        }
    }
    async disconnect() {
        if (this.client && this.isConnected) {
            await this.client.quit().catch(() => undefined);
            this.isConnected = false;
        }
    }
}
exports.redisStore = new RedisStateManager();
//# sourceMappingURL=redis.js.map
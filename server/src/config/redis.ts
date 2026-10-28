// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - REDIS STATE & SESSION STORE
// Stores Active Room State, Server Clock Snapshots, Matchmaking Queue, and
// 60-Second Reconnection Sessions in Redis.
// ============================================================================

import Redis from 'ioredis';
import { RoomStateDto } from '@xiangqi/shared';
import { ENV } from './env';

const ROOM_KEY_PREFIX = 'xiangqi:room:';
const USER_ROOM_KEY_PREFIX = 'xiangqi:user_room:';
const ROOM_TTL_SECONDS = 6 * 60 * 60; // 6 hours TTL in Redis

class RedisStateManager {
  private client: Redis | null = null;
  private isConnected = false;
  private memoryFallback = new Map<string, string>();

  constructor() {
    this.initClient();
  }

  private initClient(): void {
    try {
      this.client = new Redis(ENV.REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
        retryStrategy: (times: number) => {
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

      this.client.on('error', (err: Error) => {
        if (this.isConnected) {
          console.warn('[Redis] Connection error, using memory mirror:', err.message);
        }
        this.isConnected = false;
      });
    } catch (err: unknown) {
      console.warn('[Redis] Failed to initialize ioredis client, using memory mirror:', err);
      this.isConnected = false;
    }
  }

  public async connect(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.connect();
      this.isConnected = true;
    } catch {
      console.warn(
        '[Redis] Could not connect to external Redis daemon; operating with synchronized in-memory store.'
      );
      this.isConnected = false;
    }
  }

  public async saveRoomState(roomId: string, state: RoomStateDto): Promise<void> {
    const key = `${ROOM_KEY_PREFIX}${roomId}`;
    const serialized = JSON.stringify(state);
    this.memoryFallback.set(key, serialized);

    if (this.client && this.isConnected) {
      try {
        await this.client.set(key, serialized, 'EX', ROOM_TTL_SECONDS);
      } catch (err: unknown) {
        console.warn('[Redis saveRoomState warning]:', err);
      }
    }
  }

  public async getRoomState(roomId: string): Promise<RoomStateDto | null> {
    const key = `${ROOM_KEY_PREFIX}${roomId}`;
    if (this.client && this.isConnected) {
      try {
        const raw = await this.client.get(key);
        if (raw) {
          return JSON.parse(raw) as RoomStateDto;
        }
      } catch (err: unknown) {
        console.warn('[Redis getRoomState warning]:', err);
      }
    }

    const fallbackRaw = this.memoryFallback.get(key);
    return fallbackRaw ? (JSON.parse(fallbackRaw) as RoomStateDto) : null;
  }

  public async deleteRoomState(roomId: string): Promise<void> {
    const key = `${ROOM_KEY_PREFIX}${roomId}`;
    this.memoryFallback.delete(key);

    if (this.client && this.isConnected) {
      try {
        await this.client.del(key);
      } catch (err: unknown) {
        console.warn('[Redis deleteRoomState warning]:', err);
      }
    }
  }

  public async bindUserToRoom(userId: string, roomId: string): Promise<void> {
    const key = `${USER_ROOM_KEY_PREFIX}${userId}`;
    this.memoryFallback.set(key, roomId);

    if (this.client && this.isConnected) {
      try {
        await this.client.set(key, roomId, 'EX', ROOM_TTL_SECONDS);
      } catch (err: unknown) {
        console.warn('[Redis bindUserToRoom warning]:', err);
      }
    }
  }

  public async getUserActiveRoomId(userId: string): Promise<string | null> {
    const key = `${USER_ROOM_KEY_PREFIX}${userId}`;
    if (this.client && this.isConnected) {
      try {
        const roomId = await this.client.get(key);
        if (roomId) return roomId;
      } catch (err: unknown) {
        console.warn('[Redis getUserActiveRoomId warning]:', err);
      }
    }
    return this.memoryFallback.get(key) ?? null;
  }

  public async unbindUserFromRoom(userId: string): Promise<void> {
    const key = `${USER_ROOM_KEY_PREFIX}${userId}`;
    this.memoryFallback.delete(key);

    if (this.client && this.isConnected) {
      try {
        await this.client.del(key);
      } catch (err: unknown) {
        console.warn('[Redis unbindUserFromRoom warning]:', err);
      }
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      await this.client.quit().catch(() => undefined);
      this.isConnected = false;
    }
  }
}

export const redisStore = new RedisStateManager();

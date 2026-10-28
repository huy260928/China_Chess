// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - DUAL-CHANNEL REAL-TIME CHAT & PROFANITY FILTER
// Supports:
// 1. PLAYER Channel ( exclusively between Red & Black players, with Mute support)
// 2. SPECTATOR Channel (open commentary for Spectators & Players)
// 3. Profanity Filter (Vietnamese + English bad words masked with ***)
// 4. Rate Limiting (Strictly max 3 messages per 5 seconds per user)
// ============================================================================

import { ChatChannel, ChatMessageDto, RoomRole } from '@xiangqi/shared';

const CHAT_RATE_LIMIT_MAX = 3;
const CHAT_RATE_LIMIT_WINDOW_MS = 5000;
const MAX_CHAT_MESSAGE_LENGTH = 300;

const PROFANITY_WORDS: readonly string[] = [
  'dm',
  'dkm',
  'dcm',
  'vcl',
  'vl',
  'cc',
  'cl',
  'dit',
  'du ma',
  'duma',
  'me may',
  'ngu',
  'oc cho',
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'cunt',
];

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PROFANITY_REGEXES: RegExp[] = PROFANITY_WORDS.map(
  (word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi')
);

export class DualChannelChatManager {
  private userMessageTimestamps = new Map<string, number[]>();

  /**
   * Enforces the rate limit: maximum 3 messages within any 5-second sliding window.
   */
  public checkRateLimit(userId: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const history = this.userMessageTimestamps.get(userId) ?? [];

    // Filter timestamps within the last 5000ms
    const recent = history.filter((ts) => now - ts < CHAT_RATE_LIMIT_WINDOW_MS);

    if (recent.length >= CHAT_RATE_LIMIT_MAX) {
      const oldestRecent = recent[0];
      const retryAfterMs = Math.max(100, CHAT_RATE_LIMIT_WINDOW_MS - (now - oldestRecent));
      this.userMessageTimestamps.set(userId, recent);
      return { allowed: false, retryAfterMs };
    }

    recent.push(now);
    this.userMessageTimestamps.set(userId, recent);
    return { allowed: true };
  }

  /**
   * Sanitizes and filters profanity from chat content.
   */
  public sanitizeContent(rawContent: string): string {
    let cleaned = rawContent.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
    for (const regex of PROFANITY_REGEXES) {
      cleaned = cleaned.replace(regex, '***');
    }
    return cleaned;
  }

  /**
   * Validates channel permissions and constructs a ChatMessageDto.
   * Spectators are strictly forbidden from posting in the PLAYER channel.
   */
  public buildChatMessage(params: {
    roomId: string;
    channel: ChatChannel;
    senderId: string;
    senderUsername: string;
    senderAvatarUrl: string;
    senderRole: RoomRole;
    rawContent: string;
  }): { error?: string; message?: ChatMessageDto } {
    if (!params.rawContent || !params.rawContent.trim()) {
      return { error: 'Nội dung tin nhắn không được để trống.' };
    }

    if (params.channel === 'PLAYER' && params.senderRole === 'SPECTATOR') {
      return {
        error: 'Khán giả chỉ được phép trò chuyện tại Kênh Khán giả (Spectator Chat).',
      };
    }

    const rateCheck = this.checkRateLimit(params.senderId);
    if (!rateCheck.allowed) {
      const waitSec = Math.ceil((rateCheck.retryAfterMs ?? 1000) / 1000);
      return {
        error: `Bạn gửi tin nhắn quá nhanh (tối đa 3 tin/5 giây). Vui lòng chờ ${waitSec}s.`,
      };
    }

    const filteredContent = this.sanitizeContent(params.rawContent);

    const message: ChatMessageDto = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      roomId: params.roomId,
      channel: params.channel,
      senderId: params.senderId,
      senderUsername: params.senderUsername,
      senderAvatarUrl: params.senderAvatarUrl,
      senderRole: params.senderRole,
      content: filteredContent,
      timestamp: Date.now(),
    };

    return { message };
  }
}

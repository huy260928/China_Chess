import { ChatChannel, ChatMessageDto, RoomRole } from '@xiangqi/shared';
export declare class DualChannelChatManager {
    private userMessageTimestamps;
    /**
     * Enforces the rate limit: maximum 3 messages within any 5-second sliding window.
     */
    checkRateLimit(userId: string): {
        allowed: boolean;
        retryAfterMs?: number;
    };
    /**
     * Sanitizes and filters profanity from chat content.
     */
    sanitizeContent(rawContent: string): string;
    /**
     * Validates channel permissions and constructs a ChatMessageDto.
     * Spectators are strictly forbidden from posting in the PLAYER channel.
     */
    buildChatMessage(params: {
        roomId: string;
        channel: ChatChannel;
        senderId: string;
        senderUsername: string;
        senderAvatarUrl: string;
        senderRole: RoomRole;
        rawContent: string;
    }): {
        error?: string;
        message?: ChatMessageDto;
    };
}
//# sourceMappingURL=chat-manager.d.ts.map
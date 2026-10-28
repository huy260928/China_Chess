// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - SERVER SYSTEMS & AI WORKER INTEGRATION TESTS
// Tests:
// 1. AI Search Engine (Level 1 Easy, Level 2 Medium Tactical Capture, Level 3 Hard Book & Mate)
// 2. Node.js Worker Thread Pool (AiWorkerPool real worker_threads execution)
// 3. Server-Authoritative Clock & 300ms RTT Lag Compensation (ServerClockManager)
// 4. Dual-Channel Chat, Spectator Isolation, Profanity Filter & Rate Limiter
// 5. JWT Access Token & Refresh Token HMAC-SHA256 Security
// ============================================================================

import { describe, expect, it } from 'vitest';
import { INITIAL_XIANGQI_FEN, XiangqiEngine } from '@xiangqi/shared';
import { XiangqiAiSearchEngine } from '../workers/ai-search';
import { AiWorkerPool } from '../workers/ai-pool';
import { ServerClockManager } from '../socket/clock-manager';
import { DualChannelChatManager } from '../socket/chat-manager';
import {
  generateRefreshTokenPair,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../utils/jwt';

describe('Server Systems - AI Engine, Worker Threads, Authoritative Clock, Chat & JWT', () => {
  it('1. AI Level 1 (EASY): Minimax depth=2 computes a legal move with Material Balance', () => {
    const ai = new XiangqiAiSearchEngine();
    const engine = new XiangqiEngine(INITIAL_XIANGQI_FEN);

    const res = ai.computeBestMove({
      requestId: 'test-easy-1',
      fen: INITIAL_XIANGQI_FEN,
      difficulty: 'EASY',
    });

    expect(res.bestMove).not.toBeNull();
    expect(res.depthReached).toBe(2);
    expect(res.nodesEvaluated).toBeGreaterThan(40);
    expect(engine.isValidMove(res.bestMove!)).toBe(true);
  });

  it('2. AI Level 2 (MEDIUM): Alpha-Beta depth=4 + PST captures an undefended enemy Chariot', () => {
    const ai = new XiangqiAiSearchEngine();
    // Red Chariot at (5,4) can immediately capture undefended Black Chariot at (2,4)
    const tacticalFen = '3k5/9/4r4/9/9/4R4/9/9/9/4K4 w - - 0 1';
    const engine = new XiangqiEngine(tacticalFen);

    const res = ai.computeBestMove({
      requestId: 'test-medium-capture',
      fen: tacticalFen,
      difficulty: 'MEDIUM',
      maxTimeMs: 1500,
    });

    expect(res.bestMove).not.toBeNull();
    expect(engine.isValidMove(res.bestMove!)).toBe(true);
    expect(res.bestMove!.from).toEqual({ row: 5, col: 4 });
    expect(res.bestMove!.to).toEqual({ row: 2, col: 4 });
  });

  it('3. AI Level 3 (HARD): Uses Master Opening Book on initial position and finds Forced Checkmate in middle-game', () => {
    const ai = new XiangqiAiSearchEngine();

    // 3a. Opening Book Hit on Initial FEN
    const bookRes = ai.computeBestMove({
      requestId: 'test-hard-book',
      fen: INITIAL_XIANGQI_FEN,
      difficulty: 'HARD',
    });
    expect(bookRes.fromBook).toBe(true);
    expect(bookRes.bestMove).not.toBeNull();

    // 3b. Forced Checkmate in 1 (Trọng Pháo: Red Cannon at (7,5) moves to (7,4) to deliver Double Cannon mate)
    const mateInOneFen = '3aka3/9/4C4/9/9/9/9/5C3/9/3K5 w - - 0 1';
    const mateRes = ai.computeBestMove({
      requestId: 'test-hard-mate',
      fen: mateInOneFen,
      difficulty: 'HARD',
      maxTimeMs: 1200,
    });

    expect(mateRes.bestMove).not.toBeNull();
    expect(mateRes.bestMove).toEqual({
      from: { row: 7, col: 5 },
      to: { row: 7, col: 4 },
    });

    const verifyEngine = new XiangqiEngine(mateInOneFen);
    const executed = verifyEngine.makeMove(mateRes.bestMove!);
    expect(executed.isCheckmate).toBe(true);
  });

  it('4. AI Worker Thread Pool: Executes AI calculations in background Node.js worker_threads', async () => {
    const pool = new AiWorkerPool(1);
    try {
      const response = await pool.requestBestMove({
        fen: INITIAL_XIANGQI_FEN,
        difficulty: 'EASY',
        maxTimeMs: 1000,
      });

      expect(response.bestMove).not.toBeNull();
      const engine = new XiangqiEngine(INITIAL_XIANGQI_FEN);
      expect(engine.isValidMove(response.bestMove!)).toBe(true);
    } finally {
      await pool.shutdown();
    }
  });

  it('5. ServerClockManager: Enforces 300ms max RTT Lag Compensation and switches turn accurately', async () => {
    let timedOutRoom: string | null = null;
    const clockManager = new ServerClockManager(
      (roomId) => {
        timedOutRoom = roomId;
      },
      () => undefined
    );

    clockManager.initClock({
      roomId: 'room-clock-test',
      totalTimeMs: 60000,
      turnTimeMs: 10000,
      activeSide: 'w',
      isPaused: false,
    });

    // Wait 120ms and claim a clientSentTimestamp 500ms ago (should clamp lag comp to 300ms, so 0ms deducted)
    await new Promise((r) => setTimeout(r, 120));
    const result = clockManager.recordMoveAndSwitchTurn(
      'room-clock-test',
      'w',
      'b',
      Date.now() - 500
    );

    expect(result.timedOut).toBe(false);
    expect(result.clock.redTimeLeftMs).toBe(60000);
    expect(result.clock.activeSide).toBe('b');
    expect(timedOutRoom).toBeNull();

    clockManager.removeClock('room-clock-test');
  });

  it('6. DualChannelChatManager: Blocks Spectators from Player Chat, filters profanity, and rate-limits >3 msgs/5s', () => {
    const chatManager = new DualChannelChatManager();

    // 6a. Spectator forbidden from PLAYER channel
    const specAttempt = chatManager.buildChatMessage({
      roomId: 'room-1',
      channel: 'PLAYER',
      senderId: 'spec-user-1',
      senderUsername: 'Viewer1',
      senderAvatarUrl: '',
      senderRole: 'SPECTATOR',
      rawContent: 'Hello players!',
    });
    expect(specAttempt.error).toBeDefined();
    expect(specAttempt.message).toBeUndefined();

    // 6b. Profanity filter masks bad words with ***
    const profaneAttempt = chatManager.buildChatMessage({
      roomId: 'room-1',
      channel: 'PLAYER',
      senderId: 'player-red-1',
      senderUsername: 'RedMaster',
      senderAvatarUrl: '',
      senderRole: 'RED_PLAYER',
      rawContent: 'Nước cờ hay vcl luôn fuck',
    });
    expect(profaneAttempt.error).toBeUndefined();
    expect(profaneAttempt.message?.content).toBe('Nước cờ hay *** luôn ***');

    // 6c. Rate limiting: 3 messages allowed in 5s, 4th message rejected
    chatManager.buildChatMessage({
      roomId: 'room-1',
      channel: 'SPECTATOR',
      senderId: 'player-red-1',
      senderUsername: 'RedMaster',
      senderAvatarUrl: '',
      senderRole: 'RED_PLAYER',
      rawContent: 'Tin nhắn 2',
    });
    chatManager.buildChatMessage({
      roomId: 'room-1',
      channel: 'SPECTATOR',
      senderId: 'player-red-1',
      senderUsername: 'RedMaster',
      senderAvatarUrl: '',
      senderRole: 'RED_PLAYER',
      rawContent: 'Tin nhắn 3',
    });
    const fourthMessage = chatManager.buildChatMessage({
      roomId: 'room-1',
      channel: 'SPECTATOR',
      senderId: 'player-red-1',
      senderUsername: 'RedMaster',
      senderAvatarUrl: '',
      senderRole: 'RED_PLAYER',
      rawContent: 'Tin nhắn 4 spam',
    });
    expect(fourthMessage.error).toContain('3 tin/5 giây');
  });

  it('7. JWT & Refresh Token Utilities: Signs/verifies Access Tokens and hashes Refresh Tokens deterministically', () => {
    const token = signAccessToken({
      userId: '11111111-2222-3333-4444-555555555555',
      username: 'KyVuong',
      eloRating: 1520,
    });

    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe('11111111-2222-3333-4444-555555555555');
    expect(decoded.username).toBe('KyVuong');
    expect(decoded.eloRating).toBe(1520);

    const rtPair = generateRefreshTokenPair();
    expect(rtPair.rawToken.length).toBeGreaterThanOrEqual(64);
    expect(hashRefreshToken(rtPair.rawToken)).toBe(rtPair.tokenHash);
  });
});

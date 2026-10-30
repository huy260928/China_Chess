"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - SERVER SYSTEMS & AI WORKER INTEGRATION TESTS
// Tests:
// 1. AI Search Engine (Level 1 Easy, Level 2 Medium Tactical Capture, Level 3 Hard Book & Mate)
// 2. Node.js Worker Thread Pool (AiWorkerPool real worker_threads execution)
// 3. Server-Authoritative Clock & 300ms RTT Lag Compensation (ServerClockManager)
// 4. Dual-Channel Chat, Spectator Isolation, Profanity Filter & Rate Limiter
// 5. JWT Access Token & Refresh Token HMAC-SHA256 Security
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const shared_1 = require("@xiangqi/shared");
const ai_search_1 = require("../workers/ai-search");
const ai_pool_1 = require("../workers/ai-pool");
const clock_manager_1 = require("../socket/clock-manager");
const chat_manager_1 = require("../socket/chat-manager");
const jwt_1 = require("../utils/jwt");
(0, vitest_1.describe)('Server Systems - AI Engine, Worker Threads, Authoritative Clock, Chat & JWT', () => {
    (0, vitest_1.it)('1. AI Level 1 (EASY): Minimax depth=2 computes a legal move with Material Balance', () => {
        const ai = new ai_search_1.XiangqiAiSearchEngine();
        const engine = new shared_1.XiangqiEngine(shared_1.INITIAL_XIANGQI_FEN);
        const res = ai.computeBestMove({
            requestId: 'test-easy-1',
            fen: shared_1.INITIAL_XIANGQI_FEN,
            difficulty: 'EASY',
        });
        (0, vitest_1.expect)(res.bestMove).not.toBeNull();
        (0, vitest_1.expect)(res.depthReached).toBe(2);
        (0, vitest_1.expect)(res.nodesEvaluated).toBeGreaterThan(40);
        (0, vitest_1.expect)(engine.isValidMove(res.bestMove)).toBe(true);
    });
    (0, vitest_1.it)('2. AI Level 2 (MEDIUM): Alpha-Beta depth=4 + PST captures an undefended enemy Chariot', () => {
        const ai = new ai_search_1.XiangqiAiSearchEngine();
        // Red Chariot at (5,4) can immediately capture undefended Black Chariot at (2,4)
        const tacticalFen = '3k5/9/4r4/9/9/4R4/9/9/9/4K4 w - - 0 1';
        const engine = new shared_1.XiangqiEngine(tacticalFen);
        const res = ai.computeBestMove({
            requestId: 'test-medium-capture',
            fen: tacticalFen,
            difficulty: 'MEDIUM',
            maxTimeMs: 1500,
        });
        (0, vitest_1.expect)(res.bestMove).not.toBeNull();
        (0, vitest_1.expect)(engine.isValidMove(res.bestMove)).toBe(true);
        (0, vitest_1.expect)(res.bestMove.from).toEqual({ row: 5, col: 4 });
        (0, vitest_1.expect)(res.bestMove.to).toEqual({ row: 2, col: 4 });
    });
    (0, vitest_1.it)('3. AI Level 3 (HARD): Uses Master Opening Book on initial position and finds Forced Checkmate in middle-game', () => {
        const ai = new ai_search_1.XiangqiAiSearchEngine();
        // 3a. Opening Book Hit on Initial FEN
        const bookRes = ai.computeBestMove({
            requestId: 'test-hard-book',
            fen: shared_1.INITIAL_XIANGQI_FEN,
            difficulty: 'HARD',
        });
        (0, vitest_1.expect)(bookRes.fromBook).toBe(true);
        (0, vitest_1.expect)(bookRes.bestMove).not.toBeNull();
        // 3b. Forced Checkmate in 1 (Trọng Pháo: Red Cannon at (7,5) moves to (7,4) to deliver Double Cannon mate)
        const mateInOneFen = '3aka3/9/4C4/9/9/9/9/5C3/9/3K5 w - - 0 1';
        const mateRes = ai.computeBestMove({
            requestId: 'test-hard-mate',
            fen: mateInOneFen,
            difficulty: 'HARD',
            maxTimeMs: 1200,
        });
        (0, vitest_1.expect)(mateRes.bestMove).not.toBeNull();
        (0, vitest_1.expect)(mateRes.bestMove).toEqual({
            from: { row: 7, col: 5 },
            to: { row: 7, col: 4 },
        });
        const verifyEngine = new shared_1.XiangqiEngine(mateInOneFen);
        const executed = verifyEngine.makeMove(mateRes.bestMove);
        (0, vitest_1.expect)(executed.isCheckmate).toBe(true);
    });
    (0, vitest_1.it)('4. AI Worker Thread Pool: Executes AI calculations in background Node.js worker_threads', async () => {
        const pool = new ai_pool_1.AiWorkerPool(1);
        try {
            const response = await pool.requestBestMove({
                fen: shared_1.INITIAL_XIANGQI_FEN,
                difficulty: 'EASY',
                maxTimeMs: 1000,
            });
            (0, vitest_1.expect)(response.bestMove).not.toBeNull();
            const engine = new shared_1.XiangqiEngine(shared_1.INITIAL_XIANGQI_FEN);
            (0, vitest_1.expect)(engine.isValidMove(response.bestMove)).toBe(true);
        }
        finally {
            await pool.shutdown();
        }
    });
    (0, vitest_1.it)('5. ServerClockManager: Enforces 300ms max RTT Lag Compensation and switches turn accurately', async () => {
        let timedOutRoom = null;
        const clockManager = new clock_manager_1.ServerClockManager((roomId) => {
            timedOutRoom = roomId;
        }, () => undefined);
        clockManager.initClock({
            roomId: 'room-clock-test',
            totalTimeMs: 60000,
            turnTimeMs: 10000,
            activeSide: 'w',
            isPaused: false,
        });
        // Wait 120ms and claim a clientSentTimestamp 500ms ago (should clamp lag comp to 300ms, so 0ms deducted)
        await new Promise((r) => setTimeout(r, 120));
        const result = clockManager.recordMoveAndSwitchTurn('room-clock-test', 'w', 'b', Date.now() - 500);
        (0, vitest_1.expect)(result.timedOut).toBe(false);
        (0, vitest_1.expect)(result.clock.redTimeLeftMs).toBe(60000);
        (0, vitest_1.expect)(result.clock.activeSide).toBe('b');
        (0, vitest_1.expect)(timedOutRoom).toBeNull();
        clockManager.removeClock('room-clock-test');
    });
    (0, vitest_1.it)('6. DualChannelChatManager: Blocks Spectators from Player Chat, filters profanity, and rate-limits >3 msgs/5s', () => {
        const chatManager = new chat_manager_1.DualChannelChatManager();
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
        (0, vitest_1.expect)(specAttempt.error).toBeDefined();
        (0, vitest_1.expect)(specAttempt.message).toBeUndefined();
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
        (0, vitest_1.expect)(profaneAttempt.error).toBeUndefined();
        (0, vitest_1.expect)(profaneAttempt.message?.content).toBe('Nước cờ hay *** luôn ***');
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
        (0, vitest_1.expect)(fourthMessage.error).toContain('3 tin/5 giây');
    });
    (0, vitest_1.it)('7. JWT & Refresh Token Utilities: Signs/verifies Access Tokens and hashes Refresh Tokens deterministically', () => {
        const token = (0, jwt_1.signAccessToken)({
            userId: '11111111-2222-3333-4444-555555555555',
            username: 'KyVuong',
            eloRating: 1520,
        });
        const decoded = (0, jwt_1.verifyAccessToken)(token);
        (0, vitest_1.expect)(decoded.userId).toBe('11111111-2222-3333-4444-555555555555');
        (0, vitest_1.expect)(decoded.username).toBe('KyVuong');
        (0, vitest_1.expect)(decoded.eloRating).toBe(1520);
        const rtPair = (0, jwt_1.generateRefreshTokenPair)();
        (0, vitest_1.expect)(rtPair.rawToken.length).toBeGreaterThanOrEqual(64);
        (0, vitest_1.expect)((0, jwt_1.hashRefreshToken)(rtPair.rawToken)).toBe(rtPair.tokenHash);
    });
});
//# sourceMappingURL=server-systems.test.js.map
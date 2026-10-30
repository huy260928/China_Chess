"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - ONLINE PVP REAL-TIME SYNCHRONIZATION TESTS
// End-to-end multi-client Socket.IO integration tests verifying:
// 1. Custom Room Online PvP: Immediate `move_made` delivery to BOTH Red & Black
//    clients on every single ply (no 1-move lag) even across `clock_sync` ticks.
// 2. Matchmaking Queue Online PvP: Concurrent `join_matchmaking` -> `match_found`
//    -> `room_state_sync` -> immediate bidirectional `move_made` synchronization.
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const vitest_1 = require("vitest");
const socket_io_client_1 = require("socket.io-client");
const shared_1 = require("@xiangqi/shared");
const database_1 = require("../config/database");
const jwt_1 = require("../utils/jwt");
const password_1 = require("../utils/password");
const socket_manager_1 = require("../socket/socket-manager");
function waitForEvent(socket, eventName, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for socket event "${String(eventName)}" after ${timeoutMs}ms`));
        }, timeoutMs);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        socket.once(eventName, (...args) => {
            clearTimeout(timer);
            resolve((args.length > 1 ? args : args[0]));
        });
    });
}
async function connectAuthenticatedClient(port, token) {
    const client = (0, socket_io_client_1.io)(`http://127.0.0.1:${port}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Socket client connection timed out'));
        }, 4000);
        client.once('connect', () => {
            clearTimeout(timer);
            resolve();
        });
        client.once('connect_error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
    return client;
}
(0, vitest_1.describe)('Online PvP Multi-Client Real-Time Move Synchronization', () => {
    let httpServer;
    let socketServer;
    let port = 0;
    let redToken = '';
    let blackToken = '';
    let mmTokenA = '';
    let mmTokenB = '';
    const createdTestUserIds = [];
    (0, vitest_1.beforeAll)(async () => {
        const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const passHash = await (0, password_1.hashPassword)('TestPass123!', 10);
        const redUser = await database_1.prisma.user.create({
            data: {
                username: `red_pvp_${suffix}`,
                email: `red_pvp_${suffix}@xiangqi.test`,
                passwordHash: passHash,
                eloRating: 1350,
            },
        });
        const blackUser = await database_1.prisma.user.create({
            data: {
                username: `black_pvp_${suffix}`,
                email: `black_pvp_${suffix}@xiangqi.test`,
                passwordHash: passHash,
                eloRating: 1360,
            },
        });
        const mmUserA = await database_1.prisma.user.create({
            data: {
                username: `mma_pvp_${suffix}`,
                email: `mma_pvp_${suffix}@xiangqi.test`,
                passwordHash: passHash,
                eloRating: 1250,
            },
        });
        const mmUserB = await database_1.prisma.user.create({
            data: {
                username: `mmb_pvp_${suffix}`,
                email: `mmb_pvp_${suffix}@xiangqi.test`,
                passwordHash: passHash,
                eloRating: 1265,
            },
        });
        createdTestUserIds.push(redUser.id, blackUser.id, mmUserA.id, mmUserB.id);
        redToken = (0, jwt_1.signAccessToken)({
            userId: redUser.id,
            username: redUser.username,
            eloRating: redUser.eloRating,
        });
        blackToken = (0, jwt_1.signAccessToken)({
            userId: blackUser.id,
            username: blackUser.username,
            eloRating: blackUser.eloRating,
        });
        mmTokenA = (0, jwt_1.signAccessToken)({
            userId: mmUserA.id,
            username: mmUserA.username,
            eloRating: mmUserA.eloRating,
        });
        mmTokenB = (0, jwt_1.signAccessToken)({
            userId: mmUserB.id,
            username: mmUserB.username,
            eloRating: mmUserB.eloRating,
        });
        httpServer = http_1.default.createServer();
        socketServer = new socket_manager_1.XiangqiSocketServer(httpServer);
        await new Promise((resolve) => {
            httpServer.listen(0, '127.0.0.1', () => {
                port = httpServer.address().port;
                resolve();
            });
        });
    });
    (0, vitest_1.afterAll)(async () => {
        await socketServer.shutdown();
        await new Promise((resolve) => {
            httpServer.close(() => resolve());
        });
        // Clean up temporary integration-test matches and users from PostgreSQL
        if (createdTestUserIds.length > 0) {
            await database_1.prisma.match.deleteMany({
                where: {
                    OR: [
                        { redPlayerId: { in: createdTestUserIds } },
                        { blackPlayerId: { in: createdTestUserIds } },
                    ],
                },
            });
            await database_1.prisma.user.deleteMany({
                where: { id: { in: createdTestUserIds } },
            });
        }
    });
    (0, vitest_1.it)('1. Custom Room Online PvP: Delivers every move immediately to BOTH Red & Black clients across clock_sync ticks (0 move lag)', async () => {
        const redClient = await connectAuthenticatedClient(port, redToken);
        const blackClient = await connectAuthenticatedClient(port, blackToken);
        try {
            // Step 1: Red creates an Online PvP room
            const redCreatedSyncPromise = waitForEvent(redClient, 'room_state_sync');
            redClient.emit('create_room', {
                roomName: 'Phòng Kiểm Thử Đồng Bộ Online',
                mode: 'PVP_CASUAL',
                preferredSide: 'w',
            });
            const [createdRoomState, redAssignedRole] = await redCreatedSyncPromise;
            (0, vitest_1.expect)(redAssignedRole).toBe('RED_PLAYER');
            (0, vitest_1.expect)(createdRoomState.status).toBe('WAITING');
            (0, vitest_1.expect)(createdRoomState.fen).toBe(shared_1.INITIAL_XIANGQI_FEN);
            const roomId = createdRoomState.roomId;
            // Step 2: Black joins the room -> both Red and Black receive PLAYING room_state_sync
            const redStartSyncPromise = waitForEvent(redClient, 'room_state_sync');
            const blackStartSyncPromise = waitForEvent(blackClient, 'room_state_sync');
            blackClient.emit('join_room', { roomId });
            const [[redPlayingState, redRole2], [blackPlayingState, blackRole]] = await Promise.all([redStartSyncPromise, blackStartSyncPromise]);
            (0, vitest_1.expect)(redRole2).toBe('RED_PLAYER');
            (0, vitest_1.expect)(blackRole).toBe('BLACK_PLAYER');
            (0, vitest_1.expect)(redPlayingState.status).toBe('PLAYING');
            (0, vitest_1.expect)(blackPlayingState.status).toBe('PLAYING');
            // Track live client states identically to client Zustand store
            let redBoardFen = redPlayingState.fen;
            let blackBoardFen = blackPlayingState.fen;
            let clockSyncCountRed = 0;
            let clockSyncCountBlack = 0;
            redClient.on('clock_sync', () => {
                clockSyncCountRed += 1;
            });
            blackClient.on('clock_sync', () => {
                clockSyncCountBlack += 1;
            });
            // 4-ply real Xiangqi opening exchange:
            // Ply 1 (Red): Pháo 2 bình 5 -> (7,7) to (7,4)
            // Ply 2 (Black): Mã 8 tấn 7 -> (0,7) to (2,6)
            // Ply 3 (Red): Mã 2 tấn 3 -> (9,7) to (7,6)
            // Ply 4 (Black): Xe 9 bình 8 -> (0,8) to (0,7)
            const plannedPlies = [
                {
                    actor: 'RED',
                    socket: redClient,
                    from: { row: 7, col: 7 },
                    to: { row: 7, col: 4 },
                    expectedFenChar: 'C',
                    waitAfterMs: 1150, // Cross a 1000ms clock_sync tick + 1000ms animation window!
                },
                {
                    actor: 'BLACK',
                    socket: blackClient,
                    from: { row: 0, col: 7 },
                    to: { row: 2, col: 6 },
                    expectedFenChar: 'n',
                    waitAfterMs: 250,
                },
                {
                    actor: 'RED',
                    socket: redClient,
                    from: { row: 9, col: 7 },
                    to: { row: 7, col: 6 },
                    expectedFenChar: 'N',
                    waitAfterMs: 1100, // Cross another 1000ms clock_sync tick!
                },
                {
                    actor: 'BLACK',
                    socket: blackClient,
                    from: { row: 0, col: 8 },
                    to: { row: 0, col: 7 },
                    expectedFenChar: 'r',
                    waitAfterMs: 100,
                },
            ];
            const referenceEngine = new shared_1.XiangqiEngine(shared_1.INITIAL_XIANGQI_FEN);
            for (let i = 0; i < plannedPlies.length; i++) {
                const ply = plannedPlies[i];
                referenceEngine.makeMove({ from: ply.from, to: ply.to });
                const expectedFen = referenceEngine.generateFen();
                const expectedTurn = referenceEngine.getTurn();
                // Register listeners on BOTH clients BEFORE emitting make_move
                const redMovePromise = waitForEvent(redClient, 'move_made', 2000);
                const blackMovePromise = waitForEvent(blackClient, 'move_made', 2000);
                ply.socket.emit('make_move', {
                    roomId,
                    from: ply.from,
                    to: ply.to,
                    clientSentTimestamp: Date.now(),
                });
                // Both clients MUST receive `move_made` immediately WITHOUT waiting for the next move!
                const [redMovePayload, blackMovePayload] = await Promise.all([
                    redMovePromise,
                    blackMovePromise,
                ]);
                redBoardFen = redMovePayload.fen;
                blackBoardFen = blackMovePayload.fen;
                (0, vitest_1.expect)(redBoardFen).toBe(expectedFen);
                (0, vitest_1.expect)(blackBoardFen).toBe(expectedFen);
                (0, vitest_1.expect)(redMovePayload.turn).toBe(expectedTurn);
                (0, vitest_1.expect)(blackMovePayload.turn).toBe(expectedTurn);
                (0, vitest_1.expect)(redMovePayload.move.from).toEqual(ply.from);
                (0, vitest_1.expect)(redMovePayload.move.to).toEqual(ply.to);
                (0, vitest_1.expect)(blackMovePayload.move.from).toEqual(ply.from);
                (0, vitest_1.expect)(blackMovePayload.move.to).toEqual(ply.to);
                // Verify the moved piece is immediately present at destination square (to.row, to.col)
                // and cleared from origin square (from.row, from.col) on BOTH clients' boards!
                const redClientEngine = new shared_1.XiangqiEngine(redBoardFen);
                const blackClientEngine = new shared_1.XiangqiEngine(blackBoardFen);
                (0, vitest_1.expect)(redClientEngine.getPieceAt(ply.from)).toBeNull();
                (0, vitest_1.expect)(redClientEngine.getPieceAt(ply.to)?.fenChar).toBe(ply.expectedFenChar);
                (0, vitest_1.expect)(blackClientEngine.getPieceAt(ply.from)).toBeNull();
                (0, vitest_1.expect)(blackClientEngine.getPieceAt(ply.to)?.fenChar).toBe(ply.expectedFenChar);
                if (ply.waitAfterMs > 0) {
                    await new Promise((r) => setTimeout(r, ply.waitAfterMs));
                    // Confirm clock_sync did NOT revert or alter either client's FEN
                    (0, vitest_1.expect)(redBoardFen).toBe(expectedFen);
                    (0, vitest_1.expect)(blackBoardFen).toBe(expectedFen);
                }
            }
            // Confirm live 1000ms clock_sync broadcasts occurred during the match
            (0, vitest_1.expect)(clockSyncCountRed).toBeGreaterThanOrEqual(2);
            (0, vitest_1.expect)(clockSyncCountBlack).toBeGreaterThanOrEqual(2);
        }
        finally {
            redClient.disconnect();
            blackClient.disconnect();
        }
    });
    (0, vitest_1.it)('2. Ranked Matchmaking Online PvP: Matches two queued players and synchronizes opening moves immediately on both clients', async () => {
        const clientA = await connectAuthenticatedClient(port, mmTokenA);
        const clientB = await connectAuthenticatedClient(port, mmTokenB);
        try {
            const syncAPromise = waitForEvent(clientA, 'room_state_sync', 5000);
            const syncBPromise = waitForEvent(clientB, 'room_state_sync', 5000);
            clientA.emit('join_matchmaking', {});
            clientB.emit('join_matchmaking', {});
            const [[stateA, roleA], [stateB, roleB]] = await Promise.all([
                syncAPromise,
                syncBPromise,
            ]);
            (0, vitest_1.expect)(stateA.roomId).toBe(stateB.roomId);
            (0, vitest_1.expect)(stateA.status).toBe('PLAYING');
            (0, vitest_1.expect)(new Set([roleA, roleB])).toEqual(new Set(['RED_PLAYER', 'BLACK_PLAYER']));
            const redSocket = roleA === 'RED_PLAYER' ? clientA : clientB;
            const moveA = waitForEvent(clientA, 'move_made', 2000);
            const moveB = waitForEvent(clientB, 'move_made', 2000);
            // Red plays Binh 7 tấn 1: (6, 2) -> (5, 2)
            redSocket.emit('make_move', {
                roomId: stateA.roomId,
                from: { row: 6, col: 2 },
                to: { row: 5, col: 2 },
                clientSentTimestamp: Date.now(),
            });
            const [resA, resB] = await Promise.all([moveA, moveB]);
            (0, vitest_1.expect)(resA.fen).toBe(resB.fen);
            (0, vitest_1.expect)(resA.move.to).toEqual({ row: 5, col: 2 });
            (0, vitest_1.expect)(new shared_1.XiangqiEngine(resA.fen).getPieceAt({ row: 5, col: 2 })?.fenChar).toBe('P');
            (0, vitest_1.expect)(new shared_1.XiangqiEngine(resB.fen).getPieceAt({ row: 5, col: 2 })?.fenChar).toBe('P');
        }
        finally {
            clientA.disconnect();
            clientB.disconnect();
        }
    });
    (0, vitest_1.it)('3. 1v1 P2P WebRTC Video Call Signaling: Relays SDP/ICE strictly between Red & Black opponents while blocking & isolating Spectators', async () => {
        const redClient = await connectAuthenticatedClient(port, redToken);
        const blackClient = await connectAuthenticatedClient(port, blackToken);
        const spectatorClient = await connectAuthenticatedClient(port, mmTokenA);
        try {
            // Create & join Online PvP room with Red Player, Black Player, and 1 Spectator
            const redCreatedPromise = waitForEvent(redClient, 'room_state_sync');
            redClient.emit('create_room', {
                roomName: 'Phòng Kiểm Thử Video Call P2P',
                mode: 'PVP_CASUAL',
                preferredSide: 'w',
            });
            const [createdRoom] = await redCreatedPromise;
            const roomId = createdRoom.roomId;
            const blackJoinedPromise = waitForEvent(blackClient, 'room_state_sync');
            blackClient.emit('join_room', { roomId });
            await blackJoinedPromise;
            const specJoinedPromise = waitForEvent(spectatorClient, 'room_state_sync');
            spectatorClient.emit('join_room', { roomId, asSpectator: true });
            const [, specRole] = await specJoinedPromise;
            (0, vitest_1.expect)(specRole).toBe('SPECTATOR');
            // Track any leaked WebRTC packet on Spectator socket (MUST remain 0)
            let leakedPacketsToSpectator = 0;
            const countLeak = () => {
                leakedPacketsToSpectator += 1;
            };
            spectatorClient.on('video_call_incoming', countLeak);
            spectatorClient.on('video_call_accepted', countLeak);
            spectatorClient.on('webrtc_offer', countLeak);
            spectatorClient.on('webrtc_answer', countLeak);
            spectatorClient.on('webrtc_ice_candidate', countLeak);
            spectatorClient.on('webrtc_media_state', countLeak);
            // 3a. Spectator attempting to initiate a call MUST be rejected with FORBIDDEN_SPECTATOR
            const specErrPromise = waitForEvent(spectatorClient, 'error_event');
            spectatorClient.emit('video_call_request', { roomId, hasVideo: true });
            const specErr = await specErrPromise;
            (0, vitest_1.expect)(specErr.code).toBe('FORBIDDEN_SPECTATOR');
            // 3b. Red requests Video Call -> Black receives `video_call_incoming`
            const incomingPromise = waitForEvent(blackClient, 'video_call_incoming');
            redClient.emit('video_call_request', { roomId, hasVideo: true });
            const incoming = await incomingPromise;
            (0, vitest_1.expect)(incoming.roomId).toBe(roomId);
            (0, vitest_1.expect)(incoming.fromSide).toBe('w');
            (0, vitest_1.expect)(incoming.hasVideo).toBe(true);
            // 3c. Black accepts -> Red receives `video_call_accepted`
            const acceptedPromise = waitForEvent(redClient, 'video_call_accepted');
            blackClient.emit('video_call_respond', {
                roomId,
                accept: true,
                hasVideo: true,
            });
            const accepted = await acceptedPromise;
            (0, vitest_1.expect)(accepted.bySide).toBe('b');
            (0, vitest_1.expect)(accepted.hasVideo).toBe(true);
            // 3d. Red sends SDP Offer -> Black receives `webrtc_offer`
            const offerPromise = waitForEvent(blackClient, 'webrtc_offer');
            redClient.emit('webrtc_offer', {
                roomId,
                description: { type: 'offer', sdp: 'v=0\r\no=- 1001 2 IN IP4 127.0.0.1\r\n' },
                mediaState: { audioEnabled: true, videoEnabled: true },
            });
            const receivedOffer = await offerPromise;
            (0, vitest_1.expect)(receivedOffer.fromSide).toBe('w');
            (0, vitest_1.expect)(receivedOffer.description.type).toBe('offer');
            // 3e. Black sends SDP Answer -> Red receives `webrtc_answer`
            const answerPromise = waitForEvent(redClient, 'webrtc_answer');
            blackClient.emit('webrtc_answer', {
                roomId,
                description: { type: 'answer', sdp: 'v=0\r\no=- 2002 2 IN IP4 127.0.0.1\r\n' },
                mediaState: { audioEnabled: true, videoEnabled: false },
            });
            const receivedAnswer = await answerPromise;
            (0, vitest_1.expect)(receivedAnswer.fromSide).toBe('b');
            (0, vitest_1.expect)(receivedAnswer.description.type).toBe('answer');
            // 3f. Burst of 30 Trickle ICE candidates (>25 gameplay quota) passes cleanly without rate-limit drop
            const TOTAL_ICE_BURST = 30;
            let receivedIceCount = 0;
            const allIceArrivedPromise = new Promise((resolve) => {
                blackClient.on('webrtc_ice_candidate', () => {
                    receivedIceCount += 1;
                    if (receivedIceCount === TOTAL_ICE_BURST) {
                        resolve();
                    }
                });
            });
            for (let i = 0; i < TOTAL_ICE_BURST; i++) {
                redClient.emit('webrtc_ice_candidate', {
                    roomId,
                    candidate: {
                        candidate: `candidate:${i + 1} 1 udp 2122260223 192.168.1.10 ${50000 + i} typ host`,
                        sdpMid: '0',
                        sdpMLineIndex: 0,
                    },
                });
            }
            await allIceArrivedPromise;
            (0, vitest_1.expect)(receivedIceCount).toBe(TOTAL_ICE_BURST);
            // 3g. Media toggle & Hangup
            const mediaTogglePromise = waitForEvent(redClient, 'webrtc_media_state');
            blackClient.emit('webrtc_media_state', {
                roomId,
                mediaState: { audioEnabled: false, videoEnabled: false },
            });
            const toggled = await mediaTogglePromise;
            (0, vitest_1.expect)(toggled.fromSide).toBe('b');
            (0, vitest_1.expect)(toggled.mediaState).toEqual({ audioEnabled: false, videoEnabled: false });
            const endedPromise = waitForEvent(blackClient, 'video_call_ended');
            redClient.emit('video_call_hangup', { roomId, reason: 'HANGUP' });
            const ended = await endedPromise;
            (0, vitest_1.expect)(ended.bySide).toBe('w');
            (0, vitest_1.expect)(ended.reason).toBe('HANGUP');
            // Confirm 100% network-level Spectator isolation (0 leaked SDP/ICE/Call packets!)
            (0, vitest_1.expect)(leakedPacketsToSpectator).toBe(0);
        }
        finally {
            redClient.disconnect();
            blackClient.disconnect();
            spectatorClient.disconnect();
        }
    });
});
//# sourceMappingURL=pvp-online-sync.test.js.map
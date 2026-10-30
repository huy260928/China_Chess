"use strict";
// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - REAL-TIME WEBSOCKET SERVER & ROOM MANAGER
// Implements:
// - ELO-based Matchmaking Queue
// - Role-based Room Architecture (Red Player, Black Player, Unlimited Spectators)
// - Server-Authoritative Move Validation + 300ms Lag-Compensated Clock
// - Graceful 60-Second Reconnection on Disconnect / Browser Refresh (F5)
// - Dual-Channel Real-Time Chat (Player Channel with Mute + Spectator Channel)
// - PvE Save & Exit + PvP Mutual Adjournment (Save & Resume Match)
// - International Standard ELO Calculation & PostgreSQL Match Persistence
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.XiangqiSocketServer = void 0;
const socket_io_1 = require("socket.io");
const password_1 = require("../utils/password");
const shared_1 = require("@xiangqi/shared");
const env_1 = require("../config/env");
const database_1 = require("../config/database");
const redis_1 = require("../config/redis");
const jwt_1 = require("../utils/jwt");
const clock_manager_1 = require("./clock-manager");
const chat_manager_1 = require("./chat-manager");
const ai_pool_1 = require("../workers/ai-pool");
const socket_security_middleware_1 = require("../middlewares/socket-security.middleware");
const RECONNECT_GRACE_PERIOD_MS = 60000; // 60 seconds wait for F5 / network drop
const DEFAULT_TOTAL_TIME_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_TURN_TIME_MS = 60 * 1000; // 60 seconds per move
class XiangqiSocketServer {
    io;
    activeRooms = new Map();
    matchmakingQueue = new Map(); // key = userId
    clockManager;
    chatManager;
    matchmakingTimer;
    constructor(httpServer) {
        this.io = new socket_io_1.Server(httpServer, {
            cors: {
                origin: env_1.ENV.CLIENT_ORIGIN,
                credentials: true,
            },
            pingInterval: 10000,
            pingTimeout: 8000,
        });
        this.clockManager = new clock_manager_1.ServerClockManager((roomId, timedOutSide, finalClock) => this.handleClockTimeout(roomId, timedOutSide, finalClock), (roomId, clock) => this.io.to(roomId).emit('clock_sync', clock));
        this.chatManager = new chat_manager_1.DualChannelChatManager();
        this.setupAuthMiddleware();
        this.setupConnectionHandlers();
        this.matchmakingTimer = setInterval(() => {
            this.processMatchmakingQueue().catch((err) => console.error('[Matchmaking Loop Error]:', err));
        }, 1500);
    }
    // ==========================================================================
    // 1. JWT SOCKET AUTHENTICATION MIDDLEWARE
    // ==========================================================================
    setupAuthMiddleware() {
        this.io.use(async (socket, next) => {
            try {
                const rawToken = socket.handshake.auth?.token ||
                    socket.handshake.headers.authorization?.replace('Bearer ', '');
                if (!rawToken) {
                    return next(new Error('UNAUTHORIZED: Missing JWT Access Token'));
                }
                const decoded = (0, jwt_1.verifyAccessToken)(rawToken);
                const dbUser = await database_1.prisma.user.findUnique({
                    where: { id: decoded.userId },
                    select: {
                        id: true,
                        username: true,
                        avatarUrl: true,
                        eloRating: true,
                    },
                });
                if (!dbUser) {
                    return next(new Error('UNAUTHORIZED: User not found'));
                }
                socket.data.userId = dbUser.id;
                socket.data.username = dbUser.username;
                socket.data.avatarUrl = dbUser.avatarUrl;
                socket.data.eloRating = dbUser.eloRating;
                return next();
            }
            catch {
                return next(new Error('UNAUTHORIZED: Invalid or expired token'));
            }
        });
    }
    // ==========================================================================
    // 2. CONNECTION, AUTOMATIC 60S RECONNECTION & EVENT HANDLERS
    // ==========================================================================
    setupConnectionHandlers() {
        this.io.on('connection', async (socket) => {
            socket_security_middleware_1.socketSecurityGuard.attachToSocket(socket);
            const { userId, username } = socket.data;
            console.log(`[Socket] Connected: ${username} (${userId}) -> ${socket.id}`);
            // Send current lobby room list on connect
            socket.emit('lobby_rooms_updated', this.getLobbyRoomSummaries());
            // Latency Ping Check
            socket.on('ping_check', (_clientTimestamp, callback) => {
                if (typeof callback === 'function') {
                    callback(Date.now());
                }
            });
            // Lobby & Matchmaking
            socket.on('get_lobby_rooms', () => {
                socket.emit('lobby_rooms_updated', this.getLobbyRoomSummaries());
            });
            socket.on('join_matchmaking', (payload) => {
                this.handleJoinMatchmaking(socket, payload).catch((err) => console.error('[join_matchmaking error]:', err));
            });
            socket.on('leave_matchmaking', () => {
                this.handleLeaveMatchmaking(socket);
            });
            socket.on('create_room', (payload) => {
                this.handleCreateRoom(socket, payload).catch((err) => console.error('[create_room error]:', err));
            });
            socket.on('join_room', (payload) => {
                this.handleJoinRoom(socket, payload).catch((err) => console.error('[join_room error]:', err));
            });
            socket.on('leave_room', (payload) => {
                this.handleLeaveRoom(socket, payload.roomId).catch((err) => console.error('[leave_room error]:', err));
            });
            // Authoritative Gameplay Events (Players Only)
            socket.on('make_move', (payload) => {
                this.handleMakeMove(socket, payload).catch((err) => console.error('[make_move error]:', err));
            });
            socket.on('offer_draw', (payload) => {
                this.handleOfferDraw(socket, payload.roomId);
            });
            socket.on('respond_draw', (payload) => {
                this.handleRespondDraw(socket, payload.roomId, payload.accept).catch((err) => console.error('[respond_draw error]:', err));
            });
            socket.on('resign', (payload) => {
                this.handleResign(socket, payload.roomId).catch((err) => console.error('[resign error]:', err));
            });
            // Save, Undo/Reset (PvE) & Adjournment Events (PvE & PvP)
            socket.on('save_pve_game', (payload) => {
                this.handleSavePveGame(socket, payload.roomId, payload.title).catch((err) => console.error('[save_pve_game error]:', err));
            });
            socket.on('undo_pve_move', (payload) => {
                this.handleUndoPveMove(socket, payload.roomId).catch((err) => console.error('[undo_pve_move error]:', err));
            });
            socket.on('reset_pve_game', (payload) => {
                this.handleResetPveGame(socket, payload.roomId).catch((err) => console.error('[reset_pve_game error]:', err));
            });
            socket.on('request_adjourn', (payload) => {
                this.handleRequestAdjourn(socket, payload.roomId);
            });
            socket.on('respond_adjourn', (payload) => {
                this.handleRespondAdjourn(socket, payload.roomId, payload.accept).catch((err) => console.error('[respond_adjourn error]:', err));
            });
            socket.on('resume_saved_game', (payload) => {
                this.handleResumeSavedGame(socket, payload.savedGameId).catch((err) => console.error('[resume_saved_game error]:', err));
            });
            // Dual-Channel Chat Events
            socket.on('send_chat', (payload) => {
                this.handleSendChat(socket, payload.roomId, payload.channel, payload.content);
            });
            socket.on('toggle_mute_player_chat', (payload) => {
                this.handleToggleMutePlayerChat(socket, payload.roomId, payload.muted);
            });
            // P2P WebRTC Video / Voice Call Signaling Events (Strictly 1v1 Players Only)
            socket.on('video_call_request', (payload) => {
                this.handleVideoCallRequest(socket, payload);
            });
            socket.on('video_call_respond', (payload) => {
                this.handleVideoCallRespond(socket, payload);
            });
            socket.on('webrtc_offer', (payload) => {
                this.handleWebRtcOffer(socket, payload);
            });
            socket.on('webrtc_answer', (payload) => {
                this.handleWebRtcAnswer(socket, payload);
            });
            socket.on('webrtc_ice_candidate', (payload) => {
                this.handleWebRtcIceCandidate(socket, payload);
            });
            socket.on('webrtc_media_state', (payload) => {
                this.handleWebRtcMediaState(socket, payload);
            });
            socket.on('video_call_hangup', (payload) => {
                this.handleVideoCallHangup(socket, payload);
            });
            // Disconnect Handler (Graceful 60-Second Reconnection Window)
            socket.on('disconnect', () => {
                this.handleSocketDisconnect(socket).catch((err) => console.error('[disconnect error]:', err));
            });
            // Check if player has an active room in Redis/Memory for Graceful Reconnection (F5 / Drop)
            // Invoked AFTER all synchronous `socket.on(...)` handlers are registered so no rapid client events are lost.
            await this.tryAutoReconnectPlayer(socket);
        });
    }
    // ==========================================================================
    // 3. GRACEFUL 60-SECOND RECONNECTION (CHỐNG RỚT MẠNG / F5 TRÌNH DUYỆT)
    // ==========================================================================
    async tryAutoReconnectPlayer(socket) {
        const userId = socket.data.userId;
        const activeRoomId = await redis_1.redisStore.getUserActiveRoomId(userId);
        if (!activeRoomId)
            return;
        const room = this.activeRooms.get(activeRoomId);
        if (!room || room.status === 'FINISHED' || room.status === 'ADJOURNED') {
            await redis_1.redisStore.unbindUserFromRoom(userId);
            return;
        }
        let playerSide = null;
        let playerState = null;
        if (room.redPlayer && room.redPlayer.userId === userId) {
            playerSide = 'w';
            playerState = room.redPlayer;
            room.redSocketId = socket.id;
        }
        else if (room.blackPlayer && room.blackPlayer.userId === userId) {
            playerSide = 'b';
            playerState = room.blackPlayer;
            room.blackSocketId = socket.id;
        }
        if (!playerSide || !playerState) {
            return;
        }
        // Clear 60-second forfeit timer if active
        const existingTimer = room.reconnectTimers.get(playerSide);
        if (existingTimer) {
            clearTimeout(existingTimer);
            room.reconnectTimers.delete(playerSide);
        }
        playerState.isConnected = true;
        playerState.disconnectedAt = null;
        playerState.reconnectDeadlineTimestamp = null;
        if (room.status === 'PAUSED_RECONNECT' &&
            room.redPlayer?.isConnected &&
            room.blackPlayer?.isConnected) {
            room.status = 'PLAYING';
            this.clockManager.resumeClock(room.roomId, room.engine.getTurn());
        }
        socket.join(room.roomId);
        const assignedRole = playerSide === 'w' ? 'RED_PLAYER' : 'BLACK_PLAYER';
        const stateDto = this.buildRoomStateDto(room);
        await redis_1.redisStore.saveRoomState(room.roomId, stateDto);
        // Push full authoritative state back to the reconnected client
        socket.emit('room_state_sync', stateDto, assignedRole);
        // Notify room that player reconnected
        this.io.to(room.roomId).emit('player_connection_changed', {
            userId,
            side: playerSide,
            isConnected: true,
            reconnectDeadlineTimestamp: null,
        });
    }
    async handleSocketDisconnect(socket) {
        const { userId } = socket.data;
        // Remove from matchmaking queue if queued
        if (this.matchmakingQueue.has(userId)) {
            this.matchmakingQueue.delete(userId);
        }
        for (const [, room] of this.activeRooms) {
            // Check if socket was a Spectator
            if (room.spectators.has(socket.id)) {
                room.spectators.delete(socket.id);
                const spectatorsList = Array.from(room.spectators.values());
                this.io.to(room.roomId).emit('spectators_updated', {
                    spectatorCount: spectatorsList.length,
                    spectators: spectatorsList,
                });
                this.broadcastLobbyUpdate();
            }
            // Check if socket was Red or Black Player
            let disconnectedSide = null;
            let playerState = null;
            if (room.redSocketId === socket.id && room.redPlayer) {
                disconnectedSide = 'w';
                playerState = room.redPlayer;
                room.redSocketId = null;
            }
            else if (room.blackSocketId === socket.id && room.blackPlayer) {
                disconnectedSide = 'b';
                playerState = room.blackPlayer;
                room.blackSocketId = null;
            }
            if (!disconnectedSide || !playerState)
                continue;
            // If room was only WAITING with 1 player, close it cleanly
            if (room.status === 'WAITING') {
                await redis_1.redisStore.unbindUserFromRoom(userId);
                this.clockManager.removeClock(room.roomId);
                await redis_1.redisStore.deleteRoomState(room.roomId);
                this.activeRooms.delete(room.roomId);
                this.broadcastLobbyUpdate();
                continue;
            }
            if (room.status === 'PLAYING' || room.status === 'PAUSED_RECONNECT') {
                // Terminate any active or ringing P2P Video/Voice Call on socket drop
                if (room.isVideoCallActive || room.videoCallPendingFrom) {
                    room.isVideoCallActive = false;
                    room.videoCallPendingFrom = null;
                    const remainingPeerSocketId = disconnectedSide === 'w' ? room.blackSocketId : room.redSocketId;
                    if (remainingPeerSocketId) {
                        this.io.to(remainingPeerSocketId).emit('video_call_ended', {
                            roomId: room.roomId,
                            bySide: disconnectedSide,
                            reason: 'PEER_DISCONNECTED',
                        });
                    }
                }
                const now = Date.now();
                const deadline = now + RECONNECT_GRACE_PERIOD_MS;
                playerState.isConnected = false;
                playerState.disconnectedAt = now;
                playerState.reconnectDeadlineTimestamp = deadline;
                // Pause clock during PvE disconnect; in PvP keep clock running or pause reconnect status
                if (room.mode === 'PVE_AI') {
                    room.status = 'PAUSED_RECONNECT';
                    this.clockManager.pauseClock(room.roomId);
                }
                const stateDto = this.buildRoomStateDto(room);
                await redis_1.redisStore.saveRoomState(room.roomId, stateDto);
                this.io.to(room.roomId).emit('player_connection_changed', {
                    userId,
                    side: disconnectedSide,
                    isConnected: false,
                    reconnectDeadlineTimestamp: deadline,
                });
                // Start 60-second grace period timer before forfeiting
                const existingTimer = room.reconnectTimers.get(disconnectedSide);
                if (existingTimer)
                    clearTimeout(existingTimer);
                const sideToForfeit = disconnectedSide;
                const timer = setTimeout(() => {
                    this.handleReconnectTimeoutForfeit(room.roomId, sideToForfeit).catch((err) => console.error('[Reconnect Forfeit Error]:', err));
                }, RECONNECT_GRACE_PERIOD_MS);
                room.reconnectTimers.set(disconnectedSide, timer);
            }
        }
    }
    async handleReconnectTimeoutForfeit(roomId, forfeitedSide) {
        const room = this.activeRooms.get(roomId);
        if (!room || (room.status !== 'PLAYING' && room.status !== 'PAUSED_RECONNECT')) {
            return;
        }
        const pState = forfeitedSide === 'w' ? room.redPlayer : room.blackPlayer;
        if (!pState || pState.isConnected) {
            return;
        }
        const winnerSide = forfeitedSide === 'w' ? 'b' : 'w';
        await this.finalizeMatch(room, winnerSide, 'ABANDONED');
    }
    // ==========================================================================
    // 4. ELO-BASED MATCHMAKING QUEUE
    // ==========================================================================
    async handleJoinMatchmaking(socket, payload) {
        const { userId, username, avatarUrl, eloRating } = socket.data;
        const existingRoomId = await redis_1.redisStore.getUserActiveRoomId(userId);
        if (existingRoomId && this.activeRooms.has(existingRoomId)) {
            socket.emit('error_event', {
                code: 'ALREADY_IN_MATCH',
                message: 'Bạn đang có một ván đấu đang diễn ra.',
            });
            return;
        }
        const totalTimeMs = payload?.totalTimeMs ?? DEFAULT_TOTAL_TIME_MS;
        const turnTimeMs = payload?.turnTimeMs ?? DEFAULT_TURN_TIME_MS;
        this.matchmakingQueue.set(userId, {
            userId,
            username,
            avatarUrl,
            eloRating,
            socketId: socket.id,
            joinedAt: Date.now(),
            totalTimeMs,
            turnTimeMs,
        });
        socket.emit('matchmaking_status', {
            searching: true,
            queueSize: this.matchmakingQueue.size,
            estimatedWaitSec: 5,
        });
        await this.processMatchmakingQueue();
    }
    handleLeaveMatchmaking(socket) {
        const { userId } = socket.data;
        this.matchmakingQueue.delete(userId);
        socket.emit('matchmaking_status', {
            searching: false,
            queueSize: this.matchmakingQueue.size,
            estimatedWaitSec: 0,
        });
    }
    async processMatchmakingQueue() {
        if (this.matchmakingQueue.size < 2)
            return;
        const entries = Array.from(this.matchmakingQueue.values()).sort((a, b) => a.eloRating - b.eloRating);
        const matchedUsers = new Set();
        const now = Date.now();
        for (let i = 0; i < entries.length - 1; i++) {
            const p1 = entries[i];
            if (matchedUsers.has(p1.userId))
                continue;
            const p2 = entries[i + 1];
            if (matchedUsers.has(p2.userId))
                continue;
            const waitSec = Math.max((now - p1.joinedAt) / 1000, (now - p2.joinedAt) / 1000);
            const allowedEloSpread = 150 + Math.floor(waitSec * 25);
            const eloDiff = Math.abs(p1.eloRating - p2.eloRating);
            if (eloDiff <= allowedEloSpread) {
                matchedUsers.add(p1.userId);
                matchedUsers.add(p2.userId);
                this.matchmakingQueue.delete(p1.userId);
                this.matchmakingQueue.delete(p2.userId);
                await this.createMatchedPvpRoom(p1, p2);
            }
        }
    }
    async createMatchedPvpRoom(p1, p2) {
        const assignP1Red = Math.random() < 0.5;
        const redItem = assignP1Red ? p1 : p2;
        const blackItem = assignP1Red ? p2 : p1;
        const roomId = `room-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const engine = new shared_1.XiangqiEngine(shared_1.INITIAL_XIANGQI_FEN);
        const dbMatch = await database_1.prisma.match.create({
            data: {
                roomCode: roomId,
                mode: 'PVP_RANKED',
                status: 'IN_PROGRESS',
                redPlayerId: redItem.userId,
                blackPlayerId: blackItem.userId,
                initialFen: shared_1.INITIAL_XIANGQI_FEN,
                finalFen: shared_1.INITIAL_XIANGQI_FEN,
                totalTimeMs: redItem.totalTimeMs,
                turnTimeMs: redItem.turnTimeMs,
                redTimeLeftMs: redItem.totalTimeMs,
                blackTimeLeftMs: redItem.totalTimeMs,
                redEloBefore: redItem.eloRating,
                blackEloBefore: blackItem.eloRating,
            },
        });
        const room = {
            roomId,
            roomName: `Kỳ Đài Xếp Hạng: ${redItem.username} vs ${blackItem.username}`,
            passwordHash: null,
            mode: 'PVP_RANKED',
            status: 'PLAYING',
            dbMatchId: dbMatch.id,
            originSavedGameId: null,
            engine,
            initialFen: shared_1.INITIAL_XIANGQI_FEN,
            redPlayer: {
                userId: redItem.userId,
                username: redItem.username,
                avatarUrl: redItem.avatarUrl,
                eloRating: redItem.eloRating,
                side: 'w',
                isConnected: true,
                disconnectedAt: null,
                reconnectDeadlineTimestamp: null,
                isMutedPlayerChat: false,
            },
            blackPlayer: {
                userId: blackItem.userId,
                username: blackItem.username,
                avatarUrl: blackItem.avatarUrl,
                eloRating: blackItem.eloRating,
                side: 'b',
                isConnected: true,
                disconnectedAt: null,
                reconnectDeadlineTimestamp: null,
                isMutedPlayerChat: false,
            },
            redSocketId: redItem.socketId,
            blackSocketId: blackItem.socketId,
            spectators: new Map(),
            drawOfferFrom: null,
            adjournRequestFrom: null,
            totalTimeMs: redItem.totalTimeMs,
            turnTimeMs: redItem.turnTimeMs,
            eloChanges: null,
            reconnectTimers: new Map(),
        };
        this.clockManager.initClock({
            roomId,
            totalTimeMs: room.totalTimeMs,
            turnTimeMs: room.turnTimeMs,
            activeSide: 'w',
            isPaused: false,
        });
        this.activeRooms.set(roomId, room);
        await redis_1.redisStore.bindUserToRoom(redItem.userId, roomId);
        await redis_1.redisStore.bindUserToRoom(blackItem.userId, roomId);
        const stateDto = this.buildRoomStateDto(room);
        await redis_1.redisStore.saveRoomState(roomId, stateDto);
        const redSocket = this.io.sockets.sockets.get(redItem.socketId);
        const blackSocket = this.io.sockets.sockets.get(blackItem.socketId);
        if (redSocket) {
            redSocket.join(roomId);
            redSocket.emit('match_found', { roomId, role: 'RED_PLAYER' });
            redSocket.emit('room_state_sync', stateDto, 'RED_PLAYER');
        }
        if (blackSocket) {
            blackSocket.join(roomId);
            blackSocket.emit('match_found', { roomId, role: 'BLACK_PLAYER' });
            blackSocket.emit('room_state_sync', stateDto, 'BLACK_PLAYER');
        }
        this.broadcastLobbyUpdate();
    }
    // ==========================================================================
    // 5. ROOM CREATION, JOINING & ROLE-BASED SPECTATOR ISOLATION
    // ==========================================================================
    async handleCreateRoom(socket, payload) {
        if (payload.savedGameId) {
            await this.handleResumeSavedGame(socket, payload.savedGameId);
            return;
        }
        const { userId, username, avatarUrl, eloRating } = socket.data;
        const roomId = `room-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const totalTimeMs = payload.totalTimeMs ?? DEFAULT_TOTAL_TIME_MS;
        const turnTimeMs = payload.turnTimeMs ?? DEFAULT_TURN_TIME_MS;
        const passwordHash = payload.password && payload.password.trim()
            ? await (0, password_1.hashPassword)(payload.password.trim(), 10)
            : null;
        const humanSide = payload.preferredSide === 'b' ? 'b' : 'w';
        const engine = new shared_1.XiangqiEngine(shared_1.INITIAL_XIANGQI_FEN);
        const humanPlayerState = {
            userId,
            username,
            avatarUrl,
            eloRating,
            side: humanSide,
            isConnected: true,
            disconnectedAt: null,
            reconnectDeadlineTimestamp: null,
            isMutedPlayerChat: false,
        };
        let redPlayer = humanSide === 'w' ? humanPlayerState : null;
        let blackPlayer = humanSide === 'b' ? humanPlayerState : null;
        let status = 'WAITING';
        let dbMatchId = null;
        if (payload.mode === 'PVE_AI') {
            const difficulty = payload.aiDifficulty ?? 'MEDIUM';
            const aiSide = humanSide === 'w' ? 'b' : 'w';
            const aiElo = difficulty === 'EASY' ? 1000 : difficulty === 'MEDIUM' ? 1450 : 1900;
            const aiPlayerState = {
                userId: `ai-${difficulty.toLowerCase()}`,
                username: `AI Đại Sư (${difficulty})`,
                avatarUrl: '/avatars/ai-master.png',
                eloRating: aiElo,
                side: aiSide,
                isConnected: true,
                disconnectedAt: null,
                reconnectDeadlineTimestamp: null,
                isMutedPlayerChat: true,
                isAi: true,
                aiDifficulty: difficulty,
            };
            if (aiSide === 'w') {
                redPlayer = aiPlayerState;
            }
            else {
                blackPlayer = aiPlayerState;
            }
            status = 'PLAYING';
            const dbMatch = await database_1.prisma.match.create({
                data: {
                    roomCode: roomId,
                    mode: 'PVE_AI',
                    status: 'IN_PROGRESS',
                    redPlayerId: humanSide === 'w' ? userId : null,
                    blackPlayerId: humanSide === 'b' ? userId : null,
                    aiDifficulty: difficulty,
                    initialFen: shared_1.INITIAL_XIANGQI_FEN,
                    finalFen: shared_1.INITIAL_XIANGQI_FEN,
                    totalTimeMs,
                    turnTimeMs,
                    redTimeLeftMs: totalTimeMs,
                    blackTimeLeftMs: totalTimeMs,
                },
            });
            dbMatchId = dbMatch.id;
        }
        const room = {
            roomId,
            roomName: payload.roomName?.trim() || `Phòng của ${username}`,
            passwordHash,
            mode: payload.mode,
            status,
            dbMatchId,
            originSavedGameId: null,
            engine,
            initialFen: shared_1.INITIAL_XIANGQI_FEN,
            redPlayer,
            blackPlayer,
            redSocketId: humanSide === 'w' ? socket.id : null,
            blackSocketId: humanSide === 'b' ? socket.id : null,
            spectators: new Map(),
            drawOfferFrom: null,
            adjournRequestFrom: null,
            totalTimeMs,
            turnTimeMs,
            eloChanges: null,
            reconnectTimers: new Map(),
        };
        this.clockManager.initClock({
            roomId,
            totalTimeMs,
            turnTimeMs,
            activeSide: status === 'PLAYING' ? 'w' : null,
            isPaused: status !== 'PLAYING',
        });
        this.activeRooms.set(roomId, room);
        await redis_1.redisStore.bindUserToRoom(userId, roomId);
        socket.join(roomId);
        const assignedRole = humanSide === 'w' ? 'RED_PLAYER' : 'BLACK_PLAYER';
        const stateDto = this.buildRoomStateDto(room);
        await redis_1.redisStore.saveRoomState(roomId, stateDto);
        socket.emit('room_state_sync', stateDto, assignedRole);
        this.broadcastLobbyUpdate();
        // If AI plays Red ('w'), trigger AI's opening move immediately
        if (payload.mode === 'PVE_AI' && humanSide === 'b') {
            await this.triggerAiMoveIfNeeded(room);
        }
    }
    async handleJoinRoom(socket, payload) {
        const room = this.activeRooms.get(payload.roomId);
        if (!room) {
            socket.emit('error_event', {
                code: 'ROOM_NOT_FOUND',
                message: 'Phòng đấu không tồn tại hoặc đã kết thúc.',
            });
            return;
        }
        const { userId, username, avatarUrl, eloRating } = socket.data;
        // Check if user is already one of the two players in this room
        if (room.redPlayer?.userId === userId) {
            room.redSocketId = socket.id;
            socket.join(room.roomId);
            socket.emit('room_state_sync', this.buildRoomStateDto(room), 'RED_PLAYER');
            return;
        }
        if (room.blackPlayer?.userId === userId) {
            room.blackSocketId = socket.id;
            socket.join(room.roomId);
            socket.emit('room_state_sync', this.buildRoomStateDto(room), 'BLACK_PLAYER');
            return;
        }
        // Verify password if room is private
        if (room.passwordHash && !payload.asSpectator) {
            const validPass = await (0, password_1.verifyPassword)(payload.password || '', room.passwordHash);
            if (!validPass) {
                socket.emit('error_event', {
                    code: 'INVALID_ROOM_PASSWORD',
                    message: 'Mật khẩu phòng không chính xác.',
                });
                return;
            }
        }
        // Join as Player if a player slot is open and asSpectator is not forced
        if (!payload.asSpectator && room.status === 'WAITING') {
            const joiningSide = !room.redPlayer ? 'w' : 'b';
            const playerState = {
                userId,
                username,
                avatarUrl,
                eloRating,
                side: joiningSide,
                isConnected: true,
                disconnectedAt: null,
                reconnectDeadlineTimestamp: null,
                isMutedPlayerChat: false,
            };
            if (joiningSide === 'w') {
                room.redPlayer = playerState;
                room.redSocketId = socket.id;
            }
            else {
                room.blackPlayer = playerState;
                room.blackSocketId = socket.id;
            }
            room.status = 'PLAYING';
            const dbMatch = await database_1.prisma.match.create({
                data: {
                    roomCode: room.roomId,
                    mode: room.mode,
                    status: 'IN_PROGRESS',
                    redPlayerId: room.redPlayer?.userId ?? null,
                    blackPlayerId: room.blackPlayer?.userId ?? null,
                    initialFen: room.initialFen,
                    finalFen: room.engine.generateFen(),
                    totalTimeMs: room.totalTimeMs,
                    turnTimeMs: room.turnTimeMs,
                    redTimeLeftMs: room.totalTimeMs,
                    blackTimeLeftMs: room.totalTimeMs,
                    redEloBefore: room.redPlayer?.eloRating ?? null,
                    blackEloBefore: room.blackPlayer?.eloRating ?? null,
                },
            });
            room.dbMatchId = dbMatch.id;
            this.clockManager.resumeClock(room.roomId, room.engine.getTurn());
            await redis_1.redisStore.bindUserToRoom(userId, room.roomId);
            socket.join(room.roomId);
            const stateDto = this.buildRoomStateDto(room);
            await redis_1.redisStore.saveRoomState(room.roomId, stateDto);
            // Sync each participant with their exact role
            if (room.redSocketId) {
                this.io
                    .to(room.redSocketId)
                    .emit('room_state_sync', stateDto, 'RED_PLAYER');
            }
            if (room.blackSocketId) {
                this.io
                    .to(room.blackSocketId)
                    .emit('room_state_sync', stateDto, 'BLACK_PLAYER');
            }
            for (const [specSockId] of room.spectators) {
                this.io
                    .to(specSockId)
                    .emit('room_state_sync', stateDto, 'SPECTATOR');
            }
            this.broadcastLobbyUpdate();
            return;
        }
        // Otherwise join as SPECTATOR (Unlimited spectators, strictly read-only board access)
        room.spectators.set(socket.id, {
            userId,
            username,
            avatarUrl,
            joinedAt: Date.now(),
        });
        socket.join(room.roomId);
        const stateDto = this.buildRoomStateDto(room);
        socket.emit('room_state_sync', stateDto, 'SPECTATOR');
        const spectatorsList = Array.from(room.spectators.values());
        this.io.to(room.roomId).emit('spectators_updated', {
            spectatorCount: spectatorsList.length,
            spectators: spectatorsList,
        });
        this.broadcastLobbyUpdate();
    }
    async handleLeaveRoom(socket, roomId) {
        const room = this.activeRooms.get(roomId);
        if (!room)
            return;
        socket.leave(roomId);
        if (room.spectators.has(socket.id)) {
            room.spectators.delete(socket.id);
            const spectatorsList = Array.from(room.spectators.values());
            this.io.to(room.roomId).emit('spectators_updated', {
                spectatorCount: spectatorsList.length,
                spectators: spectatorsList,
            });
            this.broadcastLobbyUpdate();
            return;
        }
        if (room.status === 'WAITING') {
            await redis_1.redisStore.unbindUserFromRoom(socket.data.userId);
            this.clockManager.removeClock(roomId);
            await redis_1.redisStore.deleteRoomState(roomId);
            this.activeRooms.delete(roomId);
            this.broadcastLobbyUpdate();
        }
    }
    // ==========================================================================
    // 6. SERVER-AUTHORITATIVE MOVE VALIDATION & AI WORKER EXECUTION
    // ==========================================================================
    async handleMakeMove(socket, payload) {
        const room = this.activeRooms.get(payload.roomId);
        if (!room) {
            socket.emit('error_event', {
                code: 'ROOM_NOT_FOUND',
                message: 'Không tìm thấy phòng chơi.',
            });
            return;
        }
        if (room.status !== 'PLAYING') {
            socket.emit('error_event', {
                code: 'GAME_NOT_ACTIVE',
                message: 'Ván đấu hiện chưa bắt đầu hoặc đang tạm dừng.',
            });
            return;
        }
        // Strictly block Spectators from making moves
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'SPECTATOR') {
            socket.emit('error_event', {
                code: 'FORBIDDEN_SPECTATOR',
                message: 'Khán giả không có quyền điều khiển bàn cờ.',
            });
            return;
        }
        // Keep moving player's socket binding & room membership synchronized
        if (role === 'RED_PLAYER') {
            room.redSocketId = socket.id;
        }
        else if (role === 'BLACK_PLAYER') {
            room.blackSocketId = socket.id;
        }
        this.ensureParticipantSocketsJoined(room, socket);
        const playerSide = role === 'RED_PLAYER' ? 'w' : 'b';
        if (room.engine.getTurn() !== playerSide) {
            socket.emit('error_event', {
                code: 'NOT_YOUR_TURN',
                message: 'Chưa đến lượt đi của bạn.',
            });
            return;
        }
        // Server-Authoritative Move Validation via XiangqiEngine
        const moveIntent = { from: payload.from, to: payload.to };
        if (!room.engine.isValidMove(moveIntent)) {
            socket.emit('error_event', {
                code: 'ILLEGAL_MOVE',
                message: 'Nước đi vi phạm luật Cờ Tướng (Cản quân, Lộ mặt tướng hoặc đang bị Chiếu).',
            });
            return;
        }
        const nextSide = playerSide === 'w' ? 'b' : 'w';
        // Update Server Clock with RTT Lag Compensation (max 300ms)
        const clockResult = this.clockManager.recordMoveAndSwitchTurn(room.roomId, playerSide, nextSide, payload.clientSentTimestamp);
        if (clockResult.timedOut) {
            await this.handleClockTimeout(room.roomId, playerSide, clockResult.clock);
            return;
        }
        // Execute move on Authoritative Engine
        const executedMove = room.engine.makeMove(moveIntent);
        executedMove.redTimeLeftMs = clockResult.clock.redTimeLeftMs;
        executedMove.blackTimeLeftMs = clockResult.clock.blackTimeLeftMs;
        // Clear any pending draw offer on move
        room.drawOfferFrom = null;
        const outcome = room.engine.getGameOutcome();
        const legalMoves = outcome.isOver ? [] : room.engine.getLegalMoves();
        const stateDto = this.buildRoomStateDto(room);
        await redis_1.redisStore.saveRoomState(room.roomId, stateDto);
        this.io.to(room.roomId).emit('move_made', {
            move: executedMove,
            fen: room.engine.generateFen(),
            turn: room.engine.getTurn(),
            inCheck: outcome.inCheck,
            checkedGeneralPos: outcome.checkedGeneralPos,
            legalMoves,
            clock: clockResult.clock,
            outcome,
        });
        if (outcome.isOver) {
            await this.finalizeMatch(room, outcome.winner, outcome.reason);
            return;
        }
        // If PvE mode, dispatch AI turn to Worker Thread Pool
        if (room.mode === 'PVE_AI') {
            await this.triggerAiMoveIfNeeded(room);
        }
    }
    async triggerAiMoveIfNeeded(room) {
        if (room.status !== 'PLAYING' || room.mode !== 'PVE_AI')
            return;
        const currentTurn = room.engine.getTurn();
        const activePlayer = currentTurn === 'w' ? room.redPlayer : room.blackPlayer;
        if (!activePlayer || !activePlayer.isAi)
            return;
        const difficulty = activePlayer.aiDifficulty ?? 'MEDIUM';
        const fenSnapshot = room.engine.generateFen();
        const positionHashes = room.engine.getPositionHashes();
        const moveHistoryWxf = room.engine.getMoveHistory().map((m) => m.wxf);
        const aiStartTimestamp = Date.now();
        try {
            const aiPool = (0, ai_pool_1.getAiWorkerPool)();
            const aiResponse = await aiPool.requestBestMove({
                fen: fenSnapshot,
                difficulty,
                positionHashes,
                moveHistoryWxf,
            });
            // Ensure at least 1100ms has elapsed after the human player's move so that
            // the human player's 1.0s (1000ms) piece movement animation completes on the
            // board before the AI's 1.0s (1000ms) piece movement animation starts!
            const elapsedMs = Date.now() - aiStartTimestamp;
            const minAnimationGapMs = 1100;
            if (elapsedMs < minAnimationGapMs) {
                await new Promise((resolve) => setTimeout(resolve, minAnimationGapMs - elapsedMs));
            }
            // Verify room is still active and in the same state after async worker & animation wait
            if (room.status !== 'PLAYING' ||
                room.engine.generateFen() !== fenSnapshot) {
                return;
            }
            if (!aiResponse.bestMove || !room.engine.isValidMove(aiResponse.bestMove)) {
                const fallbackMoves = room.engine.getLegalMoves();
                if (fallbackMoves.length === 0) {
                    const outcome = room.engine.getGameOutcome();
                    await this.finalizeMatch(room, outcome.winner, outcome.reason ?? 'CHECKMATE');
                    return;
                }
                aiResponse.bestMove = fallbackMoves[0];
            }
            const nextSide = currentTurn === 'w' ? 'b' : 'w';
            const clockResult = this.clockManager.recordMoveAndSwitchTurn(room.roomId, currentTurn, nextSide);
            if (clockResult.timedOut) {
                await this.handleClockTimeout(room.roomId, currentTurn, clockResult.clock);
                return;
            }
            const executedMove = room.engine.makeMove(aiResponse.bestMove);
            executedMove.redTimeLeftMs = clockResult.clock.redTimeLeftMs;
            executedMove.blackTimeLeftMs = clockResult.clock.blackTimeLeftMs;
            const outcome = room.engine.getGameOutcome();
            const legalMoves = outcome.isOver ? [] : room.engine.getLegalMoves();
            const stateDto = this.buildRoomStateDto(room);
            await redis_1.redisStore.saveRoomState(room.roomId, stateDto);
            this.io.to(room.roomId).emit('move_made', {
                move: executedMove,
                fen: room.engine.generateFen(),
                turn: room.engine.getTurn(),
                inCheck: outcome.inCheck,
                checkedGeneralPos: outcome.checkedGeneralPos,
                legalMoves,
                clock: clockResult.clock,
                outcome,
            });
            if (outcome.isOver) {
                await this.finalizeMatch(room, outcome.winner, outcome.reason);
            }
        }
        catch (err) {
            console.error('[AI Worker Move Error]:', err);
        }
    }
    // ==========================================================================
    // 7. DRAW OFFERS, RESIGNATION & CLOCK TIMEOUTS
    // ==========================================================================
    handleOfferDraw(socket, roomId) {
        const room = this.activeRooms.get(roomId);
        if (!room || room.status !== 'PLAYING')
            return;
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'SPECTATOR') {
            socket.emit('error_event', {
                code: 'FORBIDDEN_SPECTATOR',
                message: 'Khán giả không được phép cầu hòa.',
            });
            return;
        }
        if (room.mode === 'PVE_AI') {
            socket.emit('error_event', {
                code: 'DRAW_NOT_SUPPORTED_IN_PVE',
                message: 'Chế độ đấu với Máy không hỗ trợ xin hòa.',
            });
            return;
        }
        const fromSide = role === 'RED_PLAYER' ? 'w' : 'b';
        room.drawOfferFrom = fromSide;
        this.io.to(roomId).emit('draw_offered', {
            fromSide,
            fromUsername: socket.data.username,
        });
    }
    async handleRespondDraw(socket, roomId, accept) {
        const room = this.activeRooms.get(roomId);
        if (!room || room.status !== 'PLAYING' || !room.drawOfferFrom)
            return;
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'SPECTATOR')
            return;
        const responderSide = role === 'RED_PLAYER' ? 'w' : 'b';
        if (responderSide === room.drawOfferFrom)
            return;
        room.drawOfferFrom = null;
        if (accept) {
            await this.finalizeMatch(room, 'draw', 'DRAW_AGREEMENT');
        }
        else {
            this.io.to(roomId).emit('draw_declined', { bySide: responderSide });
        }
    }
    async handleResign(socket, roomId) {
        const room = this.activeRooms.get(roomId);
        if (!room || (room.status !== 'PLAYING' && room.status !== 'PAUSED_RECONNECT')) {
            return;
        }
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'SPECTATOR') {
            socket.emit('error_event', {
                code: 'FORBIDDEN_SPECTATOR',
                message: 'Khán giả không có quyền đầu hàng.',
            });
            return;
        }
        const resigningSide = role === 'RED_PLAYER' ? 'w' : 'b';
        const winnerSide = resigningSide === 'w' ? 'b' : 'w';
        await this.finalizeMatch(room, winnerSide, 'RESIGNATION');
    }
    async handleClockTimeout(roomId, timedOutSide, _finalClock) {
        const room = this.activeRooms.get(roomId);
        if (!room || room.status !== 'PLAYING')
            return;
        const winnerSide = timedOutSide === 'w' ? 'b' : 'w';
        await this.finalizeMatch(room, winnerSide, 'TIMEOUT');
    }
    // ==========================================================================
    // 8. PVE UNDO / RESET MOVE, SAVE & RESUME MATCH
    // ==========================================================================
    /**
     * Undoes the last turn in PvE mode (rolls back AI's counter-move + Player's last move,
     * or rolls back Player's move if AI hasn't moved yet) so the player can re-play their move.
     */
    async handleUndoPveMove(socket, roomId) {
        const room = this.activeRooms.get(roomId);
        if (!room || room.mode !== 'PVE_AI') {
            socket.emit('error_event', {
                code: 'UNDO_ONLY_PVE',
                message: 'Chức năng Đi Lại (Reset nước đi) chỉ áp dụng khi đấu với AI.',
            });
            return;
        }
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'SPECTATOR')
            return;
        const humanSide = role === 'RED_PLAYER' ? 'w' : 'b';
        const fullHistory = room.engine.getMoveHistory();
        const fullHashes = room.engine.getPositionHashes();
        // Find the last move index made by the human player
        let lastHumanMoveIdx = -1;
        for (let i = fullHistory.length - 1; i >= 0; i--) {
            if (fullHistory[i].piece.side === humanSide) {
                lastHumanMoveIdx = i;
                break;
            }
        }
        if (lastHumanMoveIdx === -1) {
            socket.emit('error_event', {
                code: 'NO_MOVE_TO_UNDO',
                message: 'Bạn chưa thực hiện nước đi nào để quay lại.',
            });
            return;
        }
        const targetFen = fullHistory[lastHumanMoveIdx].fenBefore;
        const remainingHistory = fullHistory.slice(0, lastHumanMoveIdx);
        const remainingHashes = fullHashes.slice(0, lastHumanMoveIdx + 1);
        room.engine = new shared_1.XiangqiEngine(targetFen, remainingHashes, remainingHistory);
        room.status = 'PLAYING';
        room.eloChanges = null;
        this.clockManager.resumeClock(room.roomId, humanSide);
        const stateDto = this.buildRoomStateDto(room);
        await redis_1.redisStore.saveRoomState(room.roomId, stateDto);
        this.io.to(room.roomId).emit('room_state_sync', stateDto, role);
    }
    /**
     * Resets the entire PvE board back to the starting position (or initial FEN)
     * and restarts the 30-minute match clock.
     */
    async handleResetPveGame(socket, roomId) {
        const room = this.activeRooms.get(roomId);
        if (!room || room.mode !== 'PVE_AI') {
            socket.emit('error_event', {
                code: 'RESET_ONLY_PVE',
                message: 'Chức năng Reset bàn cờ chỉ áp dụng khi đấu với AI.',
            });
            return;
        }
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'SPECTATOR')
            return;
        const humanSide = role === 'RED_PLAYER' ? 'w' : 'b';
        room.engine = new shared_1.XiangqiEngine(room.initialFen);
        room.status = 'PLAYING';
        room.eloChanges = null;
        room.drawOfferFrom = null;
        room.adjournRequestFrom = null;
        this.clockManager.initClock({
            roomId: room.roomId,
            totalTimeMs: room.totalTimeMs,
            turnTimeMs: room.turnTimeMs,
            activeSide: 'w',
            isPaused: false,
        });
        const stateDto = this.buildRoomStateDto(room);
        await redis_1.redisStore.saveRoomState(room.roomId, stateDto);
        this.io.to(room.roomId).emit('room_state_sync', stateDto, role);
        // If human plays Black ('b'), let AI make the opening Red move
        if (humanSide === 'b') {
            await this.triggerAiMoveIfNeeded(room);
        }
    }
    async handleSavePveGame(socket, roomId, customTitle) {
        const room = this.activeRooms.get(roomId);
        if (!room || room.mode !== 'PVE_AI') {
            socket.emit('error_event', {
                code: 'INVALID_SAVE_REQUEST',
                message: 'Chỉ có thể lưu nhanh trực tiếp trong chế độ Chơi với Máy (PvE).',
            });
            return;
        }
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'SPECTATOR')
            return;
        const pausedClock = this.clockManager.pauseClock(roomId);
        room.status = 'ADJOURNED';
        const userId = socket.data.userId;
        const playerColor = role === 'RED_PLAYER' ? 'RED' : 'BLACK';
        const aiPlayer = role === 'RED_PLAYER' ? room.blackPlayer : room.redPlayer;
        const aiDifficulty = aiPlayer?.aiDifficulty ?? 'MEDIUM';
        const currentFen = room.engine.generateFen();
        const moveHistory = room.engine.getMoveHistory();
        const moveHistoryWxf = moveHistory.map((m) => m.wxf).join(' ');
        const positionHashes = room.engine.getPositionHashes();
        const turnLabel = room.engine.getTurn() === 'w' ? 'RED' : 'BLACK';
        const title = customTitle?.trim() ||
            `Đấu với Máy (${aiDifficulty}) - Hiệp ${room.engine.getFullMoveNumber()}`;
        const savedGame = await database_1.prisma.savedGame.create({
            data: {
                matchType: 'PVE',
                status: 'ACTIVE',
                title,
                ownerId: userId,
                redPlayerId: playerColor === 'RED' ? userId : null,
                blackPlayerId: playerColor === 'BLACK' ? userId : null,
                playerColor,
                aiDifficulty,
                initialFen: room.initialFen,
                currentFen,
                turn: turnLabel,
                moveHistoryJson: JSON.parse(JSON.stringify(moveHistory)),
                moveHistoryWxf,
                positionHashesJson: positionHashes,
                totalTimeMs: room.totalTimeMs,
                turnTimeMs: room.turnTimeMs,
                redTimeLeftMs: pausedClock?.redTimeLeftMs ?? room.totalTimeMs,
                blackTimeLeftMs: pausedClock?.blackTimeLeftMs ?? room.totalTimeMs,
                originMatchId: room.dbMatchId,
            },
        });
        if (room.dbMatchId) {
            await database_1.prisma.match.update({
                where: { id: room.dbMatchId },
                data: {
                    status: 'ADJOURNED',
                    endReason: 'ADJOURNED',
                    finalFen: currentFen,
                    moveHistoryJson: JSON.parse(JSON.stringify(moveHistory)),
                    moveHistoryWxf,
                    redTimeLeftMs: pausedClock?.redTimeLeftMs ?? room.totalTimeMs,
                    blackTimeLeftMs: pausedClock?.blackTimeLeftMs ?? room.totalTimeMs,
                },
            });
        }
        await redis_1.redisStore.unbindUserFromRoom(userId);
        this.clockManager.removeClock(roomId);
        await redis_1.redisStore.deleteRoomState(roomId);
        this.io.to(roomId).emit('game_saved', {
            savedGameId: savedGame.id,
            matchType: 'PVE',
            message: 'Đã lưu ván cờ PvE thành công. Bạn có thể chơi tiếp bất cứ lúc nào!',
        });
        this.activeRooms.delete(roomId);
        this.broadcastLobbyUpdate();
    }
    handleRequestAdjourn(socket, roomId) {
        const room = this.activeRooms.get(roomId);
        if (!room || room.status !== 'PLAYING' || room.mode === 'PVE_AI')
            return;
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'SPECTATOR') {
            socket.emit('error_event', {
                code: 'FORBIDDEN_SPECTATOR',
                message: 'Khán giả không có quyền yêu cầu tạm hoãn.',
            });
            return;
        }
        const fromSide = role === 'RED_PLAYER' ? 'w' : 'b';
        room.adjournRequestFrom = fromSide;
        this.io.to(roomId).emit('adjourn_requested', {
            fromSide,
            fromUsername: socket.data.username,
        });
    }
    async handleRespondAdjourn(socket, roomId, accept) {
        const room = this.activeRooms.get(roomId);
        if (!room || room.status !== 'PLAYING' || !room.adjournRequestFrom)
            return;
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'SPECTATOR')
            return;
        const responderSide = role === 'RED_PLAYER' ? 'w' : 'b';
        if (responderSide === room.adjournRequestFrom)
            return;
        room.adjournRequestFrom = null;
        if (!accept) {
            this.io.to(roomId).emit('adjourn_declined', { bySide: responderSide });
            return;
        }
        // Both players agreed to Adjourn & Save Match!
        const pausedClock = this.clockManager.pauseClock(roomId);
        room.status = 'ADJOURNED';
        const currentFen = room.engine.generateFen();
        const moveHistory = room.engine.getMoveHistory();
        const moveHistoryWxf = moveHistory.map((m) => m.wxf).join(' ');
        const positionHashes = room.engine.getPositionHashes();
        const turnLabel = room.engine.getTurn() === 'w' ? 'RED' : 'BLACK';
        const redUserId = room.redPlayer.userId;
        const blackUserId = room.blackPlayer.userId;
        const savedGame = await database_1.prisma.savedGame.create({
            data: {
                matchType: 'PVP_ADJOURNED',
                status: 'ACTIVE',
                title: `Tạm hoãn PvP: ${room.redPlayer?.username} vs ${room.blackPlayer?.username}`,
                ownerId: redUserId,
                redPlayerId: redUserId,
                blackPlayerId: blackUserId,
                playerColor: 'RED',
                initialFen: room.initialFen,
                currentFen,
                turn: turnLabel,
                moveHistoryJson: JSON.parse(JSON.stringify(moveHistory)),
                moveHistoryWxf,
                positionHashesJson: positionHashes,
                totalTimeMs: room.totalTimeMs,
                turnTimeMs: room.turnTimeMs,
                redTimeLeftMs: pausedClock?.redTimeLeftMs ?? room.totalTimeMs,
                blackTimeLeftMs: pausedClock?.blackTimeLeftMs ?? room.totalTimeMs,
                redReadyToResume: false,
                blackReadyToResume: false,
                originMatchId: room.dbMatchId,
            },
        });
        if (room.dbMatchId) {
            await database_1.prisma.match.update({
                where: { id: room.dbMatchId },
                data: {
                    status: 'ADJOURNED',
                    endReason: 'ADJOURNED',
                    finalFen: currentFen,
                    moveHistoryJson: JSON.parse(JSON.stringify(moveHistory)),
                    moveHistoryWxf,
                    redTimeLeftMs: pausedClock?.redTimeLeftMs ?? room.totalTimeMs,
                    blackTimeLeftMs: pausedClock?.blackTimeLeftMs ?? room.totalTimeMs,
                },
            });
        }
        await redis_1.redisStore.unbindUserFromRoom(redUserId);
        await redis_1.redisStore.unbindUserFromRoom(blackUserId);
        this.clockManager.removeClock(roomId);
        await redis_1.redisStore.deleteRoomState(roomId);
        this.io.to(roomId).emit('game_saved', {
            savedGameId: savedGame.id,
            matchType: 'PVP_ADJOURNED',
            message: 'Hai kỳ thủ đã đồng ý tạm hoãn. Trạng thái bàn cờ và đồng hồ đã được đóng băng và lưu lại!',
        });
        this.activeRooms.delete(roomId);
        this.broadcastLobbyUpdate();
    }
    async handleResumeSavedGame(socket, savedGameId) {
        const userId = socket.data.userId;
        const savedGame = await database_1.prisma.savedGame.findUnique({
            where: { id: savedGameId },
            include: {
                redPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
                blackPlayer: {
                    select: { id: true, username: true, avatarUrl: true, eloRating: true },
                },
            },
        });
        if (!savedGame || savedGame.status === 'COMPLETED') {
            socket.emit('error_event', {
                code: 'SAVED_GAME_NOT_FOUND',
                message: 'Không tìm thấy ván cờ đã lưu hoặc ván cờ đã kết thúc.',
            });
            return;
        }
        const moveHistory = Array.isArray(savedGame.moveHistoryJson)
            ? savedGame.moveHistoryJson
            : [];
        const positionHashes = Array.isArray(savedGame.positionHashesJson)
            ? savedGame.positionHashesJson
            : [];
        // CASE 1: Resuming a PvE (Player vs AI) saved game
        if (savedGame.matchType === 'PVE') {
            if (savedGame.ownerId !== userId) {
                socket.emit('error_event', {
                    code: 'FORBIDDEN',
                    message: 'Bạn không phải chủ sở hữu ván cờ PvE này.',
                });
                return;
            }
            const roomId = `room-pve-${savedGame.id.substring(0, 8)}-${Date.now()}`;
            const engine = new shared_1.XiangqiEngine(savedGame.currentFen, positionHashes, moveHistory);
            const humanSide = savedGame.playerColor === 'BLACK' ? 'b' : 'w';
            const aiSide = humanSide === 'w' ? 'b' : 'w';
            const difficulty = savedGame.aiDifficulty ?? 'MEDIUM';
            const aiElo = difficulty === 'EASY' ? 1000 : difficulty === 'MEDIUM' ? 1450 : 1900;
            const humanPlayerState = {
                userId,
                username: socket.data.username,
                avatarUrl: socket.data.avatarUrl,
                eloRating: socket.data.eloRating,
                side: humanSide,
                isConnected: true,
                disconnectedAt: null,
                reconnectDeadlineTimestamp: null,
                isMutedPlayerChat: false,
            };
            const aiPlayerState = {
                userId: `ai-${difficulty.toLowerCase()}`,
                username: `AI Đại Sư (${difficulty})`,
                avatarUrl: '/avatars/ai-master.png',
                eloRating: aiElo,
                side: aiSide,
                isConnected: true,
                disconnectedAt: null,
                reconnectDeadlineTimestamp: null,
                isMutedPlayerChat: true,
                isAi: true,
                aiDifficulty: difficulty,
            };
            const room = {
                roomId,
                roomName: savedGame.title || `Khôi phục PvE (${difficulty})`,
                passwordHash: null,
                mode: 'PVE_AI',
                status: 'PLAYING',
                dbMatchId: savedGame.originMatchId,
                originSavedGameId: savedGame.id,
                engine,
                initialFen: savedGame.initialFen,
                redPlayer: humanSide === 'w' ? humanPlayerState : aiPlayerState,
                blackPlayer: humanSide === 'b' ? humanPlayerState : aiPlayerState,
                redSocketId: humanSide === 'w' ? socket.id : null,
                blackSocketId: humanSide === 'b' ? socket.id : null,
                spectators: new Map(),
                drawOfferFrom: null,
                adjournRequestFrom: null,
                totalTimeMs: savedGame.totalTimeMs,
                turnTimeMs: savedGame.turnTimeMs,
                eloChanges: null,
                reconnectTimers: new Map(),
            };
            this.clockManager.initClock({
                roomId,
                totalTimeMs: savedGame.totalTimeMs,
                turnTimeMs: savedGame.turnTimeMs,
                redTimeLeftMs: savedGame.redTimeLeftMs,
                blackTimeLeftMs: savedGame.blackTimeLeftMs,
                activeSide: engine.getTurn(),
                isPaused: false,
            });
            this.activeRooms.set(roomId, room);
            await redis_1.redisStore.bindUserToRoom(userId, roomId);
            socket.join(roomId);
            const assignedRole = humanSide === 'w' ? 'RED_PLAYER' : 'BLACK_PLAYER';
            const stateDto = this.buildRoomStateDto(room);
            await redis_1.redisStore.saveRoomState(roomId, stateDto);
            socket.emit('room_state_sync', stateDto, assignedRole);
            this.broadcastLobbyUpdate();
            if (engine.getTurn() === aiSide) {
                await this.triggerAiMoveIfNeeded(room);
            }
            return;
        }
        // CASE 2: Resuming a PvP Adjourned Match
        if (savedGame.redPlayerId !== userId &&
            savedGame.blackPlayerId !== userId) {
            socket.emit('error_event', {
                code: 'FORBIDDEN',
                message: 'Bạn không phải là kỳ thủ của ván đấu tạm hoãn này.',
            });
            return;
        }
        const roomId = `room-adjourn-${savedGame.id}`;
        let room = this.activeRooms.get(roomId);
        if (!room) {
            const engine = new shared_1.XiangqiEngine(savedGame.currentFen, positionHashes, moveHistory);
            room = {
                roomId,
                roomName: savedGame.title ||
                    `Tiếp tục: ${savedGame.redPlayer?.username} vs ${savedGame.blackPlayer?.username}`,
                passwordHash: null,
                mode: 'PVP_RANKED',
                status: 'WAITING',
                dbMatchId: savedGame.originMatchId,
                originSavedGameId: savedGame.id,
                engine,
                initialFen: savedGame.initialFen,
                redPlayer: savedGame.redPlayer
                    ? {
                        userId: savedGame.redPlayer.id,
                        username: savedGame.redPlayer.username,
                        avatarUrl: savedGame.redPlayer.avatarUrl,
                        eloRating: savedGame.redPlayer.eloRating,
                        side: 'w',
                        isConnected: false,
                        disconnectedAt: null,
                        reconnectDeadlineTimestamp: null,
                        isMutedPlayerChat: false,
                    }
                    : null,
                blackPlayer: savedGame.blackPlayer
                    ? {
                        userId: savedGame.blackPlayer.id,
                        username: savedGame.blackPlayer.username,
                        avatarUrl: savedGame.blackPlayer.avatarUrl,
                        eloRating: savedGame.blackPlayer.eloRating,
                        side: 'b',
                        isConnected: false,
                        disconnectedAt: null,
                        reconnectDeadlineTimestamp: null,
                        isMutedPlayerChat: false,
                    }
                    : null,
                redSocketId: null,
                blackSocketId: null,
                spectators: new Map(),
                drawOfferFrom: null,
                adjournRequestFrom: null,
                totalTimeMs: savedGame.totalTimeMs,
                turnTimeMs: savedGame.turnTimeMs,
                eloChanges: null,
                reconnectTimers: new Map(),
            };
            this.clockManager.initClock({
                roomId,
                totalTimeMs: savedGame.totalTimeMs,
                turnTimeMs: savedGame.turnTimeMs,
                redTimeLeftMs: savedGame.redTimeLeftMs,
                blackTimeLeftMs: savedGame.blackTimeLeftMs,
                activeSide: engine.getTurn(),
                isPaused: true,
            });
            this.activeRooms.set(roomId, room);
        }
        const isRed = savedGame.redPlayerId === userId;
        if (isRed && room.redPlayer) {
            room.redPlayer.isConnected = true;
            room.redSocketId = socket.id;
        }
        else if (!isRed && room.blackPlayer) {
            room.blackPlayer.isConnected = true;
            room.blackSocketId = socket.id;
        }
        socket.join(roomId);
        await redis_1.redisStore.bindUserToRoom(userId, roomId);
        // When both Red and Black players have joined the restored room, unpause clock and resume!
        if (room.redPlayer?.isConnected && room.blackPlayer?.isConnected) {
            room.status = 'PLAYING';
            this.clockManager.resumeClock(roomId, room.engine.getTurn());
            await database_1.prisma.savedGame.update({
                where: { id: savedGame.id },
                data: {
                    status: 'RESUMED',
                    redReadyToResume: true,
                    blackReadyToResume: true,
                },
            });
        }
        const stateDto = this.buildRoomStateDto(room);
        await redis_1.redisStore.saveRoomState(roomId, stateDto);
        if (room.redSocketId) {
            this.io
                .to(room.redSocketId)
                .emit('room_state_sync', stateDto, 'RED_PLAYER');
        }
        if (room.blackSocketId) {
            this.io
                .to(room.blackSocketId)
                .emit('room_state_sync', stateDto, 'BLACK_PLAYER');
        }
        this.broadcastLobbyUpdate();
    }
    // ==========================================================================
    // 9. DUAL-CHANNEL REAL-TIME CHAT (PLAYER & SPECTATOR CHANNELS)
    // ==========================================================================
    handleSendChat(socket, roomId, channel, rawContent) {
        const room = this.activeRooms.get(roomId);
        if (!room)
            return;
        const senderRole = this.getSocketRoleInRoom(room, socket);
        const { error, message } = this.chatManager.buildChatMessage({
            roomId,
            channel,
            senderId: socket.data.userId,
            senderUsername: socket.data.username,
            senderAvatarUrl: socket.data.avatarUrl,
            senderRole,
            rawContent,
        });
        if (error || !message) {
            socket.emit('error_event', {
                code: 'CHAT_REJECTED',
                message: error || 'Không thể gửi tin nhắn.',
            });
            return;
        }
        if (channel === 'PLAYER') {
            // Send to sender
            socket.emit('chat_message', message);
            // Send to opponent only if opponent has NOT muted Player Chat
            const isSenderRed = senderRole === 'RED_PLAYER';
            const opponentPlayer = isSenderRed ? room.blackPlayer : room.redPlayer;
            const opponentSocketId = isSenderRed
                ? room.blackSocketId
                : room.redSocketId;
            if (opponentPlayer &&
                opponentSocketId &&
                !opponentPlayer.isMutedPlayerChat) {
                this.io.to(opponentSocketId).emit('chat_message', message);
            }
        }
        else {
            // Spectator/Lobby channel broadcasts to everyone in the room
            this.io.to(roomId).emit('chat_message', message);
        }
    }
    handleToggleMutePlayerChat(socket, roomId, muted) {
        const room = this.activeRooms.get(roomId);
        if (!room)
            return;
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'RED_PLAYER' && room.redPlayer) {
            room.redPlayer.isMutedPlayerChat = muted;
        }
        else if (role === 'BLACK_PLAYER' && room.blackPlayer) {
            room.blackPlayer.isMutedPlayerChat = muted;
        }
    }
    // ==========================================================================
    // 9B. P2P WEBRTC VIDEO / VOICE CALL SIGNALING (STRICTLY 1v1 PLAYERS ONLY)
    // ==========================================================================
    resolvePvpCallPeer(socket, roomId) {
        const room = this.activeRooms.get(roomId);
        if (!room) {
            socket.emit('error_event', {
                code: 'ROOM_NOT_FOUND',
                message: 'Không tìm thấy phòng đấu.',
            });
            return null;
        }
        if (room.mode === 'PVE_AI') {
            socket.emit('error_event', {
                code: 'VIDEO_CALL_UNSUPPORTED_MODE',
                message: 'Tính năng gọi Video chỉ áp dụng cho trận đấu Online giữa 2 kỳ thủ.',
            });
            return null;
        }
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'SPECTATOR') {
            socket.emit('error_event', {
                code: 'FORBIDDEN_SPECTATOR',
                message: 'Khán giả không có quyền tham gia cuộc gọi Video của 2 đấu thủ.',
            });
            return null;
        }
        if (room.status !== 'PLAYING' && room.status !== 'PAUSED_RECONNECT') {
            socket.emit('error_event', {
                code: 'VIDEO_CALL_ROOM_INACTIVE',
                message: 'Chỉ có thể gọi Video khi trận đấu đã đủ 2 kỳ thủ và đang diễn ra.',
            });
            return null;
        }
        // Keep caller's socket ID synced
        if (role === 'RED_PLAYER') {
            room.redSocketId = socket.id;
        }
        else {
            room.blackSocketId = socket.id;
        }
        const callerSide = role === 'RED_PLAYER' ? 'w' : 'b';
        const opponentPlayer = callerSide === 'w' ? room.blackPlayer : room.redPlayer;
        const opponentSocketId = callerSide === 'w' ? room.blackSocketId : room.redSocketId;
        if (!opponentPlayer || !opponentPlayer.isConnected || !opponentSocketId) {
            socket.emit('error_event', {
                code: 'VIDEO_CALL_PEER_OFFLINE',
                message: 'Đối thủ hiện đang mất kết nối, chưa thể thực hiện cuộc gọi.',
            });
            return null;
        }
        return {
            room,
            callerSide,
            callerUsername: socket.data.username,
            opponentSocketId,
        };
    }
    handleVideoCallRequest(socket, payload) {
        if (!payload?.roomId)
            return;
        const ctx = this.resolvePvpCallPeer(socket, payload.roomId);
        if (!ctx)
            return;
        const { room, callerSide, callerUsername, opponentSocketId } = ctx;
        room.videoCallPendingFrom = callerSide;
        // Point-to-point delivery ONLY to the opponent socket (never broadcast to spectators)
        this.io.to(opponentSocketId).emit('video_call_incoming', {
            roomId: room.roomId,
            fromSide: callerSide,
            fromUsername: callerUsername,
            hasVideo: Boolean(payload.hasVideo),
        });
    }
    handleVideoCallRespond(socket, payload) {
        if (!payload?.roomId)
            return;
        const ctx = this.resolvePvpCallPeer(socket, payload.roomId);
        if (!ctx)
            return;
        const { room, callerSide, callerUsername, opponentSocketId } = ctx;
        room.videoCallPendingFrom = null;
        if (payload.accept) {
            room.isVideoCallActive = true;
            this.io.to(opponentSocketId).emit('video_call_accepted', {
                roomId: room.roomId,
                bySide: callerSide,
                byUsername: callerUsername,
                hasVideo: payload.hasVideo ?? true,
            });
        }
        else {
            room.isVideoCallActive = false;
            this.io.to(opponentSocketId).emit('video_call_declined', {
                roomId: room.roomId,
                bySide: callerSide,
                byUsername: callerUsername,
            });
        }
    }
    handleWebRtcOffer(socket, payload) {
        if (!payload?.roomId || !payload.description?.sdp)
            return;
        const ctx = this.resolvePvpCallPeer(socket, payload.roomId);
        if (!ctx)
            return;
        ctx.room.isVideoCallActive = true;
        this.io.to(ctx.opponentSocketId).emit('webrtc_offer', {
            roomId: ctx.room.roomId,
            fromSide: ctx.callerSide,
            description: {
                type: 'offer',
                sdp: payload.description.sdp,
            },
            mediaState: {
                audioEnabled: Boolean(payload.mediaState?.audioEnabled),
                videoEnabled: Boolean(payload.mediaState?.videoEnabled),
            },
        });
    }
    handleWebRtcAnswer(socket, payload) {
        if (!payload?.roomId || !payload.description?.sdp)
            return;
        const ctx = this.resolvePvpCallPeer(socket, payload.roomId);
        if (!ctx)
            return;
        ctx.room.isVideoCallActive = true;
        this.io.to(ctx.opponentSocketId).emit('webrtc_answer', {
            roomId: ctx.room.roomId,
            fromSide: ctx.callerSide,
            description: {
                type: 'answer',
                sdp: payload.description.sdp,
            },
            mediaState: {
                audioEnabled: Boolean(payload.mediaState?.audioEnabled),
                videoEnabled: Boolean(payload.mediaState?.videoEnabled),
            },
        });
    }
    handleWebRtcIceCandidate(socket, payload) {
        if (!payload?.roomId || !payload.candidate || typeof payload.candidate.candidate !== 'string') {
            return;
        }
        const ctx = this.resolvePvpCallPeer(socket, payload.roomId);
        if (!ctx)
            return;
        this.io.to(ctx.opponentSocketId).emit('webrtc_ice_candidate', {
            roomId: ctx.room.roomId,
            fromSide: ctx.callerSide,
            candidate: {
                candidate: payload.candidate.candidate,
                sdpMid: payload.candidate.sdpMid ?? null,
                sdpMLineIndex: payload.candidate.sdpMLineIndex ?? null,
                usernameFragment: payload.candidate.usernameFragment ?? null,
            },
        });
    }
    handleWebRtcMediaState(socket, payload) {
        if (!payload?.roomId || !payload.mediaState)
            return;
        const ctx = this.resolvePvpCallPeer(socket, payload.roomId);
        if (!ctx)
            return;
        this.io.to(ctx.opponentSocketId).emit('webrtc_media_state', {
            roomId: ctx.room.roomId,
            fromSide: ctx.callerSide,
            mediaState: {
                audioEnabled: Boolean(payload.mediaState.audioEnabled),
                videoEnabled: Boolean(payload.mediaState.videoEnabled),
            },
        });
    }
    handleVideoCallHangup(socket, payload) {
        if (!payload?.roomId)
            return;
        const room = this.activeRooms.get(payload.roomId);
        if (!room || room.mode === 'PVE_AI')
            return;
        const role = this.getSocketRoleInRoom(room, socket);
        if (role === 'SPECTATOR')
            return;
        room.isVideoCallActive = false;
        room.videoCallPendingFrom = null;
        const callerSide = role === 'RED_PLAYER' ? 'w' : 'b';
        const opponentSocketId = callerSide === 'w' ? room.blackSocketId : room.redSocketId;
        if (opponentSocketId) {
            this.io.to(opponentSocketId).emit('video_call_ended', {
                roomId: room.roomId,
                bySide: callerSide,
                reason: payload.reason ?? 'HANGUP',
            });
        }
    }
    // ==========================================================================
    // 10. MATCH FINALIZATION, ELO CALCULATION & POSTGRESQL PERSISTENCE
    // ==========================================================================
    async finalizeMatch(room, winner, reason) {
        if (room.status === 'FINISHED')
            return;
        room.status = 'FINISHED';
        // Cleanly terminate any active P2P Video/Voice Call on match completion
        if (room.isVideoCallActive || room.videoCallPendingFrom) {
            room.isVideoCallActive = false;
            room.videoCallPendingFrom = null;
            if (room.redSocketId) {
                this.io.to(room.redSocketId).emit('video_call_ended', {
                    roomId: room.roomId,
                    bySide: 'w',
                    reason: 'MATCH_FINISHED',
                });
            }
            if (room.blackSocketId) {
                this.io.to(room.blackSocketId).emit('video_call_ended', {
                    roomId: room.roomId,
                    bySide: 'b',
                    reason: 'MATCH_FINISHED',
                });
            }
        }
        // Clear any active reconnect timers
        for (const [, timer] of room.reconnectTimers) {
            clearTimeout(timer);
        }
        room.reconnectTimers.clear();
        const finalClock = this.clockManager.pauseClock(room.roomId) ??
            this.buildDefaultClockState(room);
        this.clockManager.removeClock(room.roomId);
        const outcome = {
            isOver: true,
            winner,
            reason,
            inCheck: room.engine.isInCheck(),
            checkedGeneralPos: room.engine.isInCheck()
                ? room.engine.findGeneral(room.engine.getTurn())
                : null,
        };
        const moveHistory = room.engine.getMoveHistory();
        const moveHistoryWxf = moveHistory.map((m) => m.wxf).join(' ');
        const finalFen = room.engine.generateFen();
        // Calculate ELO Rating Updates for Ranked PvP Matches
        if (room.mode === 'PVP_RANKED' &&
            room.redPlayer &&
            room.blackPlayer &&
            !room.redPlayer.isAi &&
            !room.blackPlayer.isAi &&
            winner !== null) {
            const eloResult = (0, shared_1.calculateMatchElo)(room.redPlayer.eloRating, room.blackPlayer.eloRating, winner);
            room.eloChanges = eloResult;
            room.redPlayer.eloRating = eloResult.redEloAfter;
            room.blackPlayer.eloRating = eloResult.blackEloAfter;
            try {
                await database_1.prisma.$transaction([
                    database_1.prisma.user.update({
                        where: { id: room.redPlayer.userId },
                        data: {
                            eloRating: eloResult.redEloAfter,
                            gamesPlayed: { increment: 1 },
                            wins: winner === 'w' ? { increment: 1 } : undefined,
                            losses: winner === 'b' ? { increment: 1 } : undefined,
                            draws: winner === 'draw' ? { increment: 1 } : undefined,
                        },
                    }),
                    database_1.prisma.user.update({
                        where: { id: room.blackPlayer.userId },
                        data: {
                            eloRating: eloResult.blackEloAfter,
                            gamesPlayed: { increment: 1 },
                            wins: winner === 'b' ? { increment: 1 } : undefined,
                            losses: winner === 'w' ? { increment: 1 } : undefined,
                            draws: winner === 'draw' ? { increment: 1 } : undefined,
                        },
                    }),
                ]);
            }
            catch (err) {
                console.error('[ELO Update Transaction Error]:', err);
            }
        }
        // Update or create Match record in PostgreSQL
        try {
            const winnerSideLabel = winner === 'w' ? 'RED' : winner === 'b' ? 'BLACK' : null;
            const winnerUserId = winner === 'w'
                ? room.redPlayer && !room.redPlayer.isAi
                    ? room.redPlayer.userId
                    : null
                : winner === 'b'
                    ? room.blackPlayer && !room.blackPlayer.isAi
                        ? room.blackPlayer.userId
                        : null
                    : null;
            if (room.dbMatchId) {
                await database_1.prisma.match.update({
                    where: { id: room.dbMatchId },
                    data: {
                        status: 'COMPLETED',
                        winnerSide: winnerSideLabel,
                        winnerUserId,
                        endReason: reason,
                        finalFen,
                        moveHistoryJson: JSON.parse(JSON.stringify(moveHistory)),
                        moveHistoryWxf,
                        redTimeLeftMs: finalClock.redTimeLeftMs,
                        blackTimeLeftMs: finalClock.blackTimeLeftMs,
                        redEloDelta: room.eloChanges?.redDelta ?? null,
                        blackEloDelta: room.eloChanges?.blackDelta ?? null,
                        endedAt: new Date(),
                    },
                });
            }
            if (room.originSavedGameId) {
                await database_1.prisma.savedGame.update({
                    where: { id: room.originSavedGameId },
                    data: { status: 'COMPLETED' },
                });
            }
        }
        catch (err) {
            console.error('[Finalize Match DB Update Error]:', err);
        }
        if (room.redPlayer && !room.redPlayer.isAi) {
            await redis_1.redisStore.unbindUserFromRoom(room.redPlayer.userId);
        }
        if (room.blackPlayer && !room.blackPlayer.isAi) {
            await redis_1.redisStore.unbindUserFromRoom(room.blackPlayer.userId);
        }
        const stateDto = this.buildRoomStateDto(room);
        await redis_1.redisStore.saveRoomState(room.roomId, stateDto);
        this.io.to(room.roomId).emit('game_over', {
            outcome,
            clock: finalClock,
            eloChanges: room.eloChanges,
            matchId: room.dbMatchId ?? undefined,
        });
        this.broadcastLobbyUpdate();
    }
    // ==========================================================================
    // HELPERS
    // ==========================================================================
    getSocketRoleInRoom(room, socket) {
        if (room.redPlayer && room.redPlayer.userId === socket.data.userId) {
            return 'RED_PLAYER';
        }
        if (room.blackPlayer && room.blackPlayer.userId === socket.data.userId) {
            return 'BLACK_PLAYER';
        }
        return 'SPECTATOR';
    }
    ensureParticipantSocketsJoined(room, activeSocket) {
        if (activeSocket && !activeSocket.rooms.has(room.roomId)) {
            activeSocket.join(room.roomId);
        }
        if (room.redSocketId) {
            const redSock = this.io.sockets.sockets.get(room.redSocketId);
            if (redSock && !redSock.rooms.has(room.roomId)) {
                redSock.join(room.roomId);
            }
        }
        if (room.blackSocketId) {
            const blackSock = this.io.sockets.sockets.get(room.blackSocketId);
            if (blackSock && !blackSock.rooms.has(room.roomId)) {
                blackSock.join(room.roomId);
            }
        }
    }
    buildDefaultClockState(room) {
        return {
            totalTimeMs: room.totalTimeMs,
            turnTimeMs: room.turnTimeMs,
            redTimeLeftMs: room.totalTimeMs,
            blackTimeLeftMs: room.totalTimeMs,
            currentTurnLeftMs: room.turnTimeMs,
            activeSide: room.engine.getTurn(),
            lastTickServerTimestamp: Date.now(),
            isPaused: room.status !== 'PLAYING',
        };
    }
    buildRoomStateDto(room) {
        const clock = this.clockManager.getClock(room.roomId) ??
            this.buildDefaultClockState(room);
        const outcome = room.engine.getGameOutcome();
        const moveHistory = room.engine.getMoveHistory();
        const lastMove = moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
        const spectatorsList = Array.from(room.spectators.values());
        return {
            roomId: room.roomId,
            roomName: room.roomName,
            isPrivate: room.passwordHash !== null,
            mode: room.mode,
            status: room.status,
            redPlayer: room.redPlayer ? { ...room.redPlayer } : null,
            blackPlayer: room.blackPlayer ? { ...room.blackPlayer } : null,
            spectatorCount: spectatorsList.length,
            spectators: spectatorsList,
            fen: room.engine.generateFen(),
            initialFen: room.initialFen,
            turn: room.engine.getTurn(),
            inCheck: outcome.inCheck,
            checkedGeneralPos: outcome.checkedGeneralPos,
            lastMove,
            moveHistory,
            moveHistoryWxf: moveHistory.map((m) => m.wxf).join(' '),
            positionHashes: room.engine.getPositionHashes(),
            legalMoves: room.status === 'PLAYING' && !outcome.isOver
                ? room.engine.getLegalMoves()
                : [],
            clock,
            drawOfferFrom: room.drawOfferFrom,
            adjournRequestFrom: room.adjournRequestFrom,
            outcome,
            eloChanges: room.eloChanges,
        };
    }
    getLobbyRoomSummaries() {
        const list = [];
        for (const [, room] of this.activeRooms) {
            if (room.status === 'FINISHED' || room.status === 'ADJOURNED')
                continue;
            list.push({
                roomId: room.roomId,
                roomName: room.roomName,
                isPrivate: room.passwordHash !== null,
                mode: room.mode,
                status: room.status,
                redPlayer: room.redPlayer
                    ? {
                        username: room.redPlayer.username,
                        eloRating: room.redPlayer.eloRating,
                        avatarUrl: room.redPlayer.avatarUrl,
                    }
                    : null,
                blackPlayer: room.blackPlayer
                    ? {
                        username: room.blackPlayer.username,
                        eloRating: room.blackPlayer.eloRating,
                        avatarUrl: room.blackPlayer.avatarUrl,
                    }
                    : null,
                spectatorCount: room.spectators.size,
                totalTimeMs: room.totalTimeMs,
                turnTimeMs: room.turnTimeMs,
            });
        }
        return list;
    }
    broadcastLobbyUpdate() {
        this.io.emit('lobby_rooms_updated', this.getLobbyRoomSummaries());
    }
    async shutdown() {
        clearInterval(this.matchmakingTimer);
        for (const [, room] of this.activeRooms) {
            this.clockManager.removeClock(room.roomId);
            for (const [, timer] of room.reconnectTimers) {
                clearTimeout(timer);
            }
        }
        await (0, ai_pool_1.getAiWorkerPool)().shutdown();
        this.io.close();
    }
}
exports.XiangqiSocketServer = XiangqiSocketServer;
//# sourceMappingURL=socket-manager.js.map
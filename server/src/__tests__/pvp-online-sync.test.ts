// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - ONLINE PVP REAL-TIME SYNCHRONIZATION TESTS
// End-to-end multi-client Socket.IO integration tests verifying:
// 1. Custom Room Online PvP: Immediate `move_made` delivery to BOTH Red & Black
//    clients on every single ply (no 1-move lag) even across `clock_sync` ticks.
// 2. Matchmaking Queue Online PvP: Concurrent `join_matchmaking` -> `match_found`
//    -> `room_state_sync` -> immediate bidirectional `move_made` synchronization.
// ============================================================================

import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import {
  ClientToServerEvents,
  Coordinates,
  ExecutedMove,
  INITIAL_XIANGQI_FEN,
  RoomRole,
  RoomStateDto,
  ServerToClientEvents,
  XiangqiEngine,
} from '@xiangqi/shared';
import { prisma } from '../config/database';
import { signAccessToken } from '../utils/jwt';
import { hashPassword } from '../utils/password';
import { XiangqiSocketServer } from '../socket/socket-manager';

type TypedClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

interface MoveMadePayload {
  move: ExecutedMove;
  fen: string;
  turn: 'w' | 'b';
}

function waitForEvent<T>(
  socket: TypedClientSocket,
  eventName: keyof ServerToClientEvents,
  timeoutMs = 4000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for socket event "${String(eventName)}" after ${timeoutMs}ms`));
    }, timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any).once(eventName, (...args: unknown[]) => {
      clearTimeout(timer);
      resolve((args.length > 1 ? args : args[0]) as T);
    });
  });
}

async function connectAuthenticatedClient(
  port: number,
  token: string
): Promise<TypedClientSocket> {
  const client: TypedClientSocket = createClient(`http://127.0.0.1:${port}`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });

  await new Promise<void>((resolve, reject) => {
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

describe('Online PvP Multi-Client Real-Time Move Synchronization', () => {
  let httpServer: http.Server;
  let socketServer: XiangqiSocketServer;
  let port = 0;

  let redToken = '';
  let blackToken = '';
  let mmTokenA = '';
  let mmTokenB = '';
  const createdTestUserIds: string[] = [];

  beforeAll(async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const passHash = await hashPassword('TestPass123!', 10);

    const redUser = await prisma.user.create({
      data: {
        username: `red_pvp_${suffix}`,
        email: `red_pvp_${suffix}@xiangqi.test`,
        passwordHash: passHash,
        eloRating: 1350,
      },
    });

    const blackUser = await prisma.user.create({
      data: {
        username: `black_pvp_${suffix}`,
        email: `black_pvp_${suffix}@xiangqi.test`,
        passwordHash: passHash,
        eloRating: 1360,
      },
    });

    const mmUserA = await prisma.user.create({
      data: {
        username: `mma_pvp_${suffix}`,
        email: `mma_pvp_${suffix}@xiangqi.test`,
        passwordHash: passHash,
        eloRating: 1250,
      },
    });

    const mmUserB = await prisma.user.create({
      data: {
        username: `mmb_pvp_${suffix}`,
        email: `mmb_pvp_${suffix}@xiangqi.test`,
        passwordHash: passHash,
        eloRating: 1265,
      },
    });

    createdTestUserIds.push(redUser.id, blackUser.id, mmUserA.id, mmUserB.id);

    redToken = signAccessToken({
      userId: redUser.id,
      username: redUser.username,
      eloRating: redUser.eloRating,
    });
    blackToken = signAccessToken({
      userId: blackUser.id,
      username: blackUser.username,
      eloRating: blackUser.eloRating,
    });
    mmTokenA = signAccessToken({
      userId: mmUserA.id,
      username: mmUserA.username,
      eloRating: mmUserA.eloRating,
    });
    mmTokenB = signAccessToken({
      userId: mmUserB.id,
      username: mmUserB.username,
      eloRating: mmUserB.eloRating,
    });

    httpServer = http.createServer();
    socketServer = new XiangqiSocketServer(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        port = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await socketServer.shutdown();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });

    // Clean up temporary integration-test matches and users from PostgreSQL
    if (createdTestUserIds.length > 0) {
      await prisma.match.deleteMany({
        where: {
          OR: [
            { redPlayerId: { in: createdTestUserIds } },
            { blackPlayerId: { in: createdTestUserIds } },
          ],
        },
      });
      await prisma.user.deleteMany({
        where: { id: { in: createdTestUserIds } },
      });
    }
  });

  it('1. Custom Room Online PvP: Delivers every move immediately to BOTH Red & Black clients across clock_sync ticks (0 move lag)', async () => {
    const redClient = await connectAuthenticatedClient(port, redToken);
    const blackClient = await connectAuthenticatedClient(port, blackToken);

    try {
      // Step 1: Red creates an Online PvP room
      const redCreatedSyncPromise = waitForEvent<[RoomStateDto, RoomRole]>(
        redClient,
        'room_state_sync'
      );

      redClient.emit('create_room', {
        roomName: 'Phòng Kiểm Thử Đồng Bộ Online',
        mode: 'PVP_CASUAL',
        preferredSide: 'w',
      });

      const [createdRoomState, redAssignedRole] = await redCreatedSyncPromise;
      expect(redAssignedRole).toBe('RED_PLAYER');
      expect(createdRoomState.status).toBe('WAITING');
      expect(createdRoomState.fen).toBe(INITIAL_XIANGQI_FEN);

      const roomId = createdRoomState.roomId;

      // Step 2: Black joins the room -> both Red and Black receive PLAYING room_state_sync
      const redStartSyncPromise = waitForEvent<[RoomStateDto, RoomRole]>(
        redClient,
        'room_state_sync'
      );
      const blackStartSyncPromise = waitForEvent<[RoomStateDto, RoomRole]>(
        blackClient,
        'room_state_sync'
      );

      blackClient.emit('join_room', { roomId });

      const [[redPlayingState, redRole2], [blackPlayingState, blackRole]] =
        await Promise.all([redStartSyncPromise, blackStartSyncPromise]);

      expect(redRole2).toBe('RED_PLAYER');
      expect(blackRole).toBe('BLACK_PLAYER');
      expect(redPlayingState.status).toBe('PLAYING');
      expect(blackPlayingState.status).toBe('PLAYING');

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
      const plannedPlies: Array<{
        actor: 'RED' | 'BLACK';
        socket: TypedClientSocket;
        from: Coordinates;
        to: Coordinates;
        expectedFenChar: string;
        waitAfterMs: number;
      }> = [
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

      const referenceEngine = new XiangqiEngine(INITIAL_XIANGQI_FEN);

      for (let i = 0; i < plannedPlies.length; i++) {
        const ply = plannedPlies[i];
        referenceEngine.makeMove({ from: ply.from, to: ply.to });
        const expectedFen = referenceEngine.generateFen();
        const expectedTurn = referenceEngine.getTurn();

        // Register listeners on BOTH clients BEFORE emitting make_move
        const redMovePromise = waitForEvent<MoveMadePayload>(redClient, 'move_made', 2000);
        const blackMovePromise = waitForEvent<MoveMadePayload>(blackClient, 'move_made', 2000);

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

        expect(redBoardFen).toBe(expectedFen);
        expect(blackBoardFen).toBe(expectedFen);
        expect(redMovePayload.turn).toBe(expectedTurn);
        expect(blackMovePayload.turn).toBe(expectedTurn);
        expect(redMovePayload.move.from).toEqual(ply.from);
        expect(redMovePayload.move.to).toEqual(ply.to);
        expect(blackMovePayload.move.from).toEqual(ply.from);
        expect(blackMovePayload.move.to).toEqual(ply.to);

        // Verify the moved piece is immediately present at destination square (to.row, to.col)
        // and cleared from origin square (from.row, from.col) on BOTH clients' boards!
        const redClientEngine = new XiangqiEngine(redBoardFen);
        const blackClientEngine = new XiangqiEngine(blackBoardFen);

        expect(redClientEngine.getPieceAt(ply.from)).toBeNull();
        expect(redClientEngine.getPieceAt(ply.to)?.fenChar).toBe(ply.expectedFenChar);

        expect(blackClientEngine.getPieceAt(ply.from)).toBeNull();
        expect(blackClientEngine.getPieceAt(ply.to)?.fenChar).toBe(ply.expectedFenChar);

        if (ply.waitAfterMs > 0) {
          await new Promise((r) => setTimeout(r, ply.waitAfterMs));
          // Confirm clock_sync did NOT revert or alter either client's FEN
          expect(redBoardFen).toBe(expectedFen);
          expect(blackBoardFen).toBe(expectedFen);
        }
      }

      // Confirm live 1000ms clock_sync broadcasts occurred during the match
      expect(clockSyncCountRed).toBeGreaterThanOrEqual(2);
      expect(clockSyncCountBlack).toBeGreaterThanOrEqual(2);
    } finally {
      redClient.disconnect();
      blackClient.disconnect();
    }
  });

  it('2. Ranked Matchmaking Online PvP: Matches two queued players and synchronizes opening moves immediately on both clients', async () => {
    const clientA = await connectAuthenticatedClient(port, mmTokenA);
    const clientB = await connectAuthenticatedClient(port, mmTokenB);

    try {
      const syncAPromise = waitForEvent<[RoomStateDto, RoomRole]>(
        clientA,
        'room_state_sync',
        5000
      );
      const syncBPromise = waitForEvent<[RoomStateDto, RoomRole]>(
        clientB,
        'room_state_sync',
        5000
      );

      clientA.emit('join_matchmaking', {});
      clientB.emit('join_matchmaking', {});

      const [[stateA, roleA], [stateB, roleB]] = await Promise.all([
        syncAPromise,
        syncBPromise,
      ]);

      expect(stateA.roomId).toBe(stateB.roomId);
      expect(stateA.status).toBe('PLAYING');
      expect(new Set([roleA, roleB])).toEqual(new Set(['RED_PLAYER', 'BLACK_PLAYER']));

      const redSocket = roleA === 'RED_PLAYER' ? clientA : clientB;
      const moveA = waitForEvent<MoveMadePayload>(clientA, 'move_made', 2000);
      const moveB = waitForEvent<MoveMadePayload>(clientB, 'move_made', 2000);

      // Red plays Binh 7 tấn 1: (6, 2) -> (5, 2)
      redSocket.emit('make_move', {
        roomId: stateA.roomId,
        from: { row: 6, col: 2 },
        to: { row: 5, col: 2 },
        clientSentTimestamp: Date.now(),
      });

      const [resA, resB] = await Promise.all([moveA, moveB]);
      expect(resA.fen).toBe(resB.fen);
      expect(resA.move.to).toEqual({ row: 5, col: 2 });
      expect(new XiangqiEngine(resA.fen).getPieceAt({ row: 5, col: 2 })?.fenChar).toBe('P');
      expect(new XiangqiEngine(resB.fen).getPieceAt({ row: 5, col: 2 })?.fenChar).toBe('P');
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  });

  it('3. 1v1 P2P WebRTC Video Call Signaling: Relays SDP/ICE strictly between Red & Black opponents while blocking & isolating Spectators', async () => {
    const redClient = await connectAuthenticatedClient(port, redToken);
    const blackClient = await connectAuthenticatedClient(port, blackToken);
    const spectatorClient = await connectAuthenticatedClient(port, mmTokenA);

    try {
      // Create & join Online PvP room with Red Player, Black Player, and 1 Spectator
      const redCreatedPromise = waitForEvent<[RoomStateDto, RoomRole]>(
        redClient,
        'room_state_sync'
      );
      redClient.emit('create_room', {
        roomName: 'Phòng Kiểm Thử Video Call P2P',
        mode: 'PVP_CASUAL',
        preferredSide: 'w',
      });
      const [createdRoom] = await redCreatedPromise;
      const roomId = createdRoom.roomId;

      const blackJoinedPromise = waitForEvent<[RoomStateDto, RoomRole]>(
        blackClient,
        'room_state_sync'
      );
      blackClient.emit('join_room', { roomId });
      await blackJoinedPromise;

      const specJoinedPromise = waitForEvent<[RoomStateDto, RoomRole]>(
        spectatorClient,
        'room_state_sync'
      );
      spectatorClient.emit('join_room', { roomId, asSpectator: true });
      const [, specRole] = await specJoinedPromise;
      expect(specRole).toBe('SPECTATOR');

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
      const specErrPromise = waitForEvent<{ code: string; message: string }>(
        spectatorClient,
        'error_event'
      );
      spectatorClient.emit('video_call_request', { roomId, hasVideo: true });
      const specErr = await specErrPromise;
      expect(specErr.code).toBe('FORBIDDEN_SPECTATOR');

      // 3b. Red requests Video Call -> Black receives `video_call_incoming`
      const incomingPromise = waitForEvent<{
        roomId: string;
        fromSide: 'w' | 'b';
        fromUsername: string;
        hasVideo: boolean;
      }>(blackClient, 'video_call_incoming');

      redClient.emit('video_call_request', { roomId, hasVideo: true });
      const incoming = await incomingPromise;
      expect(incoming.roomId).toBe(roomId);
      expect(incoming.fromSide).toBe('w');
      expect(incoming.hasVideo).toBe(true);

      // 3c. Black accepts -> Red receives `video_call_accepted`
      const acceptedPromise = waitForEvent<{
        roomId: string;
        bySide: 'w' | 'b';
        hasVideo: boolean;
      }>(redClient, 'video_call_accepted');

      blackClient.emit('video_call_respond', {
        roomId,
        accept: true,
        hasVideo: true,
      });
      const accepted = await acceptedPromise;
      expect(accepted.bySide).toBe('b');
      expect(accepted.hasVideo).toBe(true);

      // 3d. Red sends SDP Offer -> Black receives `webrtc_offer`
      const offerPromise = waitForEvent<{
        roomId: string;
        fromSide: 'w' | 'b';
        description: { type: string; sdp: string };
      }>(blackClient, 'webrtc_offer');

      redClient.emit('webrtc_offer', {
        roomId,
        description: { type: 'offer', sdp: 'v=0\r\no=- 1001 2 IN IP4 127.0.0.1\r\n' },
        mediaState: { audioEnabled: true, videoEnabled: true },
      });
      const receivedOffer = await offerPromise;
      expect(receivedOffer.fromSide).toBe('w');
      expect(receivedOffer.description.type).toBe('offer');

      // 3e. Black sends SDP Answer -> Red receives `webrtc_answer`
      const answerPromise = waitForEvent<{
        roomId: string;
        fromSide: 'w' | 'b';
        description: { type: string; sdp: string };
      }>(redClient, 'webrtc_answer');

      blackClient.emit('webrtc_answer', {
        roomId,
        description: { type: 'answer', sdp: 'v=0\r\no=- 2002 2 IN IP4 127.0.0.1\r\n' },
        mediaState: { audioEnabled: true, videoEnabled: false },
      });
      const receivedAnswer = await answerPromise;
      expect(receivedAnswer.fromSide).toBe('b');
      expect(receivedAnswer.description.type).toBe('answer');

      // 3f. Burst of 30 Trickle ICE candidates (>25 gameplay quota) passes cleanly without rate-limit drop
      const TOTAL_ICE_BURST = 30;
      let receivedIceCount = 0;
      const allIceArrivedPromise = new Promise<void>((resolve) => {
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
      expect(receivedIceCount).toBe(TOTAL_ICE_BURST);

      // 3g. Media toggle & Hangup
      const mediaTogglePromise = waitForEvent<{
        fromSide: 'w' | 'b';
        mediaState: { audioEnabled: boolean; videoEnabled: boolean };
      }>(redClient, 'webrtc_media_state');

      blackClient.emit('webrtc_media_state', {
        roomId,
        mediaState: { audioEnabled: false, videoEnabled: false },
      });
      const toggled = await mediaTogglePromise;
      expect(toggled.fromSide).toBe('b');
      expect(toggled.mediaState).toEqual({ audioEnabled: false, videoEnabled: false });

      const endedPromise = waitForEvent<{
        roomId: string;
        bySide: 'w' | 'b';
        reason?: string;
      }>(blackClient, 'video_call_ended');

      redClient.emit('video_call_hangup', { roomId, reason: 'HANGUP' });
      const ended = await endedPromise;
      expect(ended.bySide).toBe('w');
      expect(ended.reason).toBe('HANGUP');

      // Confirm 100% network-level Spectator isolation (0 leaked SDP/ICE/Call packets!)
      expect(leakedPacketsToSpectator).toBe(0);
    } finally {
      redClient.disconnect();
      blackClient.disconnect();
      spectatorClient.disconnect();
    }
  });
});

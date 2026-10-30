// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - ZUSTAND REAL-TIME GAME, BOARD & SOCKET STORE
// ============================================================================

import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import {
  AiDifficulty,
  ChatChannel,
  ChatMessageDto,
  ClientToServerEvents,
  ClockState,
  Coordinates,
  LobbyRoomSummaryDto,
  RoomRole,
  RoomStateDto,
  ServerToClientEvents,
  Side,
} from '@xiangqi/shared';
import { useAuthStore } from './useAuthStore';

type XiangqiClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface GameStoreState {
  socket: XiangqiClientSocket | null;
  isConnected: boolean;
  latencyMs: number;
  lobbyRooms: LobbyRoomSummaryDto[];
  isMatchmaking: boolean;
  matchmakingQueueSize: number;

  // Active Room & Board State
  roomState: RoomStateDto | null;
  assignedRole: RoomRole | null;
  isFlipped: boolean; // True = Black at bottom (rotated 180 deg), False = Red at bottom
  selectedSquare: Coordinates | null;

  // Replay State (null = Live Board; 0..N = viewing historical step)
  replayStepIndex: number | null;

  // Dual-Channel Chat State
  playerChatMessages: ChatMessageDto[];
  spectatorChatMessages: ChatMessageDto[];
  isPlayerChatMuted: boolean;

  // Notifications & Modals
  pendingDrawOfferFrom: { side: Side; username: string } | null;
  pendingAdjournRequestFrom: { side: Side; username: string } | null;
  toastBanner: { type: 'info' | 'error' | 'success'; text: string } | null;

  // Actions
  connectSocket: (accessToken: string) => void;
  disconnectSocket: () => void;
  toggleFlipBoard: () => void;
  selectSquareOrMove: (coord: Coordinates) => void;
  setReplayStep: (index: number | null) => void;

  // Lobby & Matchmaking Actions
  joinMatchmaking: (totalTimeMs?: number, turnTimeMs?: number) => void;
  leaveMatchmaking: () => void;
  createRoom: (params: {
    roomName: string;
    password?: string;
    mode: 'PVP_RANKED' | 'PVP_CASUAL' | 'PVE_AI';
    aiDifficulty?: AiDifficulty;
    preferredSide?: Side;
    totalTimeMs?: number;
    turnTimeMs?: number;
  }) => void;
  joinRoom: (roomId: string, password?: string, asSpectator?: boolean) => void;
  leaveCurrentRoom: () => void;

  // Match Actions
  offerDraw: () => void;
  respondDraw: (accept: boolean) => void;
  resignMatch: () => void;
  savePveGame: (title?: string) => void;
  undoPveMove: () => void;
  resetPveGame: () => void;
  requestAdjourn: () => void;
  respondAdjourn: (accept: boolean) => void;
  resumeSavedGame: (savedGameId: string) => void;

  // Chat Actions
  sendChatMessage: (channel: ChatChannel, content: string) => void;
  toggleMutePlayerChat: () => void;
  clearToast: () => void;
}

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001');

let pingIntervalHandle: ReturnType<typeof setInterval> | null = null;

export const useGameStore = create<GameStoreState>((set, get) => ({
  socket: null,
  isConnected: false,
  latencyMs: 18,
  lobbyRooms: [],
  isMatchmaking: false,
  matchmakingQueueSize: 0,

  roomState: null,
  assignedRole: null,
  isFlipped: false,
  selectedSquare: null,
  replayStepIndex: null,

  playerChatMessages: [],
  spectatorChatMessages: [],
  isPlayerChatMuted: false,

  pendingDrawOfferFrom: null,
  pendingAdjournRequestFrom: null,
  toastBanner: null,

  clearToast: () => set({ toastBanner: null }),

  connectSocket: (accessToken: string) => {
    const existing = get().socket;
    if (existing) {
      existing.disconnect();
    }

    const socket: XiangqiClientSocket = io(SOCKET_URL, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      set({ isConnected: true });
      socket.emit('get_lobby_rooms');
    });

    socket.on('disconnect', () => {
      set({ isConnected: false });
    });

    socket.on('lobby_rooms_updated', (rooms) => {
      set({ lobbyRooms: rooms });
    });

    socket.on('matchmaking_status', (payload) => {
      set({
        isMatchmaking: payload.searching,
        matchmakingQueueSize: payload.queueSize,
      });
    });

    socket.on('match_found', ({ role }) => {
      set({
        isMatchmaking: false,
        assignedRole: role,
        isFlipped: role === 'BLACK_PLAYER',
        playerChatMessages: [],
        spectatorChatMessages: [],
        replayStepIndex: null,
      });
    });

    socket.on('room_state_sync', (state: RoomStateDto, role: RoomRole) => {
      const prevRoomId = get().roomState?.roomId;
      const isNewRoom = prevRoomId !== state.roomId;

      set({
        roomState: state,
        assignedRole: role,
        // Auto-flip board so Black player sees Black pieces at the bottom on room entry
        isFlipped: isNewRoom ? role === 'BLACK_PLAYER' : get().isFlipped,
        selectedSquare: null,
        replayStepIndex: null,
        isMatchmaking: false,
        playerChatMessages: isNewRoom ? [] : get().playerChatMessages,
        spectatorChatMessages: isNewRoom ? [] : get().spectatorChatMessages,
      });
    });

    socket.on('move_made', (payload) => {
      const currentRoom = get().roomState;
      if (!currentRoom) return;

      // Guard against duplicate move packet delivery
      if (
        currentRoom.fen === payload.fen &&
        currentRoom.lastMove &&
        currentRoom.lastMove.fenAfter === payload.move.fenAfter &&
        currentRoom.lastMove.from.row === payload.move.from.row &&
        currentRoom.lastMove.from.col === payload.move.from.col &&
        currentRoom.lastMove.to.row === payload.move.to.row &&
        currentRoom.lastMove.to.col === payload.move.to.col
      ) {
        return;
      }

      const updatedHistory = [...currentRoom.moveHistory, payload.move];
      set({
        roomState: {
          ...currentRoom,
          fen: payload.fen,
          turn: payload.turn,
          inCheck: payload.inCheck,
          checkedGeneralPos: payload.checkedGeneralPos,
          lastMove: payload.move,
          moveHistory: updatedHistory,
          moveHistoryWxf: updatedHistory.map((m) => m.wxf).join(' '),
          legalMoves: payload.legalMoves,
          clock: payload.clock,
          outcome: payload.outcome,
        },
        selectedSquare: null,
        replayStepIndex: null,
        pendingDrawOfferFrom: null,
      });
    });

    socket.on('clock_sync', (clock: ClockState) => {
      const currentRoom = get().roomState;
      if (!currentRoom) return;
      set({
        roomState: {
          ...currentRoom,
          clock,
        },
      });
    });

    socket.on('game_over', (payload) => {
      const currentRoom = get().roomState;
      if (!currentRoom) return;

      set({
        roomState: {
          ...currentRoom,
          status: 'FINISHED',
          outcome: payload.outcome,
          clock: payload.clock,
          eloChanges: payload.eloChanges ?? currentRoom.eloChanges,
          legalMoves: [],
        },
        pendingDrawOfferFrom: null,
        pendingAdjournRequestFrom: null,
      });

      // Refresh user profile ELO and saved games list
      const authUser = useAuthStore.getState().user;
      if (authUser) {
        useAuthStore.getState().fetchUserProfileAndMatches(authUser.username);
        useAuthStore.getState().fetchSavedGames();
      }
    });

    socket.on('draw_offered', ({ fromSide, fromUsername }) => {
      set({
        pendingDrawOfferFrom: { side: fromSide, username: fromUsername },
      });
    });

    socket.on('draw_declined', () => {
      set({
        pendingDrawOfferFrom: null,
        toastBanner: {
          type: 'info',
          text: 'Đối thủ đã từ chối lời đề nghị hòa cờ.',
        },
      });
    });

    socket.on('adjourn_requested', ({ fromSide, fromUsername }) => {
      set({
        pendingAdjournRequestFrom: { side: fromSide, username: fromUsername },
      });
    });

    socket.on('adjourn_declined', () => {
      set({
        pendingAdjournRequestFrom: null,
        toastBanner: {
          type: 'info',
          text: 'Đối thủ đã từ chối yêu cầu tạm hoãn ván đấu.',
        },
      });
    });

    socket.on('game_saved', (payload) => {
      useAuthStore.getState().fetchSavedGames();
      set({
        roomState: null,
        assignedRole: null,
        selectedSquare: null,
        pendingAdjournRequestFrom: null,
        toastBanner: {
          type: 'success',
          text: payload.message,
        },
      });
    });

    socket.on('player_connection_changed', (payload) => {
      const currentRoom = get().roomState;
      if (!currentRoom) return;

      const updatedRed =
        currentRoom.redPlayer && payload.side === 'w'
          ? {
              ...currentRoom.redPlayer,
              isConnected: payload.isConnected,
              reconnectDeadlineTimestamp: payload.reconnectDeadlineTimestamp,
            }
          : currentRoom.redPlayer;

      const updatedBlack =
        currentRoom.blackPlayer && payload.side === 'b'
          ? {
              ...currentRoom.blackPlayer,
              isConnected: payload.isConnected,
              reconnectDeadlineTimestamp: payload.reconnectDeadlineTimestamp,
            }
          : currentRoom.blackPlayer;

      set({
        roomState: {
          ...currentRoom,
          redPlayer: updatedRed,
          blackPlayer: updatedBlack,
        },
      });
    });

    socket.on('spectators_updated', ({ spectatorCount, spectators }) => {
      const currentRoom = get().roomState;
      if (!currentRoom) return;
      set({
        roomState: {
          ...currentRoom,
          spectatorCount,
          spectators,
        },
      });
    });

    socket.on('chat_message', (msg) => {
      if (msg.channel === 'PLAYER') {
        set((state) => ({
          playerChatMessages: [...state.playerChatMessages, msg],
        }));
      } else {
        set((state) => ({
          spectatorChatMessages: [...state.spectatorChatMessages, msg],
        }));
      }
    });

    socket.on('error_event', ({ message }) => {
      set({
        toastBanner: { type: 'error', text: message },
      });
    });

    if (pingIntervalHandle) {
      clearInterval(pingIntervalHandle);
    }
    pingIntervalHandle = setInterval(() => {
      if (socket.connected) {
        const sent = Date.now();
        socket.emit('ping_check', sent, () => {
          const rtt = Math.max(1, Date.now() - sent);
          set({ latencyMs: rtt });
        });
      }
    }, 5000);

    set({ socket });
  },

  disconnectSocket: () => {
    if (pingIntervalHandle) {
      clearInterval(pingIntervalHandle);
      pingIntervalHandle = null;
    }
    const socket = get().socket;
    if (socket) {
      socket.disconnect();
    }
    set({
      socket: null,
      isConnected: false,
      roomState: null,
      assignedRole: null,
    });
  },

  toggleFlipBoard: () => {
    set((state) => ({ isFlipped: !state.isFlipped }));
  },

  setReplayStep: (index: number | null) => {
    set({ replayStepIndex: index, selectedSquare: null });
  },

  selectSquareOrMove: (coord: Coordinates) => {
    const { roomState, assignedRole, selectedSquare, replayStepIndex, socket } =
      get();

    // Prevent moving when in Replay mode, Spectator mode, or game not active
    if (
      !roomState ||
      !socket ||
      replayStepIndex !== null ||
      roomState.status !== 'PLAYING' ||
      assignedRole === 'SPECTATOR' ||
      assignedRole === null
    ) {
      return;
    }

    const mySide: Side = assignedRole === 'RED_PLAYER' ? 'w' : 'b';
    if (roomState.turn !== mySide) {
      return;
    }

    // Check if the clicked square is a valid destination for the currently selected piece
    if (selectedSquare) {
      const matchingLegalMove = roomState.legalMoves.find(
        (m) =>
          m.from.row === selectedSquare.row &&
          m.from.col === selectedSquare.col &&
          m.to.row === coord.row &&
          m.to.col === coord.col
      );

      if (matchingLegalMove) {
        // Send Move Intent to Authoritative Server with timestamp for Lag Compensation
        socket.emit('make_move', {
          roomId: roomState.roomId,
          from: selectedSquare,
          to: coord,
          clientSentTimestamp: Date.now(),
        });
        set({ selectedSquare: null });
        return;
      }
    }

    // Otherwise check if the clicked square has legal moves for our own piece
    const hasMovesFromSquare = roomState.legalMoves.some(
      (m) => m.from.row === coord.row && m.from.col === coord.col
    );

    if (hasMovesFromSquare) {
      set({ selectedSquare: coord });
    } else {
      set({ selectedSquare: null });
    }
  },

  joinMatchmaking: (totalTimeMs = 30 * 60 * 1000, turnTimeMs = 60 * 1000) => {
    const socket = get().socket;
    if (!socket) return;
    socket.emit('join_matchmaking', { totalTimeMs, turnTimeMs });
  },

  leaveMatchmaking: () => {
    const socket = get().socket;
    if (!socket) return;
    socket.emit('leave_matchmaking');
  },

  createRoom: (params) => {
    const socket = get().socket;
    if (!socket) return;
    socket.emit('create_room', {
      ...params,
      totalTimeMs: params.totalTimeMs ?? 30 * 60 * 1000,
      turnTimeMs: params.turnTimeMs ?? 60 * 1000,
    });
  },

  joinRoom: (roomId, password, asSpectator) => {
    const socket = get().socket;
    if (!socket) return;
    socket.emit('join_room', { roomId, password, asSpectator });
  },

  leaveCurrentRoom: () => {
    const { socket, roomState } = get();
    if (socket && roomState) {
      socket.emit('leave_room', { roomId: roomState.roomId });
    }
    set({
      roomState: null,
      assignedRole: null,
      selectedSquare: null,
      replayStepIndex: null,
      pendingDrawOfferFrom: null,
      pendingAdjournRequestFrom: null,
    });
  },

  offerDraw: () => {
    const { socket, roomState } = get();
    if (socket && roomState) {
      socket.emit('offer_draw', { roomId: roomState.roomId });
      set({
        toastBanner: {
          type: 'info',
          text: 'Đã gửi lời đề nghị hòa cờ tới đối thủ.',
        },
      });
    }
  },

  respondDraw: (accept: boolean) => {
    const { socket, roomState } = get();
    if (socket && roomState) {
      socket.emit('respond_draw', { roomId: roomState.roomId, accept });
      set({ pendingDrawOfferFrom: null });
    }
  },

  resignMatch: () => {
    const { socket, roomState } = get();
    if (socket && roomState) {
      socket.emit('resign', { roomId: roomState.roomId });
    }
  },

  savePveGame: (title?: string) => {
    const { socket, roomState } = get();
    if (socket && roomState) {
      socket.emit('save_pve_game', { roomId: roomState.roomId, title });
    }
  },

  undoPveMove: () => {
    const { socket, roomState } = get();
    if (socket && roomState) {
      socket.emit('undo_pve_move', { roomId: roomState.roomId });
      set({
        selectedSquare: null,
        replayStepIndex: null,
        toastBanner: {
          type: 'info',
          text: 'Đã đi lại nước cờ vừa rồi!',
        },
      });
    }
  },

  resetPveGame: () => {
    const { socket, roomState } = get();
    if (socket && roomState) {
      socket.emit('reset_pve_game', { roomId: roomState.roomId });
      set({
        selectedSquare: null,
        replayStepIndex: null,
        toastBanner: {
          type: 'success',
          text: 'Đã reset bàn cờ về trạng thái khởi đầu mới!',
        },
      });
    }
  },

  requestAdjourn: () => {
    const { socket, roomState } = get();
    if (socket && roomState) {
      socket.emit('request_adjourn', { roomId: roomState.roomId });
      set({
        toastBanner: {
          type: 'info',
          text: 'Đã gửi yêu cầu Xin Tạm Hoãn & Lưu Ván Cờ tới đối thủ.',
        },
      });
    }
  },

  respondAdjourn: (accept: boolean) => {
    const { socket, roomState } = get();
    if (socket && roomState) {
      socket.emit('respond_adjourn', { roomId: roomState.roomId, accept });
      set({ pendingAdjournRequestFrom: null });
    }
  },

  resumeSavedGame: (savedGameId: string) => {
    const socket = get().socket;
    if (socket) {
      socket.emit('resume_saved_game', { savedGameId });
    }
  },

  sendChatMessage: (channel: ChatChannel, content: string) => {
    const { socket, roomState } = get();
    if (socket && roomState && content.trim()) {
      socket.emit('send_chat', {
        roomId: roomState.roomId,
        channel,
        content,
      });
    }
  },

  toggleMutePlayerChat: () => {
    const { socket, roomState, isPlayerChatMuted } = get();
    const nextMuted = !isPlayerChatMuted;
    set({ isPlayerChatMuted: nextMuted });
    if (socket && roomState) {
      socket.emit('toggle_mute_player_chat', {
        roomId: roomState.roomId,
        muted: nextMuted,
      });
    }
  },
}));

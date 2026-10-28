// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - SHARED DOMAIN TYPES, DTOS & SOCKET CONTRACTS
// ============================================================================

/**
 * Active side in Xiangqi FEN notation:
 * 'w' = Red (Tiên / Đỏ - moves first)
 * 'b' = Black (Hậu / Đen)
 */
export type Side = 'w' | 'b';

export type PlayerColorLabel = 'RED' | 'BLACK';

/**
 * 7 standard Xiangqi piece types (case-insensitive canonical code):
 * k = General (Tướng / Soái)
 * a = Advisor (Sĩ)
 * b = Elephant / Bishop (Tượng / Tịnh)
 * n = Horse / Knight (Mã)
 * r = Chariot / Rook (Xe)
 * c = Cannon (Pháo)
 * p = Soldier / Pawn (Tốt / Binh)
 */
export type PieceType = 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p';

/**
 * FEN character representation:
 * Uppercase ('K','A','B','N','R','C','P') for Red ('w')
 * Lowercase ('k','a','b','n','r','c','p') for Black ('b')
 */
export type FenPieceChar =
  | 'K'
  | 'A'
  | 'B'
  | 'N'
  | 'R'
  | 'C'
  | 'P'
  | 'k'
  | 'a'
  | 'b'
  | 'n'
  | 'r'
  | 'c'
  | 'p';

export interface Piece {
  type: PieceType;
  side: Side;
  fenChar: FenPieceChar;
}

/**
 * 0-indexed board coordinates:
 * row: 0..9 (0 = top/Black back rank, 9 = bottom/Red back rank)
 * col: 0..8 (0 = left file a, 8 = right file i from Red's perspective)
 */
export interface Coordinates {
  row: number;
  col: number;
}

export interface MoveIntent {
  from: Coordinates;
  to: Coordinates;
}

export interface ExecutedMove {
  from: Coordinates;
  to: Coordinates;
  piece: Piece;
  captured: Piece | null;
  iccs: string;
  wxf: string;
  vietnameseNotation: string;
  fenBefore: string;
  fenAfter: string;
  zobristHashAfter: string;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isThreefoldRepetition: boolean;
  halfMoveClock: number;
  fullMoveNumber: number;
  timestamp: number;
  redTimeLeftMs?: number;
  blackTimeLeftMs?: number;
}

export type GameEndReason =
  | 'CHECKMATE'
  | 'STALEMATE'
  | 'TIMEOUT'
  | 'RESIGNATION'
  | 'DRAW_AGREEMENT'
  | 'DRAW_REPETITION'
  | 'DRAW_FIFTY_MOVE'
  | 'DRAW_INSUFFICIENT_MATERIAL'
  | 'ADJOURNED'
  | 'ABANDONED';

export interface GameOutcome {
  isOver: boolean;
  winner: Side | 'draw' | null;
  reason: GameEndReason | null;
  inCheck: boolean;
  checkedGeneralPos: Coordinates | null;
}

export interface GameStateSnapshot {
  fen: string;
  board: (Piece | null)[][];
  turn: Side;
  halfMoveClock: number;
  fullMoveNumber: number;
  zobristHash: string;
  positionHashes: string[];
  moveHistory: ExecutedMove[];
  outcome: GameOutcome;
  legalMoves: MoveIntent[];
}

// ============================================================================
// AI ENGINE WORKER TYPES (3 LEVELS)
// ============================================================================

export type AiDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface AiMoveRequest {
  requestId: string;
  fen: string;
  difficulty: AiDifficulty;
  positionHashes?: string[];
  moveHistoryWxf?: string[];
  maxTimeMs?: number;
}

export interface AiMoveResponse {
  requestId: string;
  bestMove: MoveIntent | null;
  score: number;
  depthReached: number;
  nodesEvaluated: number;
  elapsedMs: number;
  fromBook: boolean;
}

// ============================================================================
// AUTH, USER PROFILE & SAVED GAME DTOS
// ============================================================================

export interface UserProfileDto {
  id: string;
  username: string;
  email: string;
  avatarUrl: string;
  eloRating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  createdAt: string;
}

export interface MatchSummaryDto {
  id: string;
  mode: 'PVP_RANKED' | 'PVP_CASUAL' | 'PVE_AI';
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ADJOURNED' | 'ABORTED';
  redPlayer: { id: string; username: string; avatarUrl: string; eloRating: number } | null;
  blackPlayer: { id: string; username: string; avatarUrl: string; eloRating: number } | null;
  aiDifficulty: AiDifficulty | null;
  winnerSide: PlayerColorLabel | null;
  endReason: GameEndReason | null;
  initialFen: string;
  finalFen: string;
  moveHistory: ExecutedMove[];
  moveHistoryWxf: string;
  redEloBefore: number | null;
  blackEloBefore: number | null;
  redEloDelta: number | null;
  blackEloDelta: number | null;
  startedAt: string;
  endedAt: string | null;
}

export interface SavedGameDto {
  id: string;
  matchType: 'PVE' | 'PVP_ADJOURNED';
  status: 'ACTIVE' | 'RESUMED' | 'COMPLETED' | 'EXPIRED';
  title: string | null;
  ownerId: string;
  redPlayer: { id: string; username: string; avatarUrl: string; eloRating: number } | null;
  blackPlayer: { id: string; username: string; avatarUrl: string; eloRating: number } | null;
  playerColor: PlayerColorLabel;
  aiDifficulty: AiDifficulty | null;
  initialFen: string;
  currentFen: string;
  turn: PlayerColorLabel;
  moveHistory: ExecutedMove[];
  moveHistoryWxf: string;
  positionHashes: string[];
  totalTimeMs: number;
  turnTimeMs: number;
  redTimeLeftMs: number;
  blackTimeLeftMs: number;
  redReadyToResume: boolean;
  blackReadyToResume: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// REAL-TIME MULTIPLAYER ROOM, CLOCK, CHAT & SOCKET EVENTS
// ============================================================================

export type RoomRole = 'RED_PLAYER' | 'BLACK_PLAYER' | 'SPECTATOR';

export type ChatChannel = 'PLAYER' | 'SPECTATOR';

export interface ClockState {
  totalTimeMs: number;
  turnTimeMs: number;
  redTimeLeftMs: number;
  blackTimeLeftMs: number;
  currentTurnLeftMs: number;
  activeSide: Side | null;
  lastTickServerTimestamp: number;
  isPaused: boolean;
}

export interface RoomPlayerState {
  userId: string;
  username: string;
  avatarUrl: string;
  eloRating: number;
  side: Side;
  isConnected: boolean;
  disconnectedAt: number | null;
  reconnectDeadlineTimestamp: number | null;
  isMutedPlayerChat: boolean;
  isAi?: boolean;
  aiDifficulty?: AiDifficulty;
}

export interface SpectatorInfo {
  userId: string;
  username: string;
  avatarUrl: string;
  joinedAt: number;
}

export interface ChatMessageDto {
  id: string;
  roomId: string;
  channel: ChatChannel;
  senderId: string;
  senderUsername: string;
  senderAvatarUrl: string;
  senderRole: RoomRole;
  content: string;
  timestamp: number;
}

export interface RoomStateDto {
  roomId: string;
  roomName: string;
  isPrivate: boolean;
  mode: 'PVP_RANKED' | 'PVP_CASUAL' | 'PVE_AI';
  status: 'WAITING' | 'PLAYING' | 'PAUSED_RECONNECT' | 'ADJOURNED' | 'FINISHED';
  redPlayer: RoomPlayerState | null;
  blackPlayer: RoomPlayerState | null;
  spectatorCount: number;
  spectators: SpectatorInfo[];
  fen: string;
  initialFen: string;
  turn: Side;
  inCheck: boolean;
  checkedGeneralPos: Coordinates | null;
  lastMove: ExecutedMove | null;
  moveHistory: ExecutedMove[];
  moveHistoryWxf: string;
  positionHashes: string[];
  legalMoves: MoveIntent[];
  clock: ClockState;
  drawOfferFrom: Side | null;
  adjournRequestFrom: Side | null;
  outcome: GameOutcome;
  eloChanges?: {
    redEloBefore: number;
    redEloAfter: number;
    redDelta: number;
    blackEloBefore: number;
    blackEloAfter: number;
    blackDelta: number;
  } | null;
}

export interface LobbyRoomSummaryDto {
  roomId: string;
  roomName: string;
  isPrivate: boolean;
  mode: 'PVP_RANKED' | 'PVP_CASUAL' | 'PVE_AI';
  status: 'WAITING' | 'PLAYING' | 'PAUSED_RECONNECT' | 'ADJOURNED' | 'FINISHED';
  redPlayer: { username: string; eloRating: number; avatarUrl: string } | null;
  blackPlayer: { username: string; eloRating: number; avatarUrl: string } | null;
  spectatorCount: number;
  totalTimeMs: number;
  turnTimeMs: number;
}

export interface ClientToServerEvents {
  // Matchmaking & Lobby
  join_matchmaking: (payload: { totalTimeMs?: number; turnTimeMs?: number }) => void;
  leave_matchmaking: () => void;
  create_room: (payload: {
    roomName: string;
    password?: string;
    mode: 'PVP_RANKED' | 'PVP_CASUAL' | 'PVE_AI';
    aiDifficulty?: AiDifficulty;
    preferredSide?: Side;
    totalTimeMs?: number;
    turnTimeMs?: number;
    savedGameId?: string;
  }) => void;
  join_room: (payload: { roomId: string; password?: string; asSpectator?: boolean }) => void;
  leave_room: (payload: { roomId: string }) => void;
  get_lobby_rooms: () => void;

  // Authoritative Gameplay Actions (Players Only)
  make_move: (payload: {
    roomId: string;
    from: Coordinates;
    to: Coordinates;
    clientSentTimestamp: number;
  }) => void;
  offer_draw: (payload: { roomId: string }) => void;
  respond_draw: (payload: { roomId: string; accept: boolean }) => void;
  resign: (payload: { roomId: string }) => void;

  // Save, Undo/Reset (PvE) & Adjournment (PvP)
  save_pve_game: (payload: { roomId: string; title?: string }) => void;
  undo_pve_move: (payload: { roomId: string }) => void;
  reset_pve_game: (payload: { roomId: string }) => void;
  request_adjourn: (payload: { roomId: string }) => void;
  respond_adjourn: (payload: { roomId: string; accept: boolean }) => void;
  resume_saved_game: (payload: { savedGameId: string }) => void;

  // Dual-Channel Chat
  send_chat: (payload: { roomId: string; channel: ChatChannel; content: string }) => void;
  toggle_mute_player_chat: (payload: { roomId: string; muted: boolean }) => void;

  // Latency Ping
  ping_check: (clientTimestamp: number, callback: (serverTimestamp: number) => void) => void;
}

export interface ServerToClientEvents {
  lobby_rooms_updated: (rooms: LobbyRoomSummaryDto[]) => void;
  matchmaking_status: (payload: { searching: boolean; queueSize: number; estimatedWaitSec: number }) => void;
  match_found: (payload: { roomId: string; role: RoomRole }) => void;
  room_state_sync: (state: RoomStateDto, assignedRole: RoomRole) => void;
  move_made: (payload: {
    move: ExecutedMove;
    fen: string;
    turn: Side;
    inCheck: boolean;
    checkedGeneralPos: Coordinates | null;
    legalMoves: MoveIntent[];
    clock: ClockState;
    outcome: GameOutcome;
  }) => void;
  clock_sync: (clock: ClockState) => void;
  game_over: (payload: {
    outcome: GameOutcome;
    clock: ClockState;
    eloChanges?: RoomStateDto['eloChanges'];
    matchId?: string;
  }) => void;
  draw_offered: (payload: { fromSide: Side; fromUsername: string }) => void;
  draw_declined: (payload: { bySide: Side }) => void;
  adjourn_requested: (payload: { fromSide: Side; fromUsername: string }) => void;
  adjourn_declined: (payload: { bySide: Side }) => void;
  game_saved: (payload: { savedGameId: string; matchType: 'PVE' | 'PVP_ADJOURNED'; message: string }) => void;
  player_connection_changed: (payload: {
    userId: string;
    side: Side;
    isConnected: boolean;
    reconnectDeadlineTimestamp: number | null;
  }) => void;
  spectators_updated: (payload: { spectatorCount: number; spectators: SpectatorInfo[] }) => void;
  chat_message: (message: ChatMessageDto) => void;
  error_event: (payload: { code: string; message: string }) => void;
}

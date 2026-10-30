// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - MAIN APPLICATION (AUTH, LOBBY & GAME ROOM)
// ============================================================================

import React, { useEffect, useState } from 'react';
import {
  Swords,
  Bot,
  Trophy,
  BookmarkCheck,
  LogOut,
  PlusCircle,
  Eye,
  Flag,
  Handshake,
  PauseCircle,
  Save,
  Wifi,
  Lock,
  Loader2,
  ArrowLeft,
  Undo2,
  RotateCcw,
} from 'lucide-react';
import { AiDifficulty, Side } from '@xiangqi/shared';
import { useAuthStore } from './store/useAuthStore';
import { useGameStore } from './store/useGameStore';
import { XiangqiBoard } from './components/XiangqiBoard';
import { GameClock } from './components/GameClock';
import { MoveHistoryReplay } from './components/MoveHistoryReplay';
import { DualChatPanel } from './components/DualChatPanel';
import { SavedGamesModal } from './components/SavedGamesModal';
import { VideoCallPanel } from './components/VideoCallPanel';

export const App: React.FC = () => {
  const {
    user,
    accessToken,
    isLoadingAuth,
    authError,
    savedGames,
    leaderboard,
    initSession,
    login,
    register,
    logout,
    fetchLeaderboard,
    clearAuthError,
  } = useAuthStore();

  const {
    isConnected,
    latencyMs,
    lobbyRooms,
    isMatchmaking,
    roomState,
    assignedRole,
    pendingDrawOfferFrom,
    pendingAdjournRequestFrom,
    toastBanner,
    connectSocket,
    disconnectSocket,
    joinMatchmaking,
    leaveMatchmaking,
    createRoom,
    joinRoom,
    leaveCurrentRoom,
    offerDraw,
    respondDraw,
    resignMatch,
    savePveGame,
    undoPveMove,
    resetPveGame,
    requestAdjourn,
    respondAdjourn,
    clearToast,
  } = useGameStore();

  // Auth Form State
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  // Lobby Creation State
  const [pveDifficulty, setPveDifficulty] = useState<AiDifficulty>('MEDIUM');
  const [pveSide, setPveSide] = useState<Side>('w');
  const [customRoomName, setCustomRoomName] = useState('');
  const [customRoomPassword, setCustomRoomPassword] = useState('');
  const [customRoomMode, setCustomRoomMode] = useState<'PVP_RANKED' | 'PVP_CASUAL'>('PVP_RANKED');
  const [isSavedModalOpen, setIsSavedModalOpen] = useState(false);

  useEffect(() => {
    initSession();
    fetchLeaderboard();
  }, [initSession, fetchLeaderboard]);

  const currentUserId = user?.id ?? null;

  useEffect(() => {
    if (accessToken && currentUserId) {
      connectSocket(accessToken);
    } else {
      disconnectSocket();
    }
  }, [accessToken, currentUserId, connectSocket, disconnectSocket]);

  useEffect(() => {
    if (!toastBanner) return;
    const timer = setTimeout(() => clearToast(), 4500);
    return () => clearTimeout(timer);
  }, [toastBanner, clearToast]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegisterMode) {
      await register(usernameInput, emailInput, passwordInput);
    } else {
      await login(usernameInput, passwordInput);
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-950 text-amber-400 gap-2 font-bold">
        <Loader2 className="w-6 h-6 animate-spin" />
        Đang khởi tạo Cờ Tướng...
      </div>
    );
  }

  // ==========================================================================
  // VIEW 1: LOGIN / REGISTER SCREEN
  // ==========================================================================
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950 p-4">
        <div className="w-full max-w-md bg-stone-900/95 border border-stone-800 rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-950 border-2 border-amber-500 text-amber-400 text-3xl font-extrabold mb-3 shadow-lg">
              帥
            </div>
            <h1 className="text-2xl font-extrabold text-stone-100 tracking-wide">
              CỜ TƯỚNG
            </h1>
            <p className="text-xs text-stone-400 mt-1">
              Hệ thống Cờ Tướng Trực Tuyến Chuẩn Quốc Tế (Server-Authoritative)
            </p>
          </div>

          {authError && (
            <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-950/90 border border-red-700 text-red-200 text-xs font-medium">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase text-stone-400 mb-1">
                {isRegisterMode ? 'Tên Kỳ Thủ (Username)' : 'Username hoặc Email'}
              </label>
              <input
                type="text"
                required
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder={isRegisterMode ? 'vd: kyvuong_2026' : 'Nhập username hoặc email'}
                className="w-full px-3.5 py-2.5 rounded-lg bg-stone-950 border border-stone-700 text-sm text-stone-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            {isRegisterMode && (
              <div>
                <label className="block text-xs font-bold uppercase text-stone-400 mb-1">
                  Địa chỉ Email
                </label>
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="kythu@example.com"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-stone-950 border border-stone-700 text-sm text-stone-100 focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase text-stone-400 mb-1">
                Mật khẩu
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Tối thiểu 6 ký tự"
                className="w-full px-3.5 py-2.5 rounded-lg bg-stone-950 border border-stone-700 text-sm text-stone-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 font-extrabold text-sm uppercase tracking-wider transition shadow-lg"
            >
              {isRegisterMode ? 'Đăng Ký Tài Khoản (ELO 1200)' : 'Đăng Nhập Kỳ Đài'}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-stone-400">
            {isRegisterMode ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}{' '}
            <button
              type="button"
              onClick={() => {
                clearAuthError();
                setIsRegisterMode(!isRegisterMode);
              }}
              className="text-amber-400 hover:underline font-bold"
            >
              {isRegisterMode ? 'Đăng nhập ngay' : 'Đăng ký miễn phí'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // AUTHENTICATED SHELL (TOP NAVBAR + LOBBY OR GAME ROOM)
  // ==========================================================================
  return (
    <div className="min-h-screen flex flex-col bg-stone-950 text-stone-100">
      {/* Top Enterprise Header */}
      <header className="sticky top-0 z-30 bg-stone-900/95 backdrop-blur border-b border-stone-800 px-4 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-red-950 border border-amber-500 flex items-center justify-center text-amber-400 font-extrabold text-lg">
            帥
          </div>
          <div>
            <h1 className="font-extrabold text-base tracking-wide text-stone-100">
              CỜ TƯỚNG
            </h1>
            <div className="flex items-center gap-2 text-[11px] text-stone-400">
              <span className="inline-flex items-center gap-1">
                <Wifi
                  className={`w-3 h-3 ${
                    isConnected ? 'text-emerald-400' : 'text-red-400'
                  }`}
                />
                {isConnected ? `Trực tuyến (${latencyMs}ms)` : 'Đang kết nối lại...'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Saved & Adjourned Games Button */}
          <button
            type="button"
            onClick={() => setIsSavedModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-700 text-xs font-bold text-amber-300 transition"
          >
            <BookmarkCheck className="w-4 h-4" />
            Ván Cờ Đang Lưu ({savedGames.length})
          </button>

          {/* User Profile & ELO Badge */}
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-stone-950 border border-stone-800">
            <div className="text-right">
              <div className="text-xs font-bold text-stone-100">{user.username}</div>
              <div className="text-[11px] text-amber-400 font-semibold">
                ELO {user.eloRating} • {user.wins}T / {user.draws}H / {user.losses}B
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="p-1.5 rounded hover:bg-stone-800 text-stone-400 hover:text-red-400 transition"
              title="Đăng xuất"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification Banner */}
      {toastBanner && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl border text-xs font-bold flex items-center gap-2 ${
            toastBanner.type === 'error'
              ? 'bg-red-950 border-red-600 text-red-200'
              : toastBanner.type === 'success'
                ? 'bg-emerald-950 border-emerald-600 text-emerald-200'
                : 'bg-amber-950 border-amber-600 text-amber-200'
          }`}
        >
          <span>{toastBanner.text}</span>
        </div>
      )}

      {/* Saved Games Modal */}
      <SavedGamesModal
        isOpen={isSavedModalOpen}
        onClose={() => setIsSavedModalOpen(false)}
      />

      {/* ====================================================================
          VIEW 2: ACTIVE GAME ROOM (BOARD + CLOCK + REPLAY + CHAT + ACTIONS)
         ==================================================================== */}
      {roomState ? (
        <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 lg:px-8 py-3 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch lg:h-[calc(100vh-65px)] lg:overflow-hidden">
          {/* Left Column (50% Screen = 6/12 cols): ONLY Xiangqi Board */}
          <div className="lg:col-span-6 flex items-center justify-center h-full overflow-hidden">
            <XiangqiBoard />
          </div>

          {/* Right Column (50% Screen = 6/12 cols): Dual-Channel Chat at Top + All Match Info Below Chat */}
          <div className="lg:col-span-6 flex flex-col gap-3 w-full h-full overflow-y-auto pr-1">
            {/* Top of Right Column: Dual-Channel Real-Time Chat */}
            <DualChatPanel />

            {/* 1v1 P2P WebRTC Video / Voice Call (Strictly Online PvP Opponents Only) */}
            <VideoCallPanel />

            {/* Below Chat & Video Call: Player Identities & 30-Minute Authoritative Clocks */}
            <GameClock />

            {/* Incoming Draw Offer Prompt */}
            {pendingDrawOfferFrom &&
              assignedRole !== 'SPECTATOR' &&
              ((assignedRole === 'RED_PLAYER' && pendingDrawOfferFrom.side === 'b') ||
                (assignedRole === 'BLACK_PLAYER' && pendingDrawOfferFrom.side === 'w')) && (
                <div className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-amber-950/80 border border-amber-500 text-xs shrink-0">
                  <span className="font-bold text-amber-200">
                    Kỳ thủ <b>{pendingDrawOfferFrom.username}</b> đề nghị Hòa cờ!
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => respondDraw(true)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                    >
                      Đồng Ý Hòa
                    </button>
                    <button
                      type="button"
                      onClick={() => respondDraw(false)}
                      className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold"
                    >
                      Từ Chối
                    </button>
                  </div>
                </div>
              )}

            {/* Incoming PvP Adjournment Request Prompt */}
            {pendingAdjournRequestFrom &&
              assignedRole !== 'SPECTATOR' &&
              ((assignedRole === 'RED_PLAYER' &&
                pendingAdjournRequestFrom.side === 'b') ||
                (assignedRole === 'BLACK_PLAYER' &&
                  pendingAdjournRequestFrom.side === 'w')) && (
                <div className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-sky-950/90 border border-sky-500 text-xs shrink-0">
                  <span className="font-bold text-sky-200">
                    Kỳ thủ <b>{pendingAdjournRequestFrom.username}</b> xin{' '}
                    <b>Tạm Hoãn & Lưu Ván Cờ</b> để đánh tiếp khi rảnh!
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => respondAdjourn(true)}
                      className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-stone-950 font-bold"
                    >
                      Đồng Ý Lưu & Hoãn
                    </button>
                    <button
                      type="button"
                      onClick={() => respondAdjourn(false)}
                      className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold"
                    >
                      Từ Chối
                    </button>
                  </div>
                </div>
              )}

            {/* Game Outcome Banner */}
            {roomState.outcome.isOver && (
              <div className="w-full p-3.5 rounded-xl bg-gradient-to-r from-amber-950/90 via-stone-900 to-amber-950/90 border border-amber-500/80 shadow-xl text-center space-y-1.5 shrink-0">
                <div className="text-sm font-extrabold text-amber-300 uppercase">
                  {roomState.outcome.winner === 'draw'
                    ? 'Ván Đấu Hòa Cờ!'
                    : roomState.outcome.winner === 'w'
                      ? 'Quân Đỏ (Tiên) Chiến Thắng!'
                      : 'Quân Đen (Hậu) Chiến Thắng!'}
                </div>
                <div className="text-xs text-stone-300">
                  Lý do kết thúc: <b>{roomState.outcome.reason}</b>
                </div>
                {roomState.eloChanges && (
                  <div className="flex items-center justify-center gap-6 text-xs font-mono pt-1">
                    <span className="text-red-300">
                      Đỏ ELO: {roomState.eloChanges.redEloBefore} →{' '}
                      <b>{roomState.eloChanges.redEloAfter}</b> (
                      {roomState.eloChanges.redDelta >= 0 ? '+' : ''}
                      {roomState.eloChanges.redDelta})
                    </span>
                    <span className="text-amber-300">
                      Đen ELO: {roomState.eloChanges.blackEloBefore} →{' '}
                      <b>{roomState.eloChanges.blackEloAfter}</b> (
                      {roomState.eloChanges.blackDelta >= 0 ? '+' : ''}
                      {roomState.eloChanges.blackDelta})
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Move Notation & Step-by-Step Replay Panel */}
            <MoveHistoryReplay />

            {/* Match Control Action Bar */}
            <div className="w-full flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-stone-900 border border-stone-800 shrink-0">
              <button
                type="button"
                onClick={leaveCurrentRoom}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-bold transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Về Sảnh Chính
              </button>

              {assignedRole !== 'SPECTATOR' && (
                <div className="flex flex-wrap items-center gap-2">
                  {roomState.mode === 'PVE_AI' ? (
                    <>
                      <button
                        type="button"
                        onClick={undoPveMove}
                        disabled={roomState.moveHistory.length === 0}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-stone-950 text-xs font-extrabold transition shadow"
                        title="Đi lại / Reset nước cờ vừa đi"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        Đi Lại Nước Cờ
                      </button>

                      <button
                        type="button"
                        onClick={resetPveGame}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition shadow"
                        title="Reset toàn bộ bàn cờ để đánh lại từ đầu"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reset Bàn Cờ
                      </button>

                      {roomState.status === 'PLAYING' && (
                        <button
                          type="button"
                          onClick={() => savePveGame()}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow"
                        >
                          <Save className="w-3.5 h-3.5" />
                          Lưu & Thoát
                        </button>
                      )}
                    </>
                  ) : (
                    roomState.status === 'PLAYING' && (
                      <>
                        <button
                          type="button"
                          onClick={requestAdjourn}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition"
                          title="Xin đối thủ tạm hoãn và lưu ván cờ để đánh tiếp khi rảnh"
                        >
                          <PauseCircle className="w-3.5 h-3.5" />
                          Xin Tạm Hoãn & Lưu
                        </button>

                        <button
                          type="button"
                          onClick={offerDraw}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-bold transition"
                        >
                          <Handshake className="w-3.5 h-3.5" />
                          Cầu Hòa
                        </button>
                      </>
                    )
                  )}

                  {roomState.status === 'PLAYING' && (
                    <button
                      type="button"
                      onClick={resignMatch}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-900/80 hover:bg-red-800 text-red-100 text-xs font-bold transition"
                    >
                      <Flag className="w-3.5 h-3.5" />
                      Đầu Hàng
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      ) : (
        /* ====================================================================
           VIEW 3: MAIN LOBBY (MATCHMAKING, PVE AI, CUSTOM ROOM & LEADERBOARD)
           ==================================================================== */
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left 8 Columns: Matchmaking, PvE Setup, Custom Room, Live Rooms */}
          <div className="lg:col-span-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card 1: Quick ELO Ranked Matchmaking */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-red-950/60 via-stone-900 to-stone-900 border border-red-800/50 shadow-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-amber-400 font-extrabold text-sm uppercase tracking-wider mb-1">
                    <Swords className="w-4 h-4" />
                    Tìm Trận Xếp Hạng (ELO Matchmaking)
                  </div>
                  <p className="text-xs text-stone-400 leading-relaxed">
                    Hệ thống tự động ghép cặp kỳ thủ có mức điểm ELO tương đồng.
                    Đồng hồ chuẩn 30 phút tổng / 60 giây mỗi nước.
                  </p>
                </div>

                <div className="mt-5">
                  {isMatchmaking ? (
                    <button
                      type="button"
                      onClick={leaveMatchmaking}
                      className="w-full py-2.5 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold text-xs uppercase flex items-center justify-center gap-2 transition"
                    >
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Đang Tìm Đối Thủ... (Hủy)
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => joinMatchmaking()}
                      className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 font-extrabold text-xs uppercase tracking-wider transition shadow-lg"
                    >
                      Tìm Trận Nhanh Ngay
                    </button>
                  )}
                </div>
              </div>

              {/* Card 2: Play vs AI Worker (3 Levels) */}
              <div className="p-5 rounded-2xl bg-stone-900 border border-stone-800 shadow-xl flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-sm uppercase tracking-wider">
                    <Bot className="w-4 h-4" />
                    Luyện Tập Với Máy (AI Worker 3 Cấp Độ)
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {(['EASY', 'MEDIUM', 'HARD'] as AiDifficulty[]).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setPveDifficulty(lvl)}
                        className={`py-1.5 rounded-lg text-xs font-bold border transition ${
                          pveDifficulty === lvl
                            ? 'bg-emerald-600 text-white border-emerald-500'
                            : 'bg-stone-950 text-stone-400 border-stone-800 hover:bg-stone-800'
                        }`}
                      >
                        {lvl === 'EASY'
                          ? 'Dễ'
                          : lvl === 'MEDIUM'
                            ? 'Trung Bình'
                            : 'Khó'}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPveSide('w')}
                      className={`py-1.5 rounded-lg text-xs font-bold border transition ${
                        pveSide === 'w'
                          ? 'bg-red-900/70 text-red-200 border-red-600'
                          : 'bg-stone-950 text-stone-400 border-stone-800'
                      }`}
                    >
                      Cầm Đỏ (Đi Tiên)
                    </button>
                    <button
                      type="button"
                      onClick={() => setPveSide('b')}
                      className={`py-1.5 rounded-lg text-xs font-bold border transition ${
                        pveSide === 'b'
                          ? 'bg-stone-700 text-stone-100 border-stone-500'
                          : 'bg-stone-950 text-stone-400 border-stone-800'
                      }`}
                    >
                      Cầm Đen (Đi Hậu)
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    createRoom({
                      roomName: `PvE (${pveDifficulty}) - ${user.username}`,
                      mode: 'PVE_AI',
                      aiDifficulty: pveDifficulty,
                      preferredSide: pveSide,
                    })
                  }
                  className="mt-4 w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs uppercase tracking-wider transition"
                >
                  Bắt Đầu Ván Đấu Với AI
                </button>
              </div>
            </div>

            {/* Card 3: Create Custom PvP Room */}
            <div className="p-5 rounded-2xl bg-stone-900 border border-stone-800 shadow-lg">
              <div className="flex items-center gap-2 text-amber-400 font-extrabold text-xs uppercase tracking-wider mb-3">
                <PlusCircle className="w-4 h-4" />
                Tạo Phòng Đấu Tùy Chỉnh
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <input
                  type="text"
                  value={customRoomName}
                  onChange={(e) => setCustomRoomName(e.target.value)}
                  placeholder="Tên phòng đấu..."
                  className="px-3 py-2 rounded-lg bg-stone-950 border border-stone-800 text-xs text-stone-100 focus:outline-none focus:border-amber-500"
                />
                <input
                  type="password"
                  value={customRoomPassword}
                  onChange={(e) => setCustomRoomPassword(e.target.value)}
                  placeholder="Mật khẩu (để trống nếu công khai)"
                  className="px-3 py-2 rounded-lg bg-stone-950 border border-stone-800 text-xs text-stone-100 focus:outline-none focus:border-amber-500"
                />
                <select
                  value={customRoomMode}
                  onChange={(e) =>
                    setCustomRoomMode(e.target.value as 'PVP_RANKED' | 'PVP_CASUAL')
                  }
                  className="px-3 py-2 rounded-lg bg-stone-950 border border-stone-800 text-xs text-stone-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="PVP_RANKED">Đấu Xếp Hạng (Tính ELO)</option>
                  <option value="PVP_CASUAL">Đấu Giao Hữu (Không ELO)</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    createRoom({
                      roomName: customRoomName || `Kỳ Đài của ${user.username}`,
                      password: customRoomPassword || undefined,
                      mode: customRoomMode,
                      preferredSide: 'w',
                    })
                  }
                  className="py-2 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-extrabold text-xs uppercase transition"
                >
                  Tạo Phòng
                </button>
              </div>
            </div>

            {/* Card 4: Active Rooms List (Play or Spectate) */}
            <div className="p-5 rounded-2xl bg-stone-900 border border-stone-800 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-stone-200">
                  Sảnh Phòng Đang Hoạt Động ({lobbyRooms.length})
                </h2>
              </div>

              {lobbyRooms.length === 0 ? (
                <div className="text-center py-8 text-xs text-stone-500 italic">
                  Hiện chưa có phòng nào đang mở. Hãy bấm <b>Tìm Trận Nhanh</b>{' '}
                  hoặc <b>Tạo Phòng</b>!
                </div>
              ) : (
                <div className="space-y-2.5">
                  {lobbyRooms.map((rm) => (
                    <div
                      key={rm.roomId}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-stone-950 border border-stone-800 hover:border-stone-700 transition"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          {rm.isPrivate && (
                            <Lock className="w-3.5 h-3.5 text-amber-400" />
                          )}
                          <span className="font-bold text-sm text-stone-100">
                            {rm.roomName}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-stone-800 text-[10px] font-bold text-amber-400 uppercase">
                            {rm.mode}
                          </span>
                        </div>
                        <div className="text-xs text-stone-400 mt-1 flex items-center gap-3">
                          <span>
                            Đỏ:{' '}
                            <b className="text-red-300">
                              {rm.redPlayer
                                ? `${rm.redPlayer.username} (${rm.redPlayer.eloRating})`
                                : 'Đang chờ...'}
                            </b>
                          </span>
                          <span>vs</span>
                          <span>
                            Đen:{' '}
                            <b className="text-amber-200">
                              {rm.blackPlayer
                                ? `${rm.blackPlayer.username} (${rm.blackPlayer.eloRating})`
                                : 'Đang chờ...'}
                            </b>
                          </span>
                          <span>•</span>
                          <span className="inline-flex items-center gap-1 text-stone-400">
                            <Eye className="w-3 h-3" /> {rm.spectatorCount} xem
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {rm.status === 'WAITING' && (
                          <button
                            type="button"
                            onClick={() => {
                              const pass = rm.isPrivate
                                ? window.prompt('Nhập mật khẩu phòng:') || ''
                                : undefined;
                              joinRoom(rm.roomId, pass, false);
                            }}
                            className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold text-xs transition"
                          >
                            Vào Thách Đấu
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => joinRoom(rm.roomId, undefined, true)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 font-semibold text-xs border border-stone-700 transition"
                        >
                          <Eye className="w-3.5 h-3.5 text-amber-400" />
                          Xem Trực Tiếp
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right 4 Columns: ELO Leaderboard */}
          <div className="lg:col-span-4 space-y-6">
            <div className="p-5 rounded-2xl bg-stone-900 border border-stone-800 shadow-lg">
              <div className="flex items-center gap-2 text-amber-400 font-extrabold text-sm uppercase tracking-wider mb-4">
                <Trophy className="w-4 h-4" />
                Bảng Phong Thần (Top ELO)
              </div>

              <div className="space-y-2">
                {leaderboard.length === 0 ? (
                  <div className="text-xs text-stone-500 italic py-4 text-center">
                    Đang cập nhật danh sách cao thủ...
                  </div>
                ) : (
                  leaderboard.slice(0, 10).map((entry, idx) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-stone-950 border border-stone-800/80 text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center font-extrabold text-[11px] ${
                            idx === 0
                              ? 'bg-amber-500 text-stone-950'
                              : idx === 1
                                ? 'bg-stone-300 text-stone-950'
                                : idx === 2
                                  ? 'bg-amber-700 text-white'
                                  : 'bg-stone-800 text-stone-400'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div>
                          <div className="font-bold text-stone-100">
                            {entry.username}
                          </div>
                          <div className="text-[10px] text-stone-500">
                            {entry.wins}T / {entry.draws}H / {entry.losses}B
                          </div>
                        </div>
                      </div>
                      <span className="font-mono font-extrabold text-amber-400">
                        {entry.eloRating}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </main>
      )}
    </div>
  );
};

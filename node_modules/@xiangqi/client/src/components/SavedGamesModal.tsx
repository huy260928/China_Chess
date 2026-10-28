// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - SAVED GAMES & ADJOURNED MATCHES MODAL
// Allows players to inspect, resume, or delete saved PvE games and
// mutually adjourned PvP matches.
// ============================================================================

import React, { useEffect } from 'react';
import {
  BookmarkCheck,
  Play,
  Trash2,
  X,
  Clock,
  Bot,
  Users,
} from 'lucide-react';
import { SavedGameDto } from '@xiangqi/shared';
import { useAuthStore } from '../store/useAuthStore';
import { useGameStore } from '../store/useGameStore';

interface SavedGamesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SavedGamesModal: React.FC<SavedGamesModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    savedGames,
    fetchSavedGames,
    deleteSavedGame,
    markReadyPvpSavedGame,
  } = useAuthStore();
  const { resumeSavedGame } = useGameStore();

  useEffect(() => {
    if (isOpen) {
      fetchSavedGames();
    }
  }, [isOpen, fetchSavedGames]);

  if (!isOpen) return null;

  const handleResume = async (game: SavedGameDto) => {
    if (game.matchType === 'PVP_ADJOURNED') {
      await markReadyPvpSavedGame(game.id);
    }
    resumeSavedGame(game.id);
    onClose();
  };

  const formatMinutes = (ms: number) => {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}p ${secs}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-stone-950 border-b border-stone-800">
          <div className="flex items-center gap-2.5">
            <BookmarkCheck className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-extrabold text-stone-100 uppercase tracking-wide">
              Ván Cờ Đang Lưu & Tạm Hoãn ({savedGames.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Saved Games List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {savedGames.length === 0 ? (
            <div className="text-center py-12 text-stone-400 text-sm">
              Bạn chưa có ván cờ nào đang lưu. Trong lúc đấu với Máy (PvE) hoặc
              đấu Online (PvP), bạn có thể bấm <b>Lưu & Thoát</b> hoặc{' '}
              <b>Xin Tạm Hoãn</b> để lưu lại và chơi tiếp khi rảnh!
            </div>
          ) : (
            savedGames.map((game) => (
              <div
                key={game.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-stone-950/90 border border-stone-800 hover:border-amber-600/50 transition"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                        game.matchType === 'PVE'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                          : 'bg-sky-950 text-sky-300 border border-sky-700/60'
                      }`}
                    >
                      {game.matchType === 'PVE' ? (
                        <>
                          <Bot className="w-3 h-3" /> Đấu Với Máy ({game.aiDifficulty})
                        </>
                      ) : (
                        <>
                          <Users className="w-3 h-3" /> PvP Tạm Hoãn
                        </>
                      )}
                    </span>

                    <span className="font-bold text-sm text-stone-100">
                      {game.title || 'Ván cờ đã lưu'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-stone-400">
                    <span>
                      Số nước đã đi: <b>{game.moveHistory.length}</b>
                    </span>
                    <span>•</span>
                    <span>
                      Lượt kế tiếp:{' '}
                      <b
                        className={
                          game.turn === 'RED' ? 'text-red-400' : 'text-amber-300'
                        }
                      >
                        {game.turn === 'RED' ? 'Đỏ' : 'Đen'}
                      </b>
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-400" />
                      Đỏ còn {formatMinutes(game.redTimeLeftMs)} / Đen còn{' '}
                      {formatMinutes(game.blackTimeLeftMs)}
                    </span>
                  </div>

                  <div className="text-[11px] text-stone-500 font-mono truncate max-w-md">
                    FEN: {game.currentFen}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleResume(game)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold text-xs transition shadow"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Chơi Tiếp
                  </button>

                  {game.matchType === 'PVE' && (
                    <button
                      type="button"
                      onClick={() => deleteSavedGame(game.id)}
                      className="p-2 rounded-lg bg-stone-800 hover:bg-red-900/70 text-stone-300 hover:text-red-200 transition"
                      title="Xóa ván cờ lưu"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

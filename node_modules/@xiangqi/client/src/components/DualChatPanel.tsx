// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - DUAL-CHANNEL CHAT & LIVE SPECTATOR LIST
// 1. PLAYER Channel (Between Red & Black players, with Mute Opponent toggle)
// 2. SPECTATOR Channel (Open commentary for Spectators & Players)
// 3. Spectators Tab (Displays real-time spectator count and viewer list)
// ============================================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  MessageSquare,
  Users,
  Send,
  Volume2,
  VolumeX,
  Eye,
  Swords,
} from 'lucide-react';
import { ChatChannel } from '@xiangqi/shared';
import { useGameStore } from '../store/useGameStore';

export const DualChatPanel: React.FC = () => {
  const {
    roomState,
    assignedRole,
    playerChatMessages,
    spectatorChatMessages,
    isPlayerChatMuted,
    sendChatMessage,
    toggleMutePlayerChat,
  } = useGameStore();

  const isSpectator = assignedRole === 'SPECTATOR';
  const [activeTab, setActiveTab] = useState<'PLAYER' | 'SPECTATOR' | 'VIEWERS'>(
    isSpectator ? 'SPECTATOR' : 'PLAYER'
  );
  const [inputText, setInputText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSpectator && activeTab === 'PLAYER') {
      setActiveTab('SPECTATOR');
    }
  }, [isSpectator, activeTab]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [playerChatMessages.length, spectatorChatMessages.length, activeTab]);

  if (!roomState) return null;

  const activeMessages =
    activeTab === 'PLAYER' ? playerChatMessages : spectatorChatMessages;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || activeTab === 'VIEWERS') return;

    const targetChannel: ChatChannel =
      activeTab === 'PLAYER' ? 'PLAYER' : 'SPECTATOR';
    sendChatMessage(targetChannel, inputText);
    setInputText('');
  };

  return (
    <div className="flex flex-col bg-stone-900/95 border border-stone-800 rounded-xl overflow-hidden shadow-lg h-56 lg:h-60 shrink-0">
      {/* Channel Tabs & Mute Toggle */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-stone-950 border-b border-stone-800">
        <div className="flex items-center gap-1">
          {!isSpectator && (
            <button
              type="button"
              onClick={() => setActiveTab('PLAYER')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'PLAYER'
                  ? 'bg-amber-600 text-stone-950'
                  : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
              }`}
            >
              <Swords className="w-3.5 h-3.5" />
              Kênh Kỳ Thủ ({playerChatMessages.length})
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('SPECTATOR')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'SPECTATOR'
                ? 'bg-amber-600 text-stone-950'
                : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Kênh Khán Giả ({spectatorChatMessages.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('VIEWERS')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'VIEWERS'
                ? 'bg-amber-600 text-stone-950'
                : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Khán Giả ({roomState.spectatorCount})
          </button>
        </div>

        {/* Mute Opponent Button (Player Channel Only) */}
        {!isSpectator && activeTab === 'PLAYER' && (
          <button
            type="button"
            onClick={toggleMutePlayerChat}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold border transition ${
              isPlayerChatMuted
                ? 'bg-red-950/70 text-red-300 border-red-700/60'
                : 'bg-stone-800 text-stone-300 border-stone-700 hover:bg-stone-700'
            }`}
            title="Tắt/Bật nhận tin nhắn từ đối thủ"
          >
            {isPlayerChatMuted ? (
              <>
                <VolumeX className="w-3.5 h-3.5" /> Đã Mute
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5" /> Mute
              </>
            )}
          </button>
        )}
      </div>

      {/* Body: Either Spectator List or Chat Messages */}
      {activeTab === 'VIEWERS' ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
          {roomState.spectators.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-stone-500 italic gap-1">
              <Eye className="w-5 h-5" />
              Hiện chưa có khán giả nào đang theo dõi.
            </div>
          ) : (
            roomState.spectators.map((spec) => (
              <div
                key={`${spec.userId}-${spec.joinedAt}`}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-stone-800/60 border border-stone-800"
              >
                <div className="flex items-center gap-2">
                  <Eye className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-semibold text-stone-200">
                    {spec.username}
                  </span>
                </div>
                <span className="text-[11px] text-stone-500">Đang xem</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
            {activeMessages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-stone-500 italic text-center px-4">
                {activeTab === 'PLAYER'
                  ? 'Kênh trò chuyện riêng giữa 2 kỳ thủ. Hãy gửi lời chào hợp lễ!'
                  : 'Kênh bình luận trực tiếp dành cho khán giả và kỳ thủ trong phòng.'}
              </div>
            ) : (
              activeMessages.map((msg) => (
                <div
                  key={msg.id}
                  className="px-2.5 py-1.5 rounded-lg bg-stone-800/50 border border-stone-800/80"
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span
                      className={`font-bold ${
                        msg.senderRole === 'RED_PLAYER'
                          ? 'text-red-400'
                          : msg.senderRole === 'BLACK_PLAYER'
                            ? 'text-amber-300'
                            : 'text-sky-400'
                      }`}
                    >
                      [{msg.senderRole === 'RED_PLAYER' ? 'Đỏ' : msg.senderRole === 'BLACK_PLAYER' ? 'Đen' : 'Khán giả'}] {msg.senderUsername}
                    </span>
                    <span className="text-[10px] text-stone-500 font-mono">
                      {new Date(msg.timestamp).toLocaleTimeString('vi-VN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-stone-200 break-words">{msg.content}</p>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input Form (Rate-Limited 3 msg / 5s & Profanity Filtered on Server) */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 p-2 bg-stone-950 border-t border-stone-800"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              maxLength={300}
              placeholder={
                activeTab === 'PLAYER'
                  ? 'Nhắn tin cho đối thủ (tối đa 3 tin/5s)...'
                  : 'Bình luận kênh khán giả...'
              }
              className="flex-1 px-3 py-1.5 rounded-lg bg-stone-900 border border-stone-700 text-xs text-stone-100 placeholder-stone-500 focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-stone-950 font-bold text-xs flex items-center gap-1 transition"
            >
              <Send className="w-3.5 h-3.5" />
              Gửi
            </button>
          </form>
        </>
      )}
    </div>
  );
};

// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - ZUSTAND AUTHENTICATION & PROFILE STORE
// ============================================================================

import { create } from 'zustand';
import {
  MatchSummaryDto,
  SavedGameDto,
  UserProfileDto,
} from '@xiangqi/shared';

interface LeaderboardEntry {
  id: string;
  username: string;
  avatarUrl: string;
  eloRating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
}

interface AuthState {
  user: UserProfileDto | null;
  accessToken: string | null;
  isLoadingAuth: boolean;
  authError: string | null;
  savedGames: SavedGameDto[];
  leaderboard: LeaderboardEntry[];
  matchHistory: MatchSummaryDto[];

  initSession: () => Promise<void>;
  login: (usernameOrEmail: string, password: string) => Promise<boolean>;
  register: (
    username: string,
    email: string,
    password: string
  ) => Promise<boolean>;
  logout: () => Promise<void>;
  fetchSavedGames: () => Promise<void>;
  deleteSavedGame: (id: string) => Promise<void>;
  markReadyPvpSavedGame: (id: string) => Promise<boolean>;
  fetchLeaderboard: () => Promise<void>;
  fetchUserProfileAndMatches: (username: string) => Promise<void>;
  clearAuthError: () => void;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken:
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('xiangqi_at')
      : null,
  isLoadingAuth: true,
  authError: null,
  savedGames: [],
  leaderboard: [],
  matchHistory: [],

  clearAuthError: () => set({ authError: null }),

  initSession: async () => {
    set({ isLoadingAuth: true });
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        const data = (await res.json()) as {
          accessToken: string;
          user: UserProfileDto;
        };
        localStorage.setItem('xiangqi_at', data.accessToken);
        set({
          user: data.user,
          accessToken: data.accessToken,
          isLoadingAuth: false,
          authError: null,
        });
        await get().fetchSavedGames();
        return;
      }

      localStorage.removeItem('xiangqi_at');
      set({ user: null, accessToken: null, isLoadingAuth: false });
    } catch {
      set({ isLoadingAuth: false });
    }
  },

  login: async (usernameOrEmail, password) => {
    set({ authError: null, isLoadingAuth: true });
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ usernameOrEmail, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        set({
          authError: data.message || 'Đăng nhập thất bại.',
          isLoadingAuth: false,
        });
        return false;
      }

      localStorage.setItem('xiangqi_at', data.accessToken);
      set({
        user: data.user,
        accessToken: data.accessToken,
        isLoadingAuth: false,
        authError: null,
      });
      await get().fetchSavedGames();
      return true;
    } catch {
      set({
        authError: 'Không thể kết nối đến máy chủ.',
        isLoadingAuth: false,
      });
      return false;
    }
  },

  register: async (username, email, password) => {
    set({ authError: null, isLoadingAuth: true });
    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        set({
          authError: data.message || 'Đăng ký thất bại.',
          isLoadingAuth: false,
        });
        return false;
      }

      localStorage.setItem('xiangqi_at', data.accessToken);
      set({
        user: data.user,
        accessToken: data.accessToken,
        isLoadingAuth: false,
        authError: null,
      });
      return true;
    } catch {
      set({
        authError: 'Không thể kết nối đến máy chủ.',
        isLoadingAuth: false,
      });
      return false;
    }
  },

  logout: async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      localStorage.removeItem('xiangqi_at');
      set({
        user: null,
        accessToken: null,
        savedGames: [],
        matchHistory: [],
      });
    }
  },

  fetchSavedGames: async () => {
    const token = get().accessToken;
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/saved-games`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.ok) {
        const data = (await res.json()) as { savedGames: SavedGameDto[] };
        set({ savedGames: data.savedGames });
      }
    } catch (err) {
      console.error('[fetchSavedGames error]:', err);
    }
  },

  deleteSavedGame: async (id: string) => {
    const token = get().accessToken;
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/saved-games/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.ok) {
        set((state) => ({
          savedGames: state.savedGames.filter((g) => g.id !== id),
        }));
      }
    } catch (err) {
      console.error('[deleteSavedGame error]:', err);
    }
  },

  markReadyPvpSavedGame: async (id: string) => {
    const token = get().accessToken;
    if (!token) return false;

    try {
      const res = await fetch(`${API_BASE}/api/saved-games/${id}/ready-pvp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.ok) {
        await get().fetchSavedGames();
        return true;
      }
    } catch (err) {
      console.error('[markReadyPvpSavedGame error]:', err);
    }
    return false;
  },

  fetchLeaderboard: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/profile/leaderboard`);
      if (res.ok) {
        const data = (await res.json()) as { leaderboard: LeaderboardEntry[] };
        set({ leaderboard: data.leaderboard });
      }
    } catch (err) {
      console.error('[fetchLeaderboard error]:', err);
    }
  },

  fetchUserProfileAndMatches: async (username: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/profile/${encodeURIComponent(username)}`);
      if (res.ok) {
        const data = (await res.json()) as {
          profile: UserProfileDto;
          matchHistory: MatchSummaryDto[];
        };
        set((state) => ({
          matchHistory: data.matchHistory,
          user:
            state.user && state.user.id === data.profile.id
              ? { ...state.user, ...data.profile }
              : state.user,
        }));
      }
    } catch (err) {
      console.error('[fetchUserProfileAndMatches error]:', err);
    }
  },
}));

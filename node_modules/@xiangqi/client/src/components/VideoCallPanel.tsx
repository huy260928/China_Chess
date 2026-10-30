// ============================================================================
// XIANGQI ENTERPRISE PLATFORM - 1v1 P2P WEBRTC VIDEO & VOICE CALL PANEL
// Architecture:
// - Strictly isolated between RED_PLAYER and BLACK_PLAYER in Online PvP matches
//   (Spectators & PvE AI rooms are excluded at both UI and Server Signaling layers)
// - Native Browser RTCPeerConnection (P2P Media) + Socket.IO Signaling
// - Trickle ICE with Pre-RemoteDescription Candidate Queuing
// - 3-Tier Graceful Hardware Fallback:
//     Camera + Mic -> Audio-Only Mic -> Receive-Only Stream
// - Non-intrusive Layout: Docked in Right Column, Floating PiP Overlay, or
//   Minimized Audio Bar (preserving continuous audio without DOM remounting)
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  PictureInPicture2,
  ShieldCheck,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  PeerMediaStateDto,
  Side,
  WebRtcIceCandidateDto,
  WebRtcSessionDescriptionDto,
} from '@xiangqi/shared';
import { useGameStore } from '../store/useGameStore';

type CallPhase =
  | 'IDLE'
  | 'OUTGOING_RINGING'
  | 'INCOMING_RINGING'
  | 'CONNECTING'
  | 'CONNECTED';

const RING_TIMEOUT_MS = 30000;

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;

  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

function formatCallDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const VideoCallPanel: React.FC = () => {
  // Narrow selectors prevent periodic `clock_sync` store updates from re-rendering video feeds
  const socket = useGameStore((s) => s.socket);
  const assignedRole = useGameStore((s) => s.assignedRole);
  const roomId = useGameStore((s) => s.roomState?.roomId ?? null);
  const roomMode = useGameStore((s) => s.roomState?.mode ?? null);
  const roomStatus = useGameStore((s) => s.roomState?.status ?? null);
  const activeTurn = useGameStore((s) => s.roomState?.turn ?? 'w');
  const redPlayer = useGameStore((s) => s.roomState?.redPlayer ?? null);
  const blackPlayer = useGameStore((s) => s.roomState?.blackPlayer ?? null);

  const [callPhase, setCallPhase] = useState<CallPhase>('IDLE');
  const [incomingCaller, setIncomingCaller] = useState<{
    fromSide: Side;
    fromUsername: string;
    hasVideo: boolean;
  } | null>(null);

  const [localMediaState, setLocalMediaState] = useState<PeerMediaStateDto>({
    audioEnabled: true,
    videoEnabled: true,
  });
  const [remoteMediaState, setRemoteMediaState] = useState<PeerMediaStateDto>({
    audioEnabled: true,
    videoEnabled: true,
  });

  const [isRemoteSpeakerMuted, setIsRemoteSpeakerMuted] = useState(false);
  const [isFloatingPip, setIsFloatingPip] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingIceCandidatesRef = useRef<WebRtcIceCandidateDto[]>([]);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outgoingPrefersVideoRef = useRef<boolean>(true);
  const localMediaStateRef = useRef<PeerMediaStateDto>(localMediaState);
  localMediaStateRef.current = localMediaState;

  const localVideoElRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoElRef = useRef<HTMLVideoElement | null>(null);

  const isEligiblePvpPlayer =
    Boolean(roomId) &&
    roomMode !== null &&
    roomMode !== 'PVE_AI' &&
    (assignedRole === 'RED_PLAYER' || assignedRole === 'BLACK_PLAYER');

  const mySide: Side = assignedRole === 'BLACK_PLAYER' ? 'b' : 'w';
  const myProfile = mySide === 'w' ? redPlayer : blackPlayer;
  const opponentProfile = mySide === 'w' ? blackPlayer : redPlayer;

  const iceConfig = useMemo<RTCConfiguration>(
    () => ({
      iceServers: buildIceServers(),
      iceCandidatePoolSize: 4,
    }),
    []
  );

  const syncVideoElements = useCallback(() => {
    if (localVideoElRef.current && localStreamRef.current) {
      if (localVideoElRef.current.srcObject !== localStreamRef.current) {
        localVideoElRef.current.srcObject = localStreamRef.current;
      }
      localVideoElRef.current.play().catch(() => undefined);
    }
    if (remoteVideoElRef.current && remoteStreamRef.current) {
      if (remoteVideoElRef.current.srcObject !== remoteStreamRef.current) {
        remoteVideoElRef.current.srcObject = remoteStreamRef.current;
      }
      remoteVideoElRef.current.play().catch(() => undefined);
    }
  }, []);

  const cleanupCallResources = useCallback((notice?: string) => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }

    pendingIceCandidatesRef.current = [];

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      try {
        pcRef.current.close();
      } catch {
        // Ignore close errors
      }
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      }
      localStreamRef.current = null;
    }

    remoteStreamRef.current = null;

    if (localVideoElRef.current) {
      localVideoElRef.current.srcObject = null;
    }
    if (remoteVideoElRef.current) {
      remoteVideoElRef.current.srcObject = null;
    }

    setCallPhase('IDLE');
    setIncomingCaller(null);
    setCallSeconds(0);
    setIsMinimized(false);
    setIsFloatingPip(false);
    if (notice !== undefined) {
      setStatusNotice(notice);
    }
  }, []);

  /**
   * 3-Tier Resilient Local Media Acquisition:
   * 1. Video + Audio (when preferVideo=true)
   * 2. Audio-Only fallback (when webcam is absent or locked by another app/browser)
   * 3. Empty receive-only stream fallback (so P2P call still connects to view opponent)
   */
  const acquireLocalMedia = useCallback(
    async (
      preferVideo: boolean
    ): Promise<{ stream: MediaStream; mediaState: PeerMediaStateDto }> => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStatusNotice(
          'Trình duyệt không hỗ trợ truy cập Camera/Mic (yêu cầu localhost hoặc HTTPS). Đang mở chế độ chỉ nhận tín hiệu.'
        );
        const emptyStream = new MediaStream();
        const fallbackState = { audioEnabled: false, videoEnabled: false };
        localStreamRef.current = emptyStream;
        setLocalMediaState(fallbackState);
        return { stream: emptyStream, mediaState: fallbackState };
      }

      if (preferVideo) {
        try {
          const avStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 640 },
              height: { ideal: 360 },
              frameRate: { ideal: 24 },
            },
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          const state: PeerMediaStateDto = {
            audioEnabled: avStream.getAudioTracks().length > 0,
            videoEnabled: avStream.getVideoTracks().length > 0,
          };
          localStreamRef.current = avStream;
          setLocalMediaState(state);
          return { stream: avStream, mediaState: state };
        } catch {
          setStatusNotice(
            'Camera đang bận hoặc không tìm thấy — tự động chuyển sang Gọi Thoại (vẫn xem được hình đối thủ).'
          );
        }
      }

      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const state: PeerMediaStateDto = {
          audioEnabled: audioStream.getAudioTracks().length > 0,
          videoEnabled: false,
        };
        localStreamRef.current = audioStream;
        setLocalMediaState(state);
        return { stream: audioStream, mediaState: state };
      } catch {
        setStatusNotice(
          'Không truy cập được Mic/Camera — đang kết nối ở chế độ chỉ xem & nghe đối thủ.'
        );
        const emptyStream = new MediaStream();
        const state: PeerMediaStateDto = {
          audioEnabled: false,
          videoEnabled: false,
        };
        localStreamRef.current = emptyStream;
        setLocalMediaState(state);
        return { stream: emptyStream, mediaState: state };
      }
    },
    []
  );

  const flushQueuedIceCandidates = useCallback(async (pc: RTCPeerConnection) => {
    if (!pc.remoteDescription) return;
    const queued = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];

    for (const cand of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        // Ignore stale candidate
      }
    }
  }, []);

  const createPeerConnection = useCallback(
    (activeRoomId: string, localStream: MediaStream): RTCPeerConnection => {
      if (pcRef.current) {
        try {
          pcRef.current.close();
        } catch {
          // Ignore
        }
      }

      const pc = new RTCPeerConnection(iceConfig);
      pcRef.current = pc;

      const inboundStream = new MediaStream();
      remoteStreamRef.current = inboundStream;

      // Attach local media tracks
      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream);
      }

      // Ensure SDP always negotiates both audio & video channels even if one side lacks a webcam
      if (localStream.getAudioTracks().length === 0) {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }
      if (localStream.getVideoTracks().length === 0) {
        pc.addTransceiver('video', { direction: 'recvonly' });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          const candJson = event.candidate.toJSON();
          if (candJson.candidate) {
            socket.emit('webrtc_ice_candidate', {
              roomId: activeRoomId,
              candidate: {
                candidate: candJson.candidate,
                sdpMid: candJson.sdpMid ?? null,
                sdpMLineIndex: candJson.sdpMLineIndex ?? null,
                usernameFragment: candJson.usernameFragment ?? null,
              },
            });
          }
        }
      };

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          for (const t of event.streams[0].getTracks()) {
            if (!inboundStream.getTracks().some((existing) => existing.id === t.id)) {
              inboundStream.addTrack(t);
            }
          }
        } else if (event.track) {
          if (!inboundStream.getTracks().some((existing) => existing.id === event.track.id)) {
            inboundStream.addTrack(event.track);
          }
        }
        syncVideoElements();
      };

      const handleConnChange = () => {
        const state = pc.connectionState || pc.iceConnectionState;
        if (state === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setCallPhase('CONNECTED');
          syncVideoElements();
        } else if (state === 'failed') {
          cleanupCallResources('Kết nối Video P2P bị gián đoạn do mạng.');
        }
      };

      pc.onconnectionstatechange = handleConnChange;
      pc.oniceconnectionstatechange = handleConnChange;

      syncVideoElements();
      return pc;
    },
    [cleanupCallResources, iceConfig, socket, syncVideoElements]
  );

  // Sync <video> DOM references whenever callPhase or layout mode updates
  useEffect(() => {
    if (callPhase === 'CONNECTING' || callPhase === 'CONNECTED') {
      syncVideoElements();
    }
  }, [callPhase, isFloatingPip, isMinimized, syncVideoElements]);

  // Live call duration timer
  useEffect(() => {
    if (callPhase !== 'CONNECTED') return;
    const interval = setInterval(() => {
      setCallSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [callPhase]);

  // Auto-hide transient status notice after 5.5s
  useEffect(() => {
    if (!statusNotice) return;
    const timer = setTimeout(() => setStatusNotice(null), 5500);
    return () => clearTimeout(timer);
  }, [statusNotice]);

  // Clean up hardware camera/mic whenever room changes, match ends, or component unmounts
  useEffect(() => {
    if (!roomId || roomStatus === 'FINISHED' || roomStatus === 'ADJOURNED') {
      cleanupCallResources();
    }
  }, [roomId, roomStatus, cleanupCallResources]);

  useEffect(() => {
    return () => {
      cleanupCallResources();
    };
  }, [cleanupCallResources]);

  // Register Socket.IO 1v1 Signaling Listeners
  useEffect(() => {
    if (!socket || !roomId || !isEligiblePvpPlayer) return;

    const onIncomingCall = (payload: {
      roomId: string;
      fromSide: Side;
      fromUsername: string;
      hasVideo: boolean;
    }) => {
      if (payload.roomId !== roomId) return;
      setStatusNotice(null);
      setIncomingCaller({
        fromSide: payload.fromSide,
        fromUsername: payload.fromUsername,
        hasVideo: payload.hasVideo,
      });
      setCallPhase('INCOMING_RINGING');
    };

    const onCallAccepted = async (payload: {
      roomId: string;
      bySide: Side;
      byUsername: string;
      hasVideo: boolean;
    }) => {
      if (payload.roomId !== roomId) return;
      if (ringTimerRef.current) {
        clearTimeout(ringTimerRef.current);
        ringTimerRef.current = null;
      }

      setCallPhase('CONNECTING');
      setRemoteMediaState({
        audioEnabled: true,
        videoEnabled: payload.hasVideo,
      });

      try {
        const { stream, mediaState } = await acquireLocalMedia(
          outgoingPrefersVideoRef.current
        );
        const pc = createPeerConnection(roomId, stream);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (offer.sdp) {
          const desc: WebRtcSessionDescriptionDto = {
            type: 'offer',
            sdp: offer.sdp,
          };
          socket.emit('webrtc_offer', {
            roomId,
            description: desc,
            mediaState,
          });
        }
      } catch {
        cleanupCallResources('Không thể khởi tạo kết nối WebRTC.');
      }
    };

    const onCallDeclined = (payload: {
      roomId: string;
      bySide: Side;
      byUsername: string;
    }) => {
      if (payload.roomId !== roomId) return;
      cleanupCallResources(`Kỳ thủ ${payload.byUsername} đã từ chối cuộc gọi.`);
    };

    const onWebRtcOffer = async (payload: {
      roomId: string;
      fromSide: Side;
      description: WebRtcSessionDescriptionDto;
      mediaState: PeerMediaStateDto;
    }) => {
      if (payload.roomId !== roomId) return;
      setRemoteMediaState(payload.mediaState);
      setCallPhase('CONNECTING');

      try {
        let stream = localStreamRef.current;
        let mediaState = localMediaStateRef.current;

        if (!stream) {
          const acquired = await acquireLocalMedia(true);
          stream = acquired.stream;
          mediaState = acquired.mediaState;
        }

        const pc = pcRef.current ?? createPeerConnection(roomId, stream);
        await pc.setRemoteDescription(
          new RTCSessionDescription({
            type: 'offer',
            sdp: payload.description.sdp,
          })
        );
        await flushQueuedIceCandidates(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (answer.sdp) {
          socket.emit('webrtc_answer', {
            roomId,
            description: {
              type: 'answer',
              sdp: answer.sdp,
            },
            mediaState,
          });
        }
        syncVideoElements();
      } catch {
        cleanupCallResources('Lỗi đồng bộ tín hiệu Video Call.');
      }
    };

    const onWebRtcAnswer = async (payload: {
      roomId: string;
      fromSide: Side;
      description: WebRtcSessionDescriptionDto;
      mediaState: PeerMediaStateDto;
    }) => {
      if (payload.roomId !== roomId || !pcRef.current) return;
      setRemoteMediaState(payload.mediaState);

      try {
        await pcRef.current.setRemoteDescription(
          new RTCSessionDescription({
            type: 'answer',
            sdp: payload.description.sdp,
          })
        );
        await flushQueuedIceCandidates(pcRef.current);
        syncVideoElements();
      } catch {
        cleanupCallResources('Không thể thiết lập phiên trả lời WebRTC.');
      }
    };

    const onWebRtcIceCandidate = async (payload: {
      roomId: string;
      fromSide: Side;
      candidate: WebRtcIceCandidateDto;
    }) => {
      if (payload.roomId !== roomId) return;
      const pc = pcRef.current;

      if (!pc || !pc.remoteDescription) {
        pendingIceCandidatesRef.current.push(payload.candidate);
        return;
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch {
        // Ignore non-fatal Trickle ICE candidate error
      }
    };

    const onWebRtcMediaState = (payload: {
      roomId: string;
      fromSide: Side;
      mediaState: PeerMediaStateDto;
    }) => {
      if (payload.roomId !== roomId) return;
      setRemoteMediaState(payload.mediaState);
    };

    const onCallEnded = (payload: {
      roomId: string;
      bySide: Side;
      reason?: string;
    }) => {
      if (payload.roomId !== roomId) return;
      const msg =
        payload.reason === 'PEER_DISCONNECTED'
          ? 'Cuộc gọi đã kết thúc do đối thủ mất kết nối.'
          : payload.reason === 'MATCH_FINISHED'
            ? undefined
            : 'Đối thủ đã kết thúc cuộc gọi.';
      cleanupCallResources(msg);
    };

    socket.on('video_call_incoming', onIncomingCall);
    socket.on('video_call_accepted', onCallAccepted);
    socket.on('video_call_declined', onCallDeclined);
    socket.on('webrtc_offer', onWebRtcOffer);
    socket.on('webrtc_answer', onWebRtcAnswer);
    socket.on('webrtc_ice_candidate', onWebRtcIceCandidate);
    socket.on('webrtc_media_state', onWebRtcMediaState);
    socket.on('video_call_ended', onCallEnded);

    return () => {
      socket.off('video_call_incoming', onIncomingCall);
      socket.off('video_call_accepted', onCallAccepted);
      socket.off('video_call_declined', onCallDeclined);
      socket.off('webrtc_offer', onWebRtcOffer);
      socket.off('webrtc_answer', onWebRtcAnswer);
      socket.off('webrtc_ice_candidate', onWebRtcIceCandidate);
      socket.off('webrtc_media_state', onWebRtcMediaState);
      socket.off('video_call_ended', onCallEnded);
    };
  }, [
    acquireLocalMedia,
    cleanupCallResources,
    createPeerConnection,
    flushQueuedIceCandidates,
    isEligiblePvpPlayer,
    roomId,
    socket,
    syncVideoElements,
  ]);

  if (!isEligiblePvpPlayer || !roomId) {
    return null;
  }

  const canInitiateCall =
    roomStatus === 'PLAYING' && Boolean(opponentProfile?.isConnected);

  const startOutgoingCall = (withVideo: boolean) => {
    if (!socket || !canInitiateCall) return;
    setStatusNotice(null);
    outgoingPrefersVideoRef.current = withVideo;
    setCallPhase('OUTGOING_RINGING');
    socket.emit('video_call_request', { roomId, hasVideo: withVideo });

    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    ringTimerRef.current = setTimeout(() => {
      socket.emit('video_call_hangup', { roomId, reason: 'RING_TIMEOUT' });
      cleanupCallResources('Đối thủ không phản hồi cuộc gọi.');
    }, RING_TIMEOUT_MS);
  };

  const acceptIncomingCall = async (withVideo: boolean) => {
    if (!socket) return;
    setStatusNotice(null);
    setCallPhase('CONNECTING');

    const { stream, mediaState } = await acquireLocalMedia(withVideo);
    createPeerConnection(roomId, stream);

    socket.emit('video_call_respond', {
      roomId,
      accept: true,
      hasVideo: mediaState.videoEnabled,
    });
  };

  const declineIncomingCall = () => {
    if (!socket) return;
    socket.emit('video_call_respond', { roomId, accept: false });
    cleanupCallResources();
  };

  const hangupCall = () => {
    if (socket) {
      socket.emit('video_call_hangup', { roomId, reason: 'HANGUP' });
    }
    cleanupCallResources();
  };

  const toggleMicrophone = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setStatusNotice('Thiết bị của bạn hiện không có Micro khả dụng.');
      return;
    }

    const nextEnabled = !localMediaState.audioEnabled;
    for (const track of audioTracks) {
      track.enabled = nextEnabled;
    }

    const updatedState: PeerMediaStateDto = {
      ...localMediaState,
      audioEnabled: nextEnabled,
    };
    setLocalMediaState(updatedState);
    socket?.emit('webrtc_media_state', { roomId, mediaState: updatedState });
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) {
      setStatusNotice('Thiết bị hiện đang ở chế độ Gọi Thoại (không có luồng Camera).');
      return;
    }

    const nextEnabled = !localMediaState.videoEnabled;
    for (const track of videoTracks) {
      track.enabled = nextEnabled;
    }

    const updatedState: PeerMediaStateDto = {
      ...localMediaState,
      videoEnabled: nextEnabled,
    };
    setLocalMediaState(updatedState);
    socket?.emit('webrtc_media_state', { roomId, mediaState: updatedState });
  };

  const isOpponentTurn = activeTurn !== mySide;
  const isMyTurn = activeTurn === mySide;

  return (
    <>
      {/* Status Notice Toast Bar Inside Call Section */}
      {statusNotice && (
        <div className="w-full px-3.5 py-2 rounded-xl bg-stone-900/95 border border-amber-600/60 text-[11px] font-semibold text-amber-200 flex items-center justify-between shrink-0">
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-stone-400 hover:text-stone-200 ml-2 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* 1. IDLE STATE: Compact Call Action Strip */}
      {callPhase === 'IDLE' && (
        <div className="w-full flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-stone-900/95 border border-stone-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-emerald-950/80 border border-emerald-700/50 flex items-center justify-center text-emerald-400">
              <Video className="w-3.5 h-3.5" />
            </span>
            <div>
              <div className="text-xs font-extrabold text-stone-200 flex items-center gap-1.5">
                Video Call Đấu Thủ 1v1
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-stone-800 text-[10px] font-semibold text-emerald-400">
                  <ShieldCheck className="w-2.5 h-2.5" /> P2P Riêng Tư
                </span>
              </div>
              <div className="text-[11px] text-stone-400">
                {canInitiateCall
                  ? `Kết nối trực tiếp với ${opponentProfile?.username} (Khán giả không thể xem/nghe)`
                  : 'Chờ đủ 2 kỳ thủ trực tuyến trong ván đấu để gọi'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!canInitiateCall}
              onClick={() => startOutgoingCall(false)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 text-xs font-bold border border-stone-700 transition"
              title="Chỉ gọi âm thanh (Micro)"
            >
              <Phone className="w-3.5 h-3.5 text-amber-400" />
              Gọi Thoại
            </button>

            <button
              type="button"
              disabled={!canInitiateCall}
              onClick={() => startOutgoingCall(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-extrabold transition shadow"
              title="Gọi Video + Âm thanh trực tiếp với đối thủ"
            >
              <Video className="w-3.5 h-3.5" />
              Gọi Video
            </button>
          </div>
        </div>
      )}

      {/* 2. OUTGOING RINGING STATE */}
      {callPhase === 'OUTGOING_RINGING' && (
        <div className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-emerald-950/75 border border-emerald-500/70 text-xs shrink-0">
          <div className="flex items-center gap-2.5">
            <PhoneCall className="w-4 h-4 text-emerald-400 animate-bounce" />
            <span className="font-bold text-emerald-100">
              Đang đổ chuông mời kỳ thủ{' '}
              <b className="text-amber-300">{opponentProfile?.username}</b> kết nối...
            </span>
          </div>
          <button
            type="button"
            onClick={hangupCall}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold transition"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            Hủy Gọi
          </button>
        </div>
      )}

      {/* 3. INCOMING CALL PROMPT */}
      {callPhase === 'INCOMING_RINGING' && incomingCaller && (
        <div className="w-full flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-950/95 via-stone-900 to-emerald-950/95 border border-emerald-400 shadow-lg text-xs shrink-0">
          <div className="flex items-center gap-2.5">
            <PhoneIncoming className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="font-bold text-emerald-100">
              Kỳ thủ <b className="text-amber-300">{incomingCaller.fromUsername}</b> mời{' '}
              <b>{incomingCaller.hasVideo ? 'Gọi Video 1v1' : 'Gọi Thoại 1v1'}</b>!
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => acceptIncomingCall(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold transition shadow"
            >
              <Video className="w-3.5 h-3.5" />
              Trả Lời Video
            </button>
            <button
              type="button"
              onClick={() => acceptIncomingCall(false)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold transition"
            >
              <Mic className="w-3.5 h-3.5" />
              Chỉ Mic
            </button>
            <button
              type="button"
              onClick={declineIncomingCall}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold border border-stone-700 transition"
            >
              <PhoneOff className="w-3.5 h-3.5 text-red-400" />
              Từ Chối
            </button>
          </div>
        </div>
      )}

      {/* 4. ACTIVE / CONNECTING P2P CALL POD (Docked in Right Column OR Floating PiP) */}
      {(callPhase === 'CONNECTING' || callPhase === 'CONNECTED') && (
        <div
          className={
            isFloatingPip
              ? 'fixed bottom-4 right-4 z-40 w-[360px] sm:w-[400px] rounded-2xl bg-stone-950/95 border-2 border-amber-500/80 shadow-2xl p-2.5 backdrop-blur-md'
              : 'w-full rounded-xl bg-stone-900/95 border border-stone-800 p-2.5 shadow-lg shrink-0'
          }
        >
          {/* Header & Quick Call Controls */}
          <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-stone-800/90">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  callPhase === 'CONNECTED'
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-amber-400 animate-ping'
                }`}
              />
              <span className="text-xs font-extrabold text-stone-200">
                {callPhase === 'CONNECTED'
                  ? `Đang Đàm Thoại (${formatCallDuration(callSeconds)})`
                  : 'Đang Thiết Lập Kênh P2P...'}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleMicrophone}
                className={`p-1.5 rounded-lg text-xs font-bold transition ${
                  localMediaState.audioEnabled
                    ? 'bg-stone-800 hover:bg-stone-700 text-stone-200'
                    : 'bg-red-900/80 hover:bg-red-800 text-red-200'
                }`}
                title={localMediaState.audioEnabled ? 'Tắt Micro' : 'Bật Micro'}
              >
                {localMediaState.audioEnabled ? (
                  <Mic className="w-3.5 h-3.5" />
                ) : (
                  <MicOff className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={toggleCamera}
                className={`p-1.5 rounded-lg text-xs font-bold transition ${
                  localMediaState.videoEnabled
                    ? 'bg-stone-800 hover:bg-stone-700 text-stone-200'
                    : 'bg-red-900/80 hover:bg-red-800 text-red-200'
                }`}
                title={localMediaState.videoEnabled ? 'Tắt Camera' : 'Bật Camera'}
              >
                {localMediaState.videoEnabled ? (
                  <Video className="w-3.5 h-3.5" />
                ) : (
                  <VideoOff className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsRemoteSpeakerMuted((prev) => !prev)}
                className={`p-1.5 rounded-lg text-xs font-bold transition ${
                  !isRemoteSpeakerMuted
                    ? 'bg-stone-800 hover:bg-stone-700 text-stone-200'
                    : 'bg-amber-900/80 hover:bg-amber-800 text-amber-200'
                }`}
                title={
                  isRemoteSpeakerMuted ? 'Bật loa nghe đối thủ' : 'Tắt loa đối thủ'
                }
              >
                {isRemoteSpeakerMuted ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsFloatingPip((prev) => !prev)}
                className={`p-1.5 rounded-lg text-xs font-bold transition ${
                  isFloatingPip
                    ? 'bg-amber-600 text-stone-950'
                    : 'bg-stone-800 hover:bg-stone-700 text-stone-200'
                }`}
                title={
                  isFloatingPip
                    ? 'Gắn lại vào cột phải'
                    : 'Tách ra cửa sổ nổi (PiP)'
                }
              >
                <PictureInPicture2 className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setIsMinimized((prev) => !prev)}
                className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-bold transition"
                title={
                  isMinimized
                    ? 'Mở rộng khung hình Video'
                    : 'Thu gọn thành thanh âm thanh'
                }
              >
                {isMinimized ? (
                  <Maximize2 className="w-3.5 h-3.5" />
                ) : (
                  <Minimize2 className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={hangupCall}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-extrabold transition ml-1"
                title="Kết thúc cuộc gọi"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                Cúp
              </button>
            </div>
          </div>

          {/* Dual 16:9 Feeds — Kept mounted (hidden when minimized) so remote audio NEVER drops */}
          <div
            className={
              isMinimized ? 'hidden' : 'grid grid-cols-2 gap-2.5'
            }
          >
            {/* Opponent Feed */}
            <div
              className={`relative rounded-xl overflow-hidden bg-stone-950 aspect-video border-2 transition ${
                isOpponentTurn
                  ? 'border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                  : 'border-stone-800'
              }`}
            >
              <video
                ref={remoteVideoElRef}
                autoPlay
                playsInline
                muted={isRemoteSpeakerMuted}
                className={`w-full h-full object-cover ${
                  remoteMediaState.videoEnabled ? 'block' : 'hidden'
                }`}
              />

              {!remoteMediaState.videoEnabled && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-stone-900 to-stone-950 gap-1.5">
                  <div className="w-10 h-10 rounded-full bg-stone-800 border border-stone-600 flex items-center justify-center text-sm font-extrabold text-amber-400">
                    {(opponentProfile?.username ?? 'ĐT').slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-[10px] text-stone-400 font-semibold">
                    Đã tắt Camera
                  </span>
                </div>
              )}

              <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between px-2 py-0.5 rounded-md bg-stone-950/80 backdrop-blur-sm text-[10px]">
                <span className="font-bold text-stone-100 truncate">
                  {opponentProfile?.username ?? 'Đối thủ'}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {!remoteMediaState.audioEnabled && (
                    <MicOff className="w-3 h-3 text-red-400" />
                  )}
                </span>
              </div>
            </div>

            {/* Local Self Feed (Mirrored) */}
            <div
              className={`relative rounded-xl overflow-hidden bg-stone-950 aspect-video border-2 transition ${
                isMyTurn
                  ? 'border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                  : 'border-stone-800'
              }`}
            >
              <video
                ref={localVideoElRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover scale-x-[-1] ${
                  localMediaState.videoEnabled ? 'block' : 'hidden'
                }`}
              />

              {!localMediaState.videoEnabled && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-stone-900 to-stone-950 gap-1.5">
                  <div className="w-10 h-10 rounded-full bg-stone-800 border border-stone-600 flex items-center justify-center text-sm font-extrabold text-emerald-400">
                    {(myProfile?.username ?? 'BẠN').slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-[10px] text-stone-400 font-semibold">
                    Camera tắt
                  </span>
                </div>
              )}

              <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between px-2 py-0.5 rounded-md bg-stone-950/80 backdrop-blur-sm text-[10px]">
                <span className="font-bold text-emerald-300 truncate">
                  Bạn ({myProfile?.username})
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {!localMediaState.audioEnabled && (
                    <MicOff className="w-3 h-3 text-red-400" />
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

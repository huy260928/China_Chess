import { Server as HttpServer } from 'http';
export declare class XiangqiSocketServer {
    private io;
    private activeRooms;
    private matchmakingQueue;
    private clockManager;
    private chatManager;
    private matchmakingTimer;
    constructor(httpServer: HttpServer);
    private setupAuthMiddleware;
    private setupConnectionHandlers;
    private tryAutoReconnectPlayer;
    private handleSocketDisconnect;
    private handleReconnectTimeoutForfeit;
    private handleJoinMatchmaking;
    private handleLeaveMatchmaking;
    private processMatchmakingQueue;
    private createMatchedPvpRoom;
    private handleCreateRoom;
    private handleJoinRoom;
    private handleLeaveRoom;
    private handleMakeMove;
    private triggerAiMoveIfNeeded;
    private handleOfferDraw;
    private handleRespondDraw;
    private handleResign;
    private handleClockTimeout;
    /**
     * Undoes the last turn in PvE mode (rolls back AI's counter-move + Player's last move,
     * or rolls back Player's move if AI hasn't moved yet) so the player can re-play their move.
     */
    private handleUndoPveMove;
    /**
     * Resets the entire PvE board back to the starting position (or initial FEN)
     * and restarts the 30-minute match clock.
     */
    private handleResetPveGame;
    private handleSavePveGame;
    private handleRequestAdjourn;
    private handleRespondAdjourn;
    private handleResumeSavedGame;
    private handleSendChat;
    private handleToggleMutePlayerChat;
    private resolvePvpCallPeer;
    private handleVideoCallRequest;
    private handleVideoCallRespond;
    private handleWebRtcOffer;
    private handleWebRtcAnswer;
    private handleWebRtcIceCandidate;
    private handleWebRtcMediaState;
    private handleVideoCallHangup;
    private finalizeMatch;
    private getSocketRoleInRoom;
    private ensureParticipantSocketsJoined;
    private buildDefaultClockState;
    private buildRoomStateDto;
    private getLobbyRoomSummaries;
    private broadcastLobbyUpdate;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=socket-manager.d.ts.map
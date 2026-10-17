import { HubConnectionBuilder, HubConnectionState, type HubConnection, LogLevel } from "@microsoft/signalr";

import type { Schemas } from "../api/client";

/** Server → client events (ovrilo-api/contracts/events/README.md). */
export interface RealtimeEvents {
  MessageCreated: Schemas["MessageResponse"];
  MessageEdited: Schemas["MessageResponse"];
  MessageDeleted: Schemas["MessageResponse"];
  ReadStateUpdated: Schemas["ReadStateResponse"];
  PresenceChanged: { userId: string; online: boolean };
  /** contracts/events/README.md: the other person and what changed; refetch the lists. */
  FriendsChanged: { change: "requestReceived" | "friendAdded" | "updated"; user: Schemas["SocialUserResponse"] };
  /** Calls in direct and group conversations (contracts/events/README.md). */
  CallRinging: {
    conversationId: string;
    caller: { id: string; displayName: string; avatarAssetId: string | null };
    isGroup?: boolean;
    groupName?: string | null;
  };
  CallAccepted: { conversationId: string };
  CallEnded: { conversationId: string; reason: "declined" | "cancelled" | "missed" };
  /** A group you are in changed (or you joined / left it); refetch GET /groups. */
  GroupChanged: { change: "added" | "updated" | "removed"; groupId: string };
  UserUpdated: { userId: string; displayName: string; avatarAssetId: string | null };
  CommunityUpdated: { communityId: string; name: string; description: string | null; iconAssetId: string | null };
  ChannelsChanged: { communityId: string; channelId: string; change: "created" | "updated" | "deleted" };
  CommunityDeleted: { communityId: string };
}

/** Members of a community online right now (SubscribeCommunity). */
type PresenceSnapshot = (onlineUserIds: string[]) => void;

export type RealtimeStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

type Handler<K extends keyof RealtimeEvents> = (payload: RealtimeEvents[K]) => void;

/**
 * One SignalR connection per signed-in session. Keeps channel subscriptions across reconnects and
 * tells listeners when they should catch up over REST (events may have been missed meanwhile).
 */
export class RealtimeClient {
  private connection: HubConnection | null = null;
  private readonly channels = new Map<string, number>();
  private readonly communities = new Map<string, Set<PresenceSnapshot>>();
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  private readonly resyncListeners = new Set<() => void>();
  private readonly statusListeners = new Set<() => void>();
  private status: RealtimeStatus = "disconnected";
  private stopped = true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: () => Promise<string | null>,
  ) {}

  getStatus = (): RealtimeStatus => this.status;

  onStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  /** Called after a reconnect: refetch whatever may have been missed. */
  onResync(listener: () => void): () => void {
    this.resyncListeners.add(listener);
    return () => this.resyncListeners.delete(listener);
  }

  on<K extends keyof RealtimeEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
      this.connection?.on(event, (payload: unknown) => this.dispatch(event, payload));
    }
    set.add(handler as (payload: unknown) => void);
    return () => set.delete(handler as (payload: unknown) => void);
  }

  /** Reference-counted: several views may watch the same channel. */
  subscribeChannel(channelId: string): () => void {
    const count = this.channels.get(channelId) ?? 0;
    this.channels.set(channelId, count + 1);
    if (count === 0 && this.connection?.state === HubConnectionState.Connected) {
      void this.connection.invoke("SubscribeChannel", channelId).catch(() => undefined);
    }
    return () => {
      const remaining = (this.channels.get(channelId) ?? 1) - 1;
      if (remaining > 0) {
        this.channels.set(channelId, remaining);
        return;
      }
      this.channels.delete(channelId);
      if (this.connection?.state === HubConnectionState.Connected) {
        void this.connection.invoke("UnsubscribeChannel", channelId).catch(() => undefined);
      }
    };
  }

  /**
   * Presence of a community's members: `onSnapshot` gets who is online after every (re)connect;
   * follow changes with `on("PresenceChanged")`.
   */
  subscribeCommunity(communityId: string, onSnapshot: PresenceSnapshot): () => void {
    let listeners = this.communities.get(communityId);
    if (!listeners) {
      listeners = new Set();
      this.communities.set(communityId, listeners);
    }
    listeners.add(onSnapshot);
    if (this.connection?.state === HubConnectionState.Connected) {
      // Every watcher needs its own snapshot; joining the group again is harmless.
      void this.watchCommunity(this.connection, communityId, new Set([onSnapshot]));
    }
    return () => {
      listeners.delete(onSnapshot);
      if (listeners.size > 0) return;
      this.communities.delete(communityId);
      if (this.connection?.state === HubConnectionState.Connected) {
        void this.connection.invoke("UnsubscribeCommunity", communityId).catch(() => undefined);
      }
    };
  }

  /** Friends online now, or null while disconnected. Changes arrive as `PresenceChanged`. */
  async getFriendsPresence(): Promise<string[] | null> {
    const connection = this.connection;
    if (connection?.state !== HubConnectionState.Connected) return null;
    try {
      const snapshot = await connection.invoke<{ onlineUserIds: string[] }>("GetFriendsPresence");
      return snapshot.onlineUserIds;
    } catch {
      return null;
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const connection = new HubConnectionBuilder()
      .withUrl(`${this.baseUrl}/hubs/realtime`, {
        // Fails the connect (instead of sending no token) when signed out.
        accessTokenFactory: async () => (await this.accessToken()) ?? "",
        // Bearer tokens only: no cookies, so the API's CORS policy need not allow credentials.
        withCredentials: false,
      })
      // Quick retries first; the server also closes the connection when the access token expires.
      .withAutomaticReconnect([0, 1000, 3000, 10_000, 30_000])
      .configureLogging(LogLevel.Warning)
      .build();
    for (const event of this.handlers.keys()) {
      connection.on(event, (payload: unknown) => this.dispatch(event, payload));
    }
    connection.onreconnecting(() => this.setStatus("reconnecting"));
    connection.onreconnected(() => void this.afterConnect());
    connection.onclose(() => {
      this.setStatus("disconnected");
      this.scheduleRestart();
    });
    this.connection = connection;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const connection = this.connection;
    this.connection = null;
    this.setStatus("disconnected");
    await connection?.stop().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    const connection = this.connection;
    if (!connection || this.stopped) return;
    this.setStatus("connecting");
    try {
      await connection.start();
      await this.afterConnect();
    } catch {
      this.setStatus("disconnected");
      this.scheduleRestart();
    }
  }

  /** Automatic reconnect gives up after its schedule (or a token-expiry close): keep trying slowly. */
  private scheduleRestart(): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.connection?.state === HubConnectionState.Disconnected) void this.connect();
    }, 5000);
  }

  private async afterConnect(): Promise<void> {
    const connection = this.connection;
    if (!connection) return;
    await Promise.all([
      ...[...this.channels.keys()].map((id) => connection.invoke("SubscribeChannel", id).catch(() => undefined)),
      ...[...this.communities].map(([id, listeners]) => this.watchCommunity(connection, id, listeners)),
    ]);
    this.setStatus("connected");
    this.resyncListeners.forEach((listener) => listener());
  }

  private async watchCommunity(connection: HubConnection, communityId: string, listeners: Set<PresenceSnapshot>) {
    try {
      const snapshot = await connection.invoke<{ onlineUserIds: string[] } | null>("SubscribeCommunity", communityId);
      if (snapshot) listeners.forEach((listener) => listener(snapshot.onlineUserIds));
    } catch {
      // The next reconnect subscribes again.
    }
  }

  private dispatch(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }

  private setStatus(status: RealtimeStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener());
  }
}

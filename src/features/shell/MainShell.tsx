import { HeadphoneOff, Hash, ImageUp, LogIn, MicOff, Plus, Settings, UserPlus, Users, Volume2, VolumeX } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";

import type { Schemas } from "../../api/client";
import { useApi } from "../../auth/SessionContext";
import { Avatar, CommunityIcon, IconButton } from "../../components/ui";
import { TextChannel } from "../messages/TextChannel";
import { type ChannelUnread, isUnread, unreadLabel, useCommunitiesWithUnread, useUnread, useUnreadSync } from "../messages/unread";
import { SettingsDialog } from "../settings/SettingsDialog";
import { UpdateBanner } from "../update/UpdateBanner";
import { useJoinVoice } from "../voice/useJoinVoice";
import { ParticipantMenu, type ParticipantMenuTarget } from "../voice/ParticipantMenu";
import { useVoice, voiceAvailable } from "../voice/voice";
import { VoiceDock } from "../voice/VoiceDock";
import { VoiceRoom } from "../voice/VoiceRoom";
import { MembersPanel } from "./MembersPanel";
import { ChannelMenu, type ChannelMenuTarget } from "./ChannelMenu";
import { dropIndex, moveChannel } from "./channelOrder";
import {
  CommunityIconDialog,
  CreateChannelDialog,
  CreateCommunityDialog,
  DeleteChannelDialog,
  EditChannelDialog,
  InviteDialog,
  JoinCommunityDialog,
} from "./dialogs";
import { queryKeys, useChannels, useCommunities, useMemberAvatars, useVoiceStates } from "./queries";
import logo from "../../assets/logo.webp";
import { UserBar } from "./UserBar";
import { useChannelUpdates } from "./useChannelUpdates";
import { useProfileUpdates } from "./useProfileUpdates";

type Channel = Schemas["ChannelResponse"];
type OpenDialog =
  | "createCommunity"
  | "joinCommunity"
  | "invite"
  | "communityIcon"
  | "settings"
  | { kind: "createChannel"; type: Channel["type"] }
  | { kind: "editChannel" | "deleteChannel"; channel: Channel }
  | null;

export function MainShell({ user }: { user: Schemas["CurrentUserResponse"] }) {
  const communities = useCommunities();
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  // Last opened channel per community, so switching back returns to it.
  const [selectedChannels, setSelectedChannels] = useState<Readonly<Record<string, string>>>({});
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [menu, setMenu] = useState<ParticipantMenuTarget | null>(null);
  const [channelMenu, setChannelMenu] = useState<ChannelMenuTarget | null>(null);
  const [showMembers, setShowMembers] = useState(readShowMembers);
  const { snapshot } = useVoice();
  const join = useJoinVoice();
  useProfileUpdates(user.id);

  const community =
    communities.data?.find((c) => c.id === selectedCommunityId) ?? communities.data?.[0] ?? null;
  const channels = useChannels(community?.id ?? null);
  const voiceStates = useVoiceStates(community?.id ?? null);
  const queryClient = useQueryClient();
  const selectedChannelId = community ? selectedChannels[community.id] : undefined;
  // Nothing picked yet (or it was deleted): open the first text channel, like a fresh community's #general.
  const channel =
    channels.data?.find((c) => c.id === selectedChannelId) ?? channels.data?.find((c) => c.type === "text") ?? null;
  const isOwner = community?.myRole === "owner";

  // The room the engine is in; its channel may belong to another community than the one shown.
  const connectedChannelId = snapshot.connection === "disconnected" ? null : snapshot.channelId;
  useChannelUpdates(communities.data?.map((c) => c.id) ?? [], connectedChannelId);
  const move = useMoveChannel();

  // Our own join/leave changes occupancy: refresh right away instead of waiting for the next poll.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["communities"], predicate: (q) => q.queryKey[2] === "voice-states" });
  }, [connectedChannelId, snapshot.connection, queryClient]);
  const [connectedChannel, setConnectedChannel] = useState<{ id: string; name: string; communityId: string } | null>(
    null,
  );
  const connectedAvatars = useMemberAvatars(connectedChannel?.communityId ?? null);
  const connectedName =
    connectedChannel?.id === connectedChannelId ? connectedChannel?.name ?? "Voice channel" : "Voice channel";

  const selectCommunity = (id: string) => setSelectedCommunityId(id);
  const selectChannel = (target: { id: string; communityId: string }) =>
    setSelectedChannels((current) => ({ ...current, [target.communityId]: target.id }));

  const joinVoice = (target: Channel) => {
    setConnectedChannel({ id: target.id, name: target.name, communityId: target.communityId });
    join.mutate(target.id);
  };

  /** One click joins a voice channel (DESIGN.md §5.1) unless that would silently leave another room. */
  const openChannel = (target: Channel) => {
    selectChannel(target);
    if (target.type === "voice" && voiceAvailable && !connectedChannelId && !join.isPending) {
      joinVoice(target);
    }
  };

  const voiceChannels = channels.data?.filter((c) => c.type === "voice") ?? [];
  const textChannels = channels.data?.filter((c) => c.type === "text") ?? [];
  const unread = useUnread(community?.id ?? null);
  useUnreadSync(community?.id ?? null, textChannels.map((c) => c.id), user.id);
  const communitiesWithUnread = useCommunitiesWithUnread(communities.data?.map((c) => c.id) ?? []);
  const manage = isOwner
    ? {
        onMenu: (target: ChannelMenuTarget) => setChannelMenu(target),
        onMove: (target: Channel, index: number) => move.mutate({ channel: target, index }),
      }
    : undefined;

  return (
    <div className="app-shell">
      <nav className="space-rail" aria-label="Communities">
        {communities.data?.map((c) => (
          <button
            key={c.id}
            className="space-button avatar-hover-scope"
            aria-current={c.id === community?.id}
            aria-label={c.name}
            title={c.name}
            onClick={() => selectCommunity(c.id)}
          >
            {communitiesWithUnread.has(c.id) && c.id !== community?.id && (
              <span className="space-unread" aria-label="Unread messages" />
            )}
            <CommunityIcon name={c.name} assetId={c.iconAssetId} />
            {c.id === connectedChannel?.communityId && connectedChannelId && (
              <span className="space-voice-dot" aria-hidden="true" />
            )}
          </button>
        ))}
        <span className="rail-divider" aria-hidden="true" />
        <IconButton icon={Plus} label="Create a community" className="rail-action" onClick={() => setDialog("createCommunity")} />
        <IconButton icon={LogIn} label="Join with an invitation" className="rail-action" onClick={() => setDialog("joinCommunity")} />
      </nav>

      <aside className="channel-sidebar" aria-label="Channels">
        {community ? (
          <>
            <header className="sidebar-header">
              <h2 title={community.name}>{community.name}</h2>
              {isOwner && (
                <IconButton icon={ImageUp} label="Change community icon" onClick={() => setDialog("communityIcon")} />
              )}
              <IconButton icon={UserPlus} label="Invite people" onClick={() => setDialog("invite")} />
            </header>
            <div className="channel-list">
              <ChannelGroup
                title="Voice"
                channels={voiceChannels}
                selectedId={channel?.id}
                manage={manage}
                onCreate={() => setDialog({ kind: "createChannel", type: "voice" })}
                onSelect={openChannel}
                renderExtra={(c) =>
                  c.id !== connectedChannelId ? (
                    <ServerMembers
                      participants={voiceStates.data?.find((s) => s.channelId === c.id)?.participants ?? []}
                      channelName={c.name}
                    />
                  ) : c.id === connectedChannelId ? (
                    <ul className="channel-members" aria-label={`In ${c.name}`}>
                      <li>
                        <Avatar name={user.displayName} assetId={user.avatarAssetId} size="xs" speaking={snapshot.selfSpeaking} />
                        <span className="member-name">{user.displayName}</span>
                        <MemberIcons
                          muted={snapshot.microphoneMuted || snapshot.deafened}
                          deafened={snapshot.deafened}
                        />
                      </li>
                      {snapshot.participants.map((p) => (
                        <li
                          key={p.id}
                          title="Right-click for volume"
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ participantId: p.id, x: e.clientX, y: e.clientY });
                          }}
                        >
                          <Avatar
                            name={p.name}
                            assetId={connectedAvatars.get(p.id)}
                            size="xs"
                            speaking={p.speaking}
                            muted={p.locallyMuted}
                          />
                          <span className="member-name">{p.name}</span>
                          <MemberIcons muted={p.muted} deafened={false} locallyMuted={p.locallyMuted} />
                        </li>
                      ))}
                    </ul>
                  ) : null
                }
              />
              <ChannelGroup
                title="Text"
                channels={textChannels}
                unread={(c) => unread.data?.find((u) => u.channelId === c.id)}
                selectedId={channel?.id}
                manage={manage}
                onCreate={() => setDialog({ kind: "createChannel", type: "text" })}
                onSelect={openChannel}
              />
              {channels.isSuccess && channels.data.length === 0 && (
                <p className="muted small sidebar-hint">
                  {isOwner ? "No channels yet. Create a voice channel to start talking." : "No channels yet."}
                </p>
              )}
              {channels.isError && <p className="form-error small">Channels could not be loaded.</p>}
            </div>
          </>
        ) : (
          <div className="sidebar-empty">
            <p className="muted">{communities.isPending ? "Loading…" : "Create or join a community to get started."}</p>
          </div>
        )}

        <div className="sidebar-footer">
          <UpdateBanner />
          <VoiceDock
            channelName={connectedName}
            onOpen={() => {
              if (connectedChannel) {
                setSelectedCommunityId(connectedChannel.communityId);
                selectChannel(connectedChannel);
              }
            }}
          />
          <UserBar user={user} onSettings={() => setDialog("settings")} />
        </div>
      </aside>

      <main className="main-pane">
        {channel ? (
          <>
            <header className="channel-header">
              {channel.type === "text" ? (
                <Hash size={18} aria-hidden="true" />
              ) : (
                <Volume2 size={18} aria-hidden="true" />
              )}
              <h1>{channel.name}</h1>
              {channel.topic && (
                <span className="muted channel-topic" title={channel.topic}>
                  {channel.topic}
                </span>
              )}
              {channel.type === "text" && (
                <IconButton
                  icon={Users}
                  label={showMembers ? "Hide member list" : "Show member list"}
                  tone={showMembers ? "active" : "default"}
                  className="channel-header-action"
                  aria-pressed={showMembers}
                  onClick={() => {
                    setShowMembers(!showMembers);
                    writeShowMembers(!showMembers);
                  }}
                />
              )}
            </header>
            {channel.type === "voice" ? (
              <VoiceRoom
                key={channel.id}
                channel={channel}
                user={user}
                otherChannelName={connectedChannelId && connectedChannelId !== channel.id ? connectedName : null}
                join={{ mutate: () => joinVoice(channel), isPending: join.isPending, error: join.error }}
              />
            ) : (
              <div className="channel-body">
                <TextChannel key={channel.id} channel={channel} user={user} canModerate={isOwner} />
                {showMembers && <MembersPanel communityId={channel.communityId} selfId={user.id} />}
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <img src={logo} alt="" width={72} height={72} className="empty-logo" />
            <h1>Ovrilo</h1>
            <p className="muted">
              {community ? "Pick a channel to start." : "Create a community or join one with an invite."}
            </p>
          </div>
        )}
      </main>

      {dialog === "createCommunity" && (
        <CreateCommunityDialog onClose={() => setDialog(null)} onCreated={selectCommunity} />
      )}
      {dialog === "joinCommunity" && <JoinCommunityDialog onClose={() => setDialog(null)} onJoined={selectCommunity} />}
      {dialog === "invite" && community && <InviteDialog communityId={community.id} onClose={() => setDialog(null)} />}
      {typeof dialog === "object" && dialog?.kind === "createChannel" && community && (
        <CreateChannelDialog communityId={community.id} type={dialog.type} onClose={() => setDialog(null)} />
      )}
      {typeof dialog === "object" && dialog?.kind === "editChannel" && (
        <EditChannelDialog channel={dialog.channel} onClose={() => setDialog(null)} />
      )}
      {typeof dialog === "object" && dialog?.kind === "deleteChannel" && (
        <DeleteChannelDialog channel={dialog.channel} onClose={() => setDialog(null)} />
      )}
      {dialog === "communityIcon" && community && (
        <CommunityIconDialog community={community} onClose={() => setDialog(null)} />
      )}
      {dialog === "settings" && <SettingsDialog user={user} onClose={() => setDialog(null)} />}
      {menu && <ParticipantMenu target={menu} onClose={() => setMenu(null)} />}
      {channelMenu && (
        <ChannelMenu
          target={channelMenu}
          onEdit={() => setDialog({ kind: "editChannel", channel: channelMenu.channel })}
          onMove={(index) => move.mutate({ channel: channelMenu.channel, index })}
          onDelete={() => setDialog({ kind: "deleteChannel", channel: channelMenu.channel })}
          onClose={() => setChannelMenu(null)}
        />
      )}
    </div>
  );
}

/**
 * Occupants of a voice channel we are not in, as reported by the server. (In our own channel the
 * engine's live list is used instead: it updates instantly and carries speaking indicators.)
 */
function ServerMembers({
  participants,
  channelName,
}: {
  participants: Schemas["VoiceParticipantResponse"][];
  channelName: string;
}) {
  if (participants.length === 0) return null;
  return (
    <ul className="channel-members" aria-label={`In ${channelName}`}>
      {participants.map((p) => (
        <li key={p.userId}>
          <Avatar name={p.displayName} assetId={p.avatarAssetId} size="xs" />
          <span className="member-name">{p.displayName}</span>
          <MemberIcons muted={p.muted} deafened={false} />
        </li>
      ))}
    </ul>
  );
}

/** Mic/deafen state next to a name; icons carry labels so state is not color-only. */
function MemberIcons({
  muted,
  deafened,
  locallyMuted = false,
}: {
  muted: boolean;
  deafened: boolean;
  locallyMuted?: boolean;
}) {
  if (!muted && !deafened && !locallyMuted) return null;
  return (
    <span className="member-icons">
      {muted && <MicOff size={12} aria-label="Microphone muted" />}
      {deafened && <HeadphoneOff size={12} aria-label="Deafened" />}
      {locallyMuted && <VolumeX size={12} aria-label="Muted for you" />}
    </span>
  );
}

/** Moves a channel among its type: optimistic, then the server's order (others are renumbered). */
function useMoveChannel() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ channel, index }: { channel: Channel; index: number }) => {
      const { error } = await api.PATCH("/channels/{channelId}", {
        params: { path: { channelId: channel.id } },
        body: { name: null, topic: null, position: index },
      });
      if (error) throw error;
    },
    onMutate: ({ channel, index }) => {
      queryClient.setQueryData<Channel[]>(queryKeys.channels(channel.communityId), (list) =>
        list ? moveChannel(list, channel.id, index) : list,
      );
    },
    onSettled: (_data, _error, { channel }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.channels(channel.communityId) }),
  });
}

interface ChannelManagement {
  onMenu: (target: ChannelMenuTarget) => void;
  onMove: (channel: Channel, index: number) => void;
}

function ChannelGroup({
  title,
  channels,
  selectedId,
  manage,
  onCreate,
  onSelect,
  renderExtra,
  unread,
}: {
  title: string;
  channels: Channel[];
  selectedId: string | undefined;
  /** Owners: create, the channel menu and drag to reorder. */
  manage: ChannelManagement | undefined;
  onCreate: () => void;
  onSelect: (channel: Channel) => void;
  renderExtra?: (channel: Channel) => ReactNode;
  unread?: (channel: Channel) => ChannelUnread | undefined;
}) {
  // Drag state is per group: a channel cannot be dropped into the other type.
  const [drag, setDrag] = useState<{ id: string; over: number; after: boolean } | null>(null);
  if (channels.length === 0 && !manage) return null;

  const openMenu = (c: Channel, index: number, x: number, y: number) =>
    manage?.onMenu({ channel: c, index, count: channels.length, x, y });

  return (
    <section className="channel-group">
      <header>
        <h3>{title}</h3>
        {manage && <IconButton icon={Plus} label={`Create ${title.toLowerCase()} channel`} className="small" onClick={onCreate} />}
      </header>
      <ul>
        {channels.map((c, index) => {
          // The open channel is being read: no badge there.
          const entry = c.id === selectedId ? undefined : unread?.(c);
          const hasUnread = isUnread(entry);
          const dropClass = drag && drag.over === index && drag.id !== c.id ? (drag.after ? " drop-after" : " drop-before") : "";
          return (
            <li
              key={c.id}
              className={`${manage ? "manageable" : ""}${drag?.id === c.id ? " dragging" : ""}${dropClass}`}
              draggable={manage !== undefined}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", c.name);
                setDrag({ id: c.id, over: index, after: false });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > rect.top + rect.height / 2;
                if (drag.over !== index || drag.after !== after) setDrag({ ...drag, over: index, after });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!drag) return;
                const from = channels.findIndex((x) => x.id === drag.id);
                const to = dropIndex(from, index, drag.after);
                setDrag(null);
                if (from >= 0 && to !== from) manage?.onMove(channels[from], to);
              }}
              onDragEnd={() => setDrag(null)}
            >
              <button
                className={`channel-row${hasUnread ? " unread" : ""}`}
                aria-current={c.id === selectedId}
                aria-label={hasUnread ? `${c.name}, ${unreadLabel(entry!.unreadCount)} unread` : undefined}
                title={c.topic ?? undefined}
                onClick={() => onSelect(c)}
                onContextMenu={(e) => {
                  if (!manage) return;
                  e.preventDefault();
                  openMenu(c, index, e.clientX, e.clientY);
                }}
              >
                {c.type === "text" ? <Hash size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
                <span>{c.name}</span>
                {hasUnread && (
                  <span className="unread-badge" aria-hidden="true">
                    {unreadLabel(entry!.unreadCount)}
                  </span>
                )}
              </button>
              {manage && (
                <IconButton
                  icon={Settings}
                  label={`Manage ${c.name}`}
                  className="small channel-row-action"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    openMenu(c, index, rect.left, rect.bottom + 4);
                  }}
                />
              )}
              {renderExtra?.(c)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const SHOW_MEMBERS_KEY = "ovrilo.showMembers";

/** Member list visibility is a per-device preference; storage may be unavailable. */
function readShowMembers(): boolean {
  try {
    return localStorage.getItem(SHOW_MEMBERS_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeShowMembers(value: boolean) {
  try {
    localStorage.setItem(SHOW_MEMBERS_KEY, String(value));
  } catch {
    // Not remembered; the default applies next time.
  }
}

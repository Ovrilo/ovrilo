import {
  ChevronDown,
  Phone,
  HeadphoneOff,
  Hash,
  LogIn,
  LogOut,
  MicOff,
  Pencil,
  Plus,
  Settings,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { Schemas } from "../../api/client";
import { useApi, useRealtime } from "../../auth/SessionContext";
import { Avatar, CommunityIcon, IconButton } from "../../components/ui";
import { useCallActions, useCallState } from "../friends/calls";
import { type Conversation, GROUP_MAX_MEMBERS, type GroupConversation, useConversations, useDirectMessagesSync, useOpenDirectMessage } from "../friends/dms";
import { AddToGroupDialog, CreateGroupDialog, LeaveGroupDialog, RenameGroupDialog } from "../friends/GroupDialogs";
import { GroupAvatar, GroupMembersPanel } from "../friends/GroupParts";
import { IncomingCall, type IncomingCallInfo } from "../friends/IncomingCall";
import { useFriendRequests, useFriendsSync } from "../friends/friends";
import { FriendsView } from "../friends/FriendsView";
import { TextChannel } from "../messages/TextChannel";
import { type ChannelUnread, isUnread, unreadLabel, useCommunitiesWithUnread, useUnread, useUnreadSync } from "../messages/unread";
import { SettingsDialog } from "../settings/SettingsDialog";
import { UpdateBanner } from "../update/UpdateBanner";
import { useJoinVoice } from "../voice/useJoinVoice";
import { ParticipantMenu, type ParticipantMenuTarget } from "../voice/ParticipantMenu";
import { useVoice, voice, voiceAvailable } from "../voice/voice";
import { VoiceDock } from "../voice/VoiceDock";
import { useMuteBlockedInVoice } from "../voice/useMuteBlocked";
import { VoiceRoom } from "../voice/VoiceRoom";
import { MembersPanel } from "./MembersPanel";
import { ChannelMenu, type ChannelMenuTarget } from "./ChannelMenu";
import { type CommunityAction, CommunityMenu } from "./CommunityMenu";
import { dropIndex, moveChannel } from "./channelOrder";
import {
  CommunitySettingsDialog,
  CreateChannelDialog,
  CreateCommunityDialog,
  DeleteChannelDialog,
  DeleteCommunityDialog,
  EditChannelDialog,
  InviteDialog,
  JoinCommunityDialog,
  LeaveCommunityDialog,
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
  | "communitySettings"
  | "deleteCommunity"
  | "leaveCommunity"
  | "settings"
  | { kind: "createChannel"; type: Channel["type"] }
  | { kind: "editChannel" | "deleteChannel"; channel: Channel }
  | { kind: "createGroup" }
  | { kind: "addToGroup" | "renameGroup"; group: GroupConversation }
  | { kind: "leaveGroup"; conversation: Conversation; userId: string; userName: string }
  | null;

export function MainShell({ user }: { user: Schemas["CurrentUserResponse"] }) {
  const communities = useCommunities();
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  // Last opened channel per community, so switching back returns to it.
  const [selectedChannels, setSelectedChannels] = useState<Readonly<Record<string, string>>>({});
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [menu, setMenu] = useState<ParticipantMenuTarget | null>(null);
  const [channelMenu, setChannelMenu] = useState<ChannelMenuTarget | null>(null);
  const [communityMenu, setCommunityMenu] = useState<{ x: number; y: number; anchor: HTMLElement } | null>(null);
  const [showMembers, setShowMembers] = useState(readShowMembers);
  // The friends home replaces the community sidebar and main pane while it is open.
  const [home, setHome] = useState(false);
  // The direct conversation open in the friends home (null: the friends page).
  const [dmId, setDmId] = useState<string | null>(null);
  useFriendsSync();
  useDirectMessagesSync();
  useMuteBlockedInVoice();
  const incomingRequests = useFriendRequests().data?.incoming.length ?? 0;
  const conversations = useConversations(user.id);
  const openDirectMessage = useOpenDirectMessage();
  const unreadDirect = conversations.data?.reduce((sum, c) => sum + c.unreadCount, 0) ?? 0;
  const homeBadge = incomingRequests + unreadDirect;
  const openDm = conversations.data?.find((c) => c.id === dmId) ?? null;
  const openGroup = openDm?.group ?? null;
  const messageFriend = (userId: string) =>
    openDirectMessage.mutate(userId, { onSuccess: (conversation) => setDmId(conversation.id) });

  // Calls in direct conversations.
  const realtime = useRealtime();
  const calls = useCallActions();
  const callState = useCallState(home && openDm ? openDm.id : null);
  const callParticipants = callState.data?.participantIds.length ?? 0;
  const [incoming, setIncoming] = useState<IncomingCallInfo | null>(null);
  const [callNotice, setCallNotice] = useState<{ conversationId: string; text: string } | null>(null);
  const inCall = (conversationId: string) => connectedChannelId === conversationId;
  const inCallRef = useRef(inCall);
  inCallRef.current = inCall;
  const connectCall = (conversation: { id: string; name: string }, answer: boolean) => {
    setCallNotice(null);
    setConnectedChannel({ id: conversation.id, name: conversation.name, communityId: "", call: true });
    calls.connect.mutate({ conversationId: conversation.id, answer });
  };
  useEffect(() => {
    const offs = [
      realtime.on("CallRinging", (ring) => {
        if (!inCallRef.current(ring.conversationId)) setIncoming(ring);
      }),
      realtime.on("CallAccepted", ({ conversationId }) =>
        setIncoming((current) => (current?.conversationId === conversationId ? null : current)),
      ),
      realtime.on("CallEnded", ({ conversationId, reason }) => {
        setIncoming((current) => (current?.conversationId === conversationId ? null : current));
        // Our call was not answered: leave the empty room and say why.
        if (inCallRef.current(conversationId) && reason !== "cancelled") {
          void voice.leave();
          setCallNotice({ conversationId, text: reason === "declined" ? "Call declined." : "No answer." });
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [realtime]);
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
  const move = useMoveChannel();

  // Our own join/leave changes occupancy: refresh right away instead of waiting for the next poll.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["communities"], predicate: (q) => q.queryKey[2] === "voice-states" });
  }, [connectedChannelId, snapshot.connection, queryClient]);
  // The room the engine joined: a voice channel, or a direct-message call (`call`, no community).
  const [connectedChannel, setConnectedChannel] = useState<
    { id: string; name: string; communityId: string; call?: boolean } | null
  >(null);
  const connectedAvatars = useMemberAvatars(connectedChannel?.communityId || null);
  const connectedCommunityId =
    connectedChannelId && connectedChannel?.id === connectedChannelId ? connectedChannel.communityId || null : null;
  useChannelUpdates(communities.data?.map((c) => c.id) ?? [], connectedChannelId, connectedCommunityId);
  const connectedName =
    connectedChannel?.id === connectedChannelId ? connectedChannel?.name ?? "Voice channel" : "Voice channel";

  const selectCommunity = (id: string) => {
    setHome(false);
    setSelectedCommunityId(id);
  };

  /** We left or deleted a community: hang up if we were talking there, then show another one. */
  const forgetCommunity = (id: string) => {
    if (connectedCommunityId === id) void voice.leave();
    setSelectedCommunityId(null);
  };

  const onCommunityAction = (action: CommunityAction) => {
    if (action === "invite") setDialog("invite");
    else if (action === "settings") setDialog("communitySettings");
    else if (action === "createChannel") setDialog({ kind: "createChannel", type: "text" });
    else if (action === "leave") setDialog("leaveCommunity");
    else setDialog("deleteCommunity");
  };
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
        <button
          className="space-button space-home"
          aria-current={home}
          aria-label={homeBadge > 0 ? `Friends and direct messages, ${homeBadge} new` : "Friends and direct messages"}
          title="Friends"
          onClick={() => setHome(true)}
        >
          <Users size={20} aria-hidden="true" />
          {homeBadge > 0 && (
            <span className="space-badge" aria-hidden="true">
              {unreadLabel(homeBadge)}
            </span>
          )}
        </button>
        <span className="rail-divider" aria-hidden="true" />
        {communities.data?.map((c) => (
          <button
            key={c.id}
            className="space-button avatar-hover-scope"
            aria-current={!home && c.id === community?.id}
            aria-label={c.name}
            title={c.name}
            onClick={() => selectCommunity(c.id)}
          >
            {communitiesWithUnread.has(c.id) && (home || c.id !== community?.id) && (
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

      <aside className="channel-sidebar" aria-label={home ? "Friends" : "Channels"}>
        {home ? (
          <>
            <header className="sidebar-header">
              <h2>Home</h2>
            </header>
            <div className="channel-list">
              <button className="channel-row" aria-current={dmId === null} onClick={() => setDmId(null)}>
                <Users size={16} aria-hidden="true" />
                <span>Friends</span>
                {incomingRequests > 0 && <span className="unread-badge">{unreadLabel(incomingRequests)}</span>}
              </button>
              <DirectMessageList
                conversations={conversations.data ?? []}
                selectedId={dmId}
                onSelect={setDmId}
                onCreateGroup={() => setDialog({ kind: "createGroup" })}
              />
            </div>
          </>
        ) : community ? (
          <>
            <header className="sidebar-header">
              <h2 className="community-title">
                <button
                  className="community-menu-button"
                  aria-haspopup="menu"
                  aria-expanded={communityMenu !== null}
                  title={community.description ?? community.name}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setCommunityMenu(communityMenu ? null : { x: rect.left, y: rect.bottom + 4, anchor: e.currentTarget });
                  }}
                >
                  <span>{community.name}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              </h2>
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
                        {snapshot.screenShare && <span className="live-pill">LIVE</span>}
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
                          {p.screenSharing && <span className="live-pill">LIVE</span>}
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
            channelName={
              connectedChannel?.call && connectedChannel.id === connectedChannelId ? `Call with ${connectedName}` : connectedName
            }
            onOpen={() => {
              if (connectedChannel?.call) {
                setHome(true);
                setDmId(connectedChannel.id);
              } else if (connectedChannel) {
                setSelectedCommunityId(connectedChannel.communityId);
                selectChannel(connectedChannel);
              }
            }}
          />
          <UserBar user={user} onSettings={() => setDialog("settings")} />
        </div>
      </aside>

      <main className="main-pane">
        {home && openDm ? (
          <>
            <header className="channel-header">
              {openGroup ? (
                <>
                  <GroupAvatar others={openDm.others} />
                  <h1>
                    <button
                      className="group-title-button"
                      title="Rename group"
                      onClick={() => setDialog({ kind: "renameGroup", group: openGroup })}
                    >
                      {openDm.title}
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                  </h1>
                  <span className="muted channel-topic">
                    {openGroup.members.length} {openGroup.members.length === 1 ? "member" : "members"}
                  </span>
                </>
              ) : (
                <>
                  <Avatar name={openDm.title} assetId={openDm.others[0]?.avatarAssetId ?? null} size="xs" />
                  <h1>{openDm.title}</h1>
                  <span className="muted channel-topic">@{openDm.others[0]?.username}</span>
                </>
              )}
              {voiceAvailable && !inCall(openDm.id) && openDm.others.length > 0 && (
                <IconButton
                  icon={Phone}
                  label={callParticipants > 0 ? "Join the call" : `Call ${openDm.title}`}
                  className="channel-header-action"
                  disabled={calls.connect.isPending}
                  onClick={() =>
                    connectCall(
                      { id: openDm.id, name: openDm.title },
                      callParticipants > 0 || (callState.data?.ringingIds ?? []).includes(user.id),
                    )
                  }
                />
              )}
              {openGroup && (
                <>
                  <IconButton
                    icon={UserPlus}
                    label={openGroup.members.length >= GROUP_MAX_MEMBERS ? "This group is full" : "Add friends"}
                    className={voiceAvailable && !inCall(openDm.id) ? undefined : "channel-header-action"}
                    disabled={openGroup.members.length >= GROUP_MAX_MEMBERS}
                    onClick={() => setDialog({ kind: "addToGroup", group: openGroup })}
                  />
                  <IconButton
                    icon={Users}
                    label={showMembers ? "Hide member list" : "Show member list"}
                    tone={showMembers ? "active" : "default"}
                    aria-pressed={showMembers}
                    onClick={() => {
                      setShowMembers(!showMembers);
                      writeShowMembers(!showMembers);
                    }}
                  />
                  <IconButton
                    icon={LogOut}
                    label="Leave group"
                    onClick={() =>
                      setDialog({ kind: "leaveGroup", conversation: openDm, userId: user.id, userName: user.displayName })
                    }
                  />
                </>
              )}
            </header>
            {(inCall(openDm.id) || callParticipants > 0) && (
              <div className="dm-call">
                {inCall(openDm.id) && callState.data?.ringingFrom === user.id && snapshot.participants.length === 0 && (
                  <p className="dm-call-status" role="status">
                    Calling {openDm.title}…{" "}
                    <button
                      className="link"
                      onClick={() => {
                        calls.decline.mutate(openDm.id);
                        void voice.leave();
                      }}
                    >
                      Cancel
                    </button>
                  </p>
                )}
                <VoiceRoom
                  key={`call-${openDm.id}`}
                  channel={{ id: openDm.id, name: openDm.title, communityId: "" }}
                  call={{
                    others: openDm.others,
                    title: openDm.title,
                    ringingFrom: callState.data?.ringingFrom ?? null,
                    occupied: callParticipants > 0,
                  }}
                  user={user}
                  otherChannelName={connectedChannelId && connectedChannelId !== openDm.id ? connectedName : null}
                  join={{
                    mutate: () => connectCall({ id: openDm.id, name: openDm.title }, true),
                    isPending: calls.connect.isPending,
                    error: calls.connect.error,
                  }}
                />
              </div>
            )}
            {callNotice?.conversationId === openDm.id && (
              <p className="dm-call-status muted" role="status">
                {callNotice.text}
              </p>
            )}
            <div className="channel-body">
              <TextChannel
                key={openDm.id}
                channel={{ id: openDm.id, name: openDm.title, communityId: "" }}
                user={user}
                canModerate={false}
                direct={{
                  unread: dmUnread(openDm),
                  group: openGroup !== null,
                  picture: openGroup ? (
                    <GroupAvatar others={openDm.others} size="lg" />
                  ) : (
                    <Avatar name={openDm.title} assetId={openDm.others[0]?.avatarAssetId ?? null} size="lg" />
                  ),
                  intro: openGroup
                    ? `This is the beginning of the ${openDm.title} group.`
                    : `This is the beginning of your direct messages with ${openDm.title}.`,
                }}
              />
              {openGroup && showMembers && (
                <GroupMembersPanel
                  group={openGroup}
                  selfId={user.id}
                  onRemove={
                    openGroup.ownerId === user.id
                      ? (member) =>
                          setDialog({ kind: "leaveGroup", conversation: openDm, userId: member.id, userName: member.displayName })
                      : undefined
                  }
                />
              )}
            </div>
          </>
        ) : home ? (
          <FriendsView onMessage={messageFriend} />
        ) : channel ? (
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

      {incoming && (
        <IncomingCall
          call={incoming}
          busy={calls.connect.isPending}
          onAccept={() => {
            setIncoming(null);
            setHome(true);
            setDmId(incoming.conversationId);
            const known = conversations.data?.find((c) => c.id === incoming.conversationId);
            connectCall({ id: incoming.conversationId, name: known?.title ?? incoming.groupName ?? incoming.caller.displayName }, true);
          }}
          onDecline={() => {
            calls.decline.mutate(incoming.conversationId);
            setIncoming(null);
          }}
        />
      )}

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
      {dialog === "communitySettings" && community && (
        <CommunitySettingsDialog community={community} onClose={() => setDialog(null)} />
      )}
      {dialog === "deleteCommunity" && community && (
        <DeleteCommunityDialog
          community={community}
          onDeleted={() => forgetCommunity(community.id)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "leaveCommunity" && community && (
        <LeaveCommunityDialog community={community} onLeft={() => forgetCommunity(community.id)} onClose={() => setDialog(null)} />
      )}
      {communityMenu && community && (
        <CommunityMenu
          community={community}
          x={communityMenu.x}
          y={communityMenu.y}
          anchor={communityMenu.anchor}
          onAction={onCommunityAction}
          onClose={() => setCommunityMenu(null)}
        />
      )}
      {typeof dialog === "object" && dialog?.kind === "createGroup" && (
        <CreateGroupDialog onClose={() => setDialog(null)} onCreated={(id) => setDmId(id)} />
      )}
      {typeof dialog === "object" && dialog?.kind === "addToGroup" && (
        <AddToGroupDialog group={dialog.group} onClose={() => setDialog(null)} />
      )}
      {typeof dialog === "object" && dialog?.kind === "renameGroup" && (
        <RenameGroupDialog group={dialog.group} onClose={() => setDialog(null)} />
      )}
      {typeof dialog === "object" && dialog?.kind === "leaveGroup" && (
        <LeaveGroupDialog
          conversation={dialog.conversation}
          selfId={user.id}
          userId={dialog.userId}
          userName={dialog.userName}
          onClose={() => setDialog(null)}
          onLeft={() => {
            if (connectedChannelId === dialog.conversation.id) void voice.leave();
            setDmId(null);
          }}
        />
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
          {p.screenSharing && <span className="live-pill">LIVE</span>}
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

/** A direct or group conversation's unread state in the shape text views use for channels. */
function dmUnread(conversation: Conversation): ChannelUnread {
  return {
    channelId: conversation.id,
    lastReadMessageId: conversation.lastReadMessageId,
    lastMessageId: conversation.lastMessageId,
    unreadCount: conversation.unreadCount,
  };
}

function DirectMessageList({
  conversations,
  selectedId,
  onSelect,
  onCreateGroup,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateGroup: () => void;
}) {
  return (
    <section className="channel-group" aria-label="Direct messages">
      <header>
        <h3>Direct messages</h3>
        <IconButton icon={Plus} label="New group" className="small" onClick={onCreateGroup} />
      </header>
      {conversations.length === 0 ? (
        <p className="muted small sidebar-hint">Message a friend from the Friends page, or start a group with +.</p>
      ) : (
        <ul>
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                className={`channel-row dm-row avatar-hover-scope${c.unreadCount > 0 && c.id !== selectedId ? " unread" : ""}`}
                aria-current={c.id === selectedId}
                onClick={() => onSelect(c.id)}
              >
                {c.group ? (
                  <GroupAvatar others={c.others} />
                ) : (
                  <Avatar name={c.title} assetId={c.others[0]?.avatarAssetId ?? null} size="xs" />
                )}
                <span className="dm-row-text">
                  <span className="dm-row-title">{c.title}</span>
                  {c.group && (
                    <span className="dm-row-subtitle">
                      {c.group.members.length} {c.group.members.length === 1 ? "member" : "members"}
                    </span>
                  )}
                </span>
                {c.unreadCount > 0 && c.id !== selectedId && (
                  <span className="unread-badge">{unreadLabel(c.unreadCount)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

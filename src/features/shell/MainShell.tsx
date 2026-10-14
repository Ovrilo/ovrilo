import { Hash, LogIn, Plus, UserPlus, Volume2 } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { Schemas } from "../../api/client";
import { Avatar, IconButton, initials } from "../../components/ui";
import { SettingsDialog } from "../settings/SettingsDialog";
import { useJoinVoice } from "../voice/useJoinVoice";
import { useVoice, voiceAvailable } from "../voice/voice";
import { VoiceDock } from "../voice/VoiceDock";
import { VoiceRoom } from "../voice/VoiceRoom";
import { CreateChannelDialog, CreateCommunityDialog, InviteDialog, JoinCommunityDialog } from "./dialogs";
import { useChannels, useCommunities } from "./queries";
import logo from "../../assets/logo.webp";
import { UserBar } from "./UserBar";

type OpenDialog = "createCommunity" | "joinCommunity" | "invite" | "createChannel" | "settings" | null;
type Channel = Schemas["ChannelResponse"];

export function MainShell({ user }: { user: Schemas["CurrentUserResponse"] }) {
  const communities = useCommunities();
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const { snapshot } = useVoice();
  const join = useJoinVoice();

  const community =
    communities.data?.find((c) => c.id === selectedCommunityId) ?? communities.data?.[0] ?? null;
  const channels = useChannels(community?.id ?? null);
  const channel = channels.data?.find((c) => c.id === selectedChannelId) ?? null;
  const isOwner = community?.myRole === "owner";

  // The room the engine is in; its channel may belong to another community than the one shown.
  const connectedChannelId = snapshot.connection === "disconnected" ? null : snapshot.channelId;
  const [connectedChannel, setConnectedChannel] = useState<{ id: string; name: string; communityId: string } | null>(
    null,
  );
  const connectedName =
    connectedChannel?.id === connectedChannelId ? connectedChannel?.name ?? "Voice channel" : "Voice channel";

  const selectCommunity = (id: string) => {
    setSelectedCommunityId(id);
    setSelectedChannelId(null);
  };

  const joinVoice = (target: Channel) => {
    setConnectedChannel({ id: target.id, name: target.name, communityId: target.communityId });
    join.mutate(target.id);
  };

  /** One click joins a voice channel (DESIGN.md §5.1) unless that would silently leave another room. */
  const openChannel = (target: Channel) => {
    setSelectedChannelId(target.id);
    if (target.type === "voice" && voiceAvailable && !connectedChannelId && !join.isPending) {
      joinVoice(target);
    }
  };

  const voiceChannels = channels.data?.filter((c) => c.type === "voice") ?? [];
  const textChannels = channels.data?.filter((c) => c.type === "text") ?? [];

  return (
    <div className="app-shell">
      <nav className="space-rail" aria-label="Communities">
        {communities.data?.map((c) => (
          <button
            key={c.id}
            className="space-button"
            aria-current={c.id === community?.id}
            aria-label={c.name}
            title={c.name}
            onClick={() => selectCommunity(c.id)}
          >
            {initials(c.name)}
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
              <IconButton icon={UserPlus} label="Invite people" onClick={() => setDialog("invite")} />
            </header>
            <div className="channel-list">
              <ChannelGroup
                title="Voice"
                channels={voiceChannels}
                selectedId={channel?.id}
                canCreate={isOwner}
                onCreate={() => setDialog("createChannel")}
                onSelect={openChannel}
                renderExtra={(c) =>
                  c.id === connectedChannelId ? (
                    <ul className="channel-members" aria-label={`In ${c.name}`}>
                      <li>
                        <Avatar name={user.displayName} size="xs" speaking={snapshot.selfSpeaking} />
                        {user.displayName}
                      </li>
                      {snapshot.participants.map((p) => (
                        <li key={p.id}>
                          <Avatar name={p.name} size="xs" speaking={p.speaking} />
                          {p.name}
                        </li>
                      ))}
                    </ul>
                  ) : null
                }
              />
              <ChannelGroup
                title="Text"
                channels={textChannels}
                selectedId={channel?.id}
                canCreate={isOwner}
                onCreate={() => setDialog("createChannel")}
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
          <VoiceDock
            channelName={connectedName}
            onOpen={() => {
              if (connectedChannel) {
                setSelectedCommunityId(connectedChannel.communityId);
                setSelectedChannelId(connectedChannel.id);
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
              {channel.topic && <span className="muted channel-topic">{channel.topic}</span>}
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
              <div className="empty-state">
                <Hash size={32} aria-hidden="true" />
                <p className="muted">Text messaging arrives in a later update.</p>
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <img src={logo} alt="" width={72} height={72} className="empty-logo" />
            <h1>Ovrilo</h1>
            <p className="muted">
              {community ? "Pick a voice channel to start talking." : "Create a community or join one with an invite."}
            </p>
          </div>
        )}
      </main>

      {dialog === "createCommunity" && (
        <CreateCommunityDialog onClose={() => setDialog(null)} onCreated={selectCommunity} />
      )}
      {dialog === "joinCommunity" && <JoinCommunityDialog onClose={() => setDialog(null)} onJoined={selectCommunity} />}
      {dialog === "invite" && community && <InviteDialog communityId={community.id} onClose={() => setDialog(null)} />}
      {dialog === "createChannel" && community && (
        <CreateChannelDialog communityId={community.id} onClose={() => setDialog(null)} />
      )}
      {dialog === "settings" && <SettingsDialog user={user} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ChannelGroup({
  title,
  channels,
  selectedId,
  canCreate,
  onCreate,
  onSelect,
  renderExtra,
}: {
  title: string;
  channels: Channel[];
  selectedId: string | undefined;
  canCreate: boolean;
  onCreate: () => void;
  onSelect: (channel: Channel) => void;
  renderExtra?: (channel: Channel) => ReactNode;
}) {
  if (channels.length === 0 && !canCreate) return null;
  return (
    <section className="channel-group">
      <header>
        <h3>{title}</h3>
        {canCreate && <IconButton icon={Plus} label={`Create ${title.toLowerCase()} channel`} className="small" onClick={onCreate} />}
      </header>
      <ul>
        {channels.map((c) => (
          <li key={c.id}>
            <button className="channel-row" aria-current={c.id === selectedId} onClick={() => onSelect(c)}>
              {c.type === "text" ? <Hash size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
              <span>{c.name}</span>
            </button>
            {renderExtra?.(c)}
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useState } from "react";

import type { Schemas } from "../../api/client";
import { useSession } from "../../auth/SessionContext";
import { voice, voiceAvailable, useVoice } from "../voice/voice";
import { VoicePanel } from "../voice/VoicePanel";
import { CreateChannelDialog, CreateCommunityDialog, InviteDialog, JoinCommunityDialog } from "./dialogs";
import { useChannels, useCommunities } from "./queries";

type OpenDialog = "createCommunity" | "joinCommunity" | "invite" | "createChannel" | null;

export function MainShell({ user }: { user: Schemas["CurrentUserResponse"] }) {
  const { session } = useSession();
  const communities = useCommunities();
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const { snapshot: voiceState } = useVoice();
  const connectedChannelId = voiceState.connection === "disconnected" ? null : voiceState.channelId;

  const community =
    communities.data?.find((c) => c.id === selectedCommunityId) ?? communities.data?.[0] ?? null;
  const channels = useChannels(community?.id ?? null);
  const channel = channels.data?.find((c) => c.id === selectedChannelId) ?? null;
  const isOwner = community?.myRole === "owner";

  const selectCommunity = (id: string) => {
    setSelectedCommunityId(id);
    setSelectedChannelId(null);
  };

  return (
    <div className="app-shell">
      <nav className="space-rail" aria-label="Communities">
        {communities.data?.map((c) => (
          <button
            key={c.id}
            className="space-button"
            aria-current={c.id === community?.id}
            title={c.name}
            onClick={() => selectCommunity(c.id)}
          >
            {initials(c.name)}
          </button>
        ))}
        <button className="space-button add" title="Create a community" onClick={() => setDialog("createCommunity")}>
          +
        </button>
        <button className="space-button add" title="Join with an invitation" onClick={() => setDialog("joinCommunity")}>
          ⇥
        </button>
      </nav>

      <aside className="channel-sidebar" aria-label="Channels">
        {community ? (
          <>
            <header className="sidebar-header">
              <h2 title={community.name}>{community.name}</h2>
              <button className="ghost" onClick={() => setDialog("invite")}>
                Invite
              </button>
            </header>
            <ChannelGroup
              title="Voice"
              channels={channels.data?.filter((c) => c.type === "voice") ?? []}
              selectedId={channel?.id}
              connectedId={connectedChannelId}
              onSelect={setSelectedChannelId}
            />
            <ChannelGroup
              title="Text"
              channels={channels.data?.filter((c) => c.type === "text") ?? []}
              selectedId={channel?.id}
              onSelect={setSelectedChannelId}
            />
            {isOwner && (
              <button className="ghost add-channel" onClick={() => setDialog("createChannel")}>
                + Add channel
              </button>
            )}
            {channels.isError && <p className="form-error">Channels could not be loaded.</p>}
          </>
        ) : (
          <p className="muted">{communities.isPending ? "Loading…" : "Create or join a community to get started."}</p>
        )}

        <footer className="user-strip">
          <div>
            <strong>{user.displayName}</strong>
            <span className="muted">@{user.username}</span>
          </div>
          <button
            className="ghost"
            onClick={() => {
              // The room grant belongs to this account; never stay connected after signing out.
              if (voiceAvailable) void voice.leave();
              void session.signOut();
            }}
          >
            Sign out
          </button>
        </footer>
      </aside>

      <main className="main-pane">
        {channel ? (
          <>
            <header className="channel-header">
              <h1>
                {channel.type === "text" ? "# " : "🔊 "}
                {channel.name}
              </h1>
              {channel.topic && <span className="muted">{channel.topic}</span>}
            </header>
            {channel.type === "voice" ? (
              <VoicePanel key={channel.id} channel={channel} />
            ) : (
              <div className="empty-state">
                <p className="muted">Text messaging is not available yet.</p>
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <h1>Ovrilo</h1>
            <p className="muted">{community ? "Select a channel." : "No community selected."}</p>
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
    </div>
  );
}

function ChannelGroup({
  title,
  channels,
  selectedId,
  connectedId,
  onSelect,
}: {
  title: string;
  channels: Schemas["ChannelResponse"][];
  selectedId: string | undefined;
  connectedId?: string | null;
  onSelect: (id: string) => void;
}) {
  if (channels.length === 0) return null;
  return (
    <section className="channel-group">
      <h3>{title}</h3>
      <ul>
        {channels.map((c) => (
          <li key={c.id}>
            <button className="channel-row" aria-current={c.id === selectedId} onClick={() => onSelect(c.id)}>
              <span aria-hidden="true">{c.type === "text" ? "#" : "🔊"}</span> {c.name}
              {c.id === connectedId && <span className="voice-dot connected" title="You are in this channel" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

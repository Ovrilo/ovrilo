import { Ban, Check, MessageCircle, UserMinus, Users, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { problemMessage } from "../../api/client";
import { Avatar, IconButton } from "../../components/ui";
import {
  type Friend,
  type FriendRequest,
  type SocialUser,
  useBlocks,
  useFriendActions,
  useFriendRequests,
  useFriends,
  useFriendsPresence,
} from "./friends";

type Tab = "online" | "all" | "pending" | "blocked" | "add";

/** The friends home (DESIGN.md §5): who is online, requests to answer, blocks, and adding someone. */
export function FriendsView({ onMessage }: { onMessage: (userId: string) => void }) {
  const [tab, setTab] = useState<Tab>("online");
  const friends = useFriends();
  const requests = useFriendRequests();
  const blocks = useBlocks(tab === "blocked");
  const online = useFriendsPresence();
  const incoming = requests.data?.incoming.length ?? 0;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "online", label: "Online" },
    { id: "all", label: "All" },
    { id: "pending", label: "Pending", count: incoming },
    { id: "blocked", label: "Blocked" },
  ];

  return (
    <div className="friends">
      <header className="channel-header friends-header">
        <Users size={18} aria-hidden="true" />
        <h1>Friends</h1>
        <nav className="friends-tabs" role="tablist" aria-label="Friends">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {t.count ? <span className="unread-badge">{t.count}</span> : null}
            </button>
          ))}
          <button role="tab" className="friends-add-tab" aria-selected={tab === "add"} onClick={() => setTab("add")}>
            Add friend
          </button>
        </nav>
      </header>
      <div className="friends-body">
        {tab === "add" ? (
          <AddFriend />
        ) : tab === "pending" ? (
          <PendingList incoming={requests.data?.incoming ?? []} outgoing={requests.data?.outgoing ?? []} loading={requests.isPending} />
        ) : tab === "blocked" ? (
          <BlockedList blocked={blocks.data ?? []} loading={blocks.isPending} />
        ) : (
          <FriendList
            friends={(friends.data ?? []).filter((f) => tab === "all" || online.has(f.user.id))}
            online={online}
            loading={friends.isPending}
            empty={
              tab === "online"
                ? (friends.data?.length ?? 0) > 0
                  ? "None of your friends are online right now."
                  : "No friends yet. Add someone by their username."
                : "No friends yet. Add someone by their username."
            }
            onAdd={() => setTab("add")}
            onMessage={onMessage}
            heading={tab === "online" ? "Online" : "All friends"}
          />
        )}
      </div>
    </div>
  );
}

function AddFriend() {
  const { send } = useFriendActions();
  const [username, setUsername] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = username.trim().replace(/^@/, "");
    if (!name) return;
    setResult(null);
    send.mutate(name, {
      onSuccess: (data) => {
        setUsername("");
        setResult(
          data.outcome === "friends"
            ? { ok: true, text: `You and ${data.friend?.user.displayName ?? name} are now friends.` }
            : { ok: true, text: `Friend request sent to ${data.request?.user.displayName ?? name}.` },
        );
      },
      onError: (error) =>
        setResult({
          ok: false,
          text: problemMessage(error, "The request could not be sent. Check your connection and try again."),
        }),
    });
  };

  return (
    <section className="friends-add">
      <h2>Add a friend</h2>
      <p className="muted">Enter their username. They can accept your request from their Pending tab.</p>
      <form className="friends-add-form" onSubmit={submit}>
        <input
          aria-label="Username"
          placeholder="username"
          value={username}
          autoFocus
          maxLength={40}
          onChange={(e) => {
            setUsername(e.target.value);
            setResult(null);
          }}
        />
        <button className="primary" type="submit" disabled={!username.trim() || send.isPending}>
          {send.isPending ? "Sending…" : "Send request"}
        </button>
      </form>
      {result && (
        <p className={result.ok ? "friends-add-ok small" : "form-error small"} role="status">
          {result.text}
        </p>
      )}
    </section>
  );
}

function FriendList({
  friends,
  online,
  loading,
  empty,
  heading,
  onAdd,
  onMessage,
}: {
  friends: Friend[];
  online: ReadonlySet<string>;
  loading: boolean;
  empty: string;
  heading: string;
  onAdd: () => void;
  onMessage: (userId: string) => void;
}) {
  const { remove, block } = useFriendActions();
  const [filter, setFilter] = useState("");
  if (loading) return <p className="muted friends-note">Loading friends…</p>;
  if (friends.length === 0) {
    return (
      <div className="friends-empty">
        <p className="muted">{empty}</p>
        <button className="ghost" onClick={onAdd}>
          Add a friend
        </button>
      </div>
    );
  }
  const query = filter.trim().toLowerCase();
  const shown = friends.filter(
    (f) => !query || f.user.displayName.toLowerCase().includes(query) || f.user.username.includes(query),
  );
  return (
    <>
      <input
        className="friends-filter"
        aria-label="Search friends"
        placeholder="Search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <h2 className="friends-count">
        {heading} — {shown.length}
      </h2>
      <ul className="friends-list">
        {shown.map((f) => (
          <PersonRow key={f.user.id} user={f.user} online={online.has(f.user.id)} status={online.has(f.user.id) ? "Online" : "Offline"}>
            <IconButton icon={MessageCircle} label={`Message ${f.user.displayName}`} onClick={() => onMessage(f.user.id)} />
            <IconButton
              icon={UserMinus}
              label={`Remove ${f.user.displayName}`}
              onClick={() => {
                if (window.confirm(`Remove ${f.user.displayName} from your friends?`)) remove.mutate(f.user.id);
              }}
            />
            <IconButton
              icon={Ban}
              label={`Block ${f.user.displayName}`}
              tone="danger"
              onClick={() => {
                if (window.confirm(`Block ${f.user.displayName}? They will be removed from your friends and cannot send you requests.`))
                  block.mutate(f.user.id);
              }}
            />
          </PersonRow>
        ))}
      </ul>
    </>
  );
}

function PendingList({ incoming, outgoing, loading }: { incoming: FriendRequest[]; outgoing: FriendRequest[]; loading: boolean }) {
  const { accept, decline, cancel } = useFriendActions();
  if (loading) return <p className="muted friends-note">Loading requests…</p>;
  if (incoming.length === 0 && outgoing.length === 0) {
    return <p className="muted friends-note">No pending requests.</p>;
  }
  return (
    <>
      {incoming.length > 0 && (
        <>
          <h2 className="friends-count">Received — {incoming.length}</h2>
          <ul className="friends-list">
            {incoming.map((r) => (
              <PersonRow key={r.id} user={r.user} status="Sent you a friend request">
                <IconButton icon={Check} label={`Accept ${r.user.displayName}`} tone="active" onClick={() => accept.mutate(r.id)} />
                <IconButton icon={X} label={`Decline ${r.user.displayName}`} onClick={() => decline.mutate(r.id)} />
              </PersonRow>
            ))}
          </ul>
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <h2 className="friends-count">Sent — {outgoing.length}</h2>
          <ul className="friends-list">
            {outgoing.map((r) => (
              <PersonRow key={r.id} user={r.user} status="Waiting for an answer">
                <IconButton icon={X} label={`Cancel the request to ${r.user.displayName}`} onClick={() => cancel.mutate(r.id)} />
              </PersonRow>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function BlockedList({ blocked, loading }: { blocked: { user: SocialUser }[]; loading: boolean }) {
  const { unblock } = useFriendActions();
  if (loading) return <p className="muted friends-note">Loading…</p>;
  if (blocked.length === 0) return <p className="muted friends-note">You have not blocked anyone.</p>;
  return (
    <>
      <h2 className="friends-count">Blocked — {blocked.length}</h2>
      <ul className="friends-list">
        {blocked.map((b) => (
          <PersonRow key={b.user.id} user={b.user} status="Blocked">
            <button className="ghost small-button" onClick={() => unblock.mutate(b.user.id)}>
              Unblock
            </button>
          </PersonRow>
        ))}
      </ul>
    </>
  );
}

function PersonRow({
  user,
  status,
  online,
  children,
}: {
  user: SocialUser;
  status: string;
  online?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="friend-row avatar-hover-scope">
      <span className="presence-avatar">
        <Avatar name={user.displayName} assetId={user.avatarAssetId} size="md" />
        {online !== undefined && (
          <span className={`presence-dot${online ? " online" : ""}`} role="img" aria-label={online ? "Online" : "Offline"} />
        )}
      </span>
      <span className="friend-text">
        <strong>{user.displayName}</strong>
        <span className="muted small">
          @{user.username} · {status}
        </span>
      </span>
      <span className="friend-actions">{children}</span>
    </li>
  );
}

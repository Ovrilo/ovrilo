import { ArrowDown, Ban, Pencil, Trash2 } from "lucide-react";
import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { problemMessage, type Schemas } from "../../api/client";
import { Avatar } from "../../components/ui";
import { useBlocks } from "../friends/friends";
import { InviteCard, inviteCode, withoutInviteLink } from "../friends/invites";
import { blockedRuns, groupRows, type Message } from "./history";
import { sendThrottle } from "./throttle";
import { type PendingMessage, useChannelMessages } from "./useChannelMessages";
import { type ChannelUnread, useMarkRead, useUnread } from "./unread";

const MAX_LENGTH = 4000;

const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : dateTimeFormat.format(date);
}

interface TextChannelProps {
  /** A community text channel, or a direct conversation (its id is used as the channel id). */
  channel: Pick<Schemas["ChannelResponse"], "id" | "name" | "communityId">;
  user: Schemas["CurrentUserResponse"];
  /** May delete other people's messages (community owners). */
  canModerate: boolean;
  /**
   * Set for a direct or group conversation: its unread state (communities keep theirs per channel)
   * and what replaces the channel's welcome text.
   */
  direct?: { unread: ChannelUnread; picture: ReactNode; intro: string; group?: boolean };
}

/** Distance from the bottom (px) that still counts as "reading the latest messages". */
const STICK_THRESHOLD = 48;

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return dayFormat.format(date);
}

/** Reports read positions this long after the view settles, not on every incoming message. */
const MARK_READ_DELAY_MS = 750;

/** Older pages loaded at most to reach the first unread message when a channel opens. */
const UNREAD_SEARCH_PAGES = 4;

/** Context kept above the "New" line when a channel opens there. */
const UNREAD_TOP_MARGIN = 24;

/** True while the window is visible and focused: only then has the person actually seen new messages. */
function useWindowAttention(): boolean {
  const read = () => document.visibilityState === "visible" && document.hasFocus();
  const [attentive, setAttentive] = useState(read);
  useEffect(() => {
    const update = () => setAttentive(read());
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return attentive;
}

/** A text channel: history with live updates, and a composer (DESIGN.md §5.3). */
export function TextChannel({ channel, user, canModerate, direct }: TextChannelProps) {
  const chat = useChannelMessages(channel.id);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [following, setFollowing] = useState(true);
  const [farFromBottom, setFarFromBottom] = useState(false);
  const [seenId, setSeenId] = useState<number | undefined>(undefined);
  const anchor = useRef<{ firstId: number | undefined; height: number }>({ firstId: undefined, height: 0 });

  const newestId = chat.messages[chat.messages.length - 1]?.id;
  const attentive = useWindowAttention();
  const markRead = useMarkRead(channel.id);
  // Messages by people you blocked are collapsed; `revealed` holds the runs you chose to show.
  const blocks = useBlocks(true).data;
  const blocked = useMemo(() => new Set(blocks?.map((b) => b.user.id)), [blocks]);
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(() => new Set());
  const toggleRun = (start: number) =>
    setRevealed((current) => {
      const next = new Set(current);
      if (!next.delete(start)) next.add(start);
      return next;
    });
  const communityUnread = useUnread(direct ? null : channel.communityId).data?.find((u) => u.channelId === channel.id);
  const unread = direct?.unread ?? communityUnread;
  // Where reading stopped when the channel was opened; the "New" line stays there while it is open.
  const [openedAt, setOpenedAt] = useState<{ lastRead: number; count: number } | null>(null);
  // The view has been placed at the first unread message (or the newest); reading counts from then.
  const [positioned, setPositioned] = useState(false);
  const olderPagesLoaded = useRef(0);
  const readTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!openedAt && unread) setOpenedAt({ lastRead: unread.lastReadMessageId ?? 0, count: unread.unreadCount });
  }, [openedAt, unread]);

  useEffect(() => () => clearTimeout(readTimer.current), []);

  // Seen = scrolled to the newest message while the window has attention.
  useEffect(() => {
    if (!following || !attentive || newestId === undefined || !positioned) return;
    const timer = setTimeout(() => markRead(newestId), MARK_READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [following, attentive, newestId, positioned, markRead]);

  /** Reading above the newest message: everything down to the last message fully in view is seen. */
  const markVisibleRead = () => {
    const element = scroller.current;
    if (!element || !positioned || !document.hasFocus()) return;
    const bottom = element.getBoundingClientRect().bottom;
    const items = element.querySelectorAll<HTMLElement>("li[data-message-id]");
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].getBoundingClientRect().bottom <= bottom + 1) {
        markRead(Number(items[i].dataset.messageId));
        return;
      }
    }
  };

  // Keep the view pinned to the bottom for new messages, and keep the reading position when older
  // messages are added above.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const firstId = chat.messages[0]?.id;
    if (anchor.current.firstId !== undefined && firstId !== undefined && firstId < anchor.current.firstId) {
      element.scrollTop += element.scrollHeight - anchor.current.height;
    } else if (atBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
    anchor.current = { firstId, height: element.scrollHeight };
  }, [chat.messages, chat.pending]);

  // What is on screen at the "New" line counts as seen once the window has attention.
  useEffect(() => {
    if (!positioned || !attentive || atBottom.current) return;
    readTimer.current = setTimeout(markVisibleRead, MARK_READ_DELAY_MS);
    return () => clearTimeout(readTimer.current);
  }, [positioned, attentive]);

  // Open at the first unread message: load older pages until it is in the history (a few at most),
  // then put the "New" line near the top. Without unread messages the view stays at the newest.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (positioned || !element || !openedAt || chat.isLoading || chat.isError) return;
    if (openedAt.count > 0) {
      const oldest = chat.messages[0]?.id;
      const reached = oldest !== undefined && oldest <= openedAt.lastRead;
      if (!reached && chat.hasOlder && olderPagesLoaded.current < UNREAD_SEARCH_PAGES) {
        if (!chat.loadingOlder) {
          olderPagesLoaded.current += 1;
          chat.loadOlder();
        }
        return;
      }
      const divider = element.querySelector<HTMLElement>(".unread-divider");
      if (divider) {
        const offset = divider.getBoundingClientRect().top - element.getBoundingClientRect().top;
        element.scrollTop += offset - UNREAD_TOP_MARGIN;
        atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD;
        setFollowing(atBottom.current);
      }
    }
    setPositioned(true);
  }, [positioned, openedAt, chat]);

  // Size changes without a scroll (the cooldown notice, a growing composer, pending messages turning
  // into stored ones, a resized window) must not unpin a reader who is at the bottom.
  useEffect(() => {
    const element = scroller.current;
    const stack = element?.firstElementChild;
    if (!element || !stack) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    observer.observe(stack);
    return () => observer.disconnect();
  }, []);

  // While following the conversation everything is read; otherwise newer messages count as unseen.
  useEffect(() => {
    if (following) setSeenId(newestId);
  }, [following, newestId]);

  // Load older messages when the top of the history scrolls into view.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !chat.hasOlder) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !chat.loadingOlder) chat.loadOlder();
      },
      { root: scroller.current, rootMargin: "200px 0px 0px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [chat.hasOlder, chat.loadingOlder, chat]);

  const jumpToPresent = () => {
    const element = scroller.current;
    if (!element) return;
    atBottom.current = true;
    setFollowing(true);
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  };

  const rows = groupRows(chat.messages);
  const runs = blockedRuns(chat.messages, blocked);
  const firstUnreadId =
    openedAt && openedAt.count > 0
      ? chat.messages.find((m) => m.id > openedAt.lastRead && m.author.id !== user.id)?.id
      : undefined;
  const unseen = seenId === undefined ? 0 : chat.messages.filter((m) => m.id > seenId && m.author.id !== user.id).length;

  return (
    <div className="text-channel">
      <div
        className="message-scroller"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
          atBottom.current = distance < STICK_THRESHOLD;
          setFollowing(atBottom.current);
          setFarFromBottom(distance > el.clientHeight);
          clearTimeout(readTimer.current);
          if (!atBottom.current) readTimer.current = setTimeout(markVisibleRead, MARK_READ_DELAY_MS);
        }}
      >
        <div className="message-stack">
          <div ref={sentinel} />
          {chat.isLoading ? (
            <p className="message-note muted">Loading messages…</p>
          ) : chat.isError ? (
            <p className="message-note form-error">Messages could not be loaded. Check your connection.</p>
          ) : (
            <>
              {chat.loadingOlder && <p className="message-note muted">Loading older messages…</p>}
              {!chat.hasOlder && (
                direct ? (
                  <div className="channel-start">
                    {direct.picture}
                    <h2>{channel.name}</h2>
                    <p className="muted">{direct.intro}</p>
                  </div>
                ) : (
                  <div className="channel-start">
                    <span className="channel-start-icon" aria-hidden="true">
                      #
                    </span>
                    <h2>Welcome to #{channel.name}</h2>
                    <p className="muted">This is the start of the channel.</p>
                  </div>
                )
              )}
              <ol className="messages" aria-label={`Messages in ${channel.name}`}>
                {rows.map(({ message, continued }, index) => {
                  const previous = rows[index - 1]?.message;
                  const newDay = !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt);
                  const firstUnread = message.id === firstUnreadId;
                  const run = runs.get(message.id);
                  const runStart = run?.start === message.id;
                  const hidden = run !== undefined && !revealed.has(run.start);
                  return (
                    <Fragment key={message.id}>
                      {newDay && (
                        <li className="day-divider" role="separator">
                          <span>{dayLabel(message.createdAt)}</span>
                        </li>
                      )}
                      {firstUnread && (
                        <li className="unread-divider" role="separator" aria-label="New messages">
                          <span>New</span>
                        </li>
                      )}
                      {run && runStart && (
                        <li className="blocked-messages">
                          <Ban size={14} aria-hidden="true" />
                          <span>
                            {run.count} blocked {run.count === 1 ? "message" : "messages"}
                          </span>
                          <button className="link" onClick={() => toggleRun(run.start)}>
                            {hidden ? "Show" : "Hide"}
                          </button>
                        </li>
                      )}
                      {!hidden && (
                        <MessageItem
                          message={message}
                          continued={continued && !newDay && !firstUnread && !runStart}
                          own={message.author.id === user.id}
                          canDelete={message.author.id === user.id || canModerate}
                          onEdit={chat.edit}
                          onDelete={chat.remove}
                        />
                      )}
                    </Fragment>
                  );
                })}
                {chat.pending.map((p) => (
                  <PendingItem key={p.clientMessageId} pending={p} user={user} onRetry={chat.retry} onDiscard={chat.discard} />
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
      {!following && (unseen > 0 || farFromBottom) && (
        <button className="jump-to-present" onClick={jumpToPresent}>
          {unseen > 0 ? `${unseen} new ${unseen === 1 ? "message" : "messages"}` : "Jump to present"}
          <ArrowDown size={14} aria-hidden="true" />
        </button>
      )}
      <Composer
        channelName={direct ? (direct.group ? channel.name : `@${channel.name}`) : `#${channel.name}`}
        onSend={(text) => {
          if (!chat.send(text)) return false;
          atBottom.current = true;
          setFollowing(true);
          return true;
        }}
      />
    </div>
  );
}

function MessageItem({
  message,
  continued,
  own,
  canDelete,
  onEdit,
  onDelete,
}: {
  message: Message;
  continued: boolean;
  own: boolean;
  canDelete: boolean;
  onEdit: (id: number, content: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = message.author.displayName ?? "Deleted user";
  const invite = inviteCode(message.content);
  const text = invite && message.content ? withoutInviteLink(message.content) : message.content;

  return (
    <li className={`message avatar-hover-scope${continued ? " continued" : ""}`} data-message-id={message.id}>
      {continued ? (
        <time className="message-gutter-time" dateTime={message.createdAt} title={formatTime(message.createdAt)}>
          {timeFormat.format(new Date(message.createdAt))}
        </time>
      ) : (
        <Avatar name={name} assetId={message.author.avatarAssetId} size="md" />
      )}
      <div className="message-body">
        {!continued && (
          <div className="message-meta">
            <strong>{name}</strong>
            <time className="muted" dateTime={message.createdAt}>
              {formatTime(message.createdAt)}
            </time>
          </div>
        )}
        {editing ? (
          <EditBox
            initial={message.content ?? ""}
            onCancel={() => setEditing(false)}
            onSave={async (text) => {
              try {
                await onEdit(message.id, text);
                setEditing(false);
                setError(null);
              } catch (e) {
                setError(problemMessage(e, "Could not save the edit."));
              }
            }}
          />
        ) : (
          <>
            {text && (
              <p className="message-text">
                {text}
                {message.editedAt && <span className="message-edited muted"> (edited)</span>}
              </p>
            )}
            {invite && <InviteCard code={invite} own={own} />}
          </>
        )}
        {error && <p className="form-error small">{error}</p>}
      </div>
      {!editing && (own || canDelete) && (
        <div className="message-actions">
          {own && (
            <button className="icon-button small" aria-label="Edit message" title="Edit" onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden="true" />
            </button>
          )}
          {canDelete && (
            <button
              className="icon-button small tone-danger"
              aria-label="Delete message"
              title="Delete"
              onClick={() => {
                if (window.confirm("Delete this message? This can't be undone.")) {
                  onDelete(message.id).catch((e) => setError(problemMessage(e, "Could not delete the message.")));
                }
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function PendingItem({
  pending,
  user,
  onRetry,
  onDiscard,
}: {
  pending: PendingMessage;
  user: Schemas["CurrentUserResponse"];
  onRetry: (p: PendingMessage) => void;
  onDiscard: (p: PendingMessage) => void;
}) {
  return (
    <li className={`message pending ${pending.status}`}>
      <Avatar name={user.displayName} assetId={user.avatarAssetId} size="md" />
      <div className="message-body">
        <div className="message-meta">
          <strong>{user.displayName}</strong>
          <span className="muted">{pending.status === "sending" ? "Sending…" : "Not sent"}</span>
        </div>
        <p className="message-text">{pending.content}</p>
        {pending.status === "failed" && (
          <p className="form-error small">
            {pending.error}{" "}
            <button className="link" onClick={() => onRetry(pending)}>
              Retry
            </button>{" "}
            <button className="link" onClick={() => onDiscard(pending)}>
              Discard
            </button>
          </p>
        )}
      </div>
    </li>
  );
}

/** Whole seconds left in the send cooldown (0 when sending is allowed), updated while it runs. */
function useCooldownSeconds(): number {
  const until = useSyncExternalStore(sendThrottle.subscribe, sendThrottle.cooldownUntil);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (until <= Date.now()) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

function Composer({ channelName, onSend }: { channelName: string; onSend: (text: string) => boolean }) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const cooldown = useCooldownSeconds();

  // Grow with the content up to a few lines.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_LENGTH) return;
    // During the cooldown the text stays in the box, ready to send when it ends.
    if (onSend(trimmed)) setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const remaining = MAX_LENGTH - text.length;
  return (
    <div className={`composer${cooldown > 0 ? " cooling" : ""}`}>
      {cooldown > 0 && (
        <p className="composer-notice" role="status">
          You're sending messages too fast. You can send again in {cooldown} {cooldown === 1 ? "second" : "seconds"}.
        </p>
      )}
      <textarea
        ref={area}
        rows={1}
        value={text}
        placeholder={`Message ${channelName}`}
        aria-label={`Message ${channelName}`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {remaining < 200 && (
        <span className={`composer-count${remaining < 0 ? " over" : ""}`} aria-live="polite">
          {remaining}
        </span>
      )}
    </div>
  );
}

function EditBox({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_LENGTH) return;
    if (trimmed === initial) return onCancel();
    setSaving(true);
    await onSave(trimmed);
    setSaving(false);
  };
  return (
    <div className="edit-box">
      <textarea
        autoFocus
        value={text}
        disabled={saving}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <span className="muted small">Enter to save, Esc to cancel</span>
    </div>
  );
}

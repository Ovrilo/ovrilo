import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Hash, Volume2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { problemMessage, type Schemas } from "../../api/client";
import { useApi } from "../../auth/SessionContext";
import { Dialog } from "../../components/Dialog";
import { PicturePicker } from "../../components/PicturePicker";
import { Avatar, CommunityIcon, Select } from "../../components/ui";
import { useFriends } from "../friends/friends";
import { useInviteFriend } from "../friends/invites";
import { uploadImage } from "../../media/upload";
import { dropCommunity, queryKeys, useMembers } from "./queries";

interface DialogProps {
  onClose: () => void;
}

/** Runs an API call and turns `{ error }` results into thrown errors for react-query. */
async function unwrap<T>(call: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await call;
  if (data === undefined) throw error ?? new Error("Empty response");
  return data;
}

function FormError({ error }: { error: unknown }) {
  return error ? (
    <p className="form-error" role="alert">
      {problemMessage(error)}
    </p>
  ) : null;
}

export function CreateCommunityDialog({ onClose, onCreated }: DialogProps & { onCreated: (id: string) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (name: string) => unwrap(api.POST("/communities", { body: { name, description: null } })),
    onSuccess: async (community) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.communities });
      onCreated(community.id);
      onClose();
    },
  });

  return (
    <Dialog title="Create a community" onClose={onClose}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          mutation.mutate(String(new FormData(event.currentTarget).get("name") ?? ""));
        }}
      >
        <label>
          Name
          <input name="name" required maxLength={100} autoComplete="off" spellCheck={false} placeholder="My crew" autoFocus />
          <span className="field-hint">It starts with a #general text channel and a General voice channel.</span>
        </label>
        <FormError error={mutation.error} />
        <DialogActions onClose={onClose} busy={mutation.isPending} submitLabel="Create" />
      </form>
    </Dialog>
  );
}

/**
 * Owners: icon (applied right away), name and description (saved with Save). Members see changes
 * through CommunityUpdated.
 */
export function CommunitySettingsDialog({ community, onClose }: DialogProps & { community: Schemas["CommunityResponse"] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const apply = (updated: Schemas["CommunityResponse"]) => {
    queryClient.setQueryData<Schemas["CommunityResponse"][]>(queryKeys.communities, (list) =>
      list?.map((c) => (c.id === updated.id ? updated : c)),
    );
  };
  const save = useMutation({
    mutationFn: (body: Schemas["UpdateCommunityRequest"]) =>
      unwrap(api.PATCH("/communities/{communityId}", { params: { path: { communityId: community.id } }, body })),
    onSuccess: (updated) => {
      apply(updated);
      onClose();
    },
  });

  return (
    <Dialog title="Community settings" onClose={onClose}>
      <section className="dialog-section">
        <h3>Icon</h3>
        <PicturePicker
          preview={<CommunityIcon name={community.name} assetId={community.iconAssetId} large />}
          hasPicture={community.iconAssetId !== null}
          onUpload={async (file) => {
            const assetId = await uploadImage(api, file, "communityIcon", community.id);
            apply(
              await unwrap(
                api.PUT("/communities/{communityId}/icon", { params: { path: { communityId: community.id } }, body: { assetId } }),
              ),
            );
          }}
          onRemove={async () =>
            apply(await unwrap(api.DELETE("/communities/{communityId}/icon", { params: { path: { communityId: community.id } } })))
          }
          hint="PNG, JPEG, WebP or GIF; animated GIFs up to 8 MB. Changes apply right away."
        />
      </section>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          // An empty description clears it.
          save.mutate({ name: String(form.get("name") ?? ""), description: String(form.get("description") ?? "") });
        }}
      >
        <label>
          Name
          <input name="name" required maxLength={100} defaultValue={community.name} autoComplete="off" spellCheck={false} />
        </label>
        <label>
          Description
          <textarea
            name="description"
            maxLength={500}
            rows={3}
            defaultValue={community.description ?? ""}
            placeholder="What is this community about?"
          />
        </label>
        <FormError error={save.error} />
        <DialogActions onClose={onClose} busy={save.isPending} submitLabel="Save" />
      </form>
    </Dialog>
  );
}

/** Owners only. Typing the name guards against deleting the wrong community. */
export function DeleteCommunityDialog({
  community,
  onClose,
  onDeleted,
}: DialogProps & { community: Schemas["CommunityResponse"]; onDeleted: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/communities/{communityId}", { params: { path: { communityId: community.id } } });
      if (error) throw error;
    },
    onSuccess: () => {
      onDeleted();
      dropCommunity(queryClient, community.id);
      onClose();
    },
  });
  const confirmed = typed.trim().toLowerCase() === community.name.trim().toLowerCase();

  return (
    <Dialog title="Delete community" onClose={onClose}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if (confirmed) mutation.mutate();
        }}
      >
        <p className="dialog-warning">
          <strong>{community.name}</strong> will be deleted for everyone, with all its channels and messages. This
          cannot be undone.
        </p>
        <label>
          Type the community name to confirm
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={community.name}
            autoFocus
          />
        </label>
        <FormError error={mutation.error} />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="danger" disabled={!confirmed || mutation.isPending}>
            {mutation.isPending ? "Please wait…" : "Delete community"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function LeaveCommunityDialog({
  community,
  onClose,
  onLeft,
}: DialogProps & { community: Schemas["CommunityResponse"]; onLeft: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST("/communities/{communityId}/leave", { params: { path: { communityId: community.id } } });
      if (error) throw error;
    },
    onSuccess: () => {
      onLeft();
      dropCommunity(queryClient, community.id);
      onClose();
    },
  });

  return (
    <Dialog title="Leave community" onClose={onClose}>
      <p>
        Leave <strong>{community.name}</strong>? You can come back only with a new invitation.
      </p>
      <FormError error={mutation.error} />
      <div className="dialog-actions">
        <button type="button" onClick={onClose} autoFocus>
          Cancel
        </button>
        <button type="button" className="danger" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Please wait…" : "Leave community"}
        </button>
      </div>
    </Dialog>
  );
}

export function JoinCommunityDialog({ onClose, onJoined }: DialogProps & { onJoined: (id: string) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (code: string) => unwrap(api.POST("/invitations/accept", { body: { code } })),
    onSuccess: async (community) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.communities });
      onJoined(community.id);
      onClose();
    },
  });

  return (
    <Dialog title="Join with an invitation" onClose={onClose}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          mutation.mutate(String(new FormData(event.currentTarget).get("code") ?? "").trim());
        }}
      >
        <label>
          Invitation code
          <input name="code" required minLength={12} maxLength={12} autoComplete="off" spellCheck={false} autoFocus />
        </label>
        <FormError error={mutation.error} />
        <DialogActions onClose={onClose} busy={mutation.isPending} submitLabel="Join" />
      </form>
    </Dialog>
  );
}

export function InviteDialog({ onClose, community }: DialogProps & { community: { id: string; name: string } }) {
  const communityId = community.id;
  const api = useApi();
  const [copied, setCopied] = useState(false);
  const mutation = useMutation({
    mutationFn: (maxUses: number) =>
      unwrap(
        api.POST("/communities/{communityId}/invitations", {
          params: { path: { communityId } },
          body: { maxUses, expiresInHours: 24 },
        }),
      ),
  });
  const invitation = mutation.data;

  return (
    <Dialog title="Invite friends" onClose={onClose}>
      <InviteFriendsList community={community} />
      <h3 className="dialog-subheading">Or share a code</h3>
      {invitation ? (
        <>
          <p className="muted">
            Share this code. It works {invitation.maxUses === 1 ? "once" : `${invitation.maxUses} times`} and expires{" "}
            {new Date(invitation.expiresAt).toLocaleString()}. It cannot be shown again.
          </p>
          <div className="invite-code">
            <code>{invitation.code}</code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(invitation.code);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="dialog-actions">
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            mutation.mutate(Number(new FormData(event.currentTarget).get("maxUses") ?? 1));
          }}
        >
          <label>
            Number of uses
            <Select name="maxUses" defaultValue="1">
              <option value="1">1 person</option>
              <option value="5">5 people</option>
              <option value="25">25 people</option>
            </Select>
          </label>
          <FormError error={mutation.error} />
          <DialogActions onClose={onClose} busy={mutation.isPending} submitLabel="Create code" />
        </form>
      )}
    </Dialog>
  );
}

/** Your friends, each with an Invite button that sends a single-use invitation to your direct messages. */
function InviteFriendsList({ community }: { community: { id: string; name: string } }) {
  const friends = useFriends();
  const members = useMembers(community.id);
  const invite = useInviteFriend(community);
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const memberIds = new Set((members.data ?? []).map((m) => m.userId));
  const query = filter.trim().toLowerCase();
  const list = (friends.data ?? [])
    .map((f) => f.user)
    .filter((u) => !query || u.displayName.toLowerCase().includes(query) || u.username.toLowerCase().includes(query))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));

  if (friends.isPending) return <p className="muted small">Loading friends…</p>;
  if ((friends.data ?? []).length === 0) {
    return <p className="muted small">Add friends from the Friends page to invite them here with one click.</p>;
  }
  return (
    <div className="invite-friends">
      <input
        type="search"
        placeholder="Find a friend"
        aria-label="Find a friend"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
      <ul className="invite-friends-list" aria-label="Friends">
        {list.map((u) => {
          const member = memberIds.has(u.id);
          const done = sent.has(u.id);
          const busy = invite.isPending && invite.variables === u.id;
          return (
            <li key={u.id} className="invite-friend-row">
              <Avatar name={u.displayName} assetId={u.avatarAssetId} size="xs" />
              <span className="invite-friend-name">
                {u.displayName} <span className="muted small">@{u.username}</span>
              </span>
              {member ? (
                <span className="muted small">Member</span>
              ) : (
                <button
                  type="button"
                  className={done ? undefined : "primary"}
                  disabled={done || busy}
                  onClick={() => invite.mutate(u.id, { onSuccess: () => setSent((s) => new Set(s).add(u.id)) })}
                >
                  {done ? "Sent" : busy ? "Sending…" : "Invite"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <FormError error={invite.error} />
    </div>
  );
}

export function CreateChannelDialog({
  onClose,
  communityId,
  type,
}: DialogProps & { communityId: string; type: Schemas["ChannelType"] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Schemas["CreateChannelRequest"]) =>
      unwrap(api.POST("/communities/{communityId}/channels", { params: { path: { communityId } }, body })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.channels(communityId) });
      onClose();
    },
  });

  return (
    <Dialog title="Create a channel" onClose={onClose}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          mutation.mutate({
            name: String(form.get("name") ?? ""),
            type: form.get("type") === "voice" ? "voice" : "text",
            topic: null,
          });
        }}
      >
        <fieldset className="choice-cards">
          <legend>Type</legend>
          <label className="choice-card">
            <input type="radio" name="type" value="text" defaultChecked={type === "text"} />
            <Hash size={20} aria-hidden="true" />
            <span>
              <strong>Text</strong>
              <span>Messages and links</span>
            </span>
          </label>
          <label className="choice-card">
            <input type="radio" name="type" value="voice" defaultChecked={type === "voice"} />
            <Volume2 size={20} aria-hidden="true" />
            <span>
              <strong>Voice</strong>
              <span>Talk together</span>
            </span>
          </label>
        </fieldset>
        <label>
          Name
          <input name="name" required maxLength={100} autoComplete="off" spellCheck={false} autoFocus />
        </label>
        <FormError error={mutation.error} />
        <DialogActions onClose={onClose} busy={mutation.isPending} submitLabel="Create" />
      </form>
    </Dialog>
  );
}

/** Rename a channel or change its topic (owners). Members see it through ChannelsChanged. */
export function EditChannelDialog({ onClose, channel }: DialogProps & { channel: Schemas["ChannelResponse"] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: Schemas["UpdateChannelRequest"]) =>
      unwrap(api.PATCH("/channels/{channelId}", { params: { path: { channelId: channel.id } }, body })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.channels(channel.communityId) });
      onClose();
    },
  });

  return (
    <Dialog title="Edit channel" onClose={onClose}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          // An empty topic clears it.
          mutation.mutate({ name: String(form.get("name") ?? ""), topic: String(form.get("topic") ?? ""), position: null });
        }}
      >
        <label>
          Name
          <input name="name" required maxLength={100} defaultValue={channel.name} autoComplete="off" spellCheck={false} autoFocus />
        </label>
        {channel.type === "text" && (
          <label>
            Topic
            <textarea name="topic" maxLength={1024} rows={3} defaultValue={channel.topic ?? ""} placeholder="What is this channel about?" />
          </label>
        )}
        <FormError error={mutation.error} />
        <DialogActions onClose={onClose} busy={mutation.isPending} submitLabel="Save" />
      </form>
    </Dialog>
  );
}

export function DeleteChannelDialog({ onClose, channel }: DialogProps & { channel: Schemas["ChannelResponse"] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE("/channels/{channelId}", { params: { path: { channelId: channel.id } } });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.channels(channel.communityId) });
      onClose();
    },
  });

  return (
    <Dialog title="Delete channel" onClose={onClose}>
      <p>
        Delete <strong>{channel.type === "text" ? `#${channel.name}` : channel.name}</strong>?{" "}
        {channel.type === "text"
          ? "Its messages will no longer be visible to anyone."
          : "Everyone in it will be disconnected."}{" "}
        This cannot be undone.
      </p>
      <FormError error={mutation.error} />
      <div className="dialog-actions">
        <button type="button" onClick={onClose} autoFocus>
          Cancel
        </button>
        <button type="button" className="danger" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Please wait…" : "Delete channel"}
        </button>
      </div>
    </Dialog>
  );
}

function DialogActions({ onClose, busy, submitLabel }: { onClose: () => void; busy: boolean; submitLabel: string }) {
  return (
    <div className="dialog-actions">
      <button type="button" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Please wait…" : submitLabel}
      </button>
    </div>
  );
}

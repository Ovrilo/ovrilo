import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { problemMessage, type Schemas } from "../../api/client";
import { useApi } from "../../auth/SessionContext";
import { Dialog } from "../../components/Dialog";
import { PicturePicker } from "../../components/PicturePicker";
import { CommunityIcon } from "../../components/ui";
import { uploadImage } from "../../media/upload";
import { queryKeys } from "./queries";

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
          <input name="name" required maxLength={100} autoFocus />
        </label>
        <FormError error={mutation.error} />
        <DialogActions onClose={onClose} busy={mutation.isPending} submitLabel="Create" />
      </form>
    </Dialog>
  );
}

/** Owners pick the community's icon. Members see the change through CommunityUpdated. */
export function CommunityIconDialog({ community, onClose }: DialogProps & { community: Schemas["CommunityResponse"] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const apply = (updated: Schemas["CommunityResponse"]) => {
    queryClient.setQueryData<Schemas["CommunityResponse"][]>(queryKeys.communities, (list) =>
      list?.map((c) => (c.id === updated.id ? updated : c)),
    );
  };

  return (
    <Dialog title="Community icon" onClose={onClose}>
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
        hint="Shown to members in the community list. PNG, JPEG, WebP or GIF; animated GIFs up to 8 MB."
      />
      <div className="dialog-actions">
        <button className="primary" onClick={onClose}>
          Done
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

export function InviteDialog({ onClose, communityId }: DialogProps & { communityId: string }) {
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
            <select name="maxUses" defaultValue="1">
              <option value="1">1 person</option>
              <option value="5">5 people</option>
              <option value="25">25 people</option>
            </select>
          </label>
          <FormError error={mutation.error} />
          <DialogActions onClose={onClose} busy={mutation.isPending} submitLabel="Create code" />
        </form>
      )}
    </Dialog>
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
        <fieldset className="segmented-field">
          <legend>Type</legend>
          <label>
            <input type="radio" name="type" value="text" defaultChecked={type === "text"} /> Text
          </label>
          <label>
            <input type="radio" name="type" value="voice" defaultChecked={type === "voice"} /> Voice
          </label>
        </fieldset>
        <label>
          Name
          <input name="name" required maxLength={100} autoFocus />
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
          <input name="name" required maxLength={100} defaultValue={channel.name} autoFocus />
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

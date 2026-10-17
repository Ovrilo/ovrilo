import { Check } from "lucide-react";
import { type FormEvent, useState } from "react";

import { problemMessage } from "../../api/client";
import { Dialog } from "../../components/Dialog";
import { Avatar } from "../../components/ui";
import { type Conversation, GROUP_MAX_MEMBERS, type GroupConversation, useGroupActions } from "./dms";
import { useFriends } from "./friends";

function FormError({ error }: { error: unknown }) {
  return error ? (
    <p className="form-error" role="alert">
      {problemMessage(error)}
    </p>
  ) : null;
}

/** Friends to tick, filtered by name; at most `limit` can be picked. */
function FriendPicker({
  exclude,
  limit,
  picked,
  onChange,
}: {
  exclude: ReadonlySet<string>;
  limit: number;
  picked: readonly string[];
  onChange: (picked: string[]) => void;
}) {
  const friends = useFriends();
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const candidates = (friends.data ?? [])
    .map((f) => f.user)
    .filter((u) => !exclude.has(u.id))
    .filter((u) => !query || u.displayName.toLowerCase().includes(query) || u.username.toLowerCase().includes(query))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
  const full = picked.length >= limit;

  return (
    <div className="friend-picker">
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
      <p className="field-hint">
        {full ? `That is the most this group can take (${GROUP_MAX_MEMBERS} people).` : `You can add ${limit - picked.length} more.`}
      </p>
      {friends.isPending ? (
        <p className="muted small">Loading friends…</p>
      ) : candidates.length === 0 ? (
        <p className="muted small">{query ? "No friends match." : "No friends to add."}</p>
      ) : (
        <ul className="friend-picker-list" aria-label="Friends">
          {candidates.map((u) => {
            const checked = picked.includes(u.id);
            return (
              <li key={u.id}>
                <label className={`friend-picker-row${checked ? " checked" : ""}`}>
                  <Avatar name={u.displayName} assetId={u.avatarAssetId} size="xs" />
                  <span className="friend-picker-name">
                    {u.displayName} <span className="muted small">@{u.username}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && full}
                    onChange={() => onChange(checked ? picked.filter((id) => id !== u.id) : [...picked, u.id])}
                  />
                  <span className="friend-picker-check" aria-hidden="true">
                    {checked && <Check size={14} />}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Start a group with friends; opens it when created. */
export function CreateGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { create } = useGroupActions();
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");

  return (
    <Dialog title="New group" onClose={onClose}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          create.mutate(
            { userIds: picked, name: name.trim() || null },
            {
              onSuccess: (group) => {
                onCreated(group.id);
                onClose();
              },
            },
          );
        }}
      >
        <FriendPicker exclude={new Set()} limit={GROUP_MAX_MEMBERS - 1} picked={picked} onChange={setPicked} />
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            placeholder="Members' names"
          />
          <span className="field-hint">Optional. Anyone in the group can change it later.</span>
        </label>
        <FormError error={create.error} />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={create.isPending || picked.length === 0}>
            {create.isPending ? "Please wait…" : "Create group"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Add friends to a group, up to its size limit. */
export function AddToGroupDialog({ group, onClose }: { group: GroupConversation; onClose: () => void }) {
  const { add } = useGroupActions();
  const [picked, setPicked] = useState<string[]>([]);
  const members = new Set(group.members.map((m) => m.id));

  return (
    <Dialog title="Add friends" onClose={onClose}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          add.mutate({ groupId: group.id, userIds: picked }, { onSuccess: onClose });
        }}
      >
        <FriendPicker exclude={members} limit={GROUP_MAX_MEMBERS - group.members.length} picked={picked} onChange={setPicked} />
        <FormError error={add.error} />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={add.isPending || picked.length === 0}>
            {add.isPending ? "Please wait…" : "Add"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Any member renames the group; an empty name shows the members' names. */
export function RenameGroupDialog({ group, onClose }: { group: GroupConversation; onClose: () => void }) {
  const { rename } = useGroupActions();
  return (
    <Dialog title="Rename group" onClose={onClose}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
          rename.mutate({ groupId: group.id, name: name || null }, { onSuccess: onClose });
        }}
      >
        <label>
          Name
          <input
            name="name"
            maxLength={100}
            defaultValue={group.name ?? ""}
            autoComplete="off"
            spellCheck={false}
            placeholder="Members' names"
            autoFocus
          />
          <span className="field-hint">Everyone in the group sees the new name. Leave it empty to show members' names.</span>
        </label>
        <FormError error={rename.error} />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={rename.isPending}>
            {rename.isPending ? "Please wait…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Leave a group (yourself), or remove someone from it as its owner. */
export function LeaveGroupDialog({
  conversation,
  selfId,
  userId,
  userName,
  onClose,
  onLeft,
}: {
  conversation: Conversation;
  selfId: string;
  /** Who leaves: yourself, or the member the owner removes. */
  userId: string;
  userName: string;
  onClose: () => void;
  onLeft: () => void;
}) {
  const { remove } = useGroupActions();
  const self = userId === selfId;
  return (
    <Dialog title={self ? "Leave group" : "Remove from group"} onClose={onClose}>
      <p>
        {self ? (
          <>
            Leave <strong>{conversation.title}</strong>? You will no longer see its messages unless someone adds you
            again.
          </>
        ) : (
          <>
            Remove <strong>{userName}</strong> from <strong>{conversation.title}</strong>?
          </>
        )}
      </p>
      <FormError error={remove.error} />
      <div className="dialog-actions">
        <button type="button" onClick={onClose} autoFocus>
          Cancel
        </button>
        <button
          type="button"
          className="danger"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(
              { groupId: conversation.id, userId },
              {
                onSuccess: () => {
                  if (self) onLeft();
                  onClose();
                },
              },
            )
          }
        >
          {remove.isPending ? "Please wait…" : self ? "Leave group" : "Remove"}
        </button>
      </div>
    </Dialog>
  );
}

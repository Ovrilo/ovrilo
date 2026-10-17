import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import { problemMessage } from "../../api/client";
import { useApi } from "../../auth/SessionContext";
import { CommunityIcon } from "../../components/ui";
import { queryKeys } from "../shell/queries";
import { dmKey } from "./dms";

/** Invitations sent in messages: `ovrilo://invite/<12-character code>`. */
const INVITE_LINK = /ovrilo:\/\/invite\/([A-Za-z0-9]{12})\b/;

/** An invitation sent to a friend works once and lasts a week. */
const FRIEND_INVITE_HOURS = 24 * 7;

/** The invitation code in a message, if it carries one. */
export function inviteCode(content: string | null | undefined): string | null {
  return content?.match(INVITE_LINK)?.[1] ?? null;
}

/** The message text around the invitation link (the link itself shows as a card). */
export function withoutInviteLink(content: string): string {
  return content.replace(INVITE_LINK, "").replace(/[\s:]+$/, "").trim();
}

export function inviteMessage(communityName: string, code: string): string {
  return `Join me in ${communityName}: ovrilo://invite/${code}`;
}

/** Opens a community after joining it from an invitation card. Provided by the main shell. */
export const OpenCommunityContext = createContext<(communityId: string) => void>(() => {});

/** Creates a single-use invitation and sends it to a friend in your direct messages. */
export function useInviteFriend(community: { id: string; name: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const invitation = await api.POST("/communities/{communityId}/invitations", {
        params: { path: { communityId: community.id } },
        body: { maxUses: 1, expiresInHours: FRIEND_INVITE_HOURS },
      });
      if (!invitation.data) throw invitation.error;
      const dm = await api.POST("/dms", { body: { userId } });
      if (!dm.data) throw dm.error;
      const sent = await api.POST("/channels/{channelId}/messages", {
        params: { path: { channelId: dm.data.id } },
        body: {
          clientMessageId: crypto.randomUUID(),
          content: inviteMessage(community.name, invitation.data.code),
          replyToMessageId: null,
        },
      });
      if (!sent.data) throw sent.error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: dmKey }),
  });
}

/** Where an invitation in a message leads; refreshed now and then since it can expire or be used up. */
function useInvitationPreview(code: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["invitations", code],
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await api.POST("/invitations/preview", { body: { code } });
      if (!data) throw error;
      return data;
    },
  });
}

/** An invitation in a message: the community it leads to and a Join button. */
export function InviteCard({ code, own }: { code: string; own: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const openCommunity = useContext(OpenCommunityContext);
  const preview = useInvitationPreview(code);
  const join = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/invitations/accept", { body: { code } });
      if (!data) throw error;
      return data;
    },
    onSuccess: async (community) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.communities });
      void queryClient.invalidateQueries({ queryKey: ["invitations", code] });
      openCommunity(community.id);
    },
  });

  if (preview.isPending) {
    return <div className="invite-card muted small">Loading invitation…</div>;
  }
  if (!preview.data) {
    return (
      <div className="invite-card invalid">
        <span className="invite-card-label">Invitation</span>
        <strong>This invitation has expired or was already used.</strong>
        {!own && <span className="muted small">Ask for a new one.</span>}
      </div>
    );
  }

  const { communityId, name, iconAssetId, memberCount, alreadyMember } = preview.data;
  return (
    <div className="invite-card">
      <span className="invite-card-label">{own ? "You sent an invitation to" : "You are invited to"}</span>
      <div className="invite-card-body">
        <CommunityIcon name={name} assetId={iconAssetId} />
        <div className="invite-card-text">
          <strong>{name}</strong>
          <span className="muted small">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </span>
        </div>
        {alreadyMember ? (
          <button onClick={() => openCommunity(communityId)}>Open</button>
        ) : (
          !own && (
            <button className="primary" disabled={join.isPending} onClick={() => join.mutate()}>
              {join.isPending ? "Joining…" : "Join"}
            </button>
          )
        )}
      </div>
      {join.error && <p className="form-error small">{problemMessage(join.error)}</p>}
    </div>
  );
}

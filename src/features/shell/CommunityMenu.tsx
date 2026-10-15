import { LogOut, Plus, Settings, Trash2, UserPlus } from "lucide-react";

import type { Schemas } from "../../api/client";
import { ContextMenu } from "../../components/ContextMenu";

export type CommunityAction = "invite" | "settings" | "createChannel" | "leave" | "delete";

/** Opened from the community name: what members and owners can do with the community. */
export function CommunityMenu({
  community,
  x,
  y,
  anchor,
  onAction,
  onClose,
}: {
  community: Schemas["CommunityResponse"];
  x: number;
  y: number;
  anchor: HTMLElement | null;
  onAction: (action: CommunityAction) => void;
  onClose: () => void;
}) {
  const isOwner = community.myRole === "owner";
  const act = (action: CommunityAction) => () => {
    onClose();
    onAction(action);
  };

  return (
    <ContextMenu x={x} y={y} label={`${community.name} options`} anchor={anchor} onClose={onClose}>
      <button role="menuitem" className="context-menu-item" onClick={act("invite")}>
        <UserPlus size={14} aria-hidden="true" /> Invite people
      </button>
      {isOwner && (
        <>
          <button role="menuitem" className="context-menu-item" onClick={act("settings")}>
            <Settings size={14} aria-hidden="true" /> Community settings
          </button>
          <button role="menuitem" className="context-menu-item" onClick={act("createChannel")}>
            <Plus size={14} aria-hidden="true" /> Create channel
          </button>
        </>
      )}
      <div className="context-menu-separator" />
      {isOwner ? (
        <button role="menuitem" className="context-menu-item context-menu-danger" onClick={act("delete")}>
          <Trash2 size={14} aria-hidden="true" /> Delete community
        </button>
      ) : (
        <button role="menuitem" className="context-menu-item context-menu-danger" onClick={act("leave")}>
          <LogOut size={14} aria-hidden="true" /> Leave community
        </button>
      )}
    </ContextMenu>
  );
}

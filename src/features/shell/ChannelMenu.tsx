import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";

import type { Schemas } from "../../api/client";
import { ContextMenu } from "../../components/ContextMenu";

type Channel = Schemas["ChannelResponse"];

export interface ChannelMenuTarget {
  channel: Channel;
  /** Its place among the channels of its type, and how many there are. */
  index: number;
  count: number;
  x: number;
  y: number;
}

/** Owner actions for a channel; moving is also possible by dragging the row. */
export function ChannelMenu({
  target,
  onEdit,
  onMove,
  onDelete,
  onClose,
}: {
  target: ChannelMenuTarget;
  onEdit: () => void;
  onMove: (index: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { channel, index, count } = target;
  const act = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <ContextMenu x={target.x} y={target.y} label={`${channel.name} options`} onClose={onClose}>
      <div className="context-menu-title">{channel.type === "text" ? `#${channel.name}` : channel.name}</div>
      <button role="menuitem" className="context-menu-item" onClick={act(onEdit)}>
        <Pencil size={14} aria-hidden="true" /> Edit channel
      </button>
      <button role="menuitem" className="context-menu-item" disabled={index === 0} onClick={act(() => onMove(index - 1))}>
        <ArrowUp size={14} aria-hidden="true" /> Move up
      </button>
      <button
        role="menuitem"
        className="context-menu-item"
        disabled={index >= count - 1}
        onClick={act(() => onMove(index + 1))}
      >
        <ArrowDown size={14} aria-hidden="true" /> Move down
      </button>
      <div className="context-menu-separator" />
      <button role="menuitem" className="context-menu-item context-menu-danger" onClick={act(onDelete)}>
        <Trash2 size={14} aria-hidden="true" /> Delete channel
      </button>
      <p className="context-menu-hint">Tip: drag channels to reorder them.</p>
    </ContextMenu>
  );
}

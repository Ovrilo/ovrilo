import type { Schemas } from "../../api/client";

type Channel = Schemas["ChannelResponse"];

/**
 * The channel list as the server returns it after moving `channelId` to `index` among the channels
 * of its type (PATCH /channels/{id} with `position`): the others shift and the type is renumbered
 * from 0. Used for an optimistic update; the list comes ordered by type, then position.
 */
export function moveChannel(channels: readonly Channel[], channelId: string, index: number): Channel[] {
  const moved = channels.find((c) => c.id === channelId);
  if (!moved) return [...channels];
  const ordered = channels.filter((c) => c.type === moved.type && c.id !== channelId);
  ordered.splice(Math.max(0, Math.min(index, ordered.length)), 0, moved);
  const renumbered = ordered.map((c, position) => (c.position === position ? c : { ...c, position }));

  const result: Channel[] = [];
  for (const c of channels) {
    if (c.type !== moved.type) result.push(c);
    else if (result.length === 0 || result[result.length - 1].type !== moved.type) result.push(...renumbered);
  }
  return result;
}

/**
 * Where a dragged channel lands: dropped before (or after) the row at `targetIndex` of a list where
 * it currently sits at `fromIndex`. Returns its new index once it is taken out of its old place.
 */
export function dropIndex(fromIndex: number, targetIndex: number, after: boolean): number {
  const slot = targetIndex + (after ? 1 : 0);
  return slot > fromIndex ? slot - 1 : slot;
}

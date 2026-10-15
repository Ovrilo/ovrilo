import { Maximize2, X } from "lucide-react";
import { type RemoteTrack, type RemoteTrackPublication, Room, RoomEvent, Track } from "livekit-client";
import { useEffect, useRef, useState } from "react";

import { problemMessage } from "../../api/client";
import { useApi } from "../../auth/SessionContext";
import { IconButton } from "../../components/ui";

type Status = "connecting" | "waiting" | "playing" | "ended" | "error";

const MESSAGES: Record<Exclude<Status, "playing">, string> = {
  connecting: "Connecting to the stream…",
  waiting: "Waiting for the stream…",
  ended: "The stream has ended.",
  error: "The stream could not be opened.",
};

/**
 * Watches one participant's screen share (ADR-0017). The webview opens its own hidden,
 * subscribe-only connection (`{userId}#viewer`, from `POST /channels/{id}/voice/watch`) and
 * subscribes to that share's video only; its sound plays in the voice engine.
 */
export function ScreenShareViewer({
  channelId,
  participantId,
  name,
  onClose,
}: {
  channelId: string;
  participantId: string;
  name: string;
  onClose: () => void;
}) {
  const api = useApi();
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let closed = false;
    const room = new Room({ adaptiveStream: false, dynacast: false });
    const isTheShare = (publication: RemoteTrackPublication, identity: string) =>
      identity === participantId && publication.source === Track.Source.ScreenShare;
    const subscribe = () => {
      const publication = room.remoteParticipants
        .get(participantId)
        ?.getTrackPublication(Track.Source.ScreenShare) as RemoteTrackPublication | undefined;
      if (!publication) {
        setStatus("waiting");
        return;
      }
      publication.setSubscribed(true);
      if (publication.track && video.current) {
        publication.track.attach(video.current);
        setStatus("playing");
      }
    };

    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication, participant) => {
        if (isTheShare(publication, participant.identity) && video.current) {
          track.attach(video.current);
          setStatus("playing");
        }
      })
      .on(RoomEvent.TrackPublished, (publication, participant) => {
        if (isTheShare(publication, participant.identity)) publication.setSubscribed(true);
      })
      .on(RoomEvent.TrackUnpublished, (publication, participant) => {
        if (isTheShare(publication, participant.identity)) setStatus("ended");
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (participant.identity === participantId) setStatus("ended");
      })
      .on(RoomEvent.ParticipantConnected, (participant) => {
        if (participant.identity === participantId) subscribe();
      });

    void (async () => {
      try {
        const { data, error: problem } = await api.POST("/channels/{channelId}/voice/watch", {
          params: { path: { channelId } },
        });
        if (!data) throw problem;
        await room.connect(data.serverUrl, data.token, { autoSubscribe: false });
        if (closed) return;
        subscribe();
      } catch (e) {
        if (closed) return;
        setError(problemMessage(e, MESSAGES.error));
        setStatus("error");
      }
    })();

    return () => {
      closed = true;
      void room.disconnect();
    };
  }, [api, channelId, participantId]);

  return (
    <section className="stream-stage" aria-label={`${name}'s screen`}>
      <header className="stream-stage-header">
        <span className="live-badge">LIVE</span>
        <span className="stream-stage-title">{name}</span>
        <IconButton
          icon={Maximize2}
          label="Full screen"
          disabled={status !== "playing"}
          onClick={() => void video.current?.requestFullscreen().catch(() => undefined)}
        />
        <IconButton icon={X} label="Stop watching" onClick={onClose} />
      </header>
      <div className="stream-stage-body">
        <video ref={video} autoPlay playsInline muted className={status === "playing" ? "" : "hidden"} />
        {status !== "playing" && <p className="muted">{error ?? MESSAGES[status]}</p>}
      </div>
    </section>
  );
}

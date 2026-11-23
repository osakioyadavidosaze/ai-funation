"use client";

import Peer, { type DataConnection, type MediaConnection } from "peerjs";
import { FormEvent, useEffect, useRef, useState } from "react";

export default function Receiver() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const connectionRef = useRef<DataConnection | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [status, setStatus] = useState("Enter the controller room ID or open its link.");
  const [error, setError] = useState<string | null>(null);
  const [needsPlay, setNeedsPlay] = useState(false);

  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room");
    if (room) {
      setRoomInput(room);
      setActiveRoom(room);
    }
  }, []);

  useEffect(() => {
    if (!activeRoom) return;

    let disposed = false;
    const peer = new Peer();
    peerRef.current = peer;
    setError(null);
    setStatus("Connecting to controller");

    peer.on("open", () => {
      if (disposed) return;
      const connection = peer.connect(activeRoom, { reliable: true });
      connectionRef.current = connection;
      connection.on("open", () => {
        connection.send({ type: "ready" });
        setStatus("Waiting for live video");
      });
      connection.on("error", (cause) => {
        if (!disposed) setError(`Room connection failed: ${cause.message}`);
      });
    });

    peer.on("call", (call) => {
      callRef.current = call;
      call.answer();
      call.on("stream", (stream) => {
        if (disposed || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        setStatus("Live");
        void videoRef.current.play().then(
          () => setNeedsPlay(false),
          () => setNeedsPlay(true),
        );
      });
      call.on("close", () => {
        if (!disposed) setStatus("Stream ended");
      });
      call.on("error", (cause) => {
        if (!disposed) setError(`Media stream failed: ${cause.message}`);
      });
    });

    peer.on("error", (cause) => {
      if (!disposed) {
        setStatus("Disconnected");
        setError(`PeerJS: ${cause.message}`);
      }
    });

    return () => {
      disposed = true;
      callRef.current?.close();
      connectionRef.current?.close();
      peer.destroy();
      peerRef.current = null;
      connectionRef.current = null;
      callRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [activeRoom]);

  const joinRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const room = roomInput.trim();
    if (!room) {
      setError("Enter a room ID.");
      return;
    }
    setError(null);
    setActiveRoom(room);
  };

  const enablePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    void video.play().then(
      () => setNeedsPlay(false),
      () => setError("Playback was blocked. Tap the page and try again."),
    );
  };

  return (
    <main className="fixed inset-0 bg-black text-white">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="h-full w-full object-contain"
      />

      {!activeRoom && (
        <form
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 p-6"
          onSubmit={joinRoom}
        >
          <h1 className="text-xl font-semibold">Avatar receiver</h1>
          <p className="max-w-sm text-center text-sm text-zinc-400">
            Open the controller’s QR link, or enter its room ID.
          </p>
          <input
            autoComplete="off"
            className="w-full max-w-sm rounded-lg border border-white/20 bg-white/10 px-4 py-3"
            onChange={(event) => setRoomInput(event.target.value)}
            placeholder="Controller room ID"
            value={roomInput}
          />
          <button className="w-full max-w-sm rounded-lg bg-accent px-4 py-3 font-semibold text-ink" type="submit">
            Connect
          </button>
          {error && <p className="max-w-sm text-center text-sm text-red-300">{error}</p>}
        </form>
      )}

      {activeRoom && status !== "Live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center">
          <p className="text-lg font-medium">{status}</p>
          {error && <p className="max-w-sm text-sm text-red-300">{error}</p>}
          <button
            className="rounded-lg bg-white/10 px-4 py-2 text-sm"
            onClick={() => {
              setActiveRoom(null);
              setStatus("Enter the controller room ID or open its link.");
              setError(null);
            }}
            type="button"
          >
            Back
          </button>
        </div>
      )}

      {needsPlay && (
        <button
          className="absolute inset-0 m-auto h-fit rounded-lg bg-black/75 px-5 py-3 text-sm"
          onClick={enablePlayback}
          type="button"
        >
          Tap to start video and audio
        </button>
      )}
    </main>
  );
}

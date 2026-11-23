"use client";

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import Peer, { type DataConnection, type MediaConnection } from "peerjs";
import { QRCodeSVG } from "qrcode.react";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { useVoiceChanger } from "@/hooks/useVoiceChanger";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm";

function getBlendshape(
  result: FaceLandmarkerResult | undefined,
  category: string,
) {
  return (
    result?.faceBlendshapes?.[0]?.categories.find(
      (item) => item.categoryName === category,
    )?.score ?? 0
  );
}

function createRoomId() {
  return `avatar-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export default function Controller() {
  const cameraRef = useRef<HTMLVideoElement>(null);
  const landmarksRef = useRef<HTMLCanvasElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<HTMLImageElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const outgoingStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]);
  const callsRef = useRef<MediaConnection[]>([]);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("Not broadcasting");
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const voice = useVoiceChanger({ monitor: false });

  const stopBroadcast = useCallback(() => {
    peerRef.current?.destroy();
    peerRef.current = null;
    connectionsRef.current = [];
    callsRef.current = [];
    outgoingStreamRef.current?.getTracks().forEach((track) => track.stop());
    outgoingStreamRef.current = null;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
    setRoomId(null);
    setShareUrl(null);
    setTracking(false);
    setStatus("Not broadcasting");
    voice.stop();
  }, [voice]);

  useEffect(
    () => () => {
      peerRef.current?.destroy();
      outgoingStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    },
    [avatarUrl],
  );

  useEffect(() => {
    if (!cameraStream || !cameraRef.current) return;
    cameraRef.current.srcObject = cameraStream;
    void cameraRef.current.play().catch(() => {
      setError("Could not start the camera preview. Check browser permissions.");
    });
  }, [cameraStream]);

  useEffect(() => {
    if (!cameraStream) return;

    let disposed = false;
    let frameId = 0;
    let landmarker: FaceLandmarker | undefined;

    const drawFrame = () => {
      const video = cameraRef.current;
      const canvas = outputRef.current;
      const context = canvas?.getContext("2d");
      const landmarksCanvas = landmarksRef.current;
      const landmarksContext = landmarksCanvas?.getContext("2d");
      if (!video || !canvas || !context || !landmarksCanvas || !landmarksContext || video.readyState < 2) {
        frameId = requestAnimationFrame(drawFrame);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      const result = landmarker?.detectForVideo(video, performance.now());
      const landmarks = result?.faceLandmarks[0];
      landmarksContext.clearRect(0, 0, landmarksCanvas.width, landmarksCanvas.height);
      setFaceDetected(Boolean(landmarks));
      if (landmarks) {
        landmarksContext.fillStyle = "#67e8f9";
        for (const point of landmarks) {
          landmarksContext.beginPath();
          landmarksContext.arc(
            point.x * landmarksCanvas.width,
            point.y * landmarksCanvas.height,
            1.5,
            0,
            Math.PI * 2,
          );
          landmarksContext.fill();
        }
      }
      context.clearRect(0, 0, width, height);

      const image = avatarRef.current;
      if (!image?.complete || image.naturalWidth === 0) {
        context.fillStyle = "#20212b";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "#d4d4dc";
        context.textAlign = "center";
        context.font = "18px Arial";
        context.fillText("Upload a portrait to start", width / 2, height / 2);
      } else {
        const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight);
        const jawOpen = getBlendshape(result, "jawOpen");
        const eyeBlink = Math.max(
          getBlendshape(result, "eyeBlinkLeft"),
          getBlendshape(result, "eyeBlinkRight"),
        );
        const faceRoll = landmarks
          ? Math.atan2(
              landmarks[263].y - landmarks[33].y,
              landmarks[263].x - landmarks[33].x,
            )
          : 0;
        const faceX = landmarks ? (landmarks[1].x - 0.5) * -width * 0.16 : 0;
        const faceY = landmarks ? (landmarks[1].y - 0.5) * -height * 0.12 : 0;
        const scale = fit * (1 + jawOpen * 0.04 - eyeBlink * 0.012);

        context.save();
        context.translate(width / 2 + faceX, height / 2 + faceY);
        context.rotate(faceRoll);
        context.scale(scale, scale);
        context.drawImage(
          image,
          -image.naturalWidth / 2,
          -image.naturalHeight / 2,
        );
        context.restore();
      }
      frameId = requestAnimationFrame(drawFrame);
    };

    const initialize = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const createdLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: "VIDEO",
          outputFaceBlendshapes: true,
          numFaces: 1,
        });
        if (disposed) {
          createdLandmarker.close();
          return;
        }
        landmarker = createdLandmarker;
        setTracking(true);
        frameId = requestAnimationFrame(drawFrame);
      } catch (cause) {
        if (!disposed) {
          setError(
            cause instanceof Error
              ? `Could not initialize face tracking: ${cause.message}`
              : "Could not initialize face tracking.",
          );
        }
      }
    };

    void initialize();
    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      landmarker?.close();
    };
  }, [cameraStream]);

  useEffect(() => {
    if (!avatarUrl) {
      avatarRef.current = null;
      return;
    }
    const image = new Image();
    image.onload = () => {
      avatarRef.current = image;
    };
    image.src = avatarUrl;
  }, [avatarUrl]);

  const onAvatarSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file to use as the avatar.");
      return;
    }
    setError(null);
    setAvatarUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return URL.createObjectURL(file);
    });
  };

  const startBroadcast = async () => {
    if (!outputRef.current || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera and audio capture require a supported secure browser context.");
      return;
    }
    setError(null);
    setStatus("Requesting camera and microphone");
    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      cameraStreamRef.current = camera;
      setCameraStream(camera);

      const audioStream = await voice.start();
      const canvasStream = outputRef.current.captureStream(30);
      const outgoing = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioStream.getAudioTracks(),
      ]);
      outgoingStreamRef.current = outgoing;

      const newRoomId = createRoomId();
      const peer = new Peer(newRoomId);
      peerRef.current = peer;
      peer.on("open", (id) => {
        setRoomId(id);
        setShareUrl(`${window.location.origin}/receiver?room=${encodeURIComponent(id)}`);
        setStatus("Waiting for receiver");
      });
      peer.on("connection", (connection) => {
        connectionsRef.current.push(connection);
        connection.on("data", (data) => {
          if (
            typeof data === "object" &&
            data !== null &&
            "type" in data &&
            data.type === "ready"
          ) {
            const call = peer.call(connection.peer, outgoing);
            if (!call) {
              setError("Could not start the WebRTC media call.");
              return;
            }
            callsRef.current.push(call);
            setStatus("Connected · live stream sent");
            call.on("close", () => setStatus("Receiver disconnected"));
            call.on("error", (cause) => {
              setError(
                cause instanceof Error
                  ? `WebRTC call failed: ${cause.message}`
                  : "WebRTC call failed.",
              );
            });
          }
        });
        connection.on("error", (cause) => {
          setError(
            cause instanceof Error
              ? `Receiver signaling failed: ${cause.message}`
              : "Receiver signaling failed.",
          );
        });
      });
      peer.on("error", (cause) => {
        setStatus("Peer connection error");
        setError(`PeerJS: ${cause.message}`);
      });
    } catch (cause) {
      stopBroadcast();
      setError(
        cause instanceof Error
          ? `Could not start broadcast: ${cause.message}`
          : "Could not start broadcast.",
      );
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("Receiver link copied");
    } catch {
      setError("Could not copy the link. Copy it from the address shown below.");
    }
  };

  return (
    <main className="min-h-screen px-5 py-8 md:px-10">
      <header className="mx-auto mb-8 flex max-w-6xl items-center justify-between">
        <div>
          <a className="text-sm text-accent hover:underline" href="/">Avatar Studio</a>
          <h1 className="mt-2 text-3xl font-semibold">Controller mode</h1>
          <p className="mt-1 text-sm text-zinc-400">Create a live avatar feed for your phone.</p>
        </div>
        <span className="rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-300">
          {status}
        </span>
      </header>

      <section className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[1fr_1fr_300px]">
        <div className="rounded-2xl border border-white/[0.08] bg-panel p-5">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="font-medium">Camera + landmarks</h2>
            <span className="text-xs text-zinc-500">
              {faceDetected ? "Face detected" : tracking ? "No face detected" : "Tracker loading"}
            </span>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
            <video
              ref={cameraRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full scale-x-[-1] object-cover"
            />
            {cameraStream && (
              <canvas
                ref={landmarksRef}
                width={640}
                height={480}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full scale-x-[-1]"
              />
            )}
            {!cameraStream && (
              <div className="absolute inset-0 grid place-items-center text-sm text-zinc-400">
                Camera preview appears here
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-panel p-5">
          <h2 className="mb-4 font-medium">Animated stream</h2>
          <canvas
            ref={outputRef}
            width={640}
            height={480}
            className="aspect-[4/3] w-full rounded-xl bg-[#20212b]"
          />
          {cameraStream && (
            <p className="mt-3 text-xs text-zinc-400">
              Camera active · {tracking ? "face tracking ready" : "loading face tracker"}
            </p>
          )}
        </div>

        <aside className="space-y-5 rounded-2xl border border-white/[0.08] bg-panel p-5">
          <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/20 p-4 text-center hover:border-accent/70">
            <span className="text-sm font-medium">Upload target portrait</span>
            <span className="mt-1 text-xs text-zinc-500">PNG, JPG, or WebP</span>
            <input accept="image/*" className="sr-only" onChange={onAvatarSelected} type="file" />
          </label>

          <div className="rounded-xl bg-white/[0.04] p-4">
            <p className="text-sm font-medium">Voice pitch</p>
            <p className="mt-1 text-xs text-zinc-400">
              Audio is processed locally and included in the live stream.
            </p>
            <label className="mt-4 block text-xs text-zinc-400">
              {voice.pitch > 0 ? "+" : ""}{voice.pitch} semitones
              <input
                className="mt-2 w-full accent-accent"
                max="12"
                min="-12"
                onChange={(event) => voice.setPitch(Number(event.target.value))}
                type="range"
                value={voice.pitch}
              />
            </label>
          </div>

          {!roomId ? (
            <button
              className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-ink hover:brightness-110"
              onClick={startBroadcast}
              type="button"
            >
              Start broadcast
            </button>
          ) : (
            <button
              className="w-full rounded-lg bg-red-500/15 px-4 py-3 text-sm font-medium text-red-200 hover:bg-red-500/25"
              onClick={stopBroadcast}
              type="button"
            >
              Stop broadcast
            </button>
          )}

          {roomId && shareUrl && (
            <div className="space-y-3 rounded-xl bg-white p-3 text-center text-black">
              <QRCodeSVG value={shareUrl} size={160} className="mx-auto" />
              <p className="break-all text-xs">{shareUrl}</p>
              <button
                className="w-full rounded-md bg-ink px-3 py-2 text-sm text-white"
                onClick={copyLink}
                type="button"
              >
                Copy receiver link
              </button>
            </div>
          )}
        </aside>
      </section>

      <p className="mx-auto mt-5 max-w-6xl text-xs text-zinc-500">
        Use only with images and voices you have permission to use. Media is sent directly peer-to-peer when the network allows it.
      </p>
      {error && (
        <div className="mx-auto mt-4 max-w-6xl rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
    </main>
  );
}

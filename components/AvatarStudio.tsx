"use client";

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
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

export default function AvatarStudio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarksCanvasRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<HTMLImageElement | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voice = useVoiceChanger();

  useEffect(() => {
    if (!videoRef.current || !cameraStream) return;
    videoRef.current.srcObject = cameraStream;
    void videoRef.current.play().catch(() => {
      setError("Could not start webcam preview. Check browser permissions.");
    });
  }, [cameraStream]);

  const stopCamera = useCallback(() => {
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
    setTracking(false);
    setFaceDetected(false);
  }, [cameraStream]);

  useEffect(
    () => () => {
      cameraStream?.getTracks().forEach((track) => track.stop());
      if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    },
    [avatarUrl, cameraStream],
  );

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      setCameraStream(stream);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Webcam unavailable: ${cause.message}`
          : "Webcam unavailable. Check browser permissions.",
      );
    }
  };

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

  useEffect(() => {
    if (!cameraStream) return;

    let disposed = false;
    let animationFrame = 0;
    let landmarker: FaceLandmarker | undefined;
    let previousDetected = false;

    const trackFrame = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      const landmarksCanvas = landmarksCanvasRef.current;
      const landmarksContext = landmarksCanvas?.getContext("2d");
      if (!video || !canvas || !context || !landmarksCanvas || !landmarksContext || video.readyState < 2) {
        animationFrame = requestAnimationFrame(trackFrame);
        return;
      }

      const width = canvas.clientWidth || 640;
      const height = canvas.clientHeight || 420;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (landmarksCanvas.width !== width || landmarksCanvas.height !== height) {
        landmarksCanvas.width = width;
        landmarksCanvas.height = height;
      }
      context.clearRect(0, 0, width, height);
      landmarksContext.clearRect(0, 0, width, height);

      const result = landmarker?.detectForVideo(video, performance.now());
      const landmarks = result?.faceLandmarks[0];
      const detected = Boolean(landmarks);
      if (detected !== previousDetected) {
        previousDetected = detected;
        setFaceDetected(detected);
      }
      if (landmarks) {
        landmarksContext.fillStyle = "#67e8f9";
        for (const point of landmarks) {
          landmarksContext.beginPath();
          landmarksContext.arc(point.x * width, point.y * height, 1.5, 0, Math.PI * 2);
          landmarksContext.fill();
        }
      }

      const image = avatarRef.current;
      if (image?.complete && image.naturalWidth > 0) {
        const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight);
        const scale = fit * (1 + getBlendshape(result, "jawOpen") * 0.035);
        const rotation = landmarks
          ? Math.atan2(
              landmarks[263].y - landmarks[33].y,
              landmarks[263].x - landmarks[33].x,
            )
          : 0;
        const offsetX = landmarks ? (landmarks[1].x - 0.5) * width * -0.16 : 0;
        const offsetY = landmarks ? (landmarks[1].y - 0.5) * height * -0.12 : 0;

        context.save();
        context.translate(width / 2 + offsetX, height / 2 + offsetY);
        context.rotate(rotation);
        context.scale(scale, scale);
        context.drawImage(
          image,
          -image.naturalWidth / 2,
          -image.naturalHeight / 2,
        );
        context.restore();
      } else {
        context.fillStyle = "#242532";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "#a7a5b5";
        context.textAlign = "center";
        context.font = "14px Arial";
        context.fillText("Upload a portrait to preview avatar motion", width / 2, height / 2);
      }

      animationFrame = requestAnimationFrame(trackFrame);
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
        animationFrame = requestAnimationFrame(trackFrame);
      } catch (cause) {
        if (!disposed) {
          setError(
            cause instanceof Error
              ? `Face tracker failed to load: ${cause.message}`
              : "Face tracker failed to load.",
          );
        }
      }
    };

    void initialize();
    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
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

  const toggleVoice = async () => {
    setError(null);
    try {
      if (voice.enabled) voice.stop();
      else await voice.start();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Microphone unavailable: ${cause.message}`
          : "Could not start voice modulation.",
      );
    }
  };

  return (
    <main className="min-h-screen px-5 py-8 md:px-10">
      <header className="mx-auto mb-8 flex max-w-7xl items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
            Creative lab
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Avatar Studio</h1>
        </div>
        <span className="rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-300">
          Runs in your browser
        </span>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[1fr_260px_1fr]">
        <Panel title="Camera input" detail={faceDetected ? "Face detected" : "Face not detected"}>
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              className="h-full w-full scale-x-[-1] object-cover"
              playsInline
              muted
            />
            {cameraStream && (
              <canvas
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full scale-x-[-1]"
                ref={landmarksCanvasRef}
              />
            )}
            {cameraStream && (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs">
                <span className={`h-2 w-2 rounded-full ${tracking ? "bg-emerald-400" : "bg-amber-400"}`} />
                {tracking ? "Tracking" : "Loading tracker"}
              </div>
            )}
            {!cameraStream && (
              <div className="absolute inset-0 grid place-items-center text-sm text-zinc-400">
                Camera preview appears here
              </div>
            )}
          </div>
          <button
            className="mt-4 w-full rounded-lg bg-white/10 px-4 py-3 text-sm font-medium hover:bg-white/15"
            onClick={cameraStream ? stopCamera : startCamera}
            type="button"
          >
            {cameraStream ? "Stop camera" : "Start camera"}
          </button>
        </Panel>

        <Panel title="Controls" detail="Choose your source">
          <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.03] p-5 text-center hover:border-accent/70">
            <span className="text-2xl text-accent">＋</span>
            <span className="mt-2 text-sm font-medium">Upload a portrait</span>
            <span className="mt-1 text-xs text-zinc-500">PNG, JPG, or WebP</span>
            <input
              accept="image/*"
              className="sr-only"
              onChange={onAvatarSelected}
              type="file"
            />
          </label>

          <div className="mt-6 border-t border-white/10 pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Voice modulation</p>
                <p className="mt-1 text-xs text-zinc-500">Live pitch effect</p>
              </div>
              <button
                aria-checked={voice.enabled}
                aria-label="Toggle voice modulation"
                className={`h-7 w-12 rounded-full p-1 transition ${voice.enabled ? "bg-accent" : "bg-white/20"}`}
                onClick={toggleVoice}
                role="switch"
                type="button"
              >
                <span className={`block h-5 w-5 rounded-full bg-white transition ${voice.enabled ? "translate-x-5" : ""}`} />
              </button>
            </div>
            {voice.enabled && (
              <label className="mt-4 block text-xs text-zinc-400">
                Pitch shift: {voice.pitch > 0 ? "+" : ""}
                {voice.pitch} semitones
                <input
                  className="mt-2 w-full accent-accent"
                  max="12"
                  min="-12"
                  onChange={(event) => voice.setPitch(Number(event.target.value))}
                  type="range"
                  value={voice.pitch}
                />
              </label>
            )}
          </div>
        </Panel>

        <Panel title="Avatar output" detail="2D motion preview">
          <canvas
            aria-label="Animated avatar output"
            className="aspect-[4/3] w-full rounded-xl bg-[#242532] object-contain"
            ref={canvasRef}
          />
          {avatarUrl && (
            <p className="mt-3 truncate text-xs text-zinc-400">
              Portrait loaded · motion follows detected head position and tilt
            </p>
          )}
        </Panel>
      </section>

      <p className="mx-auto mt-5 max-w-7xl text-xs text-zinc-500">
        Webcam and microphone permissions are used only by this browser demo; media is not sent to a server.
      </p>
      {error && (
        <div className="mx-auto mt-4 max-w-7xl rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
    </main>
  );
}

function Panel({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-panel p-5 shadow-xl shadow-black/10">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-medium">{title}</h2>
        <span className="text-xs text-zinc-500">{detail}</span>
      </div>
      {children}
    </section>
  );
}

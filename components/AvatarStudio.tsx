"use client";

import type {
  FaceLandmarker,
  FaceLandmarkerResult,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  createFaceLandmarker,
  detectPortraitLandmarks,
} from "@/lib/faceLandmarker";
import { drawAnimatedAvatar, drawSyntheticLabel } from "@/lib/faceMotion";
import { useVoiceChanger } from "@/hooks/useVoiceChanger";

export default function AvatarStudio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarksCanvasRef = useRef<HTMLCanvasElement>(null);
  const avatarRef = useRef<HTMLImageElement | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const portraitLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const portraitBusyRef = useRef(false);
  const queuedPortraitRef = useRef<HTMLImageElement | null>(null);
  const lastResultRef = useRef<FaceLandmarkerResult | undefined>(undefined);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voice = useVoiceChanger();

  const analyzePortrait = useCallback(async (image: HTMLImageElement) => {
    const landmarker = landmarkerRef.current;
    if (!landmarker) return;
    queuedPortraitRef.current = image;
    if (portraitBusyRef.current) return;

    portraitBusyRef.current = true;
    try {
      while (queuedPortraitRef.current && landmarkerRef.current === landmarker) {
        const portrait = queuedPortraitRef.current;
        queuedPortraitRef.current = null;
        const landmarks = await detectPortraitLandmarks(landmarker, portrait);
        if (portrait === avatarRef.current) {
          portraitLandmarksRef.current = landmarks;
          if (!landmarks) {
            setError("No face was detected in the uploaded portrait; facial animation is unavailable.");
          }
        }
      }
    } catch (cause) {
      if (landmarkerRef.current === landmarker) {
        const message = `Could not analyze uploaded portrait: ${cause instanceof Error ? cause.message : String(cause)}`;
        console.error(message, cause);
        setError(message);
      }
    } finally {
      portraitBusyRef.current = false;
    }
  }, []);

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

      const result = portraitBusyRef.current
        ? lastResultRef.current
        : landmarker?.detectForVideo(video, performance.now());
      if (!portraitBusyRef.current) lastResultRef.current = result;
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
        drawAnimatedAvatar(
          context,
          image,
          portraitLandmarksRef.current,
          result,
          landmarks,
          width,
          height,
        );
      } else {
        context.fillStyle = "#242532";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "#a7a5b5";
        context.textAlign = "center";
        context.font = "14px Arial";
        context.fillText("Upload a portrait to preview avatar motion", width / 2, height / 2);
      }
      drawSyntheticLabel(context, width, height);

      animationFrame = requestAnimationFrame(trackFrame);
    };

    const initialize = async () => {
      try {
        const createdLandmarker = await createFaceLandmarker();
        if (disposed) {
          createdLandmarker.close();
          return;
        }
        landmarker = createdLandmarker;
        landmarkerRef.current = createdLandmarker;
        setTracking(true);
        if (avatarRef.current) void analyzePortrait(avatarRef.current);
        animationFrame = requestAnimationFrame(trackFrame);
      } catch (cause) {
        if (!disposed) {
          const message = `Face tracker failed to load: ${cause instanceof Error ? cause.message : String(cause)}`;
          console.error(message, cause);
          setError(message);
        }
      }
    };

    void initialize();
    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      if (landmarkerRef.current === landmarker) landmarkerRef.current = null;
      landmarker?.close();
    };
  }, [analyzePortrait, cameraStream]);

  useEffect(() => {
    portraitLandmarksRef.current = null;
    if (!avatarUrl) {
      avatarRef.current = null;
      return;
    }
    const image = new Image();
    image.onload = () => {
      avatarRef.current = image;
      void analyzePortrait(image);
    };
    image.onerror = () => setError("Could not load the uploaded portrait.");
    image.src = avatarUrl;
  }, [analyzePortrait, avatarUrl]);

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

  const openFullscreenOutput = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      if (document.fullscreenElement === canvas) {
        await document.exitFullscreen();
      } else {
        await canvas.requestFullscreen();
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Could not open fullscreen output: ${cause.message}`
          : "Could not open fullscreen output.",
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
        <nav className="flex flex-wrap items-center justify-end gap-2">
          <a
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-ink hover:brightness-110"
            href="/controller"
          >
            Laptop Studio
          </a>
          <a
            className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium hover:bg-white/10"
            href="/receiver"
          >
            Phone Stream View
          </a>
        </nav>
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
          <button
            className="mt-4 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-ink hover:brightness-110"
            onClick={openFullscreenOutput}
            type="button"
          >
            Full-Screen Virtual Cam Output
          </button>
          {avatarUrl && (
            <p className="mt-3 truncate text-xs text-zinc-400">
              Portrait loaded · expressions follow face tracking
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

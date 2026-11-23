"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";

export function useVoiceChanger({ monitor = true }: { monitor?: boolean } = {}) {
  const [enabled, setEnabled] = useState(false);
  const [pitch, setPitchState] = useState(4);
  const inputRef = useRef<Tone.UserMedia | null>(null);
  const effectRef = useRef<Tone.PitchShift | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const pitchRef = useRef(pitch);

  const stop = useCallback(() => {
    inputRef.current?.disconnect();
    inputRef.current?.dispose();
    effectRef.current?.disconnect();
    effectRef.current?.dispose();
    destinationRef.current?.stream
      .getTracks()
      .forEach((track) => track.stop());
    inputRef.current = null;
    effectRef.current = null;
    destinationRef.current = null;
    setEnabled(false);
  }, []);

  const start = useCallback(async (): Promise<MediaStream> => {
    if (destinationRef.current) return destinationRef.current.stream;

    await Tone.start();
    const input = new Tone.UserMedia();
    const pitchShift = new Tone.PitchShift({
      pitch: pitchRef.current,
      windowSize: 0.1,
      delayTime: 0,
      feedback: 0,
    });
    const destination = Tone.getContext().createMediaStreamDestination();
    if (monitor) pitchShift.toDestination();

    try {
      await input.open();
      input.connect(pitchShift);
      pitchShift.connect(destination);
      inputRef.current = input;
      effectRef.current = pitchShift;
      destinationRef.current = destination;
      setEnabled(true);
      return destination.stream;
    } catch (error) {
      input.dispose();
      pitchShift.dispose();
      destination.stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
  }, []);

  const setPitch = useCallback((value: number) => {
    const nextPitch = Math.max(-12, Math.min(12, value));
    pitchRef.current = nextPitch;
    setPitchState(nextPitch);
    if (effectRef.current) effectRef.current.pitch = nextPitch;
  }, []);

  useEffect(() => stop, [stop]);

  return { enabled, pitch, setPitch, start, stop };
}

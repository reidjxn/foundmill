"use client";
/**
 * The founder's microphone on a call (docs/TEAM_CALL.md §6): getUserMedia, an AnalyserNode for the You tile's level and
 * the voice-activity rules of `vad.ts` (an utterance starts above a threshold and ends after 1.2 s of silence, 60 s at
 * most). Live transcription records each utterance with MediaRecorder (opus webm where supported) and hands the
 * recording over; simulated transcription uses the browser's own recognizer. Starting to speak calls `onSpeechStart`
 * (the page holds the agents); every start is then followed by exactly one of `onUtterance` (something to send or
 * transcribe) or `onSpeechDiscarded` (a click or a cough, nothing heard, or the mic switched off mid-word), so a hold
 * is always released. Nothing is sent anywhere from here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { audioMimeOf, pickRecorderMime, recognizerCtor, type RecognizerLike } from "./browser-speech";
import { VAD_IDLE, levelFromTimeDomain, vadStep, type VadState } from "./vad";

export type Utterance = { kind: "text"; text: string } | { kind: "audio"; blob: Blob; mime: string };

export interface CallMicrophoneOptions {
  /** How the founder's speech becomes text: `live` records and sends it for transcription, `simulated` uses the browser's recognizer. Undefined until known. */
  transcription: "live" | "simulated" | undefined;
  /** True while an agent is speaking: a clearly louder voice is then needed to count as speaking over them. */
  agentSpeaking: () => boolean;
  /** The founder began to speak. */
  onSpeechStart: () => void;
  onUtterance: (u: Utterance) => void;
  /** What began with `onSpeechStart` came to nothing: no utterance follows it. */
  onSpeechDiscarded: () => void;
}

export interface CallMicrophone {
  on: boolean;
  /** No microphone to use here (no access, no recognizer in simulated mode): the page says to type. */
  unavailable: boolean;
  /** 0..1, for the You tile. */
  level: number;
  /** The founder is speaking now (the level is above the threshold). */
  speaking: boolean;
  toggle: () => void;
  stop: () => void;
}

const TICK_MS = 50;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useCallMicrophone(options: CallMicrophoneOptions): CallMicrophone {
  const [on, setOn] = useState(false);
  const [denied, setDenied] = useState(false);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const opts = useRef(options);
  opts.current = options;
  const live = useRef<{ stop: () => void } | null>(null);
  const starting = useRef(false);

  const hasMic = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
  const recognizerMissing = options.transcription === "simulated" && recognizerCtor() === null;
  const unavailable = denied || !hasMic || recognizerMissing;

  const stop = useCallback(() => {
    live.current?.stop();
    live.current = null;
    setOn(false);
    setSpeaking(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    if (live.current || starting.current) return;
    const mode = opts.current.transcription;
    if (!hasMic || mode === undefined || (mode === "simulated" && recognizerCtor() === null)) {
      setDenied(!hasMic);
      return;
    }
    starting.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) throw new Error("no audio context");
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);

      const recorderMime = mode === "live" && typeof MediaRecorder !== "undefined" ? pickRecorderMime((m) => MediaRecorder.isTypeSupported(m)) : null;
      let recorder: MediaRecorder | null = null;
      let chunks: Blob[] = [];

      // Simulated transcription: the browser's recognizer runs while the mic is on; only what is said between the
      // start and the end of an utterance counts (so the agents' own voices coming out of the speakers are ignored).
      let heard = "";
      let collecting = false;
      let recognizer: RecognizerLike | null = null;
      let alive = true;
      if (mode === "simulated") {
        const Ctor = recognizerCtor()!;
        recognizer = new Ctor();
        recognizer.continuous = true;
        recognizer.interimResults = false;
        recognizer.lang = "en-US";
        recognizer.onresult = (e) => {
          if (!collecting) return;
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]!;
            if (r.isFinal) heard += ` ${r[0].transcript}`;
          }
        };
        recognizer.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            setDenied(true);
            live.current?.stop();
            live.current = null;
            setOn(false);
          }
        };
        // Browsers end a recognizer after a while; keep it going while the mic is on.
        recognizer.onend = () => {
          if (!alive) return;
          try {
            recognizer?.start();
          } catch {
            /* already started */
          }
        };
        recognizer.start();
      }

      const beginRecording = () => {
        chunks = [];
        if (!recorderMime) return;
        try {
          recorder = new MediaRecorder(stream, { mimeType: recorderMime });
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          recorder.start();
        } catch {
          recorder = null;
        }
      };
      const finishRecording = (): Promise<Blob | null> =>
        new Promise((resolve) => {
          const r = recorder;
          recorder = null;
          if (!r || r.state === "inactive") return resolve(null);
          r.onstop = () => resolve(chunks.length > 0 ? new Blob(chunks, { type: r.mimeType || recorderMime || "audio/webm" }) : null);
          r.stop();
        });

      const deliver = async (discard: boolean) => {
        if (mode === "live") {
          const blob = await finishRecording();
          const mime = blob ? audioMimeOf(blob.type || recorderMime || "") : null;
          if (!discard && blob && mime) opts.current.onUtterance({ kind: "audio", blob, mime });
          else opts.current.onSpeechDiscarded();
          return;
        }
        // The recognizer's last words arrive a moment after the voice stops.
        for (let waited = 0; heard.trim() === "" && waited < 900; waited += 100) await wait(100);
        const text = heard.replace(/\s+/g, " ").trim();
        collecting = false;
        heard = "";
        if (!discard && text) opts.current.onUtterance({ kind: "text", text });
        else opts.current.onSpeechDiscarded();
      };

      let vad: VadState = VAD_IDLE;
      let shown = 0;
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(buffer);
        const l = levelFromTimeDomain(buffer);
        const step = vadStep(vad, l, Date.now(), opts.current.agentSpeaking());
        vad = step.state;
        if (Math.abs(l - shown) >= 0.03) {
          shown = l;
          setLevel(l);
        }
        if (step.event?.type === "start") {
          collecting = true;
          heard = "";
          beginRecording();
          setSpeaking(true);
          opts.current.onSpeechStart();
        } else if (step.event?.type === "end") {
          setSpeaking(false);
          void deliver(step.event.discard);
        }
      }, TICK_MS);

      live.current = {
        stop: () => {
          alive = false;
          clearInterval(timer);
          // Switched off mid-word: nothing will be sent for it.
          if (vad.speaking) {
            vad = VAD_IDLE;
            opts.current.onSpeechDiscarded();
          }
          if (recognizer) {
            recognizer.onend = null;
            try {
              recognizer.abort();
            } catch {
              /* already stopped */
            }
          }
          const r = recorder;
          recorder = null;
          if (r && r.state !== "inactive") {
            r.onstop = null;
            try {
              r.stop();
            } catch {
              /* already stopped */
            }
          }
          stream.getTracks().forEach((t) => t.stop());
          void ctx.close().catch(() => undefined);
        },
      };
      setOn(true);
    } catch {
      setDenied(true);
      setOn(false);
    } finally {
      starting.current = false;
    }
  }, [hasMic]);

  const toggle = useCallback(() => {
    if (live.current) stop();
    else void start();
  }, [start, stop]);

  // A microphone the founder already allowed opens with the call; otherwise they press the mic once.
  useEffect(() => {
    if (options.transcription === undefined || unavailable || live.current) return;
    let cancelled = false;
    const permissions = typeof navigator !== "undefined" ? navigator.permissions : undefined;
    void permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((p) => {
        if (!cancelled && p.state === "granted") void start();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once the transcription mode is known
  }, [options.transcription]);

  useEffect(() => () => live.current?.stop(), []);

  return { on, unavailable, level, speaking, toggle, stop };
}

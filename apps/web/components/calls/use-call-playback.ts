"use client";
/**
 * The call's speaker (docs/TEAM_CALL.md §6): every new agent turn is queued, its speech fetched as soon as it arrives
 * (the next one while one plays) and played in order through one HTMLAudioElement. Simulated speech is spoken by the
 * browser's own voice, tuned to the agent's accent; a clip that cannot play, or a turn whose speech failed, waits out
 * its reading time so the call keeps its rhythm. The queue's rules are in `playback-queue.ts`.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { TeamCallSpeechView, TeamCallTurnView } from "@foundmill/shared/team-call";
import { estimateSpeakMs, pickBrowserVoice, toDataUrl, utteranceTuning } from "./browser-speech";
import { EMPTY_QUEUE, playingItem, queueIdle, queueReducer, toFetch, toPlay } from "./playback-queue";
import { publicEnv } from "@/lib/env";

export interface CallPlayback {
  /** Adds agent turns (each once) to the queue. */
  enqueue: (turns: readonly TeamCallTurnView[]) => void;
  /** Barge-in, mute or the end of the call: stops the voice now and drops what has not been said. */
  stop: () => void;
  /** The turn being spoken now. */
  playing: { turnId: string; agentId: string } | null;
  /** Every queued turn has been said (or dropped). */
  idle: boolean;
}

/** Where a streamed turn's audio is played from: the api's ticket path on the api's own origin. */
export function streamSource(apiUrl: string, streamUrl: string): string {
  return `${apiUrl.replace(/\/+$/, "")}${streamUrl}`;
}

export function useCallPlayback(fetchSpeech: (turnId: string, opts?: { stream?: boolean }) => Promise<TeamCallSpeechView>, apiUrl: string = publicEnv().apiUrl): CallPlayback {
  const [state, dispatch] = useReducer(queueReducer, EMPTY_QUEUE);
  const turns = useRef(new Map<string, TeamCallTurnView>());
  const speech = useRef(new Map<string, TeamCallSpeechView>());
  const inflight = useRef(new Set<string>());
  const fetchRef = useRef(fetchSpeech);
  fetchRef.current = fetchSpeech;
  const audio = useRef<HTMLAudioElement | null>(null);
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Chrome drops a speaking utterance that nothing refers to, and then never fires its end event.
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  // The turn started now: the effect may run twice for one state (Strict Mode), and a line must never be spoken twice.
  const started = useRef<string | null>(null);

  const silence = useCallback(() => {
    token.current += 1;
    started.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const el = audio.current;
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.pause();
    }
    if (utterance.current) {
      utterance.current.onend = null;
      utterance.current.onerror = null;
      utterance.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const enqueue = useCallback((list: readonly TeamCallTurnView[]) => {
    const agentTurns = list.filter((t) => t.speaker === "agent" && t.agentId !== null);
    for (const t of agentTurns) turns.current.set(t.id, t);
    dispatch({ type: "enqueue", turns: agentTurns.map((t) => ({ id: t.id, seq: t.seq, agentId: t.agentId! })) });
  }, []);

  const stop = useCallback(() => {
    silence();
    dispatch({ type: "stop" });
  }, [silence]);

  // Fetch the speech of the turn that is next and the one after it.
  useEffect(() => {
    for (const id of toFetch(state)) {
      if (inflight.current.has(id)) continue;
      inflight.current.add(id);
      dispatch({ type: "fetching", id });
      fetchRef
        .current(id)
        .then((view) => {
          speech.current.set(id, view);
          dispatch({ type: "ready", id });
        })
        .catch(() => dispatch({ type: "failed", id }))
        .finally(() => inflight.current.delete(id));
    }
  }, [state]);

  // Play the next turn once the one before it has ended.
  useEffect(() => {
    const next = toPlay(state);
    if (!next) return;
    const id = next.id;
    if (started.current === id) return;
    started.current = id;
    dispatch({ type: "playing", id });
    const my = ++token.current;
    let finished = false;
    const finish = () => {
      if (finished || token.current !== my) return;
      finished = true;
      started.current = null;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      dispatch({ type: "ended", id });
    };
    const text = turns.current.get(id)?.text ?? "";
    const view = speech.current.get(id);
    const waitOut = (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(finish, ms);
    };
    if (!view) {
      waitOut(estimateSpeakMs(text));
      return;
    }
    const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
    if (view.simulated && synth && view.spokenText.trim() !== "") {
      const u = new SpeechSynthesisUtterance(view.spokenText);
      const tuning = utteranceTuning(view.speechAccent);
      u.pitch = tuning.pitch;
      u.rate = tuning.rate;
      const voice = pickBrowserVoice(synth.getVoices(), view.speechAccent);
      if (voice) u.voice = voice;
      u.onend = finish;
      u.onerror = finish;
      utterance.current = u;
      // A voice that never reports its end must not hold the call: twice the reading time, and then on.
      waitOut(estimateSpeakMs(view.spokenText) * 2 + 3_000);
      synth.speak(u);
      return;
    }
    const el = (audio.current ??= new Audio());
    el.onended = finish;
    el.onerror = finish;
    if (view.streamUrl) {
      // Streamed: the audio plays as ElevenLabs makes it. A stream that cannot play (a ticket used up, the network) is
      // asked for once more as a whole clip, so the line is still heard.
      el.onerror = () => {
        if (token.current !== my) return;
        el.onerror = finish;
        fetchRef
          .current(id, { stream: false })
          .then((whole) => {
            if (token.current !== my || finished) return;
            el.src = toDataUrl(whole.mime, whole.base64);
            void el.play().catch(() => waitOut(estimateSpeakMs(whole.spokenText || text)));
          })
          .catch(finish);
      };
      el.src = streamSource(apiUrl, view.streamUrl);
    } else {
      el.src = toDataUrl(view.mime, view.base64);
    }
    // A line that is spoken for real may run long; a silent clip is only its timing.
    waitOut(view.simulated ? estimateSpeakMs(view.spokenText || text) + 1_500 : 90_000);
    void el.play().catch(() => {
      // Autoplay refused: the line still takes its time, and the caption shows it.
      waitOut(estimateSpeakMs(view.spokenText || text));
    });
  }, [state]);

  useEffect(() => silence, [silence]);

  const playing = playingItem(state);
  return { enqueue, stop, playing: playing ? { turnId: playing.id, agentId: playing.agentId } : null, idle: queueIdle(state) };
}

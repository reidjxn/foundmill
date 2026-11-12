/**
 * Plays one spoken sample outside a call ("Hear it" on an agent's Accent): the returned audio, or the browser's own
 * speech tuned to the accent when the speech is simulated. Returns a function that stops it.
 */
import type { TeamCallSpeechView } from "@foundmill/shared/team-call";
import { pickBrowserVoice, toDataUrl, utteranceTuning } from "./browser-speech";

export function playSpeechOnce(view: Pick<TeamCallSpeechView, "mime" | "base64" | "simulated" | "spokenText" | "speechAccent">): () => void {
  const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
  if (view.simulated && synth && view.spokenText.trim() !== "") {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(view.spokenText);
    const tuning = utteranceTuning(view.speechAccent);
    u.pitch = tuning.pitch;
    u.rate = tuning.rate;
    const voice = pickBrowserVoice(synth.getVoices(), view.speechAccent);
    if (voice) u.voice = voice;
    synth.speak(u);
    return () => synth.cancel();
  }
  const el = new Audio(toDataUrl(view.mime, view.base64));
  void el.play().catch(() => undefined);
  return () => el.pause();
}

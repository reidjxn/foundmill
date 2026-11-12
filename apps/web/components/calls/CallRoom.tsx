"use client";
/**
 * The call (docs/TEAM_CALL.md §6, DESIGN §9 "Team call"): the stage of tiles, the caption under it, the controls and the
 * transcript rail, driven by the playback queue (who is speaking), the microphone (voice activity, barge-in), the
 * typed line, "Let the team discuss" and End. A finished call shows its wrap-up instead. The design system draws every
 * agent (names and portraits through the persona rules); this file only decides who is speaking and what is said.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, CallCaptions, CallControls, CallStage, CallTranscript, CallWrapUp, Panel, StatusPill } from "@foundmill/dugout";
import { TEAM_CALL_LIMITS, TEAM_CALL_WORDS, type TeamCallRoundView, type TeamCallView } from "@foundmill/shared/team-call";
import { routes } from "@foundmill/widgets/shared/routes";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { NotFoundPanel, isMissing, loadFailed } from "@/components/shell/QueryStates";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { useSpecUser } from "@/components/spec/spec-user";
import { audioMimeOf, blobToBase64 } from "./browser-speech";
import { callTargetHref } from "./targets";
import { mergeTurns, newClientTurnId, shouldContinue, turnsToSpeakOnOpen } from "./turns";
import { useCallMicrophone, type Utterance } from "./use-call-microphone";
import { useCallPlayback } from "./use-call-playback";

interface SendItem {
  text: string;
  via: "spoken" | "typed";
  clientTurnId: string;
}

export function CallRoom({ callId }: { callId: string }) {
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const callQ = useQuery(
    trpc.teamCall.get.queryOptions(
      { businessId, callId },
      // Another tab may be writing the call up: follow it until it is done.
      { staleTime: 5_000, refetchInterval: (q) => (q.state.data?.status === "wrapping_up" ? 2_000 : false) },
    ),
  );
  const call = callQ.data;

  useShellChrome(
    {
      title: TEAM_CALL_WORDS.title,
      breadcrumbs: [{ label: TEAM_CALL_WORDS.title, href: routes.calls(businessId) }, { label: call?.topic ?? (call?.kind === "one_to_one" ? "One-to-one" : "Team") }],
    },
    [businessId, call?.topic, call?.kind],
  );

  if (loadFailed(callQ) && isMissing(callQ.error)) {
    return (
      <NotFoundPanel title={TEAM_CALL_WORDS.title} heading="No such call" back={{ label: "Back to calls", href: routes.calls(businessId) }}>
        No call in this project has this address: the link is wrong.
      </NotFoundPanel>
    );
  }
  if (loadFailed(callQ)) return <ErrorPanel title={TEAM_CALL_WORDS.title} message={errorMessage(callQ.error)} onRetry={() => void callQ.refetch()} />;
  if (!call) return <ScreenSkeleton />;
  return call.status === "live" ? <LiveCall call={call} /> : <FinishedCall call={call} />;
}

/** A call that has ended (or is being written up): the summary and what was filed, and the transcript beside it. */
function FinishedCall({ call }: { call: TeamCallView }) {
  const { businessId, departments, departmentById } = useBusiness();
  const router = useRouter();
  return (
    <div className="flex min-h-0 flex-1 gap-gutter p-gutter" data-testid="call-finished" data-status={call.status}>
      <div className="flex min-w-0 flex-1 flex-col gap-gutter overflow-y-auto">
        <div className="flex items-center gap-2">
          <StatusPill tone={call.status === "ended" ? "neutral" : "info"}>{call.status === "ended" ? "Call ended" : TEAM_CALL_WORDS.wrappingUp}</StatusPill>
          <Button size="sm" variant="ghost" onClick={() => router.push(routes.calls(businessId))} data-testid="call-back-to-calls">
            Back to calls
          </Button>
        </div>
        {call.status === "ended" ? (
          <CallWrapUp
            summary={call.summary}
            actions={call.actions}
            participants={call.participants}
            departmentName={(id) => departmentById(id)?.name ?? "Department"}
            onOpenTarget={(target) => router.push(callTargetHref(businessId, departments, target))}
          />
        ) : (
          <Panel title="What was discussed">
            <p className="text-body text-secondary" role="status">
              {TEAM_CALL_WORDS.wrappingUp}…
            </p>
          </Panel>
        )}
      </div>
      <CallTranscript turns={call.turns} participants={call.participants} className="w-80 shrink-0" />
    </div>
  );
}

function LiveCall({ call }: { call: TeamCallView }) {
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const founder = useSpecUser();
  const callId = call.id;
  const getKey = trpc.teamCall.get.queryKey({ businessId, callId });

  const modesQ = useQuery(trpc.teamCall.speechModes.queryOptions({ businessId }, { staleTime: 300_000 }));
  const modes = modesQ.data;
  const speechM = useMutation(trpc.teamCall.speech.mutationOptions());
  const transcribeM = useMutation(trpc.teamCall.transcribe.mutationOptions());
  const sayM = useMutation(trpc.teamCall.say.mutationOptions());
  const continueM = useMutation(trpc.teamCall.continue.mutationOptions());
  const endM = useMutation(trpc.teamCall.end.mutationOptions());

  const [captionsOn, setCaptionsOn] = useState(true);
  const [transcriptOn, setTranscriptOn] = useState(false);
  const [discussOn, setDiscussOn] = useState(false);
  const [handBack, setHandBack] = useState(false);
  const [busy, setBusy] = useState(0);
  const [ending, setEnding] = useState(false);
  const [failed, setFailed] = useState<{ item: SendItem; message: string } | null>(null);
  const [handBackNote, setHandBackNote] = useState(false);
  // What the founder just said, shown as the caption until the team starts to answer.
  const [founderLine, setFounderLine] = useState<string | null>(null);
  const [lastLine, setLastLine] = useState<{ turnId: string } | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const playback = useCallPlayback(
    useCallback(
      (turnId: string) => {
        return speechM.mutateAsync({ businessId, callId, turnId });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps -- mutateAsync is stable
      [businessId, callId],
    ),
  );

  // The opening round, written just now, is spoken when the call opens.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    playback.enqueue(turnsToSpeakOnOpen(call.turns, Date.now()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);

  const applyRound = useCallback(
    (round: TeamCallRoundView) => {
      queryClient.setQueryData<TeamCallView>(getKey, (old) => (old ? { ...old, turns: mergeTurns(old.turns, round), agentRoundsSinceFounder: round.agentRoundsSinceFounder } : old));
      setFounderLine(null);
      playback.enqueue(round.turns);
      setHandBack(round.handBack);
      // A hand-back with nothing said is the round limit: the team says it is the founder's turn.
      setHandBackNote(round.handBack && round.turns.length === 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getKey is a function of businessId and callId
    [queryClient, businessId, callId, playback.enqueue],
  );

  /** One round at a time, in the order they were asked; a failed one is kept so it can be tried again with the same id. */
  const run = useCallback(
    (job: () => Promise<TeamCallRoundView>, item?: SendItem) => {
      setBusy((n) => n + 1);
      chain.current = chain.current
        .then(job)
        .then((round) => {
          applyRound(round);
          setFailed(null);
        })
        .catch((err: unknown) => {
          setFounderLine(null);
          if (item) setFailed({ item, message: errorMessage(err) });
        })
        .finally(() => setBusy((n) => n - 1));
    },
    [applyRound],
  );

  const send = useCallback(
    (item: SendItem) => {
      setFailed(null);
      run(() => sayM.mutateAsync({ businessId, callId, ...item }), item);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutateAsync is stable
    [run, businessId, callId],
  );

  const say = useCallback(
    (text: string, via: "spoken" | "typed") => {
      // The founder speaking, or typing, ends whatever the team was saying.
      playback.stop();
      setHandBack(false);
      setHandBackNote(false);
      setFounderLine(text);
      send({ text, via, clientTurnId: newClientTurnId() });
    },
    [playback, send],
  );

  const onUtterance = useCallback(
    (u: Utterance) => {
      if (u.kind === "text") return say(u.text, "spoken");
      const mime = audioMimeOf(u.mime);
      if (!mime) return;
      void blobToBase64(u.blob)
        .then((base64) => transcribeM.mutateAsync({ businessId, callId, mime, base64 }))
        .then((heard) => {
          if (heard.text.trim()) say(heard.text.trim(), "spoken");
        })
        .catch((err: unknown) => setFailed({ item: { text: "", via: "spoken", clientTurnId: "" }, message: errorMessage(err) }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutateAsync is stable
    [say, businessId, callId],
  );

  const speakingRef = useRef(false);
  speakingRef.current = playback.playing !== null;
  const mic = useCallMicrophone({
    transcription: modes?.transcription,
    agentSpeaking: () => speakingRef.current,
    // Speaking over the team stops them.
    onSpeechStart: playback.stop,
    onUtterance,
  });

  // "Let the team discuss": once the team is quiet and the founder has been silent, the agents take another round.
  const rounds = call.agentRoundsSinceFounder;
  const discussReady = shouldContinue({ kind: call.kind, discussOn, live: !ending, handBack, agentRoundsSinceFounder: rounds, busy: busy > 0, playbackIdle: playback.idle, founderActive: mic.speaking });
  useEffect(() => {
    if (!discussReady) return;
    const t = setTimeout(() => run(() => continueM.mutateAsync({ businessId, callId })), TEAM_CALL_LIMITS.discussAfterSilenceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutateAsync is stable
  }, [discussReady, rounds, run, businessId, callId]);

  const end = useCallback(() => {
    setEnding(true);
    playback.stop();
    mic.stop();
    // After any round still being written, so nothing said is lost.
    void chain.current
      .then(() => endM.mutateAsync({ businessId, callId }))
      .then((done) => {
        queryClient.setQueryData(getKey, done);
        for (const router of ["teamCall", "inbox", "plan", "dev", "product", "today"]) void queryClient.invalidateQueries({ queryKey: trpcPathPrefix(router) as unknown[] });
      })
      .catch((err: unknown) => {
        // The call stays open: nothing said is lost.
        setEnding(false);
        setFailed({ item: { text: "", via: "typed", clientTurnId: "" }, message: errorMessage(err) });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutateAsync is stable
  }, [playback, mic, queryClient, businessId, callId]);

  // Who is speaking and what is on the caption.
  const turnById = useMemo(() => new Map(call.turns.map((t) => [t.id, t] as const)), [call.turns]);
  const participantById = useMemo(() => new Map(call.participants.map((p) => [p.agentId, p] as const)), [call.participants]);
  const playingTurn = playback.playing ? turnById.get(playback.playing.turnId) : undefined;
  useEffect(() => {
    if (playback.playing) setLastLine({ turnId: playback.playing.turnId });
  }, [playback.playing]);
  const shownTurn = playingTurn ?? (founderLine ? undefined : lastLine ? turnById.get(lastLine.turnId) : undefined);
  const captionSpeaker = founderLine && !playingTurn ? ("founder" as const) : shownTurn?.agentId ? (participantById.get(shownTurn.agentId) ?? null) : null;
  const captionText = founderLine && !playingTurn ? founderLine : (shownTurn?.text ?? null);

  const thinking = busy > 0 && !ending ? call.participants.map((p) => p.agentId) : [];
  const simulated = modes?.speech === "simulated" || modes?.transcription === "simulated";
  const notice = simulated ? (modes?.notice ?? TEAM_CALL_WORDS.simulatedNotice) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="call-room" data-kind={call.kind} data-ending={ending || undefined}>
      <div className="flex min-h-0 flex-1 gap-gutter overflow-y-auto p-gutter">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {notice ? (
            <div role="status" className="flex items-center gap-2" data-testid="call-simulated-notice">
              <StatusPill tone="info">Simulated</StatusPill>
              <span className="min-w-0 flex-1 text-small text-secondary">{notice}</span>
            </div>
          ) : null}
          {mic.unavailable && modes ? (
            <p className="text-small text-secondary" role="status" data-testid="call-no-mic">
              {TEAM_CALL_WORDS.noMic}
            </p>
          ) : null}
          <CallStage
            kind={call.kind}
            participants={call.participants}
            speakingAgentId={playback.playing?.agentId ?? null}
            thinkingAgentIds={thinking}
            founderSpeaking={mic.speaking}
            micOn={mic.on}
            micLevel={mic.level}
            founderName={founder.name}
          />
          {captionsOn ? <CallCaptions speaker={captionSpeaker} text={captionText} /> : null}
          {handBackNote ? (
            <p className="text-small text-secondary" role="status" data-testid="call-hand-back">
              {TEAM_CALL_WORDS.roundLimit}
            </p>
          ) : null}
          {failed ? (
            <div role="alert" className="flex items-center gap-2" data-testid="call-error">
              <StatusPill tone="bad">Not sent</StatusPill>
              <span className="min-w-0 flex-1 text-small text-secondary">{failed.message}</span>
              {failed.item.text ? (
                <Button size="sm" variant="ghost" onClick={() => send(failed.item)} data-testid="call-retry">
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {transcriptOn ? <CallTranscript turns={call.turns} participants={call.participants} speakingTurnId={playback.playing?.turnId ?? null} onClose={() => setTranscriptOn(false)} className="w-80 shrink-0" /> : null}
      </div>
      <CallControls
        kind={call.kind}
        micOn={mic.on}
        micLevel={mic.level}
        micUnavailable={mic.unavailable && modes !== undefined}
        onToggleMic={mic.toggle}
        onSubmitText={(text) => say(text, "typed")}
        discussOn={discussOn}
        onDiscussChange={setDiscussOn}
        captionsOn={captionsOn}
        onToggleCaptions={() => setCaptionsOn((v) => !v)}
        transcriptOn={transcriptOn}
        onToggleTranscript={() => setTranscriptOn((v) => !v)}
        onEnd={end}
        ending={ending}
        disabled={!call.canSpeak}
      />
    </div>
  );
}

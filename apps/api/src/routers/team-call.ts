/**
 * teamCall.* — Team call (docs/TEAM_CALL.md §5): a spoken call with the team of agents, or with one agent. Reads need the
 * Team section's read; everything that speaks, listens, ends or files needs Team write (owner, admin, member; never a
 * viewer or an example viewer). Model calls (start's opening round, say, continue, end) carry the `teamCall` allowance
 * and the shared ceiling; speech and transcription carry `teamCallSpeech`. See services/team-call.ts for each step.
 *
 * Also `agent.speechAccent.*` (merged into `agent` in router.ts): how an agent sounds on calls, chosen by an owner or an
 * admin on the agent's profile.
 */
import { SPEECH_ACCENTS, TEAM_CALL_AUDIO_MIMES, TEAM_CALL_KINDS, TEAM_CALL_LIMITS, ForbiddenError, isSpeechAccentKey } from "@foundmill/shared";
import { z } from "zod";
import { modelLimited } from "../services/model-limits";
import {
  continueTeamCall,
  endTeamCall,
  getTeamCall,
  listTeamCalls,
  previewSpeechAccent,
  sayOnTeamCall,
  setSpeechAccent,
  speakTurn,
  speechAccentsOf,
  startTeamCall,
  teamCallSpeechModes,
  transcribeOnCall,
} from "../services/team-call";
import { Id, router, sectionRead, sectionWrite } from "../trpc";

const SpeechAccentKey = z.string().refine(isSpeechAccentKey, { message: `An accent is one of: ${SPEECH_ACCENTS.map((s) => s.key).join(", ")}` });
const Base64 = z.string().min(16).max(Math.ceil((TEAM_CALL_LIMITS.maxAudioBytes * 4) / 3) + 4).regex(/^[A-Za-z0-9+/]+=*$/);

export const teamCallRouter = router({
  /** Whether accents and transcription are real here, or the browser's own stand in. No model call. */
  speechModes: sectionRead("team").query(({ ctx }) => teamCallSpeechModes(ctx)),

  list: sectionRead("team")
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(({ ctx, input }) => listTeamCalls(ctx, input.limit)),

  get: sectionRead("team").input(z.object({ callId: Id })).query(({ ctx, input }) => getTeamCall(ctx, input.callId)),

  start: sectionWrite("team")
    .input(z.object({ kind: z.enum(TEAM_CALL_KINDS), agentIds: z.array(Id).max(TEAM_CALL_LIMITS.maxAgentsInTeamCall).optional(), topic: z.string().trim().max(TEAM_CALL_LIMITS.maxTopicChars).nullish() }))
    .use(modelLimited("teamCall"))
    .mutation(({ ctx, input }) => startTeamCall(ctx, input)),

  say: sectionWrite("team")
    .input(z.object({ callId: Id, text: z.string().trim().min(1).max(TEAM_CALL_LIMITS.maxFounderChars), via: z.enum(["spoken", "typed"]), clientTurnId: z.string().trim().min(8).max(64) }))
    .use(modelLimited("teamCall"))
    .mutation(({ ctx, input }) => sayOnTeamCall(ctx, input)),

  continue: sectionWrite("team").input(z.object({ callId: Id })).use(modelLimited("teamCall")).mutation(({ ctx, input }) => continueTeamCall(ctx, input.callId)),

  speech: sectionWrite("team").input(z.object({ callId: Id, turnId: Id })).use(modelLimited("teamCallSpeech")).mutation(({ ctx, input }) => speakTurn(ctx, input)),

  transcribe: sectionWrite("team")
    .input(z.object({ callId: Id, mime: z.enum(TEAM_CALL_AUDIO_MIMES), base64: Base64 }))
    .use(modelLimited("teamCallSpeech"))
    .mutation(({ ctx, input }) => transcribeOnCall(ctx, input)),

  end: sectionWrite("team").input(z.object({ callId: Id })).use(modelLimited("teamCall")).mutation(({ ctx, input }) => endTeamCall(ctx, input.callId)),
});

const ownerOrAdmin = (role: string) => {
  if (role !== "owner" && role !== "admin") throw new ForbiddenError("Only an owner or an admin can choose how an agent sounds");
};

export const speechAccentRouter = router({
  /** Each live agent's accent, its default and the founder's choice. No model call. */
  list: sectionRead("team").query(({ ctx }) => speechAccentsOf(ctx)),

  set: sectionWrite("team")
    .input(z.object({ agentId: Id, speechAccent: SpeechAccentKey.nullable() }))
    .mutation(({ ctx, input }) => {
      ownerOrAdmin(ctx.role);
      return setSpeechAccent(ctx, input);
    }),

  /** "Hear it": a short fixed sentence in one accent. */
  preview: sectionWrite("team")
    .input(z.object({ agentId: Id, speechAccent: SpeechAccentKey }))
    .use(modelLimited("teamCallSpeech"))
    .mutation(({ ctx, input }) => previewSpeechAccent(ctx, input)),
});

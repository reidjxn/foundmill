import { defineChannelTemplate, grant } from "./_channel";

export const channelBroadcast = defineChannelTemplate({
  channelKey: "broadcast",
  name: "Broadcast Engine",
  role: "Audio and CTV specialist",
  work: ["streaming audio and CTV buys where self-serve", "scripts and spots", "linear briefs as kits"],
  connectors: [grant("google_drive", ["files.read", "files.write"])],
  guardrails: [
    "Linear TV and radio run in offline tracking: briefs, scripts and spots prepared; the founder books and signs.",
    "Voice licenses are recorded for every synthetic voice used; no impersonation of real people.",
    "Vanity URLs and lift measurement are set up before launch; claims in scripts trace to source ids.",
  ],
  playbook: [
    "Plan: choose self-serve audio or CTV where the audience fits the budget; define the vanity URL and the lift test geography.",
    "Create: write 15/30-second scripts with sourced claims; producing a spot has no tool yet, so the script and a production brief go into the founder kit.",
    "Approve: request approval for the buy and for any spot mentioning the founder.",
    "Launch: self-serve and linear both as a founder kit with the caps stated (no ad platform tool is available yet).",
    "Measure: vanity URL visits and geo-lift versus holdout.",
    "Learn and report: weekly visits and lift (labeled Estimate), spots to rotate, next buy.",
  ],
  examples: [
    {
      input: "Spotify Ad Studio self-serve budget €800; 30-second spot approved; vanity URL /radio.",
      output: "Founder kit prepared for the self-serve campaign, not launched by me: cap €800 lifetime, €60/day, audience UK 25-44 business podcasts, the approved spot, vanity URL /radio; lift test: Manchester vs Leeds holdout. Linear brief for regional radio prepared as a founder kit.",
    },
  ],
  craftSkills: ["scriptwriting", "media_research", "kit_preparation", "lift_measurement"],
  spendCapMinor: 80_000,
  kitMode: true,
  neverDoes: ["book linear media", "sign media contracts", "use unlicensed or impersonating voices", "launch without a vanity URL"],
});

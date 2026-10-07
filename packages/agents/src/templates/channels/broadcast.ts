import { defineChannelTemplate, grant } from "./_channel";

export const channelBroadcast = defineChannelTemplate({
  channelKey: "broadcast",
  name: "Broadcast Engine",
  role: "Audio and CTV specialist",
  work: ["streaming audio and CTV buys where self-serve", "scripts and spots", "linear briefs as kits"],
  connectors: [grant("spotify_ad_studio", ["campaigns.create", "campaigns.pause", "reports.read"]), grant("elevenlabs", ["speech.synthesise", "voices.list"]), grant("google_drive", ["files.read", "files.write"])],
  guardrails: [
    "Linear TV and radio run in offline tracking: briefs, scripts and spots prepared; the founder books and signs.",
    "Voice licences are recorded for every synthetic voice used; no impersonation of real people.",
    "Vanity URLs and lift measurement are set up before launch; claims in scripts trace to source ids.",
  ],
  playbook: [
    "Plan: choose self-serve audio or CTV where the audience fits the budget; define the vanity URL and the lift test geography.",
    "Create: write 15/30-second scripts with sourced claims; produce spots with licensed voices.",
    "Approve: request approval for the buy and for any spot mentioning the founder.",
    "Launch: self-serve campaigns within caps; linear as a founder kit.",
    "Measure: vanity URL visits and geo-lift versus holdout.",
    "Learn and report: weekly visits and lift (labelled Estimate), spots to rotate, next buy.",
  ],
  examples: [
    {
      input: "Spotify Ad Studio self-serve budget €800; 30-second spot approved; vanity URL /radio.",
      output: "Campaign live within cap (€800 lifetime, €60/day), audience UK 25-44 business podcasts; vanity URL visits tracked; lift test: Manchester vs Leeds holdout. Voice licence recorded (lic_7). Linear brief for regional radio prepared as a founder kit.",
    },
  ],
  craftSkills: ["scriptwriting", "media_research", "kit_preparation", "lift_measurement"],
  spendCapMinor: 80_000,
  kitMode: true,
  neverDoes: ["book linear media", "sign media contracts", "use unlicensed or impersonating voices", "launch without a vanity URL"],
});

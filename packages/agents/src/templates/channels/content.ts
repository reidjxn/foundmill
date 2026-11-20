import { defineChannelTemplate, grant } from "./_channel";

export const channelContent = defineChannelTemplate({
  channelKey: "content",
  name: "Content Marketing Engine",
  role: "Content marketing specialist",
  work: ["editorial calendar", "blogs, guides, e-books and newsletters", "short video scripts and production briefs", "gated assets that capture leads"],
  connectors: [
    grant("google_drive", ["files.list", "files.read", "files.write"]),
    grant("notion", ["pages.search", "pages.read", "pages.write"]),
    grant("github", ["repos.read", "pulls.create", "pulls.read"]),
    grant("cli_inkscape", ["vector.make", "files.release"]),
    grant("cli_gimp", ["images.make", "files.release"]),
    grant("cli_libreoffice", ["documents.make", "files.release"]),
    grant("cli_ffmpeg", ["media.make", "files.release"]),
  ],
  guardrails: [
    "Brand voice from the brief and glossary; every factual claim cites a source record id; no invented statistics, quotes or customer stories.",
    "AI-generated audio or video is labeled where the law or platform requires; voice licenses are recorded.",
    "Anything published in the founder's name needs the founder's approval; gated assets collect only the fields the lawful basis allows.",
  ],
  playbook: [
    "Plan: build the calendar from keyword clusters, customer questions and the roadmap; one asset per week per format the budget allows.",
    "Create: draft with the brand voice; cite sources; audio and video production has no tool yet, so deliver the approved script and a production brief instead.",
    "Approve: request approval for founder-bylined pieces and for any new gated form.",
    "Launch: publish through the site's merge flow; hand a newsletter to the email engine as a task; attach tracking links.",
    "Measure: leads from content by asset; read-through and conversion.",
    "Learn and report: weekly leads from content, the asset to repurpose, the next three pieces.",
  ],
  examples: [
    {
      input: "Calendar slot: guide on month-end reconciliation for fintech ops teams; founder byline requested.",
      output: "Draft 'Month-end in 3 hours, not 3 days' (1,900 words, 6 cited sources src_12..17, glossary terms applied), gated PDF version with email-only form (lawful basis: consent). Founder byline → approval requested with the full draft attached.",
    },
  ],
  craftSkills: ["copywriting", "editorial_planning", "brand_voice", "asset_production"],
  spendCapMinor: 30_000,
  neverDoes: ["publish in the founder's name without approval", "invent statistics or customer stories", "hide AI-generated media where labeling is required", "collect data beyond the lawful basis"],
});

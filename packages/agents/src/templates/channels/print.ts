import { defineChannelTemplate, grant } from "./_channel";

export const channelPrint = defineChannelTemplate({
  channelKey: "print",
  name: "Print Engine",
  role: "Print media specialist",
  work: ["media research", "rate cards", "print-ready artwork", "booking kits for the founder"],
  connectors: [grant("gmail", ["drafts.create", "threads.read"]), grant("google_drive", ["files.list", "files.read", "files.write"])],
  guardrails: [
    "Offline tracking: bookings and insertion orders are prepared with every material attached; the founder signs and sends; never call a booking API or sign an IO.",
    "Rate cards and circulation figures are quoted with the publisher's source and date; negotiated rates are proposals until the founder confirms.",
    "Every ad carries a unique code or vanity URL for redemption tracking.",
  ],
  playbook: [
    "Plan: shortlist titles whose readership matches the customer profile; gather rate cards and circulation with sources.",
    "Create: print-ready artwork to each title's spec in the brand colors with a unique code; a booking kit (IO draft, artwork, deadlines, contact).",
    "Approve: request approval for the media plan cost.",
    "Launch (offline tracking): create the founder task with the kit; record the booking once the founder confirms.",
    "Measure: code redemptions and vanity URL visits per title.",
    "Learn and report: redemptions per title, cost per redemption, titles to repeat or drop.",
  ],
  examples: [
    {
      input: "Title: Pharmacy Business monthly, quarter page £1,450 rate card, circulation 11,800 (publisher media pack, 2026-09).",
      output: "Kit prepared: IO draft (not signed), artwork 92×130 mm CMYK with code PB-OCT, deadline Oct 12, contact ads@... (from media pack). Founder task created; no booking made. Negotiation proposal: 20% first-insertion discount, pending founder.",
    },
  ],
  craftSkills: ["media_research", "negotiation", "print_production", "kit_preparation"],
  spendCapMinor: 0,
  neverDoes: ["call a booking API", "sign insertion orders", "quote circulation without a source", "book without a tracking code"],
});

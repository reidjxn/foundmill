import { defineChannelTemplate, grant } from "./_channel";

export const channelOutdoor = defineChannelTemplate({
  channelKey: "outdoor",
  name: "Outdoor Engine",
  role: "Out-of-home specialist",
  work: ["digital out-of-home buys", "creative sizing for each format", "static site quotes as kits"],
  connectors: [grant("vistar", ["inventory.search", "campaigns.create", "campaigns.pause", "reports.read"]), grant("adquick", ["inventory.search", "quotes.read"]), grant("google_drive", ["files.read", "files.write"])],
  guardrails: [
    "The founder approves every booking, digital or static; nothing is committed without the decision record.",
    "Creative carries a QR code and a short URL; geo-lift uses a holdout region and is labelled Estimate.",
    "Static site contracts are kits: quotes, artwork and the contract draft for the founder to sign.",
  ],
  playbook: [
    "Plan: find inventory near where the customer is (office districts, transit, retail) within budget; define the holdout.",
    "Create: artwork per format spec with QR and short URL; quote comparison.",
    "Approve: request approval for every booking.",
    "Launch: DOOH flights after approval; static as kits.",
    "Measure: QR scans, short URL visits, geo-lift versus holdout.",
    "Learn and report: scans and lift per site, cost per scan, sites to renew.",
  ],
  examples: [
    {
      input: "Two DOOH screens near Canary Wharf, £1,900 for two weeks; static 48-sheet quote £2,400 + production.",
      output: "Decision raised: option A DOOH flight £1,900 (recommended: measurable, QR per screen), option B static £2,400 (kit: contract draft attached), option C skip. Artwork sized 1080×1920 and 48-sheet 6096×3048 mm prepared.",
    },
  ],
  craftSkills: ["media_research", "creative_sizing", "kit_preparation", "lift_measurement"],
  spendCapMinor: 0,
  kitMode: true,
  neverDoes: ["book without founder approval", "sign site contracts", "run creative without QR or short URL", "report lift without a holdout"],
});

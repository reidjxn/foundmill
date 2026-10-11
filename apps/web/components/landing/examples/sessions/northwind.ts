/**
 * Northwind's Live sessions: four Formulation Lab specialists working toward the batch 007 order. Each tile plays its
 * own task's recording and then picks up its next one (tile k: tasks k and k + 4). The lab's sandbox holds its batch
 * records; its checks are each document's acceptance tests, and work is filed to Drive rather than merged. The purchase
 * order pack ends waiting for the founder (the Inbox's "Place the purchase order for batch 007?"), so that session is
 * parked. Quote numbers and prices match the pack: Cranbury's fills, Maumee Valley's components, Keystone's freight.
 */
import type { MockSessionAgent, MockTaskScript } from "@foundmill/dugout";
import { fileChange, sessionScript } from "./shared";

const SYNC = ["$ uv sync --frozen", "Resolved 42 packages in 9ms", "Installed 42 packages in 188ms"];
const pytest = (file: string, n: number, seconds: string) => [`$ uv run pytest tests/${file} -q`, `${".".repeat(n)} [100%]`, `${n} passed in ${seconds}s`];

const AGENTS: readonly MockSessionAgent[] = [
  { name: "Aloe", seed: "aloe", role: "Formulation chemist", dept: "dept-7", model: "opus", kind: "specialist" },
  { name: "Reed", seed: "reed", role: "Sourcing and manufacturing", dept: "dept-7", model: "sonnet", kind: "specialist" },
  { name: "Sorrel", seed: "sorrel", role: "Quality and release", dept: "dept-7", model: "sonnet", kind: "specialist" },
  { name: "Fern", seed: "fern", role: "Formulation lead", dept: "dept-7", model: "opus", kind: "specialist" },
];

const SERUM_STABILITY: MockTaskScript = {
  title: "Week-12 stability readout: calming serum",
  goal: "Read the serum's week-12 stability samples against its spec and write the readout for the batch 007 pack.",
  plan: ["Pull the week-12 readings from Cranbury's report", "Compare pH, viscosity, color and odor with the spec", "Check the 40°C and freeze-thaw samples", "Flag any drift with its values", "Write the readout", "Attach it to the batch 007 pack"],
  readPath: "lab/stability/calming-serum/spec.md",
  terminal: {
    setup: SYNC,
    unit: pytest("test_stability.py", 8, "0.41"),
    check: ["$ uv run lab stability calming-serum --week 12", "pH 5.3 (spec 5.0–5.8) · viscosity −3% · 40°C ✓ · freeze-thaw ✓", "$ uv run lab check readout calming-serum-w12", "  ✓  every reading has its spec beside it", "  ✓  samples at 25°C, 40°C and freeze-thaw", "  ✘  color reading missing for the 40°C sample", "  2 passed, 1 failed"],
    fix: ["$ uv run lab import cranbury CCL-SR-1012 --sample 40C", "40°C sample: color L* 92.1 (spec ≥ 90) ✓", '$ git commit -am "stability: serum week 12, 40°C color"', "[agent/task-1 a3d52e7] stability: serum week 12, 40°C color", "$ uv run lab check readout calming-serum-w12", "  3 passed (every reading in spec)"],
    ship: ["$ uv run lab attach calming-serum-w12 --to batch-007", "Attached: week-12 readout → Batch 007 › PO pack"],
  },
  file: fileChange("lab/stability/calming-serum/week-12.md", "@@ -0,0 +1,10 @@", [
    "+# Calming serum · stability, week 12",
    "+",
    "+| Reading | Spec | 25°C | 40°C | Freeze-thaw |",
    "+| --- | --- | ---: | ---: | ---: |",
    "+| pH | 5.0–5.8 | 5.3 | 5.2 | 5.3 |",
    "+| Viscosity, change | ±10% | −3% | −6% | −2% |",
    "+| Color (L*) | ≥ 90 | 93.4 | 92.1 | 93.0 |",
    "+| Odor | none | none | none | none |",
    "+",
    "+In spec at every condition. Source: Cranbury report CCL-SR-1012.",
  ], true),
  notes: [
    "Pulling the week-12 readings from Cranbury's report before writing anything.",
    "Every reading sits beside its spec, so any drift shows at a glance.",
    "pH and viscosity hold at 25°C, at 40°C and after freeze-thaw.",
    "The 40°C sample has no color reading. Importing it from Cranbury's report.",
    "Review: Fern checked the readout against the spec sheet; no drift to flag.",
  ],
  unitCommand: "uv run pytest",
  unitPassed: 8,
  acceptanceCommand: "uv run lab check readout",
  failingCheck: "a color reading for every sample",
  doneNote: "Done. The week-12 readout is attached to the batch 007 pack.",
  preview: {
    address: "Drive › Lab › Stability › Calming serum",
    title: "Calming serum · stability, week 12",
    rows: [
      { label: "pH at 40°C", value: "5.2 (spec 5.0 to 5.8)", tone: "good" },
      { label: "Viscosity at 40°C", value: "−6% (limit ±10%)", tone: "good" },
      { label: "Color at 40°C", value: "L* 92.1 (spec ≥ 90)", tone: "good" },
      { label: "Freeze-thaw, three cycles", value: "No separation", tone: "good" },
    ],
    footer: "In spec at every condition. Source: Cranbury report CCL-SR-1012.",
  },
};

const PUMP_RFQ: MockTaskScript = {
  title: "RFQ: 30 ml airless pumps, three suppliers",
  goal: "Compare three suppliers' quotes for the serum's 30 ml airless pump and recommend one for batch 007.",
  plan: ["Log the three pump quotes", "Check minimum order and lead time against batch 007", "Compare the samples' fit and seal", "Work out landed cost per pump", "Write the recommendation"],
  readPath: "lab/sourcing/rfq-pumps-30ml.md",
  terminal: {
    setup: SYNC,
    unit: pytest("test_quotes.py", 6, "0.29"),
    check: ["$ uv run lab quotes compare pumps-30ml", "MVP-2290  Maumee Valley       $0.92  min 5,000   18 days", "LC-3318   Lakeshore Closures  $0.86  min 10,000  35 days", "PD-0412   Penn Dispensing     $1.04  min 2,500   12 days", "$ uv run lab check rfq pumps-30ml", "  ✓  three quotes, each with its number", "  ✓  lead time inside batch 007's window", "  ✘  seal test missing for PD-0412", "  2 passed, 1 failed"],
    fix: ["$ uv run lab samples log PD-0412 --seal-test", "PD-0412: seal test pass, 0 of 50 leaked", '$ git commit -am "rfq: 30 ml pumps, recommendation"', "[agent/task-2 7b19c40] rfq: 30 ml pumps, recommendation", "$ uv run lab check rfq pumps-30ml", "  3 passed (recommend MVP-2290)"],
    ship: ["$ uv run lab rfq export pumps-30ml --to drive", "Saved: Drive › Lab › Sourcing › 30 ml pumps"],
  },
  file: fileChange("lab/sourcing/pumps-30ml.md", "@@ -0,0 +1,9 @@", [
    "+# 30 ml airless pumps · quotes",
    "+",
    "+| Quote | Supplier | Unit | Minimum | Lead time | Seal test |",
    "+| --- | --- | ---: | ---: | ---: | --- |",
    "+| MVP-2290 | Maumee Valley Packaging | $0.92 | 5,000 | 18 days | pass |",
    "+| LC-3318 | Lakeshore Closures | $0.86 | 10,000 | 35 days | pass |",
    "+| PD-0412 | Penn Dispensing | $1.04 | 2,500 | 12 days | pass |",
    "+",
    "+Recommend MVP-2290: the lowest price at 5,000 pumps that lands before batch 007 is filled.",
  ], true),
  notes: [
    "Logging the three pump quotes with their numbers before comparing any.",
    "Lakeshore is cheapest per pump but needs an order of 10,000 and 35 days.",
    "Maumee's pump fits the serum's 30 ml bottle with the current cap.",
    "Penn's sample has no seal test on file. Logging the lab's result before comparing.",
    "Review: Fern agreed; Lakeshore's minimum would tie up $4,000 more in stock.",
  ],
  unitCommand: "uv run pytest",
  unitPassed: 6,
  acceptanceCommand: "uv run lab check rfq",
  failingCheck: "a seal test for every sample",
  doneNote: "Done. Recommended Maumee Valley's MVP-2290 at $0.92 a pump.",
  preview: {
    address: "Drive › Lab › Sourcing › 30 ml pumps",
    title: "30 ml airless pumps · three quotes",
    rows: [
      { label: "MVP-2290 · Maumee Valley", value: "$0.92 · 18 days", tone: "good" },
      { label: "LC-3318 · Lakeshore Closures", value: "$0.86 · minimum 10,000", tone: "warn" },
      { label: "PD-0412 · Penn Dispensing", value: "$1.04 · 12 days" },
      { label: "Recommended", value: "MVP-2290" },
    ],
    footer: "Every quote cites its number. Seal tests: 3 of 3 pass.",
  },
};

const BATCH_006_COAS: MockTaskScript = {
  title: "Certificates of analysis for batch 006",
  goal: "Check batch 006's certificates of analysis against the release spec and file the release note Larkfield's buyer asked for.",
  plan: ["Read batch 006's certificates of analysis", "Check every result against the release spec", "Match lot numbers to the batch record", "Flag anything out of spec", "File the release note"],
  readPath: "lab/batches/batch-006/batch-record.md",
  terminal: {
    setup: SYNC,
    unit: pytest("test_coa.py", 9, "0.33"),
    check: ["$ uv run lab coa check batch-006", "  ✓  results in spec: 3 lots, 27 of 27 tests", "  ✓  micro counts under the limit (< 100 CFU/g)", "  ✘  lot 006-C on the certificate, 006-3 in the record", "  2 passed, 1 failed"],
    fix: ["$ uv run lab batch-record show batch-006 --lots", "006-A, 006-B, 006-C (Cranbury's lots 1, 2 and 3)", '$ git commit -am "batch-006: map Cranbury lot numbers"', "[agent/task-3 c4e2b91] batch-006: map Cranbury lot numbers", "$ uv run lab coa check batch-006", "  3 passed (3 of 3 lots in spec)"],
    ship: ["$ uv run lab release-note batch-006 --to drive", "Saved: Drive › Lab › Batch 006 › Release note"],
  },
  file: fileChange("lab/batches/batch-006/release-note.md", "@@ -0,0 +1,9 @@", [
    "+# Batch 006 · release note",
    "+",
    "+| Lot | Product | Tests | Result |",
    "+| --- | --- | ---: | --- |",
    "+| 006-A | Calming serum, 30 ml | 9 of 9 | in spec |",
    "+| 006-B | Gentle cleanser, 150 ml | 9 of 9 | in spec |",
    "+| 006-C | Barrier moisturizer, 50 ml | 9 of 9 | in spec |",
    "+",
    "+Certificates: Cranbury Contract Labs and Clearwell Testing Labs. Micro counts under 100 CFU/g.",
  ], true),
  notes: [
    "Reading batch 006's certificates from Cranbury and Clearwell.",
    "Every result sits beside its release spec.",
    "Micro counts are well under the limit on all three lots.",
    "One lot reads 006-C on the certificate and 006-3 in the batch record. Mapping Cranbury's numbering.",
    "Review: Arden confirmed the release note claims nothing beyond the results.",
  ],
  unitCommand: "uv run pytest",
  unitPassed: 9,
  acceptanceCommand: "uv run lab coa check",
  failingCheck: "lot numbers match the batch record",
  doneNote: "Done. Batch 006 release note filed: 3 of 3 lots in spec.",
  preview: {
    address: "Drive › Lab › Batch 006 › Release note",
    title: "Batch 006 · release note",
    rows: [
      { label: "006-A · Calming serum", value: "9 of 9 in spec", tone: "good" },
      { label: "006-B · Gentle cleanser", value: "9 of 9 in spec", tone: "good" },
      { label: "006-C · Barrier moisturizer", value: "9 of 9 in spec", tone: "good" },
      { label: "Micro counts", value: "under 100 CFU/g" },
    ],
    footer: "For Larkfield Market's buyer, with the certificates attached.",
  },
};

/** The purchase order pack the lab prepares for the founder: every line cites a quote. */
const PO_PACK: MockTaskScript = {
  title: "Purchase order pack for batch 007",
  goal: "Prepare the batch 007 purchase order for your approval, with every line citing its quote.",
  plan: ["Collect the current quotes", "Write the order lines with quote numbers", "Work out landed cost at 3,000 and 5,000 units", "Attach the stability readout", "Check the deposit against Cranbury's terms", "Send the pack to you for approval"],
  readPath: "lab/batches/batch-006/batch-record.md",
  terminal: {
    setup: SYNC,
    unit: [...pytest("test_landed_cost.py", 6, "0.38"), "$ uv run lab landed-cost batch-007 --units 5000", "Landed cost per routine: $11.78 (Estimate)"],
    check: ["$ uv run lab check po-pack batch-007", "  ✓  every line cites a quote (9 of 9)", "  ✓  landed cost at 3,000 and 5,000 units", "  ✘  stability readout for every product (serum missing)", "  2 passed, 1 failed"],
    fix: ["$ uv run lab attach calming-serum-w12 --to batch-007", "Attached: week-12 readout (in spec)", '$ git add -A && git commit -m "batch-007: serum week 12"', "[agent/task-4 5e81c0a] batch-007: serum week 12", " 3 files changed, 64 insertions(+), 2 deletions(-)", "$ uv run ruff check lab", "All checks passed!", "$ uv run lab check po-pack batch-007", "  3 passed (9 lines, deposit $21,000)"],
    ship: ["$ uv run lab pack export batch-007 --to drive", "Saved: Drive › Lab › Batch 007 › PO pack, for your approval"],
  },
  file: fileChange("lab/batches/batch-007/po-pack.md", "@@ -0,0 +1,16 @@", [
    "+# Batch 007 purchase order pack, for your approval",
    "+",
    "+| # | Item | Supplier | Quote | Units | Unit | Total |",
    "+| - | --- | --- | --- | ---: | ---: | ---: |",
    "+| 1 | Calming serum, 30 ml, filled | Cranbury Contract Labs | CCL-4471 | 5,000 | $3.40 | $17,000 |",
    "+| 2 | Gentle cleanser, 150 ml, filled | Cranbury Contract Labs | CCL-4472 | 5,000 | $2.10 | $10,500 |",
    "+| 3 | Barrier moisturizer, 50 ml, filled | Cranbury Contract Labs | CCL-4473 | 5,000 | $2.90 | $14,500 |",
    "+| 4 | Airless pump, 30 ml | Maumee Valley Packaging | MVP-2290 | 5,000 | $0.92 | $4,600 |",
    "+| 5 | Squeeze tube, 150 ml | Maumee Valley Packaging | MVP-2291 | 5,000 | $0.48 | $2,400 |",
    "+| 6 | Airless jar, 50 ml | Maumee Valley Packaging | MVP-2292 | 5,000 | $0.84 | $4,200 |",
    "+| 7 | Cartons, three sizes | Maumee Valley Packaging | MVP-2293 | 15,000 | $0.21 | $3,150 |",
    "+| 8 | Freight to the warehouse | Keystone Freight | KF-118 | 1 | $1,650 | $1,650 |",
    "+| 9 | Release testing, three lots | Clearwell Testing Labs | CTL-532 | 3 | $300 | $900 |",
    "+",
    "+Deposit with the order: 50% of Cranbury's $42,000 = $21,000, paid by you.",
    "+Landed cost per routine: $11.78 (Estimate)",
  ], true),
  notes: [
    "Reading Cranbury's quotes and the last batch record before writing a line.",
    "Every order line carries its quote number, so each cost can be traced.",
    "Landed cost per routine comes to $11.78 at 5,000 units (Estimate).",
    "The pack is missing the serum's week-12 readout. Attaching Aloe's readout from the lab.",
    "Review: Cranbury's serum quote had expired; Reed had it reissued at the same price.",
  ],
  unitCommand: "uv run pytest",
  unitPassed: 6,
  acceptanceCommand: "uv run lab check po-pack",
  failingCheck: "stability readout for every product",
  // After the founder's nudge: the 3,000-unit tier beside the 5,000-unit one.
  nudge: {
    text: "Show the 3,000-unit price too",
    reply: "Adding the 3,000-unit tier beside each line.",
    file: fileChange("lab/batches/batch-007/landed-cost.md", "@@ -1,6 +1,6 @@", [
      "-| Per routine | 5,000 units |",
      "-| --- | ---: |",
      "-| Fill, formula and QC | $8.40 |",
      "-| Components and cartons | $2.87 |",
      "-| Freight and release testing | $0.51 |",
      "-| Landed (Estimate) | $11.78 |",
      "+| Per routine | 5,000 units | 3,000 units |",
      "+| --- | ---: | ---: |",
      "+| Fill, formula and QC | $8.40 | $9.30 |",
      "+| Components and cartons | $2.87 | $3.03 |",
      "+| Freight and release testing | $0.51 | $0.77 |",
      "+| Landed (Estimate) | $11.78 | $13.10 |",
    ]),
  },
  // Placing the order, with its deposit, is the founder's alone (the Inbox's "Place the purchase order for batch 007?").
  gate: { connectorKey: "gmail", tool: "send_email", argsSummary: "Purchase order for batch 007 to Cranbury Contract Labs", note: "Waiting for your decision: batch 007, $21,000 deposit.", at: "end" },
  preview: {
    address: "Drive › Lab › Batch 007 › PO pack",
    title: "Batch 007 · purchase order pack",
    rows: [
      { label: "Cranbury Contract Labs, 3 × 5,000 fills", value: "$42,000" },
      { label: "Maumee Valley Packaging, components", value: "$14,350" },
      { label: "Freight and release testing", value: "$2,550" },
      { label: "Deposit with the order (50%)", value: "$21,000", tone: "warn" },
      { label: "Landed cost per routine", value: "$11.78 (Estimate)" },
    ],
    footer: "For your approval. Every line cites its quote.",
  },
};

const LOTION_CHALLENGE: MockTaskScript = {
  title: "Preservative efficacy test: body lotion",
  goal: "Log Clearwell's challenge test of the body lotion against the USP 51 criteria, organism by organism.",
  plan: ["Read Clearwell's challenge test protocol", "Log the counts at days 7, 14 and 28", "Compare each organism with the USP 51 criteria", "Flag any organism that misses", "Write the result for the body lotion file"],
  readPath: "lab/body-lotion/challenge-protocol.md",
  terminal: {
    setup: SYNC,
    unit: pytest("test_pet.py", 7, "0.27"),
    check: ["$ uv run lab pet body-lotion --report CTL-588", "S. aureus · day 14: 3.4 log drop ✓", "E. coli · day 14: 3.9 log drop ✓", "C. albicans · day 28: no increase ✓", "$ uv run lab check pet body-lotion", "  ✓  bacteria: at least a 2 log drop by day 14", "  ✓  yeast: no increase by day 28", "  ✘  mold: day-28 result missing", "  2 passed, 1 failed"],
    fix: ["$ uv run lab import clearwell CTL-588 --day 28", "A. brasiliensis · day 28: no increase ✓", '$ git commit -am "pet: body lotion passes at day 28"', "[agent/task-5 2f8d6a3] pet: body lotion passes at day 28", "$ uv run lab check pet body-lotion", "  3 passed (USP 51, category 2)"],
    ship: ["$ uv run lab file pet body-lotion --to drive", "Saved: Drive › Lab › Body lotion › Challenge test"],
  },
  file: fileChange("lab/body-lotion/challenge-test.md", "@@ -0,0 +1,10 @@", [
    "+# Body lotion · preservative efficacy (USP 51)",
    "+",
    "+| Organism | Criterion | Day 7 | Day 14 | Day 28 |",
    "+| --- | --- | ---: | ---: | ---: |",
    "+| S. aureus | 2 log drop by day 14 | 1.8 | 3.4 | 4.1 |",
    "+| E. coli | 2 log drop by day 14 | 2.2 | 3.9 | 4.6 |",
    "+| C. albicans | no increase | 0.4 | 0.9 | 1.2 |",
    "+| A. brasiliensis | no increase | 0.1 | 0.3 | 0.5 |",
    "+",
    "+Report CTL-588, Clearwell Testing Labs. Log reductions from the inoculum.",
  ], true),
  notes: [
    "Reading Clearwell's protocol before logging any counts.",
    "Each organism's count sits beside the USP 51 criterion it has to meet.",
    "Both bacteria dropped more than 3 logs by day 14.",
    "The day-28 mold result is missing from the file. Importing Clearwell's final report.",
    "Review: Fern checked the counts against Clearwell's signed report.",
  ],
  unitCommand: "uv run pytest",
  unitPassed: 7,
  acceptanceCommand: "uv run lab check pet",
  failingCheck: "a day-28 result for every organism",
  doneNote: "Done. The body lotion passes its challenge test at day 28.",
  preview: {
    address: "Drive › Lab › Body lotion › Challenge test",
    title: "Body lotion · challenge test (USP 51)",
    rows: [
      { label: "S. aureus, day 14", value: "3.4 log drop", tone: "good" },
      { label: "E. coli, day 14", value: "3.9 log drop", tone: "good" },
      { label: "C. albicans, day 28", value: "No increase", tone: "good" },
      { label: "A. brasiliensis, day 28", value: "No increase", tone: "good" },
    ],
    footer: "Report CTL-588 from Clearwell Testing Labs.",
  },
};

const FREIGHT_QUOTES: MockTaskScript = {
  title: "Freight quotes: New Jersey to the warehouse",
  goal: "Compare three carriers' quotes to bring batch 007 from Cranbury to the warehouse inside its delivery window.",
  plan: ["List the pallets for batch 007", "Log each carrier's quote and transit time", "Check the warehouse's delivery window", "Check liftgate and insurance", "Write the recommendation"],
  readPath: "lab/batches/batch-007/shipping.md",
  terminal: {
    setup: SYNC,
    unit: ["$ uv run lab pallets batch-007", "15,000 units · 12 pallets · 4,860 lb", ...pytest("test_freight.py", 5, "0.22")],
    check: ["$ uv run lab quotes compare freight-batch-007", "KF-118   Keystone Freight   $1,650  3 days", "BR-2207  Blue Route LTL     $1,420  6 days", "SL-0931  Summit Logistics   $1,980  2 days", "$ uv run lab check freight batch-007", "  ✓  three quotes, each with its number", "  ✓  liftgate and insurance included", "  ✘  BR-2207 lands after the delivery window", "  2 passed, 1 failed"],
    fix: ['$ uv run lab quotes exclude BR-2207 --reason "misses the window"', "excluded BR-2207", '$ git commit -am "freight: batch 007 recommendation"', "[agent/task-6 91c3e5f] freight: batch 007 recommendation", "$ uv run lab check freight batch-007", "  3 passed (recommend KF-118)"],
    ship: ["$ uv run lab freight export batch-007 --to drive", "Saved: Drive › Lab › Batch 007 › Freight"],
  },
  file: fileChange("lab/batches/batch-007/freight.md", "@@ -0,0 +1,9 @@", [
    "+# Batch 007 · freight from Cranbury, NJ",
    "+",
    "+| Quote | Carrier | Price | Transit | In the window |",
    "+| --- | --- | ---: | ---: | --- |",
    "+| KF-118 | Keystone Freight | $1,650 | 3 days | yes |",
    "+| BR-2207 | Blue Route LTL | $1,420 | 6 days | no |",
    "+| SL-0931 | Summit Logistics | $1,980 | 2 days | yes |",
    "+",
    "+Recommend KF-118: the lowest price that lands inside the warehouse's window. 12 pallets, liftgate included.",
  ], true),
  notes: [
    "Listing the pallets before asking anyone for a price.",
    "Each quote is logged with its number, transit time and what it includes.",
    "Blue Route is the cheapest, at six days in transit.",
    "Blue Route lands after the warehouse's delivery window. Setting it aside rather than moving the window.",
    "Review: Fern agreed; Keystone's price matches the line in the batch 007 pack.",
  ],
  unitCommand: "uv run pytest",
  unitPassed: 5,
  acceptanceCommand: "uv run lab check freight",
  failingCheck: "every quote lands inside the delivery window",
  doneNote: "Done. Recommended Keystone Freight at $1,650 (KF-118).",
  preview: {
    address: "Drive › Lab › Batch 007 › Freight",
    title: "Batch 007 · freight quotes",
    rows: [
      { label: "KF-118 · Keystone Freight", value: "$1,650 · 3 days", tone: "good" },
      { label: "BR-2207 · Blue Route LTL", value: "$1,420 · 6 days", tone: "bad" },
      { label: "SL-0931 · Summit Logistics", value: "$1,980 · 2 days" },
      { label: "Load", value: "12 pallets · 4,860 lb" },
    ],
    footer: "Recommended: Keystone Freight, inside the delivery window.",
  },
};

const CARTON_PROOFS: MockTaskScript = {
  title: "Carton proof: net contents and lot code",
  goal: "Check Maumee's carton proofs for net contents, the lot code area and claims before they go to print.",
  plan: ["Read the carton proofs from Maumee", "Check net contents in fl oz and mL", "Check the lot code and expiry print area", "Check every claim against the approved list", "File the marked-up proofs"],
  readPath: "lab/cartons/approved-claims.md",
  terminal: {
    setup: SYNC,
    unit: ["$ uv run lab proofs fetch MVP-2293 --from drive", "3 carton proofs · serum, cleanser, moisturizer", ...pytest("test_labels.py", 6, "0.31")],
    check: ["$ uv run lab check carton-proofs MVP-2293", "  ✓  net contents in fl oz and mL on all 3", "  ✓  lot code and expiry area, 12 × 30 mm", "  ✘  claim 'dermatologist approved' is not approved", "  2 passed, 1 failed"],
    fix: ['$ uv run lab proofs mark MVP-2293 --remove-claim "dermatologist approved"', "marked up: moisturizer carton, back panel", '$ git commit -am "cartons: remove an unapproved claim"', "[agent/task-7 4a7e0d2] cartons: remove an unapproved claim", "$ uv run lab check carton-proofs MVP-2293", "  3 passed (3 cartons)"],
    ship: ["$ uv run lab proofs file MVP-2293 --to drive", "Saved: Drive › Lab › Cartons › Proofs, marked up"],
  },
  file: fileChange("lab/cartons/proof-check.md", "@@ -0,0 +1,9 @@", [
    "+# Carton proofs · MVP-2293",
    "+",
    "+| Carton | Net contents | Lot and expiry | Claims |",
    "+| --- | --- | --- | --- |",
    "+| Calming serum | 1 fl oz (30 mL) | 12 × 30 mm | approved |",
    "+| Gentle cleanser | 5 fl oz (150 mL) | 12 × 30 mm | approved |",
    "+| Barrier moisturizer | 1.7 fl oz (50 mL) | 12 × 30 mm | remove 'dermatologist approved' |",
    "+",
    "+Claims checked against the approved list Arden keeps.",
  ], true),
  notes: [
    "Reading the approved claims list before the proofs.",
    "Net contents read in fl oz first, then mL, on every carton.",
    "The lot code and expiry area fits the printer's 12 × 30 mm stamp.",
    "The moisturizer carton says 'dermatologist approved', which is not on the approved list. Marking it for removal.",
    "Review: Arden agreed; the claim needs evidence Northwind does not have.",
  ],
  unitCommand: "uv run pytest",
  unitPassed: 6,
  acceptanceCommand: "uv run lab check carton-proofs",
  failingCheck: "every claim on the approved list",
  doneNote: "Done. Marked-up carton proofs filed for Arden's sign-off.",
  preview: {
    address: "Drive › Lab › Cartons › Proofs, marked up",
    title: "Carton proofs · MVP-2293",
    rows: [
      { label: "Calming serum · 1 fl oz (30 mL)", value: "Ready", tone: "good" },
      { label: "Gentle cleanser · 5 fl oz (150 mL)", value: "Ready", tone: "good" },
      { label: "Barrier moisturizer · 1.7 fl oz (50 mL)", value: "Claim removed", tone: "warn" },
      { label: "Lot code and expiry area", value: "12 × 30 mm" },
    ],
    footer: "For Arden's sign-off before Maumee prints.",
  },
};

const LANDED_COST: MockTaskScript = {
  title: "Landed cost at 3,000 and 5,000 units",
  goal: "Work out what one routine costs landed at 3,000 and at 5,000 units, every figure from a current quote.",
  plan: ["Collect the current quotes", "Price fill, components and cartons at each tier", "Add freight and release testing per routine", "Compare the two tiers", "Write the summary for Tess"],
  readPath: "lab/batches/batch-007/po-pack.md",
  terminal: {
    setup: SYNC,
    unit: pytest("test_landed_cost.py", 6, "0.38"),
    check: ["$ uv run lab landed-cost batch-007 --units 3000,5000", "5,000 units: $11.78 a routine (Estimate)", "3,000 units: $13.10 a routine (Estimate)", "$ uv run lab check landed-cost batch-007", "  ✓  freight split across the routines", "  ✓  release testing split across the lots", "  ✘  3,000-unit fill price has no quote", "  2 passed, 1 failed"],
    fix: ["$ uv run lab quotes add CCL-4471-B --tier 3000 --from drive", "added: Cranbury fill at 3,000 units, $9.30 a routine", '$ git commit -am "landed cost: quote the 3,000 tier"', "[agent/task-8 e05b7c4] landed cost: quote the 3,000 tier", "$ uv run lab check landed-cost batch-007", "  3 passed (both tiers quoted)"],
    ship: ["$ uv run lab landed-cost export batch-007 --to drive", "Saved: Drive › Lab › Batch 007 › Landed cost"],
  },
  file: fileChange("lab/batches/batch-007/landed-cost.md", "@@ -0,0 +1,9 @@", [
    "+| Per routine | 5,000 units | 3,000 units |",
    "+| --- | ---: | ---: |",
    "+| Fill, formula and QC | $8.40 | $9.30 |",
    "+| Components and cartons | $2.87 | $3.03 |",
    "+| Freight and release testing | $0.51 | $0.77 |",
    "+| Landed (Estimate) | $11.78 | $13.10 |",
    "+",
    "+Quotes: CCL-4471 to CCL-4473, CCL-4471-B, MVP-2290 to MVP-2293, KF-118, CTL-532.",
  ], true),
  notes: [
    "Collecting the current quotes before pricing anything.",
    "Fill, components, cartons, freight and testing are each priced per routine.",
    "The smaller batch costs $1.32 more a routine, mostly in the fill.",
    "The 3,000-unit fill price had no quote behind it. Adding Cranbury's tier quote.",
    "Review: Tess checked the totals against the batch 007 pack.",
  ],
  unitCommand: "uv run pytest",
  unitPassed: 6,
  acceptanceCommand: "uv run lab check landed-cost",
  failingCheck: "every figure cites a quote",
  doneNote: "Done. Landed cost: $11.78 a routine at 5,000 units, $13.10 at 3,000 (Estimate).",
  preview: {
    address: "Drive › Lab › Batch 007 › Landed cost",
    title: "Landed cost per routine (Estimate)",
    rows: [
      { label: "Fill, formula and QC", value: "$8.40 · $9.30" },
      { label: "Components and cartons", value: "$2.87 · $3.03" },
      { label: "Freight and release testing", value: "$0.51 · $0.77" },
      { label: "Landed, 5,000 · 3,000 units", value: "$11.78 · $13.10" },
    ],
    footer: "Every figure cites a current quote.",
  },
};

/** Tile k plays task k, then task k + 4: Aloe, Reed, Sorrel and Fern each have two. */
export const NORTHWIND_SESSIONS = sessionScript({
  agents: AGENTS,
  taskScripts: [SERUM_STABILITY, PUMP_RFQ, BATCH_006_COAS, PO_PACK, LOTION_CHALLENGE, FREIGHT_QUOTES, CARTON_PROOFS, LANDED_COST],
  currency: "USD",
  failure: "Error: quote CCL-4471 expired on Oct 2; ask Cranbury to reissue it",
  previewNote: "The finished document appears here once its checks pass.",
});

import { defineChannelTemplate, grant } from "./_channel";

export const channelEvents = defineChannelTemplate({
  channelKey: "events",
  name: "Event Marketing Engine",
  role: "Events specialist",
  work: ["find trade shows and meetups", "negotiate sponsorship proposals", "host events and pop-ups", "capture leads", "follow up"],
  connectors: [grant("gmail", ["drafts.create", "threads.read"]), grant("google_calendar", ["events.create", "events.list"])],
  guardrails: [
    "Sponsorship contracts and deposits are founder decisions: negotiate within the budget, prepare, never sign or pay.",
    "Lead capture records lawful basis and source per person; follow-ups go through the email engine's approved sequence.",
    "Hosted events disclose the business as organizer; venue agreements are kits for the founder.",
  ],
  playbook: [
    "Plan: shortlist events where the customer attends within budget and travel constraints; estimate pipeline needed to break even (Estimate).",
    "Create: sponsorship proposals, booth or talk materials, lead capture form with lawful basis, follow-up sequence draft.",
    "Approve: request approval for sponsorship cost and contracts.",
    "Launch: registering and publishing a hosted event have no tool yet, so raise a founder task with the details ready; put the event on the calendar; prepare lead capture for the day.",
    "Measure: pipeline from events by attendee → opportunity.",
    "Learn and report: pipeline per event, cost per opportunity, events to repeat.",
  ],
  examples: [
    {
      input: "Fintech Ops Summit London: sponsorship tiers £2,500 / £6,000; expected 400 attendees (organizer figure).",
      output: "Negotiated proposal: £2,500 tier plus a 10-minute talk slot (organizer agreed in writing, msg_88). Contract draft attached for founder signature; deposit £1,250 → founder action. Lead capture form ready with consent checkbox.",
    },
  ],
  craftSkills: ["event_sourcing", "negotiation", "lead_capture", "follow_up"],
  spendCapMinor: 60_000,
  neverDoes: ["sign sponsorship or venue contracts", "pay deposits", "capture leads without lawful basis", "follow up outside approved sequences"],
});

// First-run group (docs/UX_AUDIT_AND_PLAN.md §6.2): the next-step strip, the first-week checklist, coach marks and
// callouts, the example toggle. Every piece reads the one switch (GuidanceProvider) and renders nothing when guidance
// is off; `nextStepsFor` is pure and server-safe.
export * from "./firstrun/nextSteps";
export * from "./firstrun/NextStep";
export * from "./firstrun/FirstWeekChecklist";
export * from "./firstrun/Coachmark";
export * from "./firstrun/ExampleToggle";

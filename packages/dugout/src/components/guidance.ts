// Guidance group (docs/UX_AUDIT_AND_PLAN.md §6): the definitions layer. The provider is the contract every consumer
// builds against; the primitives read it. Guidance "off" hides tutoring (Term underlines, InfoTip, Explainer,
// ReassuranceLine, PlainFigure's line) and never hides information (ConsequenceLine, ScaleLabel, provenance).
export * from "./guidance/GuidanceProvider";
// Builder view: the second switch, which hides how the platform runs the team (information, on purpose) while off.
export * from "./guidance/BuilderView";
export * from "./guidance/LearnLink";
export * from "./guidance/DefinitionCard";
export * from "./guidance/Term";
export * from "./guidance/InfoTip";
export * from "./guidance/ProvenanceTip";
export * from "./guidance/Explainer";
export * from "./guidance/ConsequenceLine";
export * from "./guidance/ReassuranceLine";
export * from "./guidance/PlainFigure";
export * from "./guidance/ScaleLabel";
export { FIXTURE_TERMS } from "./guidance/fixtures";

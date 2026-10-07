// @foundmill/widgets — widget registry + data contract (docs/ARCHITECTURE.md §18).
export * from "./data";
export * from "./registry";
// Built-in widgets register themselves when this module is imported (filled in by the widgets build).
export * from "./widgets";

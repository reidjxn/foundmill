// @foundmill/widgets — widget registry + data contract (docs/ARCHITECTURE.md §18), the gallery widgets,
// dashboard presets and layout helpers (BUILD §11.2).
export * from "./data";
export * from "./registry";
export * from "./layout";
export * from "./presets";
export * from "./shared/routes";
export * from "./shared/frame";
export * from "./shared/departments";
export * from "./shared/time";
export type * from "./shared/types";
// Built-in widgets register themselves when this module is imported.
export * from "./widgets";

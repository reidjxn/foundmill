/**
 * The examples the idea field types on the landing variants that have their own (words.ts `VARIANT_WORDS`), each at
 * most `PLACEHOLDER_IDEA_MAX` characters so it fits the field whole at every width (founder, 2026-11-17). A module
 * with no imports, so the Playwright width check can measure them.
 */
export const NO_IDEA_EXAMPLES = [
  "I fix up old bikes on weekends",
  "I am good at explaining math",
  "I know every thrift store in town",
  "I bake for my whole building",
  "I edit videos for my friends",
  "I grow more tomatoes than I eat",
] as const;
export const RUNNING_EXAMPLES = [
  "A bakery with a waiting list",
  "An online shop for hand-dyed yarn",
  "A tutor with twelve students",
  "A newsletter with 800 readers",
  "A mobile bike repair van",
] as const;
export const BUILDER_EXAMPLES = [
  "A rent-splitting app for roommates",
  "A booking app for solo barbers",
  "An extension that sums up threads",
  "A training log for climbers",
  "Receipt photos into a spreadsheet",
] as const;

/** Every variant's examples, for the width checks. */
export const VARIANT_EXAMPLES: readonly string[] = [
  ...NO_IDEA_EXAMPLES,
  ...RUNNING_EXAMPLES,
  ...BUILDER_EXAMPLES,
];

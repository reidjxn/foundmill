/** The signed-in pages outside a business (account level): where Switch business, the palette and the Danger zone lead. */
export const accountRoutes = {
  /** Your businesses: open one, its settings, archived businesses. */
  businesses: "/businesses",
  /** Your businesses › Archived businesses (Restore, Export everything, Delete permanently). */
  archived: "/businesses#archived",
  /** Create a new business: the two doors (Ideation Studio, Import). */
  newBusiness: "/new",
  profile: "/onboarding",
} as const;

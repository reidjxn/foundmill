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

/** The profile pages' examples (`/2` to `/20`, lib/landing-variant.ts `PROFILE_VARIANTS`), keyed by variant. */
export const PROFILE_EXAMPLES = {
  student: ["Sneaker cleaning for my dorm", "Tutoring for intro chemistry", "Thrifted jackets, resold online", "Late-night snacks for my floor", "Moving help at the end of term"],
  graduate: ["Essay coaching for high schoolers", "Spanish lessons over video call", "Data dashboards for small shops", "Photo shoots for local bands", "A study app for nursing students"],
  "blank-box": ["Something with food, not sure what", "Maybe a dog-walking thing?", "I like plants and old furniture", "An app, but I can't code", "Help for people moving to town"],
  overwhelmed: ["A skincare line for sensitive skin", "Meal plans for busy families", "Handmade candles, sold online", "A newsletter about local hikes", "Booking for my dog grooming"],
  evenings: ["Restored chairs, sold on weekends", "Candles poured on Sunday nights", "A podcast about local history", "Weekend bike repairs near me", "Printables for wedding planners"],
  parent: ["Birthday parties in a box", "School uniform swaps near me", "Baby sleep guides by a nurse", "After-school carpool planning", "Lunchbox recipes kids will eat"],
  expert: ["HR policies for ten-person firms", "Bookkeeping help for new cafes", "Safety training for warehouses", "Pricing advice for local shops", "Grant writing for small charities"],
  trades: ["Electrical safety checks at home", "Deck repairs for older homes", "Tile work for small bathrooms", "Bike tune-ups that come to you", "Lawn care for my neighborhood"],
  retired: ["Birdhouses made in my workshop", "Phone help for older neighbors", "Walking tours of my old town", "Jam from the orchard out back", "Piano lessons for beginners"],
  maker: ["Stoneware mugs, small batches", "Quilts from old family shirts", "Leather wallets, stitched by hand", "Hand-dyed yarn in local colors", "Wooden toys for toddlers"],
  cook: ["Hot sauce from my grandma's recipe", "Sourdough for my street on Fridays", "Dumplings at the farmers market", "Vegan cookies for local cafes", "Ramen pop-ups in my backyard"],
  creator: ["Photo presets from my travels", "A paid newsletter on house plants", "Workout plans from my videos", "A cookbook of my top recipes", "Online classes in hand lettering"],
  freelancer: ["Brand templates for new bakeries", "Website audits for local dentists", "A copywriting course for shops", "Logo packs for small studios", "Video edits for real estate"],
  developer: ["AI playtesting for indie games", "Uptime alerts for small shops", "A changelog tool for startups", "Invoice reminders for freelancers", "A habit tracker that texts you"],
  "game-dev": ["A cozy farming game for phones", "Pixel art packs for game jams", "A board game about running a farm", "Sound effects for indie studios", "Speedrun coaching over video"],
  educator: ["Math practice sets for grade 6", "Reading help for adult learners", "SAT prep in small groups", "Guitar lessons over video call", "Lesson plans for new teachers"],
  beauty: ["A skincare line for sensitive skin", "Natural nail care, no harsh smells", "Hair oils for curly hair", "At-home yoga for new moms", "Bath soaks from local herbs"],
  "shop-owner": ["A bakery with a waiting list", "A flower shop on Main Street", "A bike shop that does repairs", "A cafe that wants online orders", "A salon with two chairs"],
  "idea-collector": ["A dog-walking app for my block", "Candles that smell like books", "A podcast on local history", "Bike repairs that come to you", "Cheap weekend trips, weekly"],
} as const;

/** Every variant's examples, for the width checks. */
export const VARIANT_EXAMPLES: readonly string[] = [
  ...NO_IDEA_EXAMPLES,
  ...RUNNING_EXAMPLES,
  ...BUILDER_EXAMPLES,
  ...Object.values(PROFILE_EXAMPLES).flat(),
];

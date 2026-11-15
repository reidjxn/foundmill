/**
 * Anthropomorphic agents: the persona catalog every agent draws a human first name and a face from, and the display
 * rules (founder preference `anthropomorphicAgents`, Settings › Preferences and the Launch step of a new business).
 *
 * - Each agent is given one persona key when it is hired (`agents.persona_key`), unique within its business and, where
 *   the catalog allows, not used by the owner's other businesses, so two businesses never greet a founder with the
 *   same names. The key never changes; the preference only decides whether it is shown.
 * - The face is an AI-generated portrait made once per catalog entry (platform asset, `persona_portraits`), from
 *   `personaPortraitPrompt`. The heritage, age and presentation fields exist only to make that set of faces diverse.
 * - Agents stay AI agents: the name is a display choice, and every surface keeps the role beside it, as
 *   "Bob (Chief of Staff)".
 * - Keys are stable identifiers stored on agents: never rename or reuse one. Add entries at the end.
 */

export type PersonaPresentation = "woman" | "man";

export interface Persona {
  /** Stable id stored on `agents.persona_key`. */
  key: string;
  /** The first name shown when anthropomorphic agents are on. */
  name: string;
  presentation: PersonaPresentation;
  /** Apparent age, for the portrait prompt. */
  age: string;
  /** Heritage, for the portrait prompt only (a diverse set of faces). */
  heritage: string;
}

const AGES = ["late 20s", "30s", "40s", "early 30s", "50s", "late 30s", "40s", "60s"] as const;

/** [heritage, women's names, men's names]: 15 + 15 per group, 240 in all. */
const GROUPS: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ["Black", ["Amara", "Imani", "Zuri", "Nia", "Kendra", "Tasha", "Ayana", "Adaeze", "Simone", "Keisha", "Monique", "Abena", "Folake", "Jasmine", "Dionne"], ["Malik", "Darnell", "Kofi", "Jamal", "Andre", "Tunde", "Marcus", "Kwame", "Isaiah", "Terrence", "Obi", "Desmond", "Cedric", "Femi", "Jerome"]],
  ["East Asian", ["Mei", "Yuki", "Kyoko", "Jia", "Aiko", "Haruka", "Xiu", "Eun", "Mirae", "Rin", "Yuna", "Jiwoo", "Yan", "Qing", "Sumi"], ["Kenji", "Wei", "Hiro", "Jun", "Minjun", "Takeshi", "Chen", "Daichi", "Haoran", "Sora", "Ren", "Kaito", "Jae", "Hyun", "Bo"]],
  ["South Asian", ["Priya", "Ananya", "Meera", "Kavya", "Nisha", "Riya", "Sana", "Divya", "Anjali", "Pooja", "Leela", "Asha", "Tara", "Isha", "Shreya"], ["Arjun", "Rohan", "Vikram", "Rahul", "Sanjay", "Aarav", "Dev", "Kabir", "Nikhil", "Imran", "Ravi", "Amit", "Karan", "Vivek", "Farhan"]],
  ["Hispanic", ["Sofia", "Lucia", "Camila", "Valeria", "Isabela", "Elena", "Gabriela", "Mariana", "Paola", "Carmen", "Ximena", "Daniela", "Rosa", "Ines", "Alma"], ["Mateo", "Diego", "Santiago", "Carlos", "Javier", "Luis", "Rafael", "Andres", "Emilio", "Pablo", "Joaquin", "Tomas", "Miguel", "Hector", "Ramon"]],
  ["Middle Eastern", ["Layla", "Yasmin", "Noor", "Amira", "Rana", "Dalia", "Salma", "Hiba", "Mariam", "Zeynep", "Farah", "Rania", "Lina", "Huda", "Nadia"], ["Omar", "Karim", "Tariq", "Yusuf", "Samir", "Hassan", "Rami", "Khalid", "Ziad", "Emre", "Nabil", "Faisal", "Adel", "Bilal", "Majid"]],
  ["white European", ["Emma", "Claire", "Hannah", "Grace", "Laura", "Katie", "Megan", "Anna", "Julia", "Ellen", "Molly", "Sarah", "Rachel", "Abby", "Holly"], ["Ben", "Tom", "Jack", "Sam", "Luke", "Will", "Owen", "Ryan", "Matt", "Nick", "Adam", "Henry", "Peter", "Alex", "Josh"]],
  ["Southeast Asian", ["Linh", "Thu", "Ploy", "Dewi", "Anh", "Siti", "Ratna", "Malee", "Ayu", "Putri", "Rina", "Trinh", "Lestari", "Mylene", "Ngoc"], ["Minh", "Tuan", "Bao", "Arif", "Budi", "Somchai", "Rizal", "Hung", "Duc", "Joko", "Nam", "Jomar", "Rico", "Anan", "Quang"]],
  ["mixed", ["Maya", "Willa", "Leilani", "Aria", "Talia", "Zara", "Kiana", "Mila", "Ivy", "Nina", "Jade", "Tessa", "Luna", "Eva", "Cora"], ["Kai", "Leo", "Noah", "Elijah", "Mason", "Theo", "Ezra", "Jasper", "Jonah", "Kenzo", "Luca", "Rowan", "Caleb", "Silas", "Felix"]],
];

const toKey = (name: string) => name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");

/** The catalog, interleaved so neighboring entries differ in heritage and presentation. */
export const PERSONAS: readonly Persona[] = (() => {
  const out: Persona[] = [];
  for (let i = 0; i < 15; i++) {
    GROUPS.forEach(([heritage, women, men], g) => {
      out.push({ key: toKey(women[i]!), name: women[i]!, presentation: "woman", age: AGES[(i + g) % AGES.length]!, heritage });
      out.push({ key: toKey(men[i]!), name: men[i]!, presentation: "man", age: AGES[(i + g + 3) % AGES.length]!, heritage });
    });
  }
  return out;
})();

const BY_KEY = new Map(PERSONAS.map((p) => [p.key, p] as const));

export function personaByKey(key: string | null | undefined): Persona | null {
  return key ? (BY_KEY.get(key) ?? null) : null;
}

/** The image prompt for one persona's portrait: a warm, smiling, photographic headshot on a plain background. */
export function personaPortraitPrompt(p: Persona): string {
  const heritage = p.heritage === "mixed" ? "mixed heritage" : `${p.heritage} heritage`;
  return [
    `A professional headshot photograph of a friendly ${p.presentation} in their ${p.age}, ${heritage}, smiling warmly at the camera.`,
    "Head and shoulders, natural soft daylight, plain light neutral background, smart casual clothing, approachable and confident.",
    "Photorealistic, sharp focus on the eyes, no text, no logos, no jewelry that dominates the frame, one person only.",
  ].join(" ");
}

/** FNV-1a, so the same seed always picks the same order without a crypto dependency. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The catalog in a stable order for `seed` (a business id): a seeded Fisher–Yates shuffle. */
export function personaOrder(seed: string): Persona[] {
  const order = [...PERSONAS];
  let state = hash32(seed) || 1;
  const next = () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/**
 * `count` persona keys for new agents of one business: never a key the business already uses (`taken`), and not one
 * the owner's other businesses use (`avoid`) while the catalog has others left. Past the catalog's size, keys repeat.
 */
export function pickPersonaKeys(count: number, opts: { seed: string; taken?: Iterable<string>; avoid?: Iterable<string> }): string[] {
  const taken = new Set(opts.taken ?? []);
  const avoid = new Set(opts.avoid ?? []);
  const order = personaOrder(opts.seed).map((p) => p.key);
  const picked: string[] = [];
  const take = (allow: (k: string) => boolean) => {
    for (const k of order) {
      if (picked.length >= count) return;
      if (!taken.has(k) && allow(k)) {
        picked.push(k);
        taken.add(k);
      }
    }
  };
  take((k) => !avoid.has(k));
  take(() => true);
  for (let i = 0; picked.length < count; i++) picked.push(order[i % order.length]!);
  return picked;
}

/** The fields of an agent the display rules read. `role` is the position; templates set it to the job title. */
export interface AgentIdentity {
  name: string;
  role?: string | null;
  personaKey?: string | null;
  /** The agent's layer, when the caller has it: a `utility` agent is a background helper and reads by its role name. */
  layer?: string | null;
  /** The template key, when the caller has it (the five utility templates are background helpers). */
  agentType?: string | null;
}

/** The agent's position, as shown beside a persona name: the role, else the agent's own (title) name. */
export function agentPosition(agent: AgentIdentity): string {
  return (agent.role ?? "").trim() || agent.name;
}

// ---------------------------------------------------------------------------------------------------------------
// Character styles: one key, four looks (lead decision, 2026-10-24)
// ---------------------------------------------------------------------------------------------------------------
//
// A style is a per-account preference (`account_preferences.agent_style`). The agent's `persona_key` never changes:
// each style has a catalog of exactly PERSONAS.length characters and the character of key `k` in style `s` is
// `STYLE_CATALOGS[s][indexOf(k)]`, so uniqueness per business carries over and names stay unique within a style.
// `humans` and `cartoon_3d` reuse the human persona; `cartoon_2d` alternates flat-drawn humans (even indexes) with 120
// animal characters (odd indexes); `fantasy` is 240 fantasy folk, half women and half men. Portraits are per
// (style, key) and drawn from `characterPortraitPrompt`.

export const AGENT_STYLES = ["humans", "cartoon_3d", "cartoon_2d", "fantasy"] as const;
export type AgentStyle = (typeof AGENT_STYLES)[number];
export const DEFAULT_AGENT_STYLE: AgentStyle = "humans";

export const AGENT_STYLE_META: Record<AgentStyle, { label: string; description: string }> = {
  humans: { label: "Humans", description: "Photographic faces with human first names." },
  cartoon_3d: { label: "3D cartoon humans", description: "Animated-film style people with human first names." },
  cartoon_2d: {
    label: "2D cartoon humans and animals",
    description: "Flat illustrated people and animal characters, each with a name that fits.",
  },
  fantasy: { label: "Fantasy", description: "Wizards, elves and other fantasy folk in 3D, with names to match." },
};

export function isAgentStyle(v: unknown): v is AgentStyle {
  return typeof v === "string" && (AGENT_STYLES as readonly string[]).includes(v);
}

export type CharacterKind = "human" | "animal" | "fantasy";

export interface Character {
  /** The persona key the character stands in for (the same key in every style). */
  key: string;
  style: AgentStyle;
  kind: CharacterKind;
  /** The first name shown when anthropomorphic agents are on, in this style. */
  name: string;
  presentation?: "woman" | "man" | null;
  /** Animals and fantasy folk: "red fox", "elf". Humans have none. */
  species?: string;
  /** One line the portrait prompt describes the character with. */
  look: string;
}

/** [name, species, look]: 120 friendly animal characters for the odd indexes of the 2D catalog. */
const ANIMALS: readonly (readonly [string, string, string])[] = [
  ["Bramble", "red fox", "a red fox with a bushy tail in a knitted sweater"],
  ["Pip", "river otter", "a sleek river otter with bright eyes and a striped scarf"],
  ["Juniper", "deer", "a gentle doe with soft brown fur and a daisy tucked behind one ear"],
  ["Clover", "rabbit", "a fluffy gray rabbit with long ears and a green bow tie"],
  ["Mango", "toucan", "a toucan with a big orange beak and a tiny vest"],
  ["Pepper", "raccoon", "a cheerful raccoon with a masked face and a denim jacket"],
  ["Hazel", "hedgehog", "a small hedgehog with soft quills and round glasses"],
  ["Tumble", "red panda", "a red panda with a ringed tail in a cozy cardigan"],
  ["Marlow", "sea turtle", "a sea turtle with a patterned shell and a slow, warm smile"],
  ["Fennel", "fennec fox", "a fennec fox with huge ears and a sunny yellow neckerchief"],
  ["Biscuit", "golden retriever", "a golden retriever with floppy ears and a collared shirt"],
  ["Saffron", "tiger", "a friendly tiger with bold stripes and a smart blazer"],
  ["Maple", "squirrel", "a chestnut squirrel holding an acorn, in a tiny apron"],
  ["Twig", "wren", "a tiny brown wren with a perky tail and a knitted hat"],
  ["Cobalt", "blue whale", "a blue whale calf with a big gentle grin"],
  ["Nutmeg", "chipmunk", "a chipmunk with striped cheeks and a polka-dot bow"],
  ["Ember", "salamander", "an orange salamander with a friendly grin and a tiny backpack"],
  ["Thistle", "highland cow", "a shaggy highland cow with a fringe over its eyes and a plaid scarf"],
  ["Pebble", "penguin", "a little penguin with a white belly and a red bow tie"],
  ["Moss", "tortoise", "a wise tortoise with a mossy green shell and reading glasses"],
  ["Dash", "cheetah", "a cheetah with spotted fur and a zip-up track jacket"],
  ["Pickle", "tree frog", "a bright green tree frog with big eyes and a tiny bowler hat"],
  ["Sorrel", "horse", "a chestnut horse with a flowing mane and a bandana"],
  ["Coral", "clownfish", "an orange-and-white clownfish with a bubbly smile"],
  ["Peanut", "elephant", "a kind elephant with big flapping ears and a flower crown"],
  ["Stretch", "giraffe", "a tall giraffe with a patchwork coat and a long knitted scarf"],
  ["Snooze", "koala", "a sleepy koala with fluffy ears hugging a eucalyptus sprig"],
  ["Hopper", "kangaroo", "a kangaroo with a pouch and a wide-brimmed hat"],
  ["Bamboo", "giant panda", "a giant panda with black-and-white fur munching a bamboo shoot"],
  ["Frost", "polar bear", "a polar bear with thick white fur and a blue knitted scarf"],
  ["Honey", "brown bear", "a round brown bear with a honey-colored muzzle and a flannel shirt"],
  ["Timber", "wolf", "a gray wolf with a thick ruff and a warm, friendly smile"],
  ["Tuft", "lynx", "a lynx with tufted ears and a soft wool vest"],
  ["Glacier", "snow leopard", "a snow leopard with a long spotted tail and a parka"],
  ["Sunny", "lion", "a lion with a golden mane and a linen shirt"],
  ["Stripe", "zebra", "a zebra with bold stripes and round sunglasses pushed up on its head"],
  ["Puddle", "hippo", "a chubby hippo with a wide smile and a sailor collar"],
  ["Rumble", "rhino", "a gentle rhino with a small horn and a corduroy jacket"],
  ["Cappy", "capybara", "a laid-back capybara with a tangerine balanced on its head"],
  ["Chip", "beaver", "a beaver with big front teeth and a tool belt"],
  ["Burrow", "badger", "a badger with a white-striped face and a tweed waistcoat"],
  ["Alder", "moose", "a tall moose with broad antlers and a red checked shirt"],
  ["Tinsel", "reindeer", "a reindeer with velvet antlers and a ribbon collar"],
  ["Fluff", "alpaca", "a cream alpaca with a fluffy topknot and a rainbow poncho"],
  ["Pampas", "llama", "a tan llama with a patterned blanket and a cheeky smile"],
  ["Woolly", "sheep", "a round white sheep with curly wool and a little bell"],
  ["Scramble", "mountain goat", "a mountain goat with small horns and a climbing harness"],
  ["Truffle", "pig", "a pink pig with a curly tail and a chef's neckerchief"],
  ["Marmalade", "tabby cat", "an orange tabby cat with green eyes and a bow collar"],
  ["Sesame", "siamese cat", "a cream siamese cat with blue eyes and a silk scarf"],
  ["Fetch", "border collie", "a black-and-white border collie with alert ears and a whistle on a cord"],
  ["Waffle", "corgi", "a corgi with a fluffy rump and a tiny rain jacket"],
  ["Noodle", "dachshund", "a long dachshund in a striped sweater"],
  ["Blizzard", "husky", "a husky with blue eyes and a snowflake-patterned scarf"],
  ["Dawdle", "sloth", "a smiling sloth hanging from a branch with a mug of cocoa"],
  ["Zest", "lemur", "a ring-tailed lemur with a striped tail and a bright bandana"],
  ["Lookout", "meerkat", "a meerkat standing tall with binoculars around its neck"],
  ["Velvet", "chinchilla", "a silver-gray chinchilla with soft fur and a tiny beret"],
  ["Crumb", "hamster", "a plump hamster with full cheeks and a knitted vest"],
  ["Pudding", "guinea pig", "a tricolor guinea pig with tufty hair and a bow"],
  ["Thimble", "mouse", "a tiny gray mouse with round ears and a thimble for a hat"],
  ["Dusk", "fruit bat", "a fruit bat with folded wings and big friendly eyes"],
  ["Digger", "wombat", "a stout wombat with a broad nose and a gardening hat"],
  ["Paddle", "platypus", "a platypus with a duck bill and a swim cap"],
  ["Dot", "ladybug", "a red ladybug with black spots and a tiny parasol"],
  ["Slurp", "anteater", "a giant anteater with a long snout and a striped sweater"],
  ["Dapple", "okapi", "an okapi with striped legs and a velvet coat"],
  ["Ginger", "orangutan", "a shaggy orange orangutan with a gentle face and a sun hat"],
  ["Boulder", "gorilla", "a gentle gorilla with a silver back and a cardigan"],
  ["Nectar", "honeybee", "a round honeybee with striped fur and tiny goggles"],
  ["Prairie", "bison", "a woolly bison with a broad head and a bandana"],
  ["Dune", "camel", "a camel with a fuzzy hump and a woven saddle blanket"],
  ["Humble", "donkey", "a gray donkey with long ears and a straw hat"],
  ["Kelp", "sea otter", "a sea otter floating on its back with a shell in its paws"],
  ["Splash", "harbor seal", "a harbor seal with long whiskers and a shiny coat"],
  ["Whiskers", "walrus", "a walrus with a bushy mustache and a knitted beanie"],
  ["Twist", "narwhal", "a narwhal with a spiral tusk and a cozy scarf"],
  ["Lagoon", "manatee", "a round manatee with a whiskery snout and a kind smile"],
  ["Echo", "dolphin", "a dolphin with a sleek gray body and a playful grin"],
  ["Tide", "orca", "a friendly orca with white patches and a bright smile"],
  ["Hoot", "barn owl", "a barn owl with a heart-shaped face and a tweed scarf"],
  ["Snowdrop", "snowy owl", "a snowy owl with speckled white feathers and a woolen muffler"],
  ["Clipper", "puffin", "a puffin with a striped orange beak and a sailor's cap"],
  ["Blush", "flamingo", "a pink flamingo standing on one leg with a pearl necklace"],
  ["Scarlet", "macaw", "a scarlet macaw with rainbow wing feathers and a flight scarf"],
  ["Lemon", "cockatoo", "a white cockatoo with a sunny yellow plume and a bow tie"],
  ["Plume", "peacock", "a peacock with a fan of iridescent feathers and a velvet bow tie"],
  ["Serene", "swan", "a white swan with a graceful neck and a ribbon"],
  ["Dabble", "mallard duck", "a mallard duck with a green head and a yellow raincoat"],
  ["Gander", "goose", "a white goose with orange feet and a knitted scarf"],
  ["Berry", "robin", "a robin with a red breast and a tiny wool coat"],
  ["Indigo", "blue jay", "a blue jay with bright blue feathers and a bow tie"],
  ["Crimson", "cardinal", "a red cardinal with a pointed plume and a tiny scarf"],
  ["Halcyon", "kingfisher", "a kingfisher with a teal back and an orange chest, perched on a reed"],
  ["Scoop", "pelican", "a pelican with a big pouch beak and a sailor hat"],
  ["Stilt", "heron", "a tall gray heron with long legs and a monocle"],
  ["Flit", "hummingbird", "a tiny hummingbird with shimmering green feathers and a flower"],
  ["Fern", "kiwi", "a fuzzy brown kiwi bird with a long beak and a hiking vest"],
  ["Casque", "hornbill", "a hornbill with a big curved yellow beak and a bow tie"],
  ["Cobble", "pigeon", "a city pigeon with iridescent neck feathers and a flat cap"],
  ["Covey", "quail", "a plump quail with a bobbing head plume and a tiny apron"],
  ["Origami", "crane", "a red-crowned crane with a long neck and a silk sash"],
  ["Swift", "falcon", "a peregrine falcon with sharp eyes and a leather glove"],
  ["Soar", "eagle", "a bald eagle with a white head and a flight jacket"],
  ["Trinket", "magpie", "a magpie with glossy black-and-white feathers and a shiny button"],
  ["Cuddle", "lovebird", "a peach-faced lovebird with green feathers and a heart-shaped locket"],
  ["Mosaic", "chameleon", "a chameleon with shifting rainbow scales and a curled tail"],
  ["Sticky", "gecko", "a spotted gecko with big round eyes and a tiny sun visor"],
  ["Tango", "iguana", "a green iguana with a spiky back and a tropical shirt"],
  ["Puff", "bearded dragon", "a bearded dragon with a scaly beard and a cowboy hat"],
  ["Lotus", "axolotl", "a pink axolotl with frilly gills and a permanent smile"],
  ["Dapper", "crocodile", "a smiling crocodile in a bow tie and vest"],
  ["Hatch", "box turtle", "a box turtle with a domed shell and a pair of goggles"],
  ["Squiggle", "octopus", "a purple octopus with eight curling arms and a tiny top hat"],
  ["Ripple", "seahorse", "a yellow seahorse with a curled tail and a pearl earring"],
  ["Shimmer", "jellyfish", "a glowing jellyfish with flowing tentacles and a sweet smile"],
  ["Bubbles", "pufferfish", "a round pufferfish with soft spikes and wide eyes"],
  ["Glide", "manta ray", "a manta ray with wide wings and a calm smile"],
  ["Nook", "hermit crab", "a hermit crab peeking out of a spiral shell with a tiny hat"],
  ["Buttons", "lobster", "a red lobster with big claws and a chef's hat"],
];

/**
 * Fantasy folk: [species, women as [name, look], men as [name, look]], 6 + 6 per group, 20 groups, 240 in all.
 * Interleaved like the human catalog so neighboring entries differ in species and presentation.
 */
const FANTASY_GROUPS: readonly (readonly [
  string,
  readonly (readonly [string, string])[],
  readonly (readonly [string, string])[],
])[] = [
  [
    "elf",
    [
      ["Elowen", "a silver-haired elf woman with pointed ears and a leaf-green cloak"],
      ["Caelith", "an elf woman with dark braids, pointed ears and a circlet of silver vines"],
      ["Thalindra", "an elf woman with copper hair, pointed ears and a moss-colored tunic"],
      ["Vaeloria", "an elf woman with pale gold hair, pointed ears and a star-blue mantle"],
      ["Sylvanna", "an elf woman with chestnut curls, pointed ears and a bow slung over one shoulder"],
      ["Aerindel", "an elf woman with white hair, pointed ears and a cloak clasped with an oak leaf"],
    ],
    [
      ["Thandor", "an elf man with long black hair, pointed ears and a forest-green cloak"],
      ["Faelar", "an elf man with ash-blond hair, pointed ears and a quiver at his back"],
      ["Erevan", "an elf man with auburn hair, pointed ears and a jerkin embroidered with leaves"],
      ["Lorithas", "an elf man with silver hair, pointed ears and a deep-blue traveling cloak"],
      ["Caladrin", "an elf man with dark skin, pointed ears and a mantle of woven birch bark"],
      ["Vaelen", "an elf man with braided brown hair, pointed ears and a moonstone pendant"],
    ],
  ],
  [
    "wizard",
    [
      ["Morwenna", "a wizard woman in a midnight-blue robe with silver stars and a tall pointed hat"],
      ["Isolde", "a wizard woman with gray-streaked hair, a violet robe and a staff topped with a crystal"],
      ["Seraphine", "a wizard woman with a crimson robe, half-moon spectacles and a book under one arm"],
      ["Thessaly", "a wizard woman with dark curls, an emerald robe and a glowing wand"],
      ["Vesper", "a wizard woman with a deep-purple hooded robe and a floating lantern beside her"],
      ["Ondine", "a wizard woman with sea-blue robes and a staff carved like a wave"],
    ],
    [
      ["Aldric", "a wizard man with a long white beard, a starry blue robe and a pointed hat"],
      ["Orrin", "a wizard man with a short gray beard, a brown robe and a staff of twisted oak"],
      ["Thaddeus", "a wizard man with round spectacles, a plum robe and a satchel of scrolls"],
      ["Balthazar", "a wizard man with a dark beard, a gold-trimmed black robe and a glowing orb"],
      ["Cassius", "a wizard man with a trimmed red beard, a green robe and a crystal-tipped staff"],
      ["Evander", "a wizard man with silver hair, a midnight robe and runes glowing on his sleeves"],
    ],
  ],
  [
    "sorcerer",
    [
      ["Nimue", "a sorceress with flowing dark hair, a shimmering teal gown and mist curling from her hands"],
      ["Lysandra", "a sorceress with white-blond hair, a violet gown and sparks of light at her fingertips"],
      ["Zephyrine", "a sorceress with windswept silver hair and a gown that ripples like the sky"],
      ["Isadora", "a sorceress with red hair, a gold-embroidered gown and a small flame cupped in her palm"],
      ["Melisande", "a sorceress with dark braids, an amber gown and a staff topped with a rose crystal"],
      ["Amaranth", "a sorceress with deep-purple robes, a jeweled collar and glowing magenta eyes"],
    ],
    [
      ["Corvin", "a sorcerer man with raven-black hair, a dark cloak and violet light in his hands"],
      ["Magnus", "a sorcerer man with a gray beard, a crimson mantle and a staff crowned with a flame"],
      ["Draven", "a sorcerer man with a sharp jaw, a storm-gray cloak and lightning crackling at his fingertips"],
      ["Alaric", "a sorcerer man with golden hair, a white robe and a halo of floating runes"],
      ["Oswin", "a sorcerer man with warm brown skin, a sapphire robe and a glowing blue orb"],
      ["Lucian", "a sorcerer man with silver-white hair, a black-and-gold robe and starlight in his palm"],
    ],
  ],
  [
    "dwarf",
    [
      ["Brunhild", "a dwarf woman with braided red hair, a leather apron and a smith's hammer"],
      ["Hilda", "a dwarf woman with blond braids, a fur-lined vest and a stout warhammer"],
      ["Gerda", "a dwarf woman with dark hair in a bun, a studded leather coat and a gem-set belt"],
      ["Thora", "a dwarf woman with copper braids, a chainmail shirt and a round shield"],
      ["Signy", "a dwarf woman with silver hair, an engraved breastplate and a carved pipe"],
      ["Dagny", "a dwarf woman with black braids, a green tunic and a pickaxe over one shoulder"],
    ],
    [
      ["Brann", "a dwarf man with a braided red beard, a horned helm and a heavy axe"],
      ["Dunmore", "a dwarf man with a long gray beard, a leather apron and a smith's hammer"],
      ["Grimbold", "a dwarf man with a black beard in rings, a fur cloak and a round shield"],
      ["Thorvald", "a dwarf man with a blond beard, a chainmail coat and a hammer at his belt"],
      ["Haldor", "a dwarf man with a white beard, a gem-crusted belt and a wooden tankard"],
      ["Kelgar", "a dwarf man with a brown beard, an engraved breastplate and a miner's lantern"],
    ],
  ],
  [
    "fairy",
    [
      ["Fayelle", "a fairy woman with translucent wings, a petal dress and a trail of golden sparkles"],
      ["Liriope", "a fairy woman with dragonfly wings, a blue-flower gown and a tiny wand"],
      ["Twyla", "a fairy woman with moth wings, a dusky purple dress and a crown of twilight blossoms"],
      ["Oriel", "a fairy woman with butterfly wings, a sunflower-yellow dress and a dandelion wand"],
      ["Celandine", "a fairy woman with leaf-green wings, a buttercup dress and a moss cap"],
      ["Marigold", "a fairy woman with orange-tipped wings, a marigold dress and freckles"],
    ],
    [
      ["Quillon", "a fairy man with beetle-shell wings, an acorn cap and a tiny sword"],
      ["Fennimore", "a fairy man with dragonfly wings, a leaf tunic and a cheeky grin"],
      ["Wendel", "a fairy man with moth wings, a bark-brown vest and a glowing firefly lantern"],
      ["Larkin", "a fairy man with blue butterfly wings, a bluebell hat and a reed flute"],
      ["Pim", "a fairy man with tiny gossamer wings, a mushroom cap and a thimble of dew"],
      ["Tobin", "a fairy man with amber wings, a maple-leaf cloak and a seed-pod satchel"],
    ],
  ],
  [
    "gnome",
    [
      ["Tilda", "a gnome woman with a red pointed hat, round cheeks and a toolbelt of tiny gears"],
      ["Wimble", "a gnome woman with gray braids, brass goggles and a patched leather apron"],
      ["Posy", "a gnome woman with a flower-print hat, rosy cheeks and a watering can"],
      ["Nimbly", "a gnome woman with a green hat, ink-stained fingers and a stack of blueprints"],
      ["Greta", "a gnome woman with white hair in a bun, a knitted shawl and a steaming teapot"],
      ["Ottilie", "a gnome woman with a striped hat, spectacles and a wind-up bird on her shoulder"],
    ],
    [
      ["Fenwick", "a gnome man with a white beard, a red pointed hat and a wooden toolbox"],
      ["Bodkin", "a gnome man with a brown beard, brass goggles and a wrench"],
      ["Rumbold", "a gnome man with a round belly, a blue pointed hat and a lantern"],
      ["Wizzle", "a gnome man with wild gray hair, a tinkerer's apron and a clockwork mouse"],
      ["Gimbal", "a gnome man with a ginger beard, a leather cap and a spyglass"],
      ["Nubbin", "a gnome man with a short beard, a green hat and a basket of mushrooms"],
    ],
  ],
  [
    "druid",
    [
      ["Brielle", "a druid woman with ivy woven through her hair and a cloak of green leaves"],
      ["Fiadh", "a druid woman with wild red hair, antler circlet and a staff sprouting new leaves"],
      ["Niamh", "a druid woman with dark braids, a feathered cloak and a small owl on her shoulder"],
      ["Ceridwen", "a druid woman with silver hair, a robe of woven moss and a bowl of glowing herbs"],
      ["Yarrow", "a druid woman with freckles, a deerskin cloak and a sprig of yarrow in her hair"],
      ["Linnea", "a druid woman with flowers in her hair, a bark-brown robe and a fawn at her side"],
    ],
    [
      ["Caddoc", "a druid man with a leafy beard, an oak staff and a cloak of green"],
      ["Bryn", "a druid man with a short brown beard, antler circlet and a wolf pelt cloak"],
      ["Tiernan", "a druid man with long gray hair, a robe of woven moss and a hawk on his arm"],
      ["Ardal", "a druid man with dark skin, a feathered cloak and a staff crowned with mistletoe"],
      ["Fionn", "a druid man with fair hair, a deerskin cloak and a fox curled at his feet"],
      ["Oswald", "a druid man with a white beard full of acorns and a cloak of autumn leaves"],
    ],
  ],
  [
    "knight",
    [
      ["Adalind", "a knight woman in polished silver plate with a blue tabard and a sword at her hip"],
      ["Rosalind", "a knight woman in steel armor with a rose-red surcoat and a plumed helm under her arm"],
      ["Isabeau", "a knight woman with cropped dark hair, gilded armor and a lion-painted shield"],
      ["Gwendolyn", "a knight woman with a long braid, white-and-gold armor and a lance"],
      ["Alienor", "a knight woman in green-enameled plate with a hawk emblem on her shield"],
      ["Matilde", "a knight woman in weathered armor with a sunburst tabard and a kind smile"],
    ],
    [
      ["Roderick", "a knight man in gleaming plate armor with a blue cloak and a longsword"],
      ["Percival", "a knight man with a neat beard, silver armor and a white-and-red shield"],
      ["Gareth", "a knight man with dark skin, golden armor and a stag emblem on his breastplate"],
      ["Leofric", "a knight man with a scarred cheek, steel plate and a green cloak"],
      ["Aldous", "a knight man with gray hair, engraved armor and a ceremonial sword"],
      ["Benedek", "a knight man with a warm grin, bronze-trimmed plate and a plumed helm"],
    ],
  ],
  [
    "ranger",
    [
      ["Kestrel", "a ranger woman with a hooded green cloak, a longbow and a kestrel on her glove"],
      ["Tamsin", "a ranger woman with a braid over one shoulder, leather armor and twin knives"],
      ["Sable", "a ranger woman with dark hair, a black cloak and a wolf at her side"],
      ["Ashlyn", "a ranger woman with ash-blond hair, a quiver of arrows and a mossy cloak"],
      ["Rhoswen", "a ranger woman with freckles, a fur-trimmed hood and a hunting horn"],
      ["Elspeth", "a ranger woman with red hair, a leather jerkin and a map case at her belt"],
    ],
    [
      ["Fletcher", "a ranger man with a stubbled chin, a green hood and a longbow"],
      ["Garrick", "a ranger man with a dark beard, a wolf-pelt cloak and a hunting knife"],
      ["Thorne", "a ranger man with a scar over one eye, leather armor and a hawk on his arm"],
      ["Ewan", "a ranger man with ginger hair, a mossy cloak and a quiver of arrows"],
      ["Lorcan", "a ranger man with dark skin, a brown hood and a staff wrapped in vines"],
      ["Ansel", "a ranger man with a weathered face, a fur-trimmed hood and a hound at his feet"],
    ],
  ],
  [
    "bard",
    [
      ["Lirienne", "a bard woman with a lute, a feathered cap and a velvet doublet"],
      ["Calliope", "a bard woman with dark curls, a flute and a cloak of patchwork colors"],
      ["Seren", "a bard woman with a harp, silver hair and a star-embroidered gown"],
      ["Viviane", "a bard woman with a fiddle, a wide-brimmed hat and a crimson scarf"],
      ["Odalys", "a bard woman with a drum at her hip, bright beads in her braids and a wide smile"],
      ["Ninette", "a bard woman with a mandolin, a green beret and a traveling cloak"],
    ],
    [
      ["Taliesin", "a bard man with a harp, long hair and a cloak of midnight blue"],
      ["Finnegan", "a bard man with a red beard, a fiddle and a feathered cap"],
      ["Lucan", "a bard man with a lute, a velvet doublet and a roguish grin"],
      ["Rafferty", "a bard man with a tin whistle, a patched coat and a satchel of songs"],
      ["Evrard", "a bard man with dark skin, a drum and a cloak of saffron and gold"],
      ["Ambrose", "a bard man with silver hair, a mandolin and a scarf of many colors"],
    ],
  ],
  [
    "merfolk",
    [
      ["Marisela", "a mermaid with a shimmering teal tail, sea-green hair and a crown of shells"],
      ["Nerissa", "a mermaid with a violet tail, dark hair strung with pearls and a conch horn"],
      ["Coralie", "a mermaid with a coral-pink tail, red hair and a necklace of sea glass"],
      ["Thalassa", "a mermaid with a deep-blue tail, silver hair and a trident of coral"],
      ["Oceane", "a mermaid with a gold-and-green tail, dark skin and a sash of kelp"],
      ["Maren", "a mermaid with a sunset-orange tail, braided hair and a starfish hairpin"],
    ],
    [
      ["Nereus", "a merman with a sea-green tail, a white beard and a coral trident"],
      ["Delmar", "a merman with a navy tail, dark hair and a necklace of shark teeth"],
      ["Finnian", "a merman with a silver tail, ginger hair and a conch shell horn"],
      ["Morvan", "a merman with a storm-gray tail, kelp-wrapped arms and a kind grin"],
      ["Tarquin", "a merman with a gold tail, dark skin and a crown of blue coral"],
      ["Zale", "a merman with a turquoise tail, short hair and a spear of polished shell"],
    ],
  ],
  [
    "centaur",
    [
      ["Xanthe", "a centaur woman with a palomino body, golden hair and a bow across her back"],
      ["Hesper", "a centaur woman with a dark bay body, braided hair and a quiver of arrows"],
      ["Ione", "a centaur woman with a dappled gray body and a wreath of olive leaves"],
      ["Callista", "a centaur woman with a chestnut body, a laurel crown and a scroll in hand"],
      ["Phaedra", "a centaur woman with a black body, silver jewelry and a long spear"],
      ["Eulalie", "a centaur woman with a white body, flowers in her hair and a woven sash"],
    ],
    [
      ["Orestes", "a centaur man with a chestnut body, a dark beard and a longbow"],
      ["Lysander", "a centaur man with a gray body, a laurel crown and a scholar's satchel"],
      ["Theron", "a centaur man with a black body, braided hair and a bronze spear"],
      ["Nikandros", "a centaur man with a palomino body, a short beard and a hunting horn"],
      ["Alcaeus", "a centaur man with a dappled body, a lyre and a wreath of ivy"],
      ["Demetrios", "a centaur man with a bay body, a sunburst medallion and a wide grin"],
    ],
  ],
  [
    "dryad",
    [
      ["Daphne", "a dryad with bark-textured skin, laurel leaves for hair and blossoms on her shoulders"],
      ["Willowmere", "a dryad with long willow-leaf hair, pale green skin and a trailing vine shawl"],
      ["Aspen", "a dryad with silver-bark skin, golden autumn leaves for hair and bright eyes"],
      ["Linden", "a dryad with heart-shaped leaves in her hair and honey-colored bark skin"],
      ["Laurelai", "a dryad with glossy dark leaves for hair, moss-green skin and a crown of berries"],
      ["Sorcha", "a dryad with rowan-red leaves for hair and a mantle of lichen"],
    ],
    [
      ["Silvanus", "a faun man with curling horns, a leafy beard and a reed pipe"],
      ["Ferris", "a faun man with small horns, a tweed vest and a satchel of apples"],
      ["Hollis", "a faun man with goat legs, a holly wreath and a cheerful grin"],
      ["Bramwell", "a faun man with dark curls, short horns and a cloak of bramble leaves"],
      ["Thackery", "a faun man with gray fur, spectacles and a book of poems"],
      ["Quince", "a faun man with golden horns, a fruit-laden basket and a wide smile"],
    ],
  ],
  [
    "halfling",
    [
      ["Poppy", "a halfling woman with curly brown hair, a floral apron and a basket of bread"],
      ["Peony", "a halfling woman with red curls, a green waistcoat and a pie in her hands"],
      ["Rosamund", "a halfling woman with a braid, a patched traveling cloak and a walking stick"],
      ["Clementine", "a halfling woman with freckles, a yellow dress and a jar of marmalade"],
      ["Tansy", "a halfling woman with dark curls, a gardening hat and a trowel"],
      ["Mabel", "a halfling woman with gray curls, a knitted shawl and a teacup"],
    ],
    [
      ["Barnaby", "a halfling man with curly hair, a waistcoat with brass buttons and a pipe"],
      ["Dilly", "a halfling man with a round face, suspenders and a basket of mushrooms"],
      ["Humphrey", "a halfling man with a bushy mustache, a tweed jacket and a pocket watch"],
      ["Wilmot", "a halfling man with sandy curls, a leather vest and a fishing rod"],
      ["Alfie", "a halfling man with a cheeky grin, a red scarf and a slingshot"],
      ["Tobias", "a halfling man with gray curls, a green cloak and a walking stick"],
    ],
  ],
  [
    "dragon-kin",
    [
      ["Ignatia", "a dragon-kin woman with crimson scales, small curved horns and golden eyes"],
      ["Pyrrha", "a dragon-kin woman with copper scales, a frill of fins and a flame-orange cloak"],
      ["Vermithra", "a dragon-kin woman with emerald scales, swept-back horns and a leather tunic"],
      ["Scaelith", "a dragon-kin woman with sapphire scales, pearl horns and a silver circlet"],
      ["Embera", "a dragon-kin woman with ash-gray scales, amber eyes and a scarf of red silk"],
      ["Drakaina", "a dragon-kin woman with violet scales, ridged brows and a gilded breastplate"],
    ],
    [
      ["Vorath", "a dragon-kin man with bronze scales, curved horns and a fur-trimmed cloak"],
      ["Kazreth", "a dragon-kin man with obsidian scales, red eyes and a warm, toothy grin"],
      ["Emberon", "a dragon-kin man with crimson scales, a frill of fins and a smith's apron"],
      ["Tharkos", "a dragon-kin man with jade scales, swept-back horns and a traveler's pack"],
      ["Scalder", "a dragon-kin man with gold scales, small horns and a scholar's robe"],
      ["Ryvan", "a dragon-kin man with silver-blue scales, ridged brows and a sapphire pendant"],
    ],
  ],
  [
    "alchemist",
    [
      ["Wilhelmina", "an alchemist woman with brass goggles, a leather apron and a bubbling green flask"],
      ["Octavia", "an alchemist woman with ink-black hair in a bun, round spectacles and a tray of vials"],
      ["Philippa", "an alchemist woman with a singed apron, wild curls and a glowing blue potion"],
      ["Cordelia", "an alchemist woman with gray braids, a velvet coat and a mortar and pestle"],
      ["Beatrix", "an alchemist woman with a monocle, a pinned-up braid and a flask of golden liquid"],
      ["Henrietta", "an alchemist woman with a stained smock, freckles and a rack of colorful test tubes"],
    ],
    [
      ["Ignatius", "an alchemist man with a singed white beard, goggles and a smoking flask"],
      ["Bartholomew", "an alchemist man with a dark beard, a leather apron and a glowing violet vial"],
      ["Phineas", "an alchemist man with wild gray hair, spectacles and a book of formulas"],
      ["Leopold", "an alchemist man with a waxed mustache, a velvet coat and a brass scale"],
      ["Erasmus", "an alchemist man with a bald head, a long robe and a bubbling cauldron"],
      ["Mortimer", "an alchemist man with a gray goatee, a stained smock and a crystal in tongs"],
    ],
  ],
  [
    "paladin",
    [
      ["Oriana", "a paladin woman in white-and-gold armor with a sunburst shield"],
      ["Serenna", "a paladin woman with a dark braid, silver armor and a glowing warhammer"],
      ["Justina", "a paladin woman with cropped hair, blue-enameled plate and a holy symbol on her tabard"],
      ["Honora", "a paladin woman with dark skin, gilded armor and a radiant longsword"],
      ["Celestine", "a paladin woman with pale hair, a white cloak and a shield marked with a star"],
      ["Brigid", "a paladin woman with red hair, bronze armor and a flame-shaped pendant"],
    ],
    [
      ["Galahad", "a paladin man in white plate armor with a gold-trimmed cloak and a shining sword"],
      ["Aurelian", "a paladin man with dark skin, golden armor and a sunburst shield"],
      ["Benedict", "a paladin man with a gray beard, silver plate and a glowing mace"],
      ["Constantin", "a paladin man with a square jaw, blue-and-white tabard and a tower shield"],
      ["Theodric", "a paladin man with a short blond beard, bronze armor and a radiant hammer"],
      ["Lionel", "a paladin man with a warm smile, white armor and a star-marked shield"],
    ],
  ],
  [
    "seer",
    [
      ["Sibylla", "a seer woman with a veil of stars, a crystal ball and silver-ringed fingers"],
      ["Delphina", "a seer woman with dark hair, a shawl of deep indigo and glowing pale eyes"],
      ["Morgause", "a seer woman with raven hair, a crescent-moon circlet and a deck of cards"],
      ["Isaura", "a seer woman with gold-painted eyelids, a saffron shawl and a bowl of still water"],
      ["Ophira", "a seer woman with white hair, a cloak of midnight blue and a floating crystal"],
      ["Zenobia", "a seer woman with dark skin, a jeweled headdress and a mirror of polished bronze"],
    ],
    [
      ["Osric", "a seer man with a long white beard, a star-covered cloak and a crystal orb"],
      ["Mordecai", "a seer man with a hooded robe, a gray beard and glowing pale eyes"],
      ["Severin", "a seer man with dark hair, a cloak of indigo and a deck of painted cards"],
      ["Anselm", "a seer man with a bald head, a saffron robe and a bowl of still water"],
      ["Caspar", "a seer man with a short gray beard, a crescent-moon pendant and a brass astrolabe"],
      ["Gideon", "a seer man with dark skin, a midnight cloak and a floating crystal beside him"],
    ],
  ],
  [
    "healer",
    [
      ["Anwen", "a healer woman in a white linen robe with a satchel of herbs and a gentle smile"],
      ["Mireille", "a healer woman with gray hair, a blue apron and a bowl of glowing salve"],
      ["Solenne", "a healer woman with dark skin, a saffron robe and hands wreathed in soft light"],
      ["Elara", "a healer woman with a braid, a green cloak and a staff wound with healing vines"],
      ["Ysabel", "a healer woman with red hair, a white veil and a jar of honey-colored balm"],
      ["Verity", "a healer woman with spectacles, a cream robe and a book of remedies"],
    ],
    [
      ["Caius", "a healer man in a white robe with a satchel of herbs and a calm smile"],
      ["Edric", "a healer man with a brown beard, a green cloak and hands wreathed in soft light"],
      ["Hadrian", "a healer man with gray hair, a blue apron and a mortar of crushed leaves"],
      ["Elian", "a healer man with dark skin, a cream robe and a staff wound with healing vines"],
      ["Rafe", "a healer man with a kind face, a linen tunic and a bandage roll in hand"],
      ["Wystan", "a healer man with a white beard, a saffron robe and a jar of glowing balm"],
    ],
  ],
  [
    "giant",
    [
      ["Berta", "a gentle giant woman with braided brown hair, a wool dress and a basket of apples"],
      ["Hulda", "a gentle giant woman with gray hair, a fur cloak and a wooden walking staff"],
      ["Magda", "a gentle giant woman with freckles, a patched tunic and a bird perched on her finger"],
      ["Ingrun", "a gentle giant woman with blond braids, a leather vest and a pine sapling in hand"],
      ["Oddny", "a gentle giant woman with dark hair, a knitted shawl and a lantern"],
      ["Thyra", "a gentle giant woman with red hair, a hide cloak and a broad warm smile"],
    ],
    [
      ["Bjorn", "a gentle giant man with a brown beard, a fur cloak and a tree-trunk staff"],
      ["Hagen", "a gentle giant man with a gray beard, a wool tunic and a sheep under one arm"],
      ["Ragnvald", "a gentle giant man with braided blond hair, a leather vest and a huge mug"],
      ["Torsten", "a gentle giant man with dark hair, a patched coat and a bird on his shoulder"],
      ["Gunnar", "a gentle giant man with a red beard, a hide cloak and a boulder-sized smile"],
      ["Sigurd", "a gentle giant man with a white beard, a knitted scarf and a lantern"],
    ],
  ],
];

/** The human persona as a style character; `look` describes the person for the stylized prompts. */
function humanCharacter(p: Persona, style: AgentStyle): Character {
  const heritage = p.heritage === "mixed" ? "mixed heritage" : `${p.heritage} heritage`;
  const pronoun = p.presentation === "woman" ? "her" : "his";
  return {
    key: p.key,
    style,
    kind: "human",
    name: p.name,
    presentation: p.presentation,
    look: `a friendly ${p.presentation} in ${pronoun} ${p.age}, ${heritage}, in smart casual clothing`,
  };
}

if (ANIMALS.length * 2 !== PERSONAS.length) throw new Error(`animal catalog has ${ANIMALS.length} characters, expected ${PERSONAS.length / 2}`);
const CARTOON_2D: readonly Character[] = PERSONAS.map((p, i) => {
  if (i % 2 === 0) return humanCharacter(p, "cartoon_2d");
  const [name, species, look] = ANIMALS[(i - 1) / 2]!;
  return { key: p.key, style: "cartoon_2d", kind: "animal", name, presentation: null, species, look };
});

const FANTASY: readonly Character[] = (() => {
  const out: Character[] = [];
  for (let i = 0; i < 6; i++) {
    for (const [species, women, men] of FANTASY_GROUPS) {
      const [wName, wLook] = women[i]!;
      const [mName, mLook] = men[i]!;
      out.push({ key: "", style: "fantasy", kind: "fantasy", name: wName, presentation: "woman", species, look: wLook });
      out.push({ key: "", style: "fantasy", kind: "fantasy", name: mName, presentation: "man", species, look: mLook });
    }
  }
  if (out.length !== PERSONAS.length) throw new Error(`fantasy catalog has ${out.length} characters, expected ${PERSONAS.length}`);
  return out.map((c, i) => ({ ...c, key: PERSONAS[i]!.key }));
})();

/** One catalog per style, each exactly PERSONAS.length long and index-aligned with PERSONAS. */
export const STYLE_CATALOGS: Record<AgentStyle, readonly Character[]> = {
  humans: PERSONAS.map((p) => humanCharacter(p, "humans")),
  cartoon_3d: PERSONAS.map((p) => humanCharacter(p, "cartoon_3d")),
  cartoon_2d: CARTOON_2D,
  fantasy: FANTASY,
};

const INDEX_BY_KEY = new Map(PERSONAS.map((p, i) => [p.key, i] as const));

/** The character of a persona key in one style; null for an unknown key. */
export function characterFor(key: string | null | undefined, style: AgentStyle): Character | null {
  if (!key) return null;
  const index = INDEX_BY_KEY.get(key);
  return index === undefined ? null : (STYLE_CATALOGS[style][index] ?? null);
}

const FRAMING = "plain light background, head and shoulders, no text, one character only.";

/**
 * The image prompt for one character's portrait. Humans keep today's photographic prompt word for word; the other
 * styles describe a rendering style and the character's `look`. No prompt names a studio, brand or franchise.
 */
export function characterPortraitPrompt(character: Character): string {
  switch (character.style) {
    case "humans": {
      const persona = personaByKey(character.key);
      if (persona) return personaPortraitPrompt(persona);
      return `A professional headshot photograph of ${character.look}, smiling warmly at the camera. Head and shoulders, natural soft daylight, plain light neutral background, approachable and confident. Photorealistic, sharp focus on the eyes, no text, no logos, one person only.`;
    }
    case "cartoon_3d":
      return `A 3D animated feature film style character portrait of ${character.look}, smiling warmly. Stylized proportions, big expressive eyes, soft studio lighting, ${FRAMING}`;
    case "cartoon_2d":
      return `A flat 2D cartoon illustration of ${character.look}, smiling warmly. Bold clean outlines, flat colors, simple shading, ${FRAMING}`;
    case "fantasy":
      return `A 3D rendered fantasy character portrait of ${character.look}, smiling warmly. Painterly fantasy lighting, ${FRAMING}`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// One name everywhere (docs/DECISIONS.md, "One name everywhere", 2026-11-08)
// ---------------------------------------------------------------------------------------------------------------
//
// Every surface that names an agent goes through `agentDisplay`: the founder's account preference decides between the
// stored name and the persona, never the surface. The server never writes a display choice into stored text (members
// of one business may have different preferences): bodies name agents as `[[ent:<id>|<stored name>]]` markup, which
// `EntityLink` renders under the reader's preference, and plain stored text such as a subject goes through
// `withAgentNames` when it is shown.

/**
 * The background helpers' template keys (the five utilities: entity linker, classifier, categorizer, inbound sorter,
 * moderation). They always read by their role name, even with anthropomorphic agents on (founder, 2026-11-08). Kept
 * equal to `UTILITY_TEMPLATE_KEYS` in @foundmill/agents by a test there.
 */
export const BACKGROUND_HELPER_AGENT_TYPES: readonly string[] = Object.freeze(["entity_linker", "classifier", "categoriser", "triage", "moderation"]);

/** True for a background helper: the utility layer, or one of the utility templates. */
export function isBackgroundHelper(agent: Pick<AgentIdentity, "layer" | "agentType">): boolean {
  return agent.layer === "utility" || (typeof agent.agentType === "string" && BACKGROUND_HELPER_AGENT_TYPES.includes(agent.agentType));
}

/** The display preference: the account's `anthropomorphicAgents` and `agentStyle`. A bare boolean means the humans style. */
export type AgentDisplayPrefs = boolean | { anthropomorphic: boolean; style?: AgentStyle | null };

function prefsOf(prefs: AgentDisplayPrefs): { anthropomorphic: boolean; style: AgentStyle } {
  if (typeof prefs === "boolean") return { anthropomorphic: prefs, style: DEFAULT_AGENT_STYLE };
  return { anthropomorphic: prefs.anthropomorphic === true, style: prefs.style ?? DEFAULT_AGENT_STYLE };
}

/** The character an agent is shown as under `prefs`, or null (preference off, no catalog persona, or a background helper). */
export function agentCharacter(agent: AgentIdentity, prefs: AgentDisplayPrefs): Character | null {
  const { anthropomorphic, style } = prefsOf(prefs);
  if (!anthropomorphic || isBackgroundHelper(agent)) return null;
  return characterFor(agent.personaKey, style);
}

/**
 * The one display function. `form: "name"` is the first name, for a place with the position beside it (a table cell,
 * a card title); `form: "label"` is "Bob (Chief of Staff)", for a sender, a subject, or anywhere the agent is named
 * alone. With the preference off, without a persona, or for a background helper, both are the stored name.
 */
export function agentDisplay(agent: AgentIdentity, prefs: AgentDisplayPrefs, form: "name" | "label" = "label"): string {
  const character = agentCharacter(agent, prefs);
  if (!character) return agent.name;
  return form === "name" ? character.name : `${character.name} (${agentPosition(agent)})`;
}

/** The first name (in the account's style) when anthropomorphic agents are on. Alias of `agentDisplay(…, "name")`. */
export function agentDisplayName(agent: AgentIdentity, anthropomorphic: boolean, style: AgentStyle = DEFAULT_AGENT_STYLE): string {
  return agentDisplay(agent, { anthropomorphic, style }, "name");
}

/** "Bramble (Chief of Staff)" when on, else the stored name. Alias of `agentDisplay(…, "label")`. */
export function agentLabel(agent: AgentIdentity, anthropomorphic: boolean, style: AgentStyle = DEFAULT_AGENT_STYLE): string {
  return agentDisplay(agent, { anthropomorphic, style }, "label");
}

/**
 * How the server names an agent in stored text: `[[ent:<id>|<stored name>]]`, never a display choice. EntityLink renders
 * it under each reader's own preference. The name loses the two characters markup cannot carry ("|" and "]").
 */
export function agentMention(agent: { id: string; name: string }): string {
  const name = agent.name.replace(/[|\]]/g, " ").replace(/\s+/g, " ").trim();
  return name ? `[[ent:${agent.id}|${name}]]` : "";
}

const ENTITY_MARKUP = /\[\[ent:[^\]]*\]\]/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Plain stored text (an Inbox subject, a toast, a live-session note) with each roster agent's exact stored name
 * replaced by its label under `prefs`: whole words only, case-sensitive, the longest name first (so "Engineering
 * Lead" wins over "Lead"), and never inside `[[ent:…]]` markup (EntityLink names those itself). With the preference
 * off the text comes back unchanged. Text written under an agent's old name after a rename is left as it is.
 */
export function withAgentNames(text: string, roster: readonly AgentIdentity[], prefs: AgentDisplayPrefs, form: "name" | "label" = "label"): string {
  if (!text || roster.length === 0 || !prefsOf(prefs).anthropomorphic) return text;
  const byName = new Map<string, { shown: string; first: string }>();
  for (const agent of roster) {
    const name = agent.name?.trim();
    if (!name || byName.has(name)) continue;
    const shown = agentDisplay(agent, prefs, form);
    if (shown !== agent.name) byName.set(name, { shown, first: agentDisplay(agent, prefs, "name") });
  }
  if (byName.size === 0) return text;
  const names = [...byName.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  // A whole word: no letter, digit or underscore touches either end of the name. A possessive ("Engineering Lead's
  // change") takes the first name alone, so it never reads "Malik (Head of Engineering)'s change".
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])(['’]s(?![\\p{L}\\p{N}_]))?`, "gu");
  const swap = (part: string) =>
    part.replace(pattern, (hit: string, name: string, possessive: string | undefined) => {
      const entry = byName.get(name);
      if (!entry) return hit;
      return possessive ? `${entry.first}${possessive}` : entry.shown;
    });
  let out = "";
  let last = 0;
  for (const m of text.matchAll(ENTITY_MARKUP)) {
    out += swap(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + swap(text.slice(last));
}

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
}

/** The agent's position, as shown beside a persona name: the role, else the agent's own (title) name. */
export function agentPosition(agent: AgentIdentity): string {
  return (agent.role ?? "").trim() || agent.name;
}

/** The name to show: the persona's first name when anthropomorphic agents are on and the agent has one. */
export function agentDisplayName(agent: AgentIdentity, anthropomorphic: boolean): string {
  const persona = anthropomorphic ? personaByKey(agent.personaKey) : null;
  return persona ? persona.name : agent.name;
}

/** The sender label (Inbox and anywhere an agent is named alone): "Bob (Chief of Staff)" when on, else the name. */
export function agentLabel(agent: AgentIdentity, anthropomorphic: boolean): string {
  const persona = anthropomorphic ? personaByKey(agent.personaKey) : null;
  return persona ? `${persona.name} (${agentPosition(agent)})` : agent.name;
}

/**
 * Word lists for the sweep's proper-noun heuristics. Everything here is compared after `normalizeName`, so entries are
 * lowercase. These lists only decide what becomes a *draft* or a *partial* match; manifest matching (exact, alias,
 * fuzzy) ignores them, so a founder whose supplier is called "Inbox Ltd" still gets a link.
 */

/** Capitalised words that are not entity names: acronyms, calendar words, product-interface nouns, honorifics. */
export const DEFAULT_STOPLIST: ReadonlySet<string> = new Set(
  (
    // calendar
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december today tomorrow yesterday q1 q2 q3 q4 h1 h2 fy am pm " +
    // business / metrics acronyms
    "ceo cto cfo coo cmo cpo cro vp svp evp md gm hr it pr seo geo sem ppc cpa cac cpc cpm ltv roi roas kpi okr mrr arr gmv nps nrr arpu arpa churn mvp poc rfp rfq rfi po sla sow nda loi mou ipo m&a saas b2b b2c b2b2c d2c dtc smb sme kyc aml gdpr ccpa vat gst iso soc hipaa pci api sdk ui ux url pdf csv json html xml sql ai ml llm nlp ocr crm erp cms cdn dns ssl ios ok tbd tbc eta faq asap fyi re cc bcc ps nb id ids sms mms qr pos b2g usd eur gbp sek nok dkk chf jpy cad aud nzd inr cny hkd sgd " +
    // interface nouns the composer capitalises (BUILD §1, §5)
    "inbox continue refresh home settings match day ribbon journey formation squad staff training ground kit crest season chapter forecast estimate decision update warning milestone report respond archive customers updates messages live personal plan tasks task roadmap specification vision sources research channels leads campaigns creative attribution overview cash runway wage bill cap table legal compliance contracts policies regulatory entity team product development distribution finance " +
    // honorifics and generic name parts
    "mr mrs ms mx dr prof sir dame jr sr esq the a an and or of for to in on at by with from as is are was were be been it its this that these those i we you they he she " +
    // generic org words that are never a name on their own
    "inc ltd llc gmbh ab oy as sa bv nv plc co corp company corporation limited group holdings partners ventures capital labs lab studio studios technologies technology tech systems software solutions services agency bank university institute foundation association network media digital global international national series seed round"
  )
    .split(/\s+/)
    .filter(Boolean),
);

/** Words that join two capitalised words into one name ("Bank of Sweden", "Procter & Gamble", "van der Berg"). */
export const CONNECTORS: ReadonlySet<string> = new Set(["of", "de", "del", "della", "di", "da", "du", "des", "van", "von", "der", "den", "ter", "la", "le", "el", "al", "y", "e", "the", "and", "&", "for", "on", "in"]);

/** Abbreviations whose trailing dot is part of the name ("Inc.", "Co.", "St."). */
export const DOTTED_ABBREVIATIONS: ReadonlySet<string> = new Set(["inc", "ltd", "co", "corp", "st", "mt", "ft", "bros", "mfg", "no", "jr", "sr", "dr", "mr", "mrs", "ms", "prof"]);

/** Tokens that mark the rest of a span as an organisation. */
export const ORG_MARKERS: ReadonlySet<string> = new Set(
  "inc ltd llc llp gmbh ag ab oy oyj as asa sa sas sarl bv nv plc pty co corp company corporation limited group holdings partners ventures capital labs lab studio studios technologies technology tech systems software solutions services agency bank university college institute foundation association network media digital global international clinic hospital pharma pharmaceuticals robotics logistics industries manufacturing works brewery bakery kitchen cafe restaurant hotel shop store market markets exchange trust fund funds partners school academy council committee ministry department authority office press publishing records games gaming studio motors automotive energy power solar wind water airlines airways rail railway shipping freight".split(" "),
);

/** Tokens before a name that mark a person ("Dr Sara Lindqvist"). */
export const PERSON_MARKERS: ReadonlySet<string> = new Set(["mr", "mrs", "ms", "mx", "dr", "prof", "sir", "dame", "madam", "miss", "herr", "frau", "monsieur", "madame", "señor", "señora"]);

/** Suffixes common in surnames; used only to guess the kind of a two-word draft. */
export const SURNAME_SUFFIXES: readonly string[] = ["son", "sen", "sson", "qvist", "quist", "berg", "borg", "strom", "ström", "lund", "gren", "stedt", "man", "mann", "ley", "ton", "ez", "es", "ov", "ova", "ev", "eva", "ski", "sky", "cki", "escu", "ich", "vic", "vich", "ic", "ić", "ini", "elli", "etti", "oğlu", "oglu", "yan", "ian", "sen", "dóttir", "dottir", "ard", "wood", "field", "ford", "worth", "smith", "wright", "er", "ler", "ner"];

/** A short list of common given names across the markets in BUILD §17.2 (Sweden, UK, US) for the person/organisation guess. */
export const GIVEN_NAMES: ReadonlySet<string> = new Set(
  (
    "sara sarah anna anne ann emma eva elin erik eric lars johan jonas anders karin kristina maria marie mikael michael magnus per peter petter pär oskar oscar linnea lisa lena hanna hannah ida julia klara clara elsa alice maja ebba wilma agnes astrid freja tilde nils axel olle gustav hugo elias oliver liam william lucas noah leo alexander adam isak viktor victor filip felix anton emil arvid vincent benjamin theo ludvig edvin love simon samuel daniel david jakob jacob jonathan joel josef joseph jack james john robert thomas tom charles charlie george henry harry edward ted richard paul mark luke matthew andrew christopher chris stephen steven ryan kevin brian jason justin brandon scott eric nathan aaron adam patrick sean timothy tim jeffrey jeff gregory greg raymond dennis walter jerry carl arthur harold frank ralph eugene roy louis philip johnny bobby jimmy " +
    "mary patricia jennifer linda elizabeth barbara susan jessica margaret karen nancy betty helen sandra donna carol ruth sharon michelle laura kimberly deborah amy angela melissa brenda rebecca virginia kathleen pamela martha debra amanda stephanie carolyn christine janet catherine frances ann joyce diane alice julie heather teresa doris gloria evelyn jean cheryl mildred katherine joan ashley judith rose janice kelly nicole judy christina kathy theresa beverly denise tammy irene jane lori rachel marilyn andrea kathryn louise sophie sophia olivia ava isabella mia charlotte amelia harper evelyn abigail emily ella grace chloe camila penelope riley layla zoe zoey nora lily eleanor hazel violet aurora savannah audrey brooklyn bella claire skylar lucy paisley everly anna caroline nova genesis emilia kennedy samantha maya willow kinsley naomi aaliyah elena sarah ariana allison gabriella alice madelyn cora ruby eva serenity autumn adeline hailey gianna valentina isla eliana quinn nevaeh ivy sadie piper lydia alexa josephine emery julia delilah arianna vivian kaylee sophie brielle madeline peyton rylee clara hadley melanie mackenzie reagan adalynn liliana aubrey jade katherine isabelle natalie raelynn maria athena ximena arya leilah taylor faith rose kylie alexandra mary margaret lyla lauren elise amara noor ines yasmin fatima aisha omar ali ahmed mohammed hassan youssef karim nadia leila amir reza sina kaveh arash jamal tariq " +
    "wei li ming jun hui fang lei ying jing xin yan ling hao yu chen jie min kai ken hiroshi yuki haruto sota ren aoi himari rin akira kenji takeshi naoko yumi satoshi raj priya arjun aditya ananya kavya rohan sanjay vikram neha pooja rahul amit deepak sunil anil ravi suresh kiran divya shreya ishaan vihaan"
  )
    .split(/\s+/)
    .filter(Boolean),
);

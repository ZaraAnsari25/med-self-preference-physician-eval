import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_INSTRUMENT_CONFIG, type InstrumentConfig } from "@/lib/rubric";
import type { StudyId } from "@/lib/studies";

const KEY = "instrument_config";

export async function getInstrumentConfig(db: DB): Promise<InstrumentConfig> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return { ...DEFAULT_INSTRUMENT_CONFIG, ...((row?.value as Partial<InstrumentConfig>) ?? {}) };
}

export async function setInstrumentConfig(db: DB, config: InstrumentConfig) {
  await db
    .insert(settings)
    .values({ key: KEY, value: config })
    .onConflictDoUpdate({ target: settings.key, set: { value: config, updatedAt: new Date() } });
}

/** Each study has its own frozen seed (sampling + presentation order), set once on first import. */
const seedKey = (study: StudyId) => `study_seed:${study}`;

export async function getStudySeed(db: DB, study: StudyId): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, seedKey(study)));
  return (row?.value as string) ?? null;
}

export async function setStudySeed(db: DB, study: StudyId, seed: string) {
  const existing = await getStudySeed(db, study);
  if (existing && existing !== seed) throw new Error(`${study} seed already set to ${existing}; refusing to change it to ${seed}`);
  if (!existing) await db.insert(settings).values({ key: seedKey(study), value: seed });
}

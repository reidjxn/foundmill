/**
 * Builds the migrated PGlite snapshot ahead of the tests (CI's unit lane, WP-01 T3), so the test workers find it ready.
 *   pnpm --filter @foundmill/db exec tsx src/testing/build-snapshot.ts
 */
import path from "node:path";
import { readMigrations } from "../migrations";
import { loadOrBuildSnapshot, snapshotDir, snapshotKey } from "./snapshot";

const started = Date.now();
const snap = await loadOrBuildSnapshot();
const file = path.join(snapshotDir(), `${snapshotKey(readMigrations(), snap.hasVector)}.tar`);
console.warn(`migrated PGlite snapshot ${file}: ${(snap.bytes.byteLength / 1e6).toFixed(1)} MB, ${snap.tags.length} migrations, vector ${snap.hasVector}, ${((Date.now() - started) / 1000).toFixed(1)} s`);

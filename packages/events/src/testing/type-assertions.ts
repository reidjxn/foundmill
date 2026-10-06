/**
 * Compile-time contracts (no runtime). If ioredis's `Redis` or drizzle's `PgDatabase`/`PgTransaction`
 * stop satisfying our structural interfaces, `pnpm typecheck` fails here rather than in a consumer.
 */
import type { Redis } from "ioredis";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { Queryable, TransactionalQueryable } from "../outbox/writer";
import type { StreamRedis } from "../redis";
import type { MemoryRedis } from "./memory-redis";

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;

export type _RedisSatisfiesStreamRedis = Assert<Extends<Redis, StreamRedis>>;
export type _MemoryRedisSatisfiesStreamRedis = Assert<Extends<MemoryRedis, StreamRedis>>;
export type _PgDatabaseIsQueryable = Assert<Extends<PgDatabase<PgQueryResultHKT>, Queryable>>;
export type _PgDatabaseIsTransactional = Assert<
  Extends<PgDatabase<PgQueryResultHKT>, TransactionalQueryable>
>;
export type _PgTransactionIsQueryable = Assert<Extends<PgTransaction<PgQueryResultHKT>, Queryable>>;

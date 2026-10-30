import { PrismaClient } from '@prisma/client';
export declare const prisma: PrismaClient;
/**
 * Connects to PostgreSQL (`xiangqi_db`) and performs a one-time idempotent
 * migration of any pre-existing local records from `server/data/xiangqi-db.json`
 * (excluding temporary `@xiangqi.test` test-suite accounts) when PostgreSQL is empty.
 */
export declare function connectAndSeedDatabase(): Promise<void>;
//# sourceMappingURL=database.d.ts.map
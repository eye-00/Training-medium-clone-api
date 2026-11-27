import { createConnection, type Connection } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import {
    acquireE2eDatabaseLock,
    assertApplicationTablesEmpty,
    assertDedicatedE2eEnvironment,
    truncateE2eTables,
    verifyDedicatedE2eDatabase,
} from './dedicated-e2e-database.js';

let session: Connection | undefined;
let cleanupFailed = false;
let caseStarted = false;
const expectedUuid = assertDedicatedE2eEnvironment();

async function query(sql: string): Promise<unknown> {
    if (!session) throw new Error('Dedicated E2E database session not initialized');
    const [rows] = await session.query(sql);
    return rows;
}

const connection = { query };

beforeAll(async () => {
    session = await createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        database: process.env.DB_DATABASE,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        connectTimeout: 5000,
    });
    await verifyDedicatedE2eDatabase(connection, expectedUuid);
    await acquireE2eDatabaseLock(connection);
    await query('SET SESSION lock_wait_timeout = 5');
    await assertApplicationTablesEmpty(connection);
});

beforeEach(() => {
    if (cleanupFailed) throw new Error('Previous E2E cleanup failed');
    caseStarted = true;
});

afterEach(async () => {
    if (!caseStarted) return;
    caseStarted = false;
    try {
        await truncateE2eTables(connection, expectedUuid);
    } catch (error) {
        cleanupFailed = true;
        throw error;
    }
});

afterAll(async () => {
    await session?.end(); // Closing the pinned session releases the advisory lock.
});

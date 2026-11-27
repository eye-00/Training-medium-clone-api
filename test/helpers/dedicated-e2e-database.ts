export const APPLICATION_TABLES = [
    'article_favorites', 'article_tags', 'comments', 'follows',
    'attachments', 'articles', 'tags', 'users',
] as const;

export const E2E_DATABASE_LOCK = 'medium_clone_e2e:tests';

const EXPECTED_ENV = {
    NODE_ENV: 'test',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_DATABASE: 'medium_clone_e2e',
    DB_USERNAME: 'medium_e2e_user',
    E2E_TRUNCATE_DATABASE: 'medium_clone_e2e',
    REDIS_URL: 'redis://127.0.0.1:6380/2',
} as const;

type Connection = { query(sql: string): Promise<unknown> };

export function assertDedicatedE2eEnvironment(env = process.env): string {
    for (const [key, expected] of Object.entries(EXPECTED_ENV)) {
        if (env[key] !== expected) throw new Error(`Unsafe dedicated E2E configuration: ${key}`);
    }
    const uuid = env.DB_TEST_SERVER_UUID?.trim();
    if (!uuid || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid)) {
        throw new Error('Unsafe dedicated E2E configuration: DB_TEST_SERVER_UUID');
    }
    return uuid;
}

export async function verifyDedicatedE2eDatabase(connection: Connection, expectedUuid: string) {
    const rows = await connection.query(
        'SELECT DATABASE() AS db, CURRENT_USER() AS dbUser, @@server_uuid AS serverUuid',
    ) as Array<{ db: string; dbUser: string; serverUuid: string }>;
    const identity = rows[0];
    if (rows.length !== 1 || !identity || identity.db !== EXPECTED_ENV.DB_DATABASE ||
        typeof identity.dbUser !== 'string' || !identity.dbUser.startsWith(`${EXPECTED_ENV.DB_USERNAME}@`) ||
        identity.serverUuid !== expectedUuid) {
        throw new Error('Dedicated E2E database identity verification failed');
    }
    return Object.freeze(identity);
}

export async function acquireE2eDatabaseLock(connection: Connection): Promise<void> {
    const [row] = await connection.query(`SELECT GET_LOCK('${E2E_DATABASE_LOCK}', 0) AS acquired`) as
        Array<{ acquired: number | string | null }>;
    if (Number(row?.acquired) !== 1) throw new Error('The dedicated E2E database is already in use');
}

export async function assertApplicationTablesEmpty(connection: Connection): Promise<void> {
    const statements = APPLICATION_TABLES.map((table) =>
        `SELECT '${table}' AS name WHERE EXISTS (SELECT 1 FROM \`${table}\`)`,
    );
    const rows = await connection.query(statements.join(' UNION ALL ')) as Array<{ name: string }>;
    if (rows.length) throw new Error(`Dedicated E2E tables are not empty: ${rows.map(({ name }) => name).join(', ')}`);
}

/** The caller holds the E2E lock and uses one pinned MySQL session. */
export async function truncateE2eTables(connection: Connection, expectedUuid: string): Promise<void> {
    if (assertDedicatedE2eEnvironment() !== expectedUuid) {
        throw new Error('Dedicated E2E configuration changed during execution');
    }
    await verifyDedicatedE2eDatabase(connection, expectedUuid);
    const [row] = await connection.query(`SELECT @@SESSION.FOREIGN_KEY_CHECKS AS fk,
        IS_USED_LOCK('${E2E_DATABASE_LOCK}') = CONNECTION_ID() AS ownsLock`) as
        Array<{ fk: number | string; ownsLock: number | string | null }>;
    if (Number(row?.ownsLock) !== 1 || Number(row?.fk) !== 1) {
        throw new Error('Dedicated E2E cleanup requires the database lock and enabled foreign keys');
    }

    try {
        await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 0');
        for (const table of APPLICATION_TABLES) await connection.query(`TRUNCATE TABLE \`${table}\``);
    } finally {
        await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 1');
    }
    await assertApplicationTablesEmpty(connection);
}

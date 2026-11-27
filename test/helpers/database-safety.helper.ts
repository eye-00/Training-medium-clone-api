const TEST_DATABASE = 'medium_clone_test';
const TEST_DATABASE_USER = 'medium_test_user';

const EXPECTED_TEST_ENV = {
    NODE_ENV: 'test',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    DB_DATABASE: TEST_DATABASE,
    DB_USERNAME: TEST_DATABASE_USER,
    REDIS_URL: 'redis://127.0.0.1:6380/1',
} as const;

type TestEnvironment = Readonly<
    Record<string, string | undefined>
>;

type DatabaseConnection = {
    query(sql: string): Promise<unknown>;
};

export type VerifiedDatabaseIdentity = Readonly<{
    db: string;
    dbUser: string;
    serverUuid: string;
}>;

/**
 * Validates the environment before loading AppModule.
 *
 * Returns the expected MySQL server UUID.
 * Never includes credentials in error messages.
 */
export function assertSafeTestEnvironment(
    env: TestEnvironment = process.env,
): string {
    for (const [key, expected] of Object.entries(
        EXPECTED_TEST_ENV,
    )) {
        if (env[key] !== expected) {
            throw new Error(
                `Unsafe E2E environment: invalid ${key}`,
            );
        }
    }

    const expectedServerUuid =
        env.DB_TEST_SERVER_UUID?.trim();

    if (!expectedServerUuid) {
        throw new Error(
            'Unsafe E2E environment: missing DB_TEST_SERVER_UUID',
        );
    }

    return expectedServerUuid;
}

/**
 * Verifies the actual database connection.
 *
 * Must complete successfully before executing
 * test requests or database cleanup.
 */
export async function verifyTestDatabaseIdentity(
    connection: DatabaseConnection,
    expectedServerUuid: string,
): Promise<VerifiedDatabaseIdentity> {
    if (!expectedServerUuid.trim()) {
        throw new Error(
            'E2E database identity verification failed',
        );
    }

    const rows = await connection.query(`
        SELECT
            DATABASE() AS db,
            CURRENT_USER() AS dbUser,
            @@server_uuid AS serverUuid
    `);

    if (!Array.isArray(rows) || rows.length !== 1) {
        throw new Error(
            'E2E database identity verification failed',
        );
    }

    const identity: unknown = rows[0];

    if (
        typeof identity !== 'object' ||
        identity === null ||
        !('db' in identity) ||
        !('dbUser' in identity) ||
        !('serverUuid' in identity) ||
        identity.db !== TEST_DATABASE ||
        typeof identity.dbUser !== 'string' ||
        !identity.dbUser.startsWith(
            `${TEST_DATABASE_USER}@`,
        ) ||
        identity.serverUuid !== expectedServerUuid
    ) {
        throw new Error(
            'E2E database identity verification failed',
        );
    }

    return Object.freeze({
        db: identity.db,
        dbUser: identity.dbUser,
        serverUuid: identity.serverUuid,
    });
}

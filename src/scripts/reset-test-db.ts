import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "dotenv";
import { DataSource } from "typeorm";

import { databaseEnvSchema } from "../config/env.schema.js";
import { createDatabaseOptions } from "../database/database.options.js";

const raw = parse(
    readFileSync(resolve(process.cwd(), ".env.test")),
);
const config = databaseEnvSchema.parse(raw);

const expectedDatabase = 'medium_clone_test';
const expectedUser = 'medium_test_user';

// if (
//     raw.NODE_ENV !== 'test' ||
//     config.DB_DATABASE !== expectedDatabase ||
//     config.DB_USERNAME !== expectedUser ||
//     config.DB_HOST !== '127.0.0.1' ||
//     config.DB_PORT !== 3307 ||
//     !raw.DB_TEST_SERVER_UUID ||
//     process.env.CONFIRM_DB_RESET !== expectedDatabase
// ) {
//     throw new Error(
//         'Unsafe database reset: test configuration or confirmation is invalid',
//     );
// }

const checks = {
    NODE_ENV: raw.NODE_ENV === 'test',

    DB_DATABASE:
        config.DB_DATABASE === 'medium_clone_test',

    DB_USERNAME:
        config.DB_USERNAME === 'medium_test_user',

    DB_HOST:
        config.DB_HOST === '127.0.0.1',

    DB_PORT:
        config.DB_PORT === 3307,

    DB_TEST_SERVER_UUID:
        Boolean(raw.DB_TEST_SERVER_UUID?.trim()),

    CONFIRM_DB_RESET:
        process.env.CONFIRM_DB_RESET === 'medium_clone_test',
};

const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

if (failedChecks.length > 0) {
    throw new Error(
        `Unsafe database reset. Failed checks: ${failedChecks.join(', ')}`,
    );
}

const dataSource = new DataSource(createDatabaseOptions(config));

await dataSource.initialize();

try {
    type DatabaseIdentity = {
        db: string;
        dbUser: string;
        serverUuid: string;
    };
    const connections = (await dataSource.query(`
    SELECT
        DATABASE() AS db,
        CURRENT_USER() AS dbUser,
        @@server_uuid AS serverUuid
`)) as DatabaseIdentity[];
    const actual = connections[0];
    const identityChecks = {
        database: actual?.db === expectedDatabase,

        username: actual?.dbUser?.startsWith(
            `${expectedUser}@`,
        ) ?? false,

        serverUuid:
            actual?.serverUuid ===
            raw.DB_TEST_SERVER_UUID?.trim(),
    };

    const failedIdentityChecks = Object.entries(identityChecks)
        .filter(([, passed]) => !passed)
        .map(([name]) => name);

    if (failedIdentityChecks.length > 0) {
        throw new Error(
            `Database identity verification failed: ${failedIdentityChecks.join(', ')
            }`,
        );
    }

    console.info('Verified test database connection');

    const tables = (await dataSource.query(`
        SELECT COUNT(*) AS total
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        AND table_name = 'migrations'`)) as Array<{ total: number | string }>;

    const hasHistoryTable = Number(tables[0]?.total ?? 0) > 0;
    let executedCount = 0;
    if (hasHistoryTable) {
        const rows = (await dataSource.query(`
            SELECT COUNT(*) AS total FROM migrations`)) as Array<{ total: number | string }>;
        executedCount = Number(rows[0]?.total ?? 0);
    }

    for (let i = 0; i < executedCount; i++) {
        await dataSource.undoLastMigration();
    }
    await dataSource.runMigrations();
    console.info('Test database reset complete');
} finally {
    await dataSource.destroy();
}
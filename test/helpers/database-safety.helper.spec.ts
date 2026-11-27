import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import {
    assertSafeTestEnvironment,
    verifyTestDatabaseIdentity,
} from './database-safety.helper.js';

const SERVER_UUID =
    '11111111-2222-4333-8444-555555555555';

function validEnvironment() {
    return {
        NODE_ENV: 'test',
        DB_HOST: '127.0.0.1',
        DB_PORT: '3307',
        DB_DATABASE: 'medium_clone_test',
        DB_USERNAME: 'medium_test_user',
        REDIS_URL: 'redis://127.0.0.1:6380/1',
        DB_TEST_SERVER_UUID: SERVER_UUID,
    };
}

function validIdentity() {
    return {
        db: 'medium_clone_test',
        dbUser: 'medium_test_user@%',
        serverUuid: SERVER_UUID,
    };
}

describe('assertSafeTestEnvironment', () => {
    it('accepts the isolated E2E environment', () => {
        expect(
            assertSafeTestEnvironment(
                validEnvironment(),
            ),
        ).toBe(SERVER_UUID);
    });

    it('normalizes surrounding UUID whitespace', () => {
        const env = {
            ...validEnvironment(),
            DB_TEST_SERVER_UUID: ` ${SERVER_UUID} `,
        };

        expect(
            assertSafeTestEnvironment(env),
        ).toBe(SERVER_UUID);
    });

    it.each([
        {
            key: 'NODE_ENV',
            value: 'production',
        },
        {
            key: 'DB_HOST',
            value: 'remote-database.example.com',
        },
        {
            key: 'DB_PORT',
            value: '3306',
        },
        {
            key: 'DB_DATABASE',
            value: 'medium_clone',
        },
        {
            key: 'DB_USERNAME',
            value: 'root',
        },
        {
            key: 'REDIS_URL',
            value: 'redis://127.0.0.1:6379',
        },
        {
            key: 'DB_TEST_SERVER_UUID',
            value: undefined,
        },
        {
            key: 'DB_TEST_SERVER_UUID',
            value: '   ',
        },
    ])(
        'rejects unsafe $key ($value)',
        ({ key, value }) => {
            const env = {
                ...validEnvironment(),
                [key]: value,
            };

            expect(() =>
                assertSafeTestEnvironment(env),
            ).toThrow('Unsafe E2E environment');

            expect(() =>
                assertSafeTestEnvironment(env),
            ).toThrow(key);
        },
    );
});

describe('verifyTestDatabaseIdentity', () => {
    it('accepts the verified database identity', async () => {
        const identity = validIdentity();

        const connection = {
            query: vi.fn()
                .mockResolvedValue([identity]),
        };

        const result =
            await verifyTestDatabaseIdentity(
                connection,
                SERVER_UUID,
            );

        expect(result).toEqual(identity);
        expect(Object.isFrozen(result)).toBe(true);

        expect(connection.query)
            .toHaveBeenCalledTimes(1);

        const sql =
            connection.query.mock.calls[0]?.[0];

        expect(sql).toContain('DATABASE()');
        expect(sql).toContain('CURRENT_USER()');
        expect(sql).toContain('@@server_uuid');
    });

    it.each([
        {
            label: 'empty result',
            rows: [],
        },
        {
            label: 'null result',
            rows: null,
        },
        {
            label: 'non-array result',
            rows: validIdentity(),
        },
        {
            label: 'multiple rows',
            rows: [
                validIdentity(),
                validIdentity(),
            ],
        },
        {
            label: 'wrong database',
            rows: [{
                ...validIdentity(),
                db: 'medium_clone',
            }],
        },
        {
            label: 'wrong database user',
            rows: [{
                ...validIdentity(),
                dbUser: 'root@%',
            }],
        },
        {
            label: 'invalid database user type',
            rows: [{
                ...validIdentity(),
                dbUser: null,
            }],
        },
        {
            label: 'wrong MySQL server UUID',
            rows: [{
                ...validIdentity(),
                serverUuid: 'different-server',
            }],
        },
        {
            label: 'malformed identity row',
            rows: [null],
        },
    ])(
        'rejects $label',
        async ({ rows }) => {
            const connection = {
                query: vi.fn()
                    .mockResolvedValue(rows),
            };

            await expect(
                verifyTestDatabaseIdentity(
                    connection,
                    SERVER_UUID,
                ),
            ).rejects.toThrow(
                'E2E database identity verification failed',
            );

            expect(connection.query)
                .toHaveBeenCalledTimes(1);
        },
    );

    it('propagates database query failures', async () => {
        const error = new Error(
            'Database connection failed',
        );

        const connection = {
            query: vi.fn()
                .mockRejectedValue(error),
        };

        await expect(
            verifyTestDatabaseIdentity(
                connection,
                SERVER_UUID,
            ),
        ).rejects.toBe(error);

        expect(connection.query)
            .toHaveBeenCalledTimes(1);
    });

    it('rejects an empty expected UUID before querying', async () => {
        const connection = {
            query: vi.fn(),
        };

        await expect(
            verifyTestDatabaseIdentity(
                connection,
                '   ',
            ),
        ).rejects.toThrow(
            'E2E database identity verification failed',
        );

        expect(connection.query)
            .not.toHaveBeenCalled();
    });
});

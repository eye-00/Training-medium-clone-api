import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { truncateE2eTables } from './dedicated-e2e-database.js';

const expectedUuid = '12345678-1234-1234-1234-123456789abc';

function connection(database = 'medium_clone_e2e', ownsLock = 1) {
    return {
        query: vi.fn(async (sql: string): Promise<unknown> => {
            if (sql.startsWith('SELECT DATABASE()')) {
                return [{ db: database, dbUser: 'medium_e2e_user@%', serverUuid: expectedUuid }];
            }
            if (sql.includes('IS_USED_LOCK')) return [{ fk: 1, ownsLock }];
            return [];
        }),
    };
}

describe('Dedicated E2E truncation', () => {
    beforeEach(() => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('DB_HOST', '127.0.0.1');
        vi.stubEnv('DB_PORT', '3307');
        vi.stubEnv('DB_DATABASE', 'medium_clone_e2e');
        vi.stubEnv('DB_USERNAME', 'medium_e2e_user');
        vi.stubEnv('E2E_TRUNCATE_DATABASE', 'medium_clone_e2e');
        vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6380/2');
        vi.stubEnv('DB_TEST_SERVER_UUID', expectedUuid);
    });

    afterEach(() => { vi.unstubAllEnvs(); });

    it('refuses the existing shared configuration before sending SQL', async () => {
        vi.stubEnv('DB_DATABASE', 'medium_clone_test');
        const db = connection();
        await expect(truncateE2eTables(db, expectedUuid)).rejects.toThrow('DB_DATABASE');
        expect(db.query).not.toHaveBeenCalled();
    });

    it.each([
        ['wrong live database', 'medium_clone_test', 1, 'identity verification failed'],
        ['missing session lock', 'medium_clone_e2e', 0, 'requires the database lock'],
    ])('fails closed with %s', async (_scenario, database, ownsLock, message) => {
        const db = connection(database, ownsLock);
        await expect(truncateE2eTables(db, expectedUuid)).rejects.toThrow(message);
        expect(db.query.mock.calls.flat().every(sql => sql.startsWith('SELECT'))).toBe(true);
    });

    it('restores foreign key checks and propagates a truncate failure', async () => {
        const db = connection();
        const error = new Error('test truncate failure');
        db.query.mockResolvedValueOnce([{ db: 'medium_clone_e2e', dbUser: 'medium_e2e_user@%', serverUuid: expectedUuid }])
            .mockResolvedValueOnce([{ fk: 1, ownsLock: 1 }])
            .mockResolvedValueOnce([])
            .mockRejectedValueOnce(error);
        await expect(truncateE2eTables(db, expectedUuid)).rejects.toBe(error);
        expect(db.query).toHaveBeenLastCalledWith('SET SESSION FOREIGN_KEY_CHECKS = 1');
    });
});

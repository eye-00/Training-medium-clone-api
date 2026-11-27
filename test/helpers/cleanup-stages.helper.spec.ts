import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCleanupStages } from './cleanup-stages.helper.js';
import { closeTestApp, type TestAppContext } from './test-app.helper.js';

const serverUuid = '11111111-2222-4333-8444-555555555555';

function setSafeEnvironment() {
    const env = {
        NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: '3307',
        DB_DATABASE: 'medium_clone_test', DB_USERNAME: 'medium_test_user',
        REDIS_URL: 'redis://127.0.0.1:6380/1', DB_TEST_SERVER_UUID: serverUuid,
    };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

describe('runCleanupStages', () => {
    afterEach(() => { vi.unstubAllEnvs(); });

    it('runs independent stages in order', async () => {
        const events: string[] = [];
        await runCleanupStages([
            async () => { events.push('users'); },
            async () => { events.push('tags'); },
        ]);
        expect(events).toEqual(['users', 'tags']);
    });

    it('tries later stages and aggregates all errors', async () => {
        const events: string[] = [];
        const usersError = new Error('synthetic users failure');
        const tagsError = new Error('synthetic tags failure');
        const result = runCleanupStages([
            async () => { events.push('users'); throw usersError; },
            async () => { events.push('tags'); throw tagsError; },
        ]);
        await expect(result).rejects.toMatchObject({
            errors: [usersError, tagsError],
        });
        expect(events).toEqual(['users', 'tags']);
    });

    it('does not run stages on database identity mismatch and still closes the app', async () => {
        setSafeEnvironment();
        const stage = vi.fn().mockResolvedValue(undefined);
        const close = vi.fn().mockResolvedValue(undefined);
        const context = {
            identity: { serverUuid },
            db: { query: vi.fn().mockResolvedValue([{ db: 'wrong', dbUser: 'medium_test_user@localhost', serverUuid }]) },
            app: { close },
        } as unknown as TestAppContext;

        await expect(closeTestApp(context, () => runCleanupStages([stage])))
            .rejects.toThrow('E2E database identity verification failed');
        expect(stage).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnce();
    });

    it('closes after stage failures and preserves a separate close failure', async () => {
        setSafeEnvironment();
        const usersError = new Error('synthetic users failure');
        const closeError = new Error('synthetic close failure');
        const tags = vi.fn().mockResolvedValue(undefined);
        const context = {
            identity: { serverUuid },
            db: { query: vi.fn().mockResolvedValue([{ db: 'medium_clone_test', dbUser: 'medium_test_user@localhost', serverUuid }]) },
            app: { close: vi.fn().mockRejectedValue(closeError) },
        } as unknown as TestAppContext;

        const result = closeTestApp(context, () => runCleanupStages([
            async () => { throw usersError; }, tags,
        ]));
        await expect(result).rejects.toMatchObject({
            errors: [expect.objectContaining({ errors: [usersError] }), closeError],
        });
        expect(tags).toHaveBeenCalledOnce();
    });
});

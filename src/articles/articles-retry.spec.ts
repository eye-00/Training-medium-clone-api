
import { QueryFailedError } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ArticlesService } from './articles.service.js';

type RetryHarness = {
    retryOnDeadlock<T>(
        operation: () => Promise<T>,
    ): Promise<T>;
};

function createHarness(): RetryHarness {
    // Access the existing implementation without
    // initializing database connections.
    return Object.create(
        ArticlesService.prototype,
    ) as RetryHarness;
}

function createDatabaseError(
    code: string,
    errno: number,
): QueryFailedError {
    const driverError = Object.assign(
        new Error(code),
        { code, errno },
    );

    return new QueryFailedError(
        'INSERT INTO article_tags VALUES (?, ?)',
        ['article-id', 'tag-id'],
        driverError,
    );
}

describe('ArticlesService deadlock retry', () => {
    it('executes a successful operation once', async () => {
        const service = createHarness();
        const operation = vi.fn()
            .mockResolvedValue('created');

        await expect(
            service.retryOnDeadlock(operation),
        ).resolves.toBe('created');

        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('retries a MySQL deadlock and succeeds', async () => {
        const service = createHarness();

        const deadlock = createDatabaseError(
            'ER_LOCK_DEADLOCK',
            1213,
        );

        const operation = vi.fn()
            .mockRejectedValueOnce(deadlock)
            .mockResolvedValueOnce('created');

        await expect(
            service.retryOnDeadlock(operation),
        ).resolves.toBe('created');

        expect(operation).toHaveBeenCalledTimes(2);
    });

    it('stops after three deadlocked attempts', async () => {
        const service = createHarness();

        const deadlock = createDatabaseError(
            'ER_LOCK_DEADLOCK',
            1213,
        );

        const operation = vi.fn()
            .mockRejectedValue(deadlock);

        await expect(
            service.retryOnDeadlock(operation),
        ).rejects.toBe(deadlock);

        expect(operation).toHaveBeenCalledTimes(3);
    });

    it('does not retry duplicate key errors', async () => {
        const service = createHarness();

        const duplicate = createDatabaseError(
            'ER_DUP_ENTRY',
            1062,
        );

        const operation = vi.fn()
            .mockRejectedValue(duplicate);

        await expect(
            service.retryOnDeadlock(operation),
        ).rejects.toBe(duplicate);

        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('does not retry ordinary application errors', async () => {
        const service = createHarness();

        const error = new Error(
            'Business validation failed',
        );

        const operation = vi.fn()
            .mockRejectedValue(error);

        await expect(
            service.retryOnDeadlock(operation),
        ).rejects.toBe(error);

        expect(operation).toHaveBeenCalledTimes(1);
    });
});

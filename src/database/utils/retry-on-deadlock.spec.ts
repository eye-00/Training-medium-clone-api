import { QueryFailedError } from 'typeorm';

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import {
    retryOnDeadlock,
} from './retry-on-deadlock.js';

type DriverErrorDetails = {
    code?: string;
    errno?: number;
};

function createQueryError(
    details: DriverErrorDetails,
): QueryFailedError {
    const driverError = Object.assign(
        new Error('Simulated database error'),
        details,
    );

    return new QueryFailedError(
        'SELECT 1',
        [],
        driverError,
    );
}

function createDeadlockError(): QueryFailedError {
    return createQueryError({
        code: 'ER_LOCK_DEADLOCK',
        errno: 1213,
    });
}

describe('retryOnDeadlock', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('executes a successful operation exactly once', async () => {
        const operation = vi.fn()
            .mockResolvedValue('success');

        await expect(
            retryOnDeadlock(operation),
        ).resolves.toBe('success');

        expect(operation).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves the returned object reference', async () => {
        const result = {
            id: 1,
            body: 'Comment created',
        };

        const operation = vi.fn()
            .mockResolvedValue(result);

        await expect(
            retryOnDeadlock(operation),
        ).resolves.toBe(result);

        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('supports operations returning void', async () => {
        const operation = vi.fn()
            .mockResolvedValue(undefined);

        await expect(
            retryOnDeadlock(operation),
        ).resolves.toBeUndefined();

        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('retries a deadlock identified by its error code', async () => {
        const error = createQueryError({
            code: 'ER_LOCK_DEADLOCK',
        });

        const operation = vi.fn()
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce('success');

        const result = retryOnDeadlock(operation);

        const assertion = expect(result)
            .resolves.toBe('success');

        await vi.runAllTimersAsync();
        await assertion;

        expect(operation).toHaveBeenCalledTimes(2);
    });

    it('retries a deadlock identified by its error number', async () => {
        const error = createQueryError({
            errno: 1213,
        });

        const operation = vi.fn()
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce('success');

        const result = retryOnDeadlock(operation);

        const assertion = expect(result)
            .resolves.toBe('success');

        await vi.runAllTimersAsync();
        await assertion;

        expect(operation).toHaveBeenCalledTimes(2);
    });

    it('succeeds on the third attempt after two deadlocks', async () => {
        const operation = vi.fn()
            .mockRejectedValueOnce(createDeadlockError())
            .mockRejectedValueOnce(createDeadlockError())
            .mockResolvedValueOnce('success');

        const result = retryOnDeadlock(operation);

        const assertion = expect(result)
            .resolves.toBe('success');

        await vi.runAllTimersAsync();
        await assertion;

        expect(operation).toHaveBeenCalledTimes(3);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops after three attempts and throws the last deadlock error', async () => {
        const first = createDeadlockError();
        const second = createDeadlockError();
        const last = createDeadlockError();

        const operation = vi.fn()
            .mockRejectedValueOnce(first)
            .mockRejectedValueOnce(second)
            .mockRejectedValueOnce(last);

        const result = retryOnDeadlock(operation);

        const assertion = expect(result)
            .rejects.toBe(last);

        await vi.runAllTimersAsync();
        await assertion;

        expect(operation).toHaveBeenCalledTimes(3);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not retry duplicate key errors', async () => {
        const error = createQueryError({
            code: 'ER_DUP_ENTRY',
            errno: 1062,
        });

        const operation = vi.fn()
            .mockRejectedValue(error);

        await expect(
            retryOnDeadlock(operation),
        ).rejects.toBe(error);

        expect(operation).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not retry lock wait timeout errors', async () => {
        const error = createQueryError({
            code: 'ER_LOCK_WAIT_TIMEOUT',
            errno: 1205,
        });

        const operation = vi.fn()
            .mockRejectedValue(error);

        await expect(
            retryOnDeadlock(operation),
        ).rejects.toBe(error);

        expect(operation).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not retry ordinary application errors', async () => {
        const error = new Error(
            'Business validation failed',
        );

        const operation = vi.fn()
            .mockRejectedValue(error);

        await expect(
            retryOnDeadlock(operation),
        ).rejects.toBe(error);

        expect(operation).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not retry errors that are not QueryFailedError', async () => {
        const error = Object.assign(
            new Error('Not a TypeORM error'),
            {
                code: 'ER_LOCK_DEADLOCK',
                errno: 1213,
            },
        );

        const operation = vi.fn()
            .mockRejectedValue(error);

        await expect(
            retryOnDeadlock(operation),
        ).rejects.toBe(error);

        expect(operation).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops retrying when a non-deadlock error occurs', async () => {
        const error = createQueryError({
            code: 'ER_DUP_ENTRY',
            errno: 1062,
        });

        const operation = vi.fn()
            .mockRejectedValueOnce(createDeadlockError())
            .mockRejectedValueOnce(error);

        const result = retryOnDeadlock(operation);

        const assertion = expect(result)
            .rejects.toBe(error);

        await vi.runAllTimersAsync();
        await assertion;

        expect(operation).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        {
            label: 'minimum',
            random: 0,
            firstDelay: 30,
            secondDelay: 60,
        },
        {
            label: 'maximum',
            random: 0.999999,
            firstDelay: 59,
            secondDelay: 89,
        },
    ])(
        'applies the $label backoff and jitter delays',
        async ({
            random,
            firstDelay,
            secondDelay,
        }) => {
            vi.spyOn(Math, 'random')
                .mockReturnValue(random);

            const operation = vi.fn()
                .mockRejectedValueOnce(createDeadlockError())
                .mockRejectedValueOnce(createDeadlockError())
                .mockResolvedValueOnce('success');

            const result = retryOnDeadlock(operation);

            const assertion = expect(result)
                .resolves.toBe('success');

            expect(operation).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(
                firstDelay - 1,
            );

            expect(operation).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(1);

            expect(operation).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(
                secondDelay - 1,
            );

            expect(operation).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(1);

            expect(operation).toHaveBeenCalledTimes(3);

            await assertion;

            expect(vi.getTimerCount()).toBe(0);
        },
    );
});

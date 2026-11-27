
import {
    Logger,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { RedisService } from './redis.service.js';

const { redisClient } = vi.hoisted(() => ({
    redisClient: {
        isReady: true,
        on: vi.fn(),
        set: vi.fn(),
        exists: vi.fn(),
    },
}));

vi.mock('redis', () => ({
    createClient: vi.fn(() => redisClient),
}));

function createTestContext() {
    const config = {
        getOrThrow: vi.fn().mockReturnValue(
            'redis://127.0.0.1:6380',
        ),
    } as unknown as ConfigService;

    const service = new RedisService(config);

    return { service };
}

describe('RedisService error logging', () => {
    beforeEach(() => { redisClient.on.mockClear(); });

    it('logs a safe connection code without the raw error text', () => {
        const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        try {
            createTestContext();
            const listener = redisClient.on.mock.calls.find(([event]) => event === 'error')?.[1] as (error: Error) => void;
            expect(listener).toBeTypeOf('function');
            listener(Object.assign(new Error('SYNTHETIC_PRIVATE_REDIS_MARKER'), { code: 'ECONNREFUSED' }));
            const output = JSON.stringify(logger.mock.calls);
            expect(output).toContain('ECONNREFUSED');
            expect(output).not.toContain('SYNTHETIC_PRIVATE_REDIS_MARKER');
        } finally {
            logger.mockRestore();
        }
    });

    it('does not log an unrecognized connection error code or text', () => {
        const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        try {
            createTestContext();
            const listener = redisClient.on.mock.calls.find(([event]) => event === 'error')?.[1] as (error: Error) => void;
            listener(Object.assign(new Error('SYNTHETIC_PRIVATE_REDIS_MARKER'), { code: 'SYNTHETIC_UNTRUSTED_CODE' }));
            const output = JSON.stringify(logger.mock.calls);
            expect(output).not.toContain('SYNTHETIC_PRIVATE_REDIS_MARKER');
            expect(output).not.toContain('SYNTHETIC_UNTRUSTED_CODE');
        } finally {
            logger.mockRestore();
        }
    });
});

describe('RedisService.isTokenRevoked', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        redisClient.isReady = true;
        redisClient.exists.mockReset();
    });

    it('returns true when the blacklist key exists', async () => {
        redisClient.exists.mockResolvedValue(1);
        const { service } = createTestContext();

        await expect(service.isTokenRevoked('test-jti')).resolves.toBe(true);
        expect(redisClient.exists).toHaveBeenCalledExactlyOnceWith(
            'auth:blacklist:test-jti',
        );
    });

    it('returns false when the blacklist key does not exist', async () => {
        redisClient.exists.mockResolvedValue(0);
        const { service } = createTestContext();

        await expect(service.isTokenRevoked('test-jti')).resolves.toBe(false);
        expect(redisClient.exists).toHaveBeenCalledExactlyOnceWith(
            'auth:blacklist:test-jti',
        );
    });

    it('returns 503 without querying when Redis is not ready', async () => {
        redisClient.isReady = false;
        const { service } = createTestContext();

        await expect(service.isTokenRevoked('test-jti')).rejects.toMatchObject({
            status: 503,
            message: 'Authentication service temporarily unavailable',
        });
        expect(redisClient.exists).not.toHaveBeenCalled();
    });

    it('returns 503 without exposing a Redis query error', async () => {
        redisClient.exists.mockRejectedValue(new Error('Connection lost'));
        const { service } = createTestContext();

        await expect(service.isTokenRevoked('test-jti')).rejects.toMatchObject({
            status: 503,
            message: 'Authentication service temporarily unavailable',
        });
        expect(redisClient.exists).toHaveBeenCalledExactlyOnceWith(
            'auth:blacklist:test-jti',
        );
    });
});

describe('RedisService.revokeToken', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        redisClient.isReady = true;
        redisClient.set.mockResolvedValue('OK');

        // Fixed time: 1,800,000,000 seconds.
        vi.spyOn(Date, 'now').mockReturnValue(
            1_800_000_000_000,
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('stores the jti with the remaining TTL', async () => {
        const { service } = createTestContext();

        await service.revokeToken(
            'test-jti',
            1_800_000_700,
        );

        expect(redisClient.set).toHaveBeenCalledWith(
            'auth:blacklist:test-jti',
            '1',
            { EX: 700 },
        );
    });

    it.each([
        { now: 1_700_000_000_000, ttl: 1 },
        { now: 1_700_000_000_001, ttl: 1 },
        { now: 1_700_000_000_500, ttl: 1 },
        { now: 1_700_000_000_999, ttl: 1 },
        { now: 1_699_999_999_999, ttl: 2 },
    ])('uses TTL $ttl at $now milliseconds', async ({ now, ttl }) => {
        vi.mocked(Date.now).mockReturnValue(now);
        const { service } = createTestContext();

        await service.revokeToken('test-jti', 1_700_000_001);

        expect(redisClient.set).toHaveBeenCalledExactlyOnceWith(
            'auth:blacklist:test-jti',
            '1',
            { EX: ttl },
        );
    });

    it.each([1_700_000_001_000, 1_700_000_001_001])(
        'rejects an expired token at %i milliseconds without writing',
        async (now) => {
            vi.mocked(Date.now).mockReturnValue(now);
            const { service } = createTestContext();

            await expect(
                service.revokeToken('test-jti', 1_700_000_001),
            ).rejects.toBeInstanceOf(UnauthorizedException);
            expect(redisClient.set).not.toHaveBeenCalled();
        },
    );

    it('rejects an expired token', async () => {
        const { service } = createTestContext();

        await expect(
            service.revokeToken('test-jti', 1_799_999_999),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('returns 503 when Redis is not ready', async () => {
        redisClient.isReady = false;

        const { service } = createTestContext();

        await expect(
            service.revokeToken('test-jti', 1_800_000_700),
        ).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );

        expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('returns 503 when writing to Redis fails', async () => {
        redisClient.set.mockRejectedValue(
            new Error('Connection lost'),
        );

        const { service } = createTestContext();

        await expect(
            service.revokeToken('test-jti', 1_800_000_700),
        ).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });

    it('rejects an unconfirmed Redis write', async () => {
        redisClient.set.mockResolvedValue(null);

        const { service } = createTestContext();

        await expect(
            service.revokeToken('test-jti', 1_800_000_700),
        ).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });
});

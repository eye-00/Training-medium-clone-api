
import {
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

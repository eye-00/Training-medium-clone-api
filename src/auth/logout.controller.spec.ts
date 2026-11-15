
import {
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { RedisService } from '../redis/redis.service.js';
import { LogoutController } from './logout.controller.js';
import type { AuthenticatedRequest } from './types/authenticated-request.js';

const payload = {
    sub: '308fac1d-401f-4a06-b2bd-32dd50234048',
    jti: 'b5740140-c476-44c0-b860-ec523c5308dd',
    iat: 1_800_000_000,
    exp: 1_800_000_900,
};

function createTestContext() {
    const revokeToken = vi.fn().mockResolvedValue(undefined);

    const redisService = {
        revokeToken,
    } as unknown as RedisService;

    const controller = new LogoutController(redisService);

    const request = {
        headers: {
            authorization: 'Bearer valid.jwt.token',
        },
        auth: payload,
        user: {
            id: payload.sub,
            email: 'test@example.com',
            username: 'test_user',
            bio: null,
            image: null,
        },
    } as AuthenticatedRequest;

    return {
        controller,
        request,
        revokeToken,
    };
}

describe('LogoutController', () => {
    it('revokes the authenticated token', async () => {
        const { controller, request, revokeToken } =
            createTestContext();

        await expect(
            controller.logout(request),
        ).resolves.toBeUndefined();

        expect(revokeToken).toHaveBeenCalledExactlyOnceWith(
            payload.jti,
            payload.exp,
        );
    });

    it('rejects a request without auth claims', async () => {
        const { controller, request, revokeToken } =
            createTestContext();

        request.auth = undefined;

        await expect(
            controller.logout(request),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(revokeToken).not.toHaveBeenCalled();
    });

    it('propagates Redis unavailability', async () => {
        const { controller, request, revokeToken } =
            createTestContext();

        revokeToken.mockRejectedValue(
            new ServiceUnavailableException(
                'Authentication service temporarily unavailable',
            ),
        );

        await expect(
            controller.logout(request),
        ).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
    });
});

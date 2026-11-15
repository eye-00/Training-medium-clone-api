
import {
    type ExecutionContext,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';

import { RedisService } from '../../redis/redis.service.js';
import { UsersService } from '../../users/users.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const payload = {
    sub: '308fac1d-401f-4a06-b2bd-32dd50234048',
    jti: 'b5740140-c476-44c0-b860-ec523c5308dd',
    iat: 1900000000,
    exp: 1900000900,
};

const publicUser = {
    id: payload.sub,
    email: 'test@example.com',
    username: 'test_user',
    bio: null,
    image: null,
};

function createTestContext() {
    const verifyAsync = vi.fn().mockResolvedValue(payload);
    const isTokenRevoked = vi.fn().mockResolvedValue(false);
    const findPublicById = vi.fn().mockResolvedValue(publicUser);

    const jwtService = {
        verifyAsync,
    } as unknown as JwtService;

    const redisService = {
        isTokenRevoked,
    } as unknown as RedisService;

    const usersService = {
        findPublicById,
    } as unknown as UsersService;

    const guard = new JwtAuthGuard(
        jwtService,
        redisService,
        usersService,
    );

    const request = {
        headers: {
            authorization: 'Bearer valid.jwt.token',
        },
        user: undefined,
    };

    const context = {
        switchToHttp: () => ({
            getRequest: () => request,
        }),
    } as unknown as ExecutionContext;

    return {
        guard,
        context,
        request,
        verifyAsync,
        isTokenRevoked,
        findPublicById,
    };
}

describe('JwtAuthGuard', () => {
    it('allows a valid token and attaches the user', async () => {
        const {
            guard,
            context,
            request,
            verifyAsync,
            isTokenRevoked,
            findPublicById,
        } = createTestContext();

        await expect(guard.canActivate(context))
            .resolves.toBe(true);

        expect(verifyAsync).toHaveBeenCalledWith(
            'valid.jwt.token',
            { algorithms: ['HS256'] },
        );

        expect(isTokenRevoked).toHaveBeenCalledWith(payload.jti);
        expect(findPublicById).toHaveBeenCalledWith(payload.sub);
        expect(request.user).toEqual(publicUser);
    });

    it('rejects a request without a token', async () => {
        const { guard, context, request, verifyAsync } =
            createTestContext();

        request.headers.authorization = '';

        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);

        expect(verifyAsync).not.toHaveBeenCalled();
    });

    it('rejects a token with invalid signature', async () => {
        const { guard, context, verifyAsync, isTokenRevoked } =
            createTestContext();

        verifyAsync.mockRejectedValue(
            new Error('invalid signature'),
        );

        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);

        expect(isTokenRevoked).not.toHaveBeenCalled();
    });

    it('rejects an expired token', async () => {
        const { guard, context, verifyAsync } =
            createTestContext();

        verifyAsync.mockRejectedValue(
            new Error('jwt expired'),
        );

        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token missing required claims', async () => {
        const { guard, context, verifyAsync, isTokenRevoked } =
            createTestContext();

        verifyAsync.mockResolvedValue({
            sub: payload.sub,
            iat: payload.iat,
            exp: payload.exp,
        });

        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);

        expect(isTokenRevoked).not.toHaveBeenCalled();
    });

    it('rejects a revoked token', async () => {
        const { guard, context, isTokenRevoked, findPublicById } =
            createTestContext();

        isTokenRevoked.mockResolvedValue(true);

        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);

        expect(findPublicById).not.toHaveBeenCalled();
    });

    it('returns 503 when Redis is unavailable', async () => {
        const { guard, context, isTokenRevoked, findPublicById } =
            createTestContext();

        isTokenRevoked.mockRejectedValue(
            new ServiceUnavailableException(
                'Authentication service temporarily unavailable',
            ),
        );

        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(ServiceUnavailableException);

        expect(findPublicById).not.toHaveBeenCalled();
    });

    it('rejects a token whose user no longer exists', async () => {
        const { guard, context, findPublicById } =
            createTestContext();

        findPublicById.mockResolvedValue(null);

        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);
    });
});

import {
    type ExecutionContext,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';

import { RedisService } from '../../redis/redis.service.js';
import { UsersService } from '../../users/users.service.js';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard.js';

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

function createContext(authorization?: string) {
    const verifyAsync = vi.fn().mockResolvedValue(payload);
    const isTokenRevoked = vi.fn().mockResolvedValue(false);
    const findPublicById = vi.fn().mockResolvedValue(publicUser);
    const guard = new OptionalJwtAuthGuard(
        { verifyAsync } as unknown as JwtService,
        { isTokenRevoked } as unknown as RedisService,
        { findPublicById } as unknown as UsersService,
    );
    const request = { headers: { authorization }, user: undefined };
    const context = {
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { guard, context, request, verifyAsync, isTokenRevoked, findPublicById };
}

describe('OptionalJwtAuthGuard', () => {
    it('allows an absent header without authentication calls', async () => {
        const { guard, context, request, verifyAsync, isTokenRevoked, findPublicById } =
            createContext();
        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(verifyAsync).not.toHaveBeenCalled();
        expect(isTokenRevoked).not.toHaveBeenCalled();
        expect(findPublicById).not.toHaveBeenCalled();
        expect(request.user).toBeUndefined();
        expect(request).not.toHaveProperty('auth');
    });

    it.each(['', 'Basic abc', 'Bearer\ttoken'])(
        'rejects a supplied malformed header %j',
        async (header) => {
            const { guard, context, request, verifyAsync, isTokenRevoked } =
                createContext(header);
            await expect(guard.canActivate(context))
                .rejects.toBeInstanceOf(UnauthorizedException);
            expect(verifyAsync).not.toHaveBeenCalled();
            expect(isTokenRevoked).not.toHaveBeenCalled();
            expect(request.user).toBeUndefined();
            expect(request).not.toHaveProperty('auth');
        },
    );

    it.each(['invalid signature', 'jwt expired'])(
        'rejects %s', async (reason) => {
            const { guard, context, request, verifyAsync, isTokenRevoked } =
                createContext('Bearer token');
            verifyAsync.mockRejectedValue(new Error(reason));
            await expect(guard.canActivate(context))
                .rejects.toBeInstanceOf(UnauthorizedException);
            expect(isTokenRevoked).not.toHaveBeenCalled();
            expect(request.user).toBeUndefined();
            expect(request).not.toHaveProperty('auth');
        },
    );

    it('rejects a revoked token', async () => {
        const { guard, context, request, isTokenRevoked, findPublicById } =
            createContext('Bearer token');
        isTokenRevoked.mockResolvedValue(true);
        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);
        expect(findPublicById).not.toHaveBeenCalled();
        expect(request.user).toBeUndefined();
        expect(request).not.toHaveProperty('auth');
    });

    it('authenticates a valid token and attaches claims and user', async () => {
        const { guard, context, request, verifyAsync, isTokenRevoked, findPublicById } =
            createContext('bearer   token');
        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(verifyAsync).toHaveBeenCalledWith('token', { algorithms: ['HS256'] });
        expect(isTokenRevoked).toHaveBeenCalledWith(payload.jti);
        expect(findPublicById).toHaveBeenCalledWith(payload.sub);
        expect(request.user).toEqual(publicUser);
        expect(request).toHaveProperty('auth', payload);
    });

    it('propagates Redis unavailability and does not authenticate', async () => {
        const { guard, context, request, isTokenRevoked, findPublicById } =
            createContext('Bearer token');
        isTokenRevoked.mockRejectedValue(new ServiceUnavailableException());
        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(findPublicById).not.toHaveBeenCalled();
        expect(request.user).toBeUndefined();
        expect(request).not.toHaveProperty('auth');
    });

    it('rejects a token when its user no longer exists', async () => {
        const { guard, context, request, findPublicById } =
            createContext('Bearer token');
        findPublicById.mockResolvedValue(null);
        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);
        expect(request.user).toBeUndefined();
        expect(request).not.toHaveProperty('auth');
    });
});

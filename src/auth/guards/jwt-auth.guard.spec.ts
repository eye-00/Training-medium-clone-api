
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

function createTestContext(jwtServiceOverride?: JwtService) {
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
        jwtServiceOverride ?? jwtService,
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
        expect(request).toHaveProperty('auth', payload);
    });

    it.each(['bearer', 'BEARER', 'BeArEr'])(
        'accepts the case-insensitive %s authentication scheme',
        async (scheme) => {
            const { guard, context, request, verifyAsync } =
                createTestContext();
            request.headers.authorization = `${scheme} valid.jwt.token`;

            await expect(guard.canActivate(context)).resolves.toBe(true);
            expect(verifyAsync).toHaveBeenCalledWith(
                'valid.jwt.token',
                { algorithms: ['HS256'] },
            );
        },
    );

    it('accepts multiple ASCII spaces after the scheme', async () => {
        const { guard, context, request, verifyAsync } = createTestContext();
        request.headers.authorization = 'Bearer   valid.jwt.token';
        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(verifyAsync).toHaveBeenCalledWith('valid.jwt.token', {
            algorithms: ['HS256'],
        });
    });

    it.each([
        'Bearer',
        'Basic valid.jwt.token',
        'Bearer\tvalid.jwt.token',
        ' Bearer valid.jwt.token',
        'Bearer valid.jwt.token trailing',
        'Bearer valid.jwt.token\n',
        'Bearer valid.jwt.token ',
    ])('rejects malformed authorization header %j', async (header) => {
        const { guard, context, request, verifyAsync, isTokenRevoked } =
            createTestContext();
        request.headers.authorization = header;

        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);
        expect(verifyAsync).not.toHaveBeenCalled();
        expect(isTokenRevoked).not.toHaveBeenCalled();
        expect(request.user).toBeUndefined();
        expect(request).not.toHaveProperty('auth');
    });

    it('rejects a non-string authorization header', async () => {
        const { guard, context, request, verifyAsync } = createTestContext();
        request.headers.authorization = ['Bearer valid.jwt.token'] as unknown as string;
        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);
        expect(verifyAsync).not.toHaveBeenCalled();
    });

    it('rejects an absent authorization header', async () => {
        const { guard, context, request, verifyAsync, isTokenRevoked } =
            createTestContext();
        request.headers.authorization = undefined as unknown as string;
        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);
        expect(verifyAsync).not.toHaveBeenCalled();
        expect(isTokenRevoked).not.toHaveBeenCalled();
        expect(request.user).toBeUndefined();
        expect(request).not.toHaveProperty('auth');
    });

    it.each([
        { name: 'null payload', claims: null },
        { name: 'string payload', claims: 'invalid' },
        { name: 'invalid subject UUID', claims: { ...payload, sub: 'invalid' } },
        { name: 'invalid token ID UUID', claims: { ...payload, jti: 'invalid' } },
        { name: 'non-v4 subject UUID', claims: { ...payload, sub: '308fac1d-401f-1a06-b2bd-32dd50234048' } },
        { name: 'string issued-at', claims: { ...payload, iat: '1900000000' } },
        { name: 'fractional issued-at', claims: { ...payload, iat: 1.5 } },
        { name: 'unsafe issued-at', claims: { ...payload, iat: Number.MAX_SAFE_INTEGER + 1 } },
        { name: 'string expiration', claims: { ...payload, exp: '1900000900' } },
        { name: 'fractional expiration', claims: { ...payload, exp: 1900000900.5 } },
        { name: 'unsafe expiration', claims: { ...payload, exp: Number.MAX_SAFE_INTEGER + 1 } },
        { name: 'expiration equal to issued-at', claims: { ...payload, exp: payload.iat } },
        { name: 'expiration before issued-at', claims: { ...payload, exp: payload.iat - 1 } },
    ])('rejects $name before Redis or user lookup', async ({ claims }) => {
        const { guard, context, request, verifyAsync, isTokenRevoked, findPublicById } =
            createTestContext();
        verifyAsync.mockResolvedValue(claims);

        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);
        expect(isTokenRevoked).not.toHaveBeenCalled();
        expect(findPublicById).not.toHaveBeenCalled();
        expect(request.user).toBeUndefined();
        expect(request).not.toHaveProperty('auth');
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

    it('accepts a real HS256 JWT with a 900-second TTL', async () => {
        const jwtService = new JwtService({
            secret: 'unit-test-only-secret-not-for-production',
        });
        const token = await jwtService.signAsync(
            { sub: payload.sub, jti: payload.jti },
            { algorithm: 'HS256', expiresIn: 900 },
        );
        const { guard, context, request, isTokenRevoked, findPublicById } =
            createTestContext(jwtService);
        request.headers.authorization = `Bearer ${token}`;

        await expect(guard.canActivate(context)).resolves.toBe(true);
        const claims = (request as unknown as { auth: { iat: number; exp: number } }).auth;
        expect(claims.exp - claims.iat).toBe(900);
        expect(isTokenRevoked).toHaveBeenCalledWith(payload.jti);
        expect(findPublicById).toHaveBeenCalledWith(payload.sub);
        expect(request.user).toEqual(publicUser);
    });

    it('rejects a real expired HS256 JWT', async () => {
        const jwtService = new JwtService({
            secret: 'unit-test-only-secret-not-for-production',
        });
        const token = await jwtService.signAsync(
            { sub: payload.sub, jti: payload.jti, iat: Math.floor(Date.now() / 1000) - 901 },
            { algorithm: 'HS256', expiresIn: 900 },
        );
        const { guard, context, request, isTokenRevoked, findPublicById } =
            createTestContext(jwtService);
        request.headers.authorization = `Bearer ${token}`;

        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);
        expect(isTokenRevoked).not.toHaveBeenCalled();
        expect(findPublicById).not.toHaveBeenCalled();
        expect(request.user).toBeUndefined();
        expect(request).not.toHaveProperty('auth');
    });

    it('rejects a real JWT signed with HS384', async () => {
        const jwtService = new JwtService({
            secret: 'unit-test-only-secret-not-for-production',
        });
        const token = await jwtService.signAsync(payload, {
            algorithm: 'HS384',
        });
        const { guard, context, request, isTokenRevoked, findPublicById } =
            createTestContext(jwtService);
        request.headers.authorization = `Bearer ${token}`;

        await expect(guard.canActivate(context))
            .rejects.toBeInstanceOf(UnauthorizedException);
        expect(isTokenRevoked).not.toHaveBeenCalled();
        expect(findPublicById).not.toHaveBeenCalled();
        expect(request.user).toBeUndefined();
        expect(request).not.toHaveProperty('auth');
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

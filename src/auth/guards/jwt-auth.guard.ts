import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';

import { RedisService } from '../../redis/redis.service.js';
import { UsersService } from '../../users/users.service.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';
import type { JwtAccessPayload } from '../types/jwt-access-payload.js';

function isJwtAccessPayload(
    value: unknown,
): value is JwtAccessPayload {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const claims = value as Record<string, unknown>;

    return (
        typeof claims.sub === 'string' &&
        isUUID(claims.sub, '4') &&
        typeof claims.jti === 'string' &&
        isUUID(claims.jti, '4') &&
        typeof claims.iat === 'number' &&
        Number.isSafeInteger(claims.iat) &&
        typeof claims.exp === 'number' &&
        Number.isSafeInteger(claims.exp) &&
        claims.exp > claims.iat
    );
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly redisService: RedisService,
        private readonly usersService: UsersService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();

        const authorization = request.headers.authorization;

        const match = /^Bearer ([^\s]+)$/.exec(
            authorization ?? '',
        );

        const token = match?.[1];

        if (!token) {
            throw new UnauthorizedException(
                'Missing or invalid access token',
            );
        }

        let payload: unknown;

        try {
            payload = await this.jwtService.verifyAsync(token, {
                algorithms: ['HS256'],
            });
        } catch {
            throw new UnauthorizedException(
                'Invalid or expired access token',
            );
        }

        if (!isJwtAccessPayload(payload)) {
            throw new UnauthorizedException(
                'Invalid access token payload',
            );
        }

        const isRevoked = await this.redisService.isTokenRevoked(
            payload.jti,
        );

        if (isRevoked) {
            throw new UnauthorizedException(
                'Invalid or revoked access token',
            );
        }

        const user = await this.usersService.findPublicById(
            payload.sub,
        );

        if (!user) {
            throw new UnauthorizedException(
                'Invalid or expired access token',
            );
        }

        request.user = user;
        request.auth = payload;

        return true;
    }
}
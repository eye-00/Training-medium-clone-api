
import {
    ExecutionContext,
    Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { RedisService } from '../../redis/redis.service.js';
import { UsersService } from '../../users/users.service.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
    constructor(
        jwtService: JwtService,
        redisService: RedisService,
        usersService: UsersService,
    ) {
        super(jwtService, redisService, usersService);
    }

    override async canActivate(
        context: ExecutionContext,
    ): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>();

        // No Authorization header: public access.
        if (request.headers.authorization === undefined) {
            return true;
        }

        // Authorization was supplied:
        // validate it using the original JWT guard.
        return super.canActivate(context);
    }
}


import {
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    Req,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiNoContentResponse,
    ApiServiceUnavailableResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { RedisService } from '../redis/redis.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from './types/authenticated-request.js';

@ApiTags('Authentication')
@Controller('users')
export class LogoutController {
    constructor(
        private readonly redisService: RedisService,
    ) { }

    @Post('logout')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiNoContentResponse({
        description: 'Successfully logged out',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing, invalid or revoked token',
    })
    @ApiServiceUnavailableResponse({
        description: 'Token revocation service unavailable',
    })
    async logout(
        @Req() request: AuthenticatedRequest,
    ): Promise<void> {
        if (!request.auth) {
            throw new UnauthorizedException(
                'Unauthenticated request',
            );
        }

        await this.redisService.revokeToken(
            request.auth.jti,
            request.auth.exp,
        );
    }
}

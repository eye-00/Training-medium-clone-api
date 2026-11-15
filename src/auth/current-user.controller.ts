
import {
    Controller,
    Get,
    Req,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOkResponse,
    ApiServiceUnavailableResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { RegisterResponseDto } from '../users/dto/register-response.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from './types/authenticated-request.js';

@ApiTags('Authentication')
@Controller('user')
export class CurrentUserController {
    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOkResponse({ type: RegisterResponseDto })
    @ApiUnauthorizedResponse({
        description: 'Missing, invalid or revoked access token',
    })
    @ApiServiceUnavailableResponse({
        description: 'Redis blacklist check is unavailable',
    })

    getCurrentUser(
        @Req() request: AuthenticatedRequest,
    ): RegisterResponseDto {
        if (!request.user) {
            throw new UnauthorizedException(
                'Unauthenticated request',
            );
        }

        return {
            user: request.user,
        };
    }

}

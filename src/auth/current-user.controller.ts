
import {
    Body,
    Controller,
    Get,
    Put,
    Req,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiNotFoundResponse,
    ApiBearerAuth,
    ApiOkResponse,
    ApiServiceUnavailableResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { UpdateUserDto } from '../users/dto/update-user.dto.js';
import { UsersService } from '../users/users.service.js';
import { RegisterResponseDto } from '../users/dto/register-response.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from './types/authenticated-request.js';

@ApiTags('Authentication')
@Controller('user')
export class CurrentUserController {
    constructor(
        private readonly usersService: UsersService,
    ) { }
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
    @Put()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOkResponse({ type: RegisterResponseDto })
    @ApiBadRequestResponse({
        description: 'Invalid or empty update request',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing, invalid or revoked access token',
    })
    @ApiConflictResponse({
        description: 'Username already exists',
    })
    @ApiNotFoundResponse({
        description: 'User not found',
    })
    @ApiServiceUnavailableResponse({
        description: 'Redis blacklist check is unavailable',
    })
    async updateCurrentUser(
        @Req() request: AuthenticatedRequest,
        @Body() dto: UpdateUserDto,
    ): Promise<RegisterResponseDto> {
        if (!request.user) {
            throw new UnauthorizedException(
                'Unauthenticated request',
            );
        }

        const updatedUser =
            await this.usersService.updateProfile(
                request.user.id,
                dto,
            );

        return {
            user: updatedUser,
        };
    }
}

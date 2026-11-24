import {
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';

import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiConflictResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiParam,
    ApiServiceUnavailableResponse,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtAuthenticatedRequest } from '../auth/types/authenticated-request.js';

import { ProfileResponseDto } from './dto/profile-response.dto.js';
import { FollowsService } from './follows.service.js';
import { ProfilesService } from './profiles.service.js';

@ApiTags('Profiles')
@Controller('profiles')
export class ProfilesController {
    constructor(
        private readonly profilesService: ProfilesService,
        private readonly followsService: FollowsService,
    ) { }

    @Get(':username')
    @ApiParam({
        name: 'username',
        description: 'Username of the profile owner',
    })
    @ApiOkResponse({ type: ProfileResponseDto })
    @ApiNotFoundResponse({
        description: 'Profile not found',
    })
    async getProfile(
        @Param('username') username: string,
    ): Promise<ProfileResponseDto> {
        return this.profilesService.getProfile(username);
    }

    @Post(':username/follow')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiParam({ name: 'username' })
    @ApiOkResponse({
        description: 'User followed successfully',
    })
    @ApiBadRequestResponse({
        description: 'Cannot follow yourself',
    })
    @ApiUnauthorizedResponse({
        description: 'Invalid or missing access token',
    })
    @ApiNotFoundResponse({
        description: 'Profile not found',
    })
    @ApiConflictResponse({
        description: 'Already following this user',
    })
    @ApiServiceUnavailableResponse({
        description: 'Redis blacklist check is unavailable',
    })
    async follow(
        @Param('username') username: string,
        @Req() request: JwtAuthenticatedRequest,
    ): Promise<void> {

        await this.followsService.follow(
            request.user.id,
            username,
        );
    }

    @Delete(':username/follow')
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiParam({ name: 'username' })
    @ApiNoContentResponse({
        description: 'User unfollowed successfully',
    })
    @ApiBadRequestResponse({
        description: 'Cannot unfollow yourself',
    })
    @ApiUnauthorizedResponse({
        description: 'Invalid or missing access token',
    })
    @ApiNotFoundResponse({
        description: 'Profile not found',
    })
    @ApiServiceUnavailableResponse({
        description: 'Redis blacklist check is unavailable',
    })
    async unfollow(
        @Param('username') username: string,
        @Req() request: JwtAuthenticatedRequest,
    ): Promise<void> {

        await this.followsService.unfollow(
            request.user.id,
            username,
        );
    }
}

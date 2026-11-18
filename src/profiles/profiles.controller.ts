import {
    Controller,
    Get,
    Param,
} from '@nestjs/common';

import {
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';

import { ProfilesService } from './profiles.service.js';
import { ProfileResponseDto } from './dto/profile-response.dto.js';

@ApiTags('Profiles')
@Controller('profiles')
export class ProfilesController {
    constructor(
        private readonly profilesService: ProfilesService,
    ) { }

    @Get(':username')
    @ApiParam({
        name: 'username',
        description: 'Username of the profile owner',
    })
    @ApiOkResponse({
        type: ProfileResponseDto,
    })
    @ApiNotFoundResponse({
        description: 'Profile not found',
    })
    async getProfile(
        @Param('username') username: string,
    ): Promise<ProfileResponseDto> {
        return this.profilesService.getProfile(username);
    }
}

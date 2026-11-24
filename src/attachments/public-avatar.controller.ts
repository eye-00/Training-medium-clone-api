
import {
    Controller,
    Get,
    Header,
    Param,
    StreamableFile,
} from '@nestjs/common';

import {
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiParam,
    ApiProduces,
    ApiTags,
} from '@nestjs/swagger';

import { AvatarService } from './avatar.service.js';

@ApiTags('Avatars')
@Controller('avatars')
export class PublicAvatarController {
    constructor(
        private readonly avatarService: AvatarService,
    ) { }

    @Get(':id')
    @Header('Content-Type', 'image/webp')
    @Header('Cache-Control', 'public, max-age=60')
    @Header('X-Content-Type-Options', 'nosniff')
    @ApiParam({
        name: 'id',
        description: 'Public avatar attachment UUID',
    })
    @ApiProduces('image/webp')
    @ApiOkResponse({
        description: 'Avatar image',
        content: {
            'image/webp': {
                schema: {
                    type: 'string',
                    format: 'binary',
                },
            },
        },
    })
    @ApiNotFoundResponse({
        description: 'Avatar not found',
    })
    async getAvatar(
        @Param('id') id: string,
    ): Promise<StreamableFile> {
        const image =
            await this.avatarService.getPublicAvatar(id);

        return new StreamableFile(image);
    }
}

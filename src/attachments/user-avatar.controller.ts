import {
    BadRequestException,
    Controller,
    Post,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
    Delete,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiConsumes,
    ApiCreatedResponse,
    ApiResponse,
    ApiServiceUnavailableResponse,
    ApiTags,
    ApiUnauthorizedResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtAuthenticatedRequest } from '../auth/types/authenticated-request.js';
import { AvatarService } from './avatar.service.js';
import { MAX_AVATAR_FILE_BYTES } from './constants.js';
interface UploadedAvatarFile {
    buffer: Buffer;
    originalname: string;
}

@ApiTags('Avatars')
@Controller('user/avatar')
export class UserAvatarController {
    constructor(
        private readonly avatarService: AvatarService,
    ) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: {
                fileSize: MAX_AVATAR_FILE_BYTES,
                files: 1,
            },
        }),
    )
    @ApiBearerAuth()
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['file'],
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                },
            },
        },
    })
    @ApiCreatedResponse({
        description: 'Avatar uploaded successfully',
        schema: {
            type: 'object',
            properties: {
                image: {
                    type: 'string',
                    example:
                        '/api/avatars/11111111-1111-4111-8111-111111111111',
                },
            },
        },
    })
    @ApiBadRequestResponse({
        description: 'Missing or invalid image',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing or invalid access token',
    })
    @ApiResponse({
        status: 413,
        description: 'File exceeds the 2 MB limit',
    })
    @ApiServiceUnavailableResponse({
        description: 'Redis blacklist check is unavailable',
    })
    async uploadAvatar(
        @Req() request: JwtAuthenticatedRequest,
        @UploadedFile() file: UploadedAvatarFile | undefined,
    ): Promise<{ image: string }> {

        if (!file) {
            throw new BadRequestException(
                'Image file is required',
            );
        }

        return this.avatarService.uploadAvatar(
            request.user.id,
            file,
        );
    }

    @Delete()
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiNoContentResponse({
        description: 'Avatar removed successfully',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing or invalid access token',
    })
    @ApiNotFoundResponse({
        description: 'User not found',
    })
    @ApiServiceUnavailableResponse({
        description: 'Redis blacklist check is unavailable',
    })
    async deleteAvatar(
        @Req() request: JwtAuthenticatedRequest,
    ): Promise<void> {

        await this.avatarService.deleteAvatar(
            request.user.id,
        );
    }

}

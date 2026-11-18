import {
    BadRequestException,
    Controller,
    Post,
    Req,
    UnauthorizedException,
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
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.js';
import { AvatarService } from './avatar.service.js';

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
                fileSize: 2 * 1024 * 1024,
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
        @Req() request: AuthenticatedRequest,
        @UploadedFile() file: UploadedAvatarFile | undefined,
    ): Promise<{ image: string }> {
        if (!request.user) {
            throw new UnauthorizedException(
                'Unauthenticated request',
            );
        }

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
        @Req() request: AuthenticatedRequest,
    ): Promise<void> {
        if (!request.user) {
            throw new UnauthorizedException(
                'Unauthenticated request',
            );
        }

        await this.avatarService.deleteAvatar(
            request.user.id,
        );
    }

}

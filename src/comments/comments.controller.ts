import {
    Body,
    Controller,
    Param,
    Post,
    Req,
    UseGuards,
    Get,
    Delete,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';

import {
    ApiBearerAuth,
    ApiBadRequestResponse,
    ApiCreatedResponse,
    ApiNotFoundResponse,
    ApiUnauthorizedResponse,
    ApiTags,
    ApiOkResponse,
    ApiForbiddenResponse,
    ApiNoContentResponse,
    ApiParam,
    ApiOperation,
    ApiServiceUnavailableResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import type {
    JwtAuthenticatedRequest,
} from '../auth/types/authenticated-request.js';

import { CommentsService } from './comments.service.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';
import { CommentResponseDto } from './dto/comment-response.dto.js';
import {
    OptionalJwtAuthGuard,
} from '../auth/guards/optional-jwt-auth.guard.js';

import type {
    AuthenticatedRequest,
} from '../auth/types/authenticated-request.js';

import {
    CommentsResponseDto,
} from './dto/comments-response.dto.js';
import { CommentIdPipe } from './pipes/comment-id.pipe.js';

@ApiTags('Comments')
@ApiServiceUnavailableResponse({ description: 'Token revocation check is unavailable when authentication is required or supplied.' })
@Controller('articles/:slug/comments')
export class CommentsController {
    constructor(
        private readonly commentsService: CommentsService,
    ) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiCreatedResponse({
        type: CommentResponseDto,
        description: 'Comment created successfully',
    })
    @ApiBadRequestResponse({
        description: 'Invalid comment data',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing or invalid access token',
    })
    @ApiNotFoundResponse({
        description: 'Article not found',
    })
    create(
        @Param('slug') slug: string,
        @Req() request: JwtAuthenticatedRequest,
        @Body() dto: CreateCommentDto,
    ): Promise<CommentResponseDto> {
        return this.commentsService.create(
            slug,
            request.user.id,
            dto,
        );
    }

    @Get()
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({
        summary: 'Get comments for an article',
        description:
            'Authentication is optional. When authenticated, ' +
            'author.following is personalized for the current user.',
        security: [
            {},
            { bearer: [] },
        ],
    })
    @ApiOkResponse({
        type: CommentsResponseDto,
        description: 'Article comments',
    })
    @ApiNotFoundResponse({
        description: 'Article not found',
    })
    @ApiUnauthorizedResponse({
        description: 'Invalid or expired access token',
    })
    findAll(
        @Param('slug') slug: string,
        @Req() request: AuthenticatedRequest,
    ): Promise<CommentsResponseDto> {
        return this.commentsService.findAll(
            slug,
            request.user?.id,
        );
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiParam({
        name: 'id',
        required: true,
        description: 'Positive unsigned integer comment ID',
        schema: {
            type: 'integer',
            minimum: 1,
            maximum: 4294967295,
            example: 1,
        },
    })
    @ApiNoContentResponse({
        description: 'Comment deleted successfully',
    })
    @ApiBadRequestResponse({
        description: 'Invalid comment ID',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing or invalid access token',
    })
    @ApiForbiddenResponse({
        description: 'Only the comment author can delete it',
    })
    @ApiNotFoundResponse({
        description: 'Article or comment not found',
    })
    async delete(
        @Param('slug') slug: string,
        @Param('id', CommentIdPipe) commentId: unknown,
        @Req() request: JwtAuthenticatedRequest,
    ): Promise<void> {
        await this.commentsService.delete(
            slug,
            commentId as number,
            request.user.id,
        );
    }

}

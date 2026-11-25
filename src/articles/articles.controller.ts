
import {
    Body,
    Controller,
    Post,
    Req,
    UseGuards,
    Get,
    Param,
    Put,
    Delete,
    HttpCode,
    HttpStatus,
    Query,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiBadRequestResponse,
    ApiCreatedResponse,
    ApiTags,
    ApiUnauthorizedResponse,
    ApiOkResponse,
    ApiNotFoundResponse,
    ApiForbiddenResponse,
    ApiNoContentResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtAuthenticatedRequest, AuthenticatedRequest } from '../auth/types/authenticated-request.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';


import { ArticlesService } from './articles.service.js';
import { CreateArticleDto } from './dto/create-article.dto.js';
import { ArticleResponseDto } from './dto/article-response.dto.js';
import { UpdateArticleDto } from './dto/update-article.dto.js';
import { ListArticlesQueryDto } from './dto/list-articles-query.dto.js';
import { ArticlesResponseDto } from './dto/articles-response.dto.js';
import { FeedArticlesQueryDto } from './dto/feed-articles-query.dto.js';
@ApiTags('Articles')
@Controller('articles')
export class ArticlesController {
    constructor(
        private readonly articlesService: ArticlesService,
    ) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiCreatedResponse({ type: ArticleResponseDto })
    @ApiBadRequestResponse({
        description: 'Invalid article data',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing or invalid access token',
    })
    create(
        @Req() request: JwtAuthenticatedRequest,
        @Body() dto: CreateArticleDto,
    ): Promise<ArticleResponseDto> {
        return this.articlesService.create(request.user, dto);
    }


    @Get()
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOkResponse({
        type: ArticlesResponseDto,
        description: 'Paginated article list',
    })
    @ApiBadRequestResponse({
        description: 'Invalid query parameters',
    })
    @ApiUnauthorizedResponse({
        description: 'Invalid or expired access token',
    })
    findAll(
        @Query() filters: ListArticlesQueryDto,
        @Req() request: AuthenticatedRequest,
    ): Promise<ArticlesResponseDto> {
        return this.articlesService.findAll(
            filters,
            request.user?.id,
        );
    }
    @Get('feed')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOkResponse({
        type: ArticlesResponseDto,
        description: 'Personalized article feed',
    })
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing or invalid access token',
    })
    getFeed(
        @Query() filters: FeedArticlesQueryDto,
        @Req() request: JwtAuthenticatedRequest,
    ): Promise<ArticlesResponseDto> {
        return this.articlesService.getFeed(
            request.user.id,
            filters,
        );
    }

    @Get(':slug')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOkResponse({
        type: ArticleResponseDto,
        description: 'Article details',
    })
    @ApiNotFoundResponse({
        description: 'Article not found',
    })
    @ApiUnauthorizedResponse({
        description: 'Invalid or expired access token',
    })
    findOne(
        @Param('slug') slug: string,
        @Req() request: AuthenticatedRequest,
    ): Promise<ArticleResponseDto> {
        return this.articlesService.findOne(
            slug,
            request.user?.id,
        );
    }

    @Put(':slug')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOkResponse({
        type: ArticleResponseDto,
        description: 'Article updated successfully',
    })
    @ApiBadRequestResponse({
        description: 'Invalid update data',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing or invalid access token',
    })
    @ApiForbiddenResponse({
        description: 'Only the author can update this article',
    })
    @ApiNotFoundResponse({
        description: 'Article not found',
    })
    update(
        @Param('slug') slug: string,
        @Req() request: JwtAuthenticatedRequest,
        @Body() dto: UpdateArticleDto,
    ): Promise<ArticleResponseDto> {
        return this.articlesService.update(
            slug,
            request.user.id,
            dto,
        );
    }

    @Delete(':slug')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @ApiNoContentResponse({
        description: 'Article deleted successfully',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing or invalid access token',
    })
    @ApiForbiddenResponse({
        description: 'Only the author can delete this article',
    })
    @ApiNotFoundResponse({
        description: 'Article not found',
    })
    async delete(
        @Param('slug') slug: string,
        @Req() request: JwtAuthenticatedRequest,
    ): Promise<void> {
        await this.articlesService.delete(
            slug,
            request.user.id,
        );
    }


    @Post(':slug/favorite')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @ApiOkResponse({
        type: ArticleResponseDto,
        description: 'Article favorited successfully',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing or invalid access token',
    })
    @ApiNotFoundResponse({
        description: 'Article not found',
    })
    favorite(
        @Param('slug') slug: string,
        @Req() request: JwtAuthenticatedRequest,
    ): Promise<ArticleResponseDto> {
        return this.articlesService.favorite(
            slug,
            request.user.id,
        );
    }

    @Delete(':slug/favorite')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @ApiOkResponse({
        type: ArticleResponseDto,
        description: 'Article unfavorited successfully',
    })
    @ApiUnauthorizedResponse({
        description: 'Missing or invalid access token',
    })
    @ApiNotFoundResponse({
        description: 'Article not found',
    })
    unfavorite(
        @Param('slug') slug: string,
        @Req() request: JwtAuthenticatedRequest,
    ): Promise<ArticleResponseDto> {
        return this.articlesService.unfavorite(
            slug,
            request.user.id,
        );
    }




}

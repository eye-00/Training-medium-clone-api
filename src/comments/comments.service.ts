import {
    Injectable,
    NotFoundException,
    UnauthorizedException,
    InternalServerErrorException,
    ForbiddenException,
} from '@nestjs/common';
import { DataSource, In, QueryFailedError } from 'typeorm';
import { Article } from '../articles/entities/article.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Comment } from './entities/comment.entity.js';

import { toAvatarUrl } from '../attachments/avatar-url.js';

import type { CreateCommentDto } from './dto/create-comment.dto.js';

import type {
    CommentDetailsDto,
    CommentResponseDto,
} from './dto/comment-response.dto.js';

import { Follow } from '../profiles/entities/follow.entity.js';

import type {
    CommentsResponseDto,
} from './dto/comments-response.dto.js';

@Injectable()
export class CommentsService {
    constructor(
        private readonly dataSource: DataSource,
    ) { }

    async create(
        slug: string,
        userId: string,
        dto: CreateCommentDto,
    ): Promise<CommentResponseDto> {
        return this.retryOnDeadlock(() => this.dataSource.transaction(
            'READ COMMITTED',
            async (manager) => {
                const article = await manager
                    .getRepository(Article)
                    .createQueryBuilder('article')
                    .setLock('pessimistic_read')
                    .where('article.slug = :slug', { slug })
                    .getOne();

                if (!article) {
                    throw new NotFoundException(
                        'Article not found',
                    );
                }

                const author = await manager
                    .getRepository(User)
                    .createQueryBuilder('user')
                    .setLock('pessimistic_read')
                    .where('user.id = :userId', { userId })
                    .getOne();

                if (!author) {
                    throw new UnauthorizedException(
                        'User not found',
                    );
                }

                const commentsRepository =
                    manager.getRepository(Comment);

                const created = await commentsRepository.save({
                    articleId: article.id,
                    authorId: userId,
                    body: dto.comment.body,
                });

                const storedComment =
                    await commentsRepository.findOneByOrFail({
                        id: created.id,
                    });

                return {
                    comment: this.toCommentDetails(
                        storedComment,
                        author,
                        false,
                    ),
                };
            },
        ));
    }

    async findAll(
        slug: string,
        viewerId?: string,
    ): Promise<CommentsResponseDto> {
        return this.dataSource.transaction(
            'REPEATABLE READ',
            async (manager) => {
                const article = await manager
                    .getRepository(Article)
                    .findOneBy({ slug });

                if (!article) {
                    throw new NotFoundException(
                        'Article not found',
                    );
                }

                const comments = await manager
                    .getRepository(Comment)
                    .find({
                        where: {
                            articleId: article.id,
                        },
                        order: {
                            createdAt: 'DESC',
                            id: 'DESC',
                        },
                    });

                // Avoid unnecessary queries for empty articles.
                if (comments.length === 0) {
                    return { comments: [] };
                }

                // Deduplicate author IDs before batch loading.
                const authorIds = [
                    ...new Set(
                        comments.map(
                            (comment) => comment.authorId,
                        ),
                    ),
                ];

                const authors = await manager
                    .getRepository(User)
                    .findBy({
                        id: In(authorIds),
                    });

                const authorsById = new Map(
                    authors.map((author) => [
                        author.id,
                        author,
                    ]),
                );

                // Load viewer-specific follow relationships.
                const follows = viewerId
                    ? await manager
                        .getRepository(Follow)
                        .findBy({
                            followerId: viewerId,
                            followedId: In(authorIds),
                        })
                    : [];

                const followedIds = new Set(
                    follows.map(
                        (follow) => follow.followedId,
                    ),
                );

                return {
                    comments: comments.map((comment) => {
                        const author = authorsById.get(
                            comment.authorId,
                        );

                        if (!author) {
                            throw new InternalServerErrorException(
                                'Comment author not found',
                            );
                        }

                        const following =
                            viewerId !== undefined &&
                            viewerId !== author.id &&
                            followedIds.has(author.id);

                        return this.toCommentDetails(
                            comment,
                            author,
                            following,
                        );
                    }),
                };
            },
        );
    }

    async delete(
        slug: string,
        commentId: number,
        userId: string,
    ): Promise<void> {
        await this.retryOnDeadlock(() => this.dataSource.transaction(
            'READ COMMITTED',
            async (manager) => {
                const article = await manager
                    .getRepository(Article)
                    .createQueryBuilder('article')
                    .setLock('pessimistic_read')
                    .where('article.slug = :slug', { slug })
                    .getOne();

                if (!article) {
                    throw new NotFoundException(
                        'Article not found',
                    );
                }

                const commentsRepository =
                    manager.getRepository(Comment);

                const comment = await commentsRepository
                    .createQueryBuilder('comment')
                    .setLock('pessimistic_write')
                    .where('comment.id = :commentId', {
                        commentId,
                    })
                    .andWhere(
                        'comment.article_id = :articleId',
                        { articleId: article.id },
                    )
                    .getOne();

                if (!comment) {
                    throw new NotFoundException(
                        'Comment not found',
                    );
                }

                if (comment.authorId !== userId) {
                    throw new ForbiddenException(
                        'You can only delete your own comments',
                    );
                }

                await commentsRepository.delete({
                    id: comment.id,
                    articleId: article.id,
                    authorId: userId,
                });
            },
        ));
    }


    private toCommentDetails(
        comment: Comment,
        author: User,
        following: boolean,
    ): CommentDetailsDto {
        return {
            id: comment.id,
            createdAt: comment.createdAt.toISOString(),
            updatedAt: comment.updatedAt.toISOString(),
            body: comment.body,
            author: {
                username: author.username,
                bio: author.bio,
                image: toAvatarUrl(author.image),
                following,
            },
        };
    }

    private async retryOnDeadlock<T>(
        operation: () => Promise<T>,
    ): Promise<T> {
        const maxAttempts = 3;

        for (let attempt = 1; ; attempt++) {
            try {
                return await operation();
            } catch (error: unknown) {
                const driverError =
                    error instanceof QueryFailedError
                        ? (error.driverError as {
                            code?: string;
                            errno?: number;
                        })
                        : null;

                const isDeadlock =
                    driverError?.code === 'ER_LOCK_DEADLOCK' ||
                    driverError?.errno === 1213;

                if (!isDeadlock || attempt >= maxAttempts) {
                    throw error;
                }

                const delayMs =
                    attempt * 30 +
                    Math.floor(Math.random() * 30);

                await new Promise<void>((resolve) => {
                    setTimeout(resolve, delayMs);
                });
            }
        }
    }

}

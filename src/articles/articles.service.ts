
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, In, EntityManager } from 'typeorm';

import { retryOnDeadlock } from '../database/utils/retry-on-deadlock.js';

import type { PublicUserDto } from '../users/dto/register-response.dto.js';
import { Article } from './entities/article.entity.js';
import { Tag } from './entities/tag.entity.js';
import { ArticleTag } from './entities/article-tag.entity.js';
import type { CreateArticleDto } from './dto/create-article.dto.js';
import type { ArticleResponseDto } from './dto/article-response.dto.js';
import type { UpdateArticleDto } from './dto/update-article.dto.js';

import { User } from '../users/entities/user.entity.js';
import { Follow } from '../profiles/entities/follow.entity.js';
import { toAvatarUrl } from '../attachments/avatar-url.js';
import { ArticleFavorite } from './entities/article-favorite.entity.js';
import type { ListArticlesQueryDto } from './dto/list-articles-query.dto.js';
import type { FeedArticlesQueryDto } from './dto/feed-articles-query.dto.js';
import type { TagsResponseDto } from './dto/tags-response.dto.js';

import type {
    ArticleListItemDto,
    ArticlesResponseDto,
} from './dto/articles-response.dto.js';

function generateSlug(title: string, id: string): string {
    const base = title
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 180)
        // A UTF-16 slice can cut a supplementary letter in half.
        .replace(/[\uD800-\uDBFF]$/, '')
        .replace(/-+$/g, '');

    return `${base || 'article'}-${id}`;
}

function assertTitleFitsStorage(title: string): void {
    if (Array.from(title).length > 255) {
        throw new BadRequestException('Article title must not exceed 255 characters');
    }
}

@Injectable()
export class ArticlesService {
    constructor(
        private readonly dataSource: DataSource,
    ) { }

    async create(
        user: PublicUserDto,
        dto: CreateArticleDto,
    ): Promise<ArticleResponseDto> {
        const input = dto.article;
        assertTitleFitsStorage(input.title);
        const tagNames = this.normalizeTagNames(input.tagList ?? []);
        const articleId = randomUUID();
        const slug = generateSlug(input.title, articleId);


        return retryOnDeadlock(() => this.dataSource.transaction('READ COMMITTED', async (manager) => {
            const articlesRepository = manager.getRepository(Article);

            await articlesRepository.insert({
                id: articleId,
                slug,
                title: input.title,
                description: input.description,
                body: input.body,
                authorId: user.id,
            });


            await this.replaceArticleTags(
                manager,
                articleId,
                tagNames,
            );

            // Build the response from persisted database data.
            return this.findOne(
                slug,
                user.id,
                manager,
            );

        }));

    }


    async findOne(
        slug: string,
        viewerId?: string,
        manager: EntityManager = this.dataSource.manager,
    ): Promise<ArticleResponseDto> {
        const article = await manager
            .getRepository(Article)
            .findOneBy({ slug });

        if (!article) {
            throw new NotFoundException('Article not found');
        }

        // All queries must use the supplied EntityManager.
        const author = await manager
            .getRepository(User)
            .findOneBy({
                id: article.authorId,
            });

        if (!author) {
            throw new NotFoundException(
                'Article author not found',
            );
        }

        const tagLinks = await manager
            .getRepository(ArticleTag)
            .findBy({
                articleId: article.id,
            });

        const tagIds = tagLinks.map(
            (link) => link.tagId,
        );

        const tags = tagIds.length > 0
            ? await manager.getRepository(Tag).findBy({
                id: In(tagIds),
            })
            : [];

        const favoritesRepository =
            manager.getRepository(ArticleFavorite);

        const favoritesCount =
            await favoritesRepository.countBy({
                articleId: article.id,
            });

        const favorited = viewerId
            ? await favoritesRepository.existsBy({
                articleId: article.id,
                userId: viewerId,
            })
            : false;

        const following = viewerId
            ? await manager.getRepository(Follow).existsBy({
                followerId: viewerId,
                followedId: article.authorId,
            })
            : false;

        return {
            article: {
                slug: article.slug,
                title: article.title,
                description: article.description,
                body: article.body,

                tagList: tags
                    .map((tag) => tag.name)
                    .sort(),

                createdAt: article.createdAt.toISOString(),
                updatedAt: article.updatedAt.toISOString(),

                favorited,
                favoritesCount,

                author: {
                    username: author.username,
                    bio: author.bio,
                    image: toAvatarUrl(author.image),
                    following,
                },
            },
        };
    }



    async update(
        slug: string,
        userId: string,
        dto: UpdateArticleDto,
    ): Promise<ArticleResponseDto> {
        const input = dto.article;

        if (
            input.title === undefined &&
            input.description === undefined &&
            input.body === undefined &&
            input.tagList === undefined
        ) {
            throw new BadRequestException(
                'At least one article field must be provided',
            );
        }

        const rawTagNames = input.tagList;

        return retryOnDeadlock(() =>
            this.dataSource.transaction(
                'READ COMMITTED',
                async (manager): Promise<ArticleResponseDto> => {
                    const articlesRepository =
                        manager.getRepository(Article);

                    const article = await articlesRepository
                        .createQueryBuilder('article')
                        .setLock('pessimistic_write')
                        .where('article.slug = :slug', { slug })
                        .getOne();

                    if (!article) {
                        throw new NotFoundException(
                            'Article not found',
                        );
                    }

                    if (article.authorId !== userId) {
                        throw new ForbiddenException(
                            'You can only update your own articles',
                        );
                    }

                    if (input.title !== undefined) {
                        assertTitleFitsStorage(input.title);
                    }
                    const tagNames = rawTagNames === undefined
                        ? undefined
                        : this.normalizeTagNames(rawTagNames);

                    const updates: Partial<
                        Pick<
                            Article,
                            'title' | 'description' | 'body' | 'slug'
                        >
                    > = {};

                    if (input.title !== undefined) {
                        updates.title = input.title;
                        updates.slug = generateSlug(
                            input.title,
                            article.id,
                        );
                    }

                    if (input.description !== undefined) {
                        updates.description = input.description;
                    }

                    if (input.body !== undefined) {
                        updates.body = input.body;
                    }

                    const updatedSlug =
                        updates.slug ?? article.slug;

                    // Case 1: Main article fields changed.
                    if (Object.keys(updates).length > 0) {
                        await articlesRepository.update(
                            { id: article.id },
                            updates,
                        );
                    }

                    // Case 2: Only tagList is being updated.
                    // Touch the article row to advance updatedAt.
                    else if (tagNames !== undefined) {
                        await articlesRepository.update(
                            { id: article.id },
                            {
                                updatedAt: () => 'CURRENT_TIMESTAMP(6)',
                            },
                        );
                    }

                    // Replace article-tag relationships only
                    // when tagList was provided.
                    if (tagNames !== undefined) {
                        await this.replaceArticleTags(
                            manager,
                            article.id,
                            tagNames,
                        );
                    }

                    // Read the updated article using the
                    // SAME transactional EntityManager.
                    return this.findOne(
                        updatedSlug,
                        userId,
                        manager,
                    );
                },
            ),
        );
    }


    async delete(
        slug: string,
        userId: string,
    ): Promise<void> {
        await this.dataSource.transaction(async (manager) => {
            const articlesRepository =
                manager.getRepository(Article);

            const article = await articlesRepository
                .createQueryBuilder('article')
                .setLock('pessimistic_write')
                .where('article.slug = :slug', { slug })
                .getOne();

            if (!article) {
                throw new NotFoundException(
                    'Article not found',
                );
            }

            if (article.authorId !== userId) {
                throw new ForbiddenException(
                    'You can only delete your own articles',
                );
            }

            await articlesRepository.delete({
                id: article.id,
                authorId: userId,
            });
        });
    }

    async findAll(
        filters: ListArticlesQueryDto,
        viewerId?: string,
    ): Promise<ArticlesResponseDto> {
        return this.dataSource.transaction(
            'REPEATABLE READ',
            async (manager) => {
                const articlesRepository =
                    manager.getRepository(Article);

                const query = articlesRepository
                    .createQueryBuilder('a');

                // Filter by tag.
                if (filters.tag !== undefined) {
                    query.andWhere(
                        `EXISTS (
            SELECT 1
            FROM article_tags atl
            INNER JOIN tags t
              ON t.id = atl.tag_id
            WHERE atl.article_id = a.id
              AND t.name = :tag
          )`,
                        {
                            tag: filters.tag.toLowerCase(),
                        },
                    );
                }

                // Filter by author username.
                if (filters.author !== undefined) {
                    query.andWhere(
                        `EXISTS (
            SELECT 1
            FROM users au
            WHERE au.id = a.author_id
              AND au.username = :author
          )`,
                        {
                            author: filters.author,
                        },
                    );
                }

                // Filter by the username of a user
                // who has favorited the article.
                if (filters.favorited !== undefined) {
                    query.andWhere(
                        `EXISTS (
            SELECT 1
            FROM article_favorites af
            INNER JOIN users fu
              ON fu.id = af.user_id
            WHERE af.article_id = a.id
              AND fu.username = :favorited
          )`,
                        {
                            favorited: filters.favorited,
                        },
                    );
                }

                // Total number of matching articles,
                // before applying pagination.
                const articlesCount = await query.getCount();

                // Fetch only fields needed by the list response.
                const articles = await query
                    .select([
                        'a.id',
                        'a.slug',
                        'a.title',
                        'a.description',
                        'a.authorId',
                        'a.createdAt',
                        'a.updatedAt',
                    ])
                    .orderBy('a.createdAt', 'DESC')
                    .addOrderBy('a.id', 'DESC')
                    .offset(filters.offset)
                    .limit(filters.limit)
                    .getMany();

                if (articles.length === 0) {
                    return {
                        articles: [],
                        articlesCount,
                    };
                }

                const items = await this.buildArticleList(
                    manager,
                    articles,
                    viewerId,
                );

                return {
                    articles: items,
                    articlesCount,
                };
            },
        );
    }

    private async buildArticleList(
        manager: EntityManager,
        articles: Article[],
        viewerId?: string,
    ): Promise<ArticleListItemDto[]> {
        if (articles.length === 0) {
            return [];
        }

        const articleIds = articles.map(
            (article) => article.id,
        );

        const authorIds = [
            ...new Set(
                articles.map((article) => article.authorId),
            ),
        ];

        // 1. Fetch all authors in one query.
        const authors = await manager
            .getRepository(User)
            .findBy({
                id: In(authorIds),
            });

        // 2. Fetch all article-tag relationships.
        const tagLinks = await manager
            .getRepository(ArticleTag)
            .findBy({
                articleId: In(articleIds),
            });

        // 3. Fetch the corresponding tags.
        const tagIds = [
            ...new Set(
                tagLinks.map((link) => link.tagId),
            ),
        ];

        const tags = tagIds.length > 0
            ? await manager.getRepository(Tag).findBy({
                id: In(tagIds),
            })
            : [];

        // 4. Count favorites grouped by article.
        const favoriteCounts = await manager
            .getRepository(ArticleFavorite)
            .createQueryBuilder('f')
            .select('f.articleId', 'articleId')
            .addSelect('COUNT(*)', 'total')
            .where('f.articleId IN (:...articleIds)', {
                articleIds,
            })
            .groupBy('f.articleId')
            .getRawMany<{
                articleId: string;
                total: string | number;
            }>();

        // 5. Get the current viewer's favorites.
        const viewerFavorites = viewerId
            ? await manager
                .getRepository(ArticleFavorite)
                .findBy({
                    userId: viewerId,
                    articleId: In(articleIds),
                })
            : [];

        // 6. Get the authors followed by the viewer.
        const viewerFollows = viewerId
            ? await manager
                .getRepository(Follow)
                .findBy({
                    followerId: viewerId,
                    followedId: In(authorIds),
                })
            : [];

        // Build lookup maps and sets.
        const authorsById = new Map(
            authors.map((author) => [author.id, author]),
        );

        const namesByTagId = new Map(
            tags.map((tag) => [tag.id, tag.name]),
        );

        const tagListsByArticleId =
            new Map<string, string[]>();

        for (const link of tagLinks) {
            const tagName = namesByTagId.get(link.tagId);

            if (tagName === undefined) {
                continue;
            }

            const names =
                tagListsByArticleId.get(link.articleId) ?? [];

            names.push(tagName);

            tagListsByArticleId.set(
                link.articleId,
                names,
            );
        }

        const favoriteCountsByArticleId = new Map(
            favoriteCounts.map((row) => [
                row.articleId,
                Number(row.total),
            ]),
        );

        const favoritedArticleIds = new Set(
            viewerFavorites.map(
                (favorite) => favorite.articleId,
            ),
        );

        const followedAuthorIds = new Set(
            viewerFollows.map(
                (follow) => follow.followedId,
            ),
        );

        // Assemble response without additional queries.
        return articles.map((article) => {
            const author = authorsById.get(
                article.authorId,
            );

            if (!author) {
                throw new InternalServerErrorException(
                    'Article author not found',
                );
            }

            return {
                slug: article.slug,
                title: article.title,
                description: article.description,
                tagList: (
                    tagListsByArticleId.get(article.id) ?? []
                ).sort(),
                createdAt: article.createdAt.toISOString(),
                updatedAt: article.updatedAt.toISOString(),
                favorited: favoritedArticleIds.has(
                    article.id,
                ),
                favoritesCount:
                    favoriteCountsByArticleId.get(article.id) ?? 0,
                author: {
                    username: author.username,
                    bio: author.bio,
                    image: toAvatarUrl(author.image),
                    following: followedAuthorIds.has(
                        article.authorId,
                    ),
                },
            };
        });
    }

    private async setFavorite(
        slug: string,
        userId: string,
        shouldFavorite: boolean,
    ): Promise<ArticleResponseDto> {
        return this.dataSource.transaction(async (manager) => {
            const articlesRepository =
                manager.getRepository(Article);

            const favoritesRepository =
                manager.getRepository(ArticleFavorite);

            // Lock the article to serialize favorite,
            // unfavorite, update and delete operations.
            const article = await articlesRepository
                .createQueryBuilder('article')
                .setLock('pessimistic_write')
                .where('article.slug = :slug', { slug })
                .getOne();

            if (!article) {
                throw new NotFoundException(
                    'Article not found',
                );
            }

            if (shouldFavorite) {
                // Insert a favorite, or do nothing if it
                // already exists.
                await manager.query(
                    'INSERT INTO `article_favorites` ' +
                    '(`user_id`, `article_id`) VALUES (?, ?) ' +
                    'ON DUPLICATE KEY UPDATE `user_id` = `user_id`',
                    [userId, article.id],
                );
            } else {
                // Deleting a nonexistent favorite is valid.
                await favoritesRepository.delete({
                    userId,
                    articleId: article.id,
                });
            }

            // Read the result using the same transaction.
            return this.findOne(
                article.slug,
                userId,
                manager,
            );
        });
    }


    private normalizeTagNames(
        rawTagNames: string[],
    ): string[] {
        const normalized = rawTagNames.map((name) => name.trim().toLowerCase());
        if (normalized.some((name) => Array.from(name).length > 100)) {
            throw new BadRequestException('Article tag must not exceed 100 characters after normalization');
        }
        return [...new Set(normalized)].sort();
    }

    private async replaceArticleTags(
        manager: EntityManager,
        articleId: string,
        tagNames: string[],
    ): Promise<void> {
        const tagsRepository = manager.getRepository(Tag);
        const linksRepository =
            manager.getRepository(ArticleTag);

        let tagIds: string[] = [];

        if (tagNames.length > 0) {
            // Bulk insert all tag names in a single query.
            // Let the database unique index handle
            // case/accent-insensitive duplicates.
            const placeholders = tagNames
                .map(() => '(?, ?)')
                .join(', ');

            const parameters = tagNames.flatMap(
                (name) => [randomUUID(), name],
            );

            await manager.query(
                'INSERT INTO `tags` (`id`, `name`) VALUES ' +
                placeholders +
                ' ON DUPLICATE KEY UPDATE `id` = `id`',
                parameters,
            );

            // Retrieve canonical tag IDs in one query.
            // MySQL collation determines logical equality.
            const storedTags = await tagsRepository.findBy({
                name: In(tagNames),
            });

            // Multiple input names may resolve to
            // the same canonical database tag ID.
            tagIds = [
                ...new Set(storedTags.map((tag) => tag.id)),
            ].sort();
        }

        // Replace relationships within the existing
        // transaction.
        await linksRepository.delete({ articleId });

        if (tagIds.length > 0) {
            await linksRepository.insert(
                tagIds.map((tagId) => ({
                    articleId,
                    tagId,
                })),
            );
        }
    }


    async favorite(
        slug: string,
        userId: string,
    ): Promise<ArticleResponseDto> {
        return this.setFavorite(slug, userId, true);
    }
    async unfavorite(
        slug: string,
        userId: string,
    ): Promise<ArticleResponseDto> {
        return this.setFavorite(slug, userId, false);
    }

    async getFeed(
        userId: string,
        filters: FeedArticlesQueryDto,
    ): Promise<ArticlesResponseDto> {
        return this.dataSource.transaction(
            'REPEATABLE READ',
            async (manager) => {
                const articlesRepository =
                    manager.getRepository(Article);

                const query = articlesRepository
                    .createQueryBuilder('a')
                    .where(
                        `EXISTS (
            SELECT 1
            FROM follows f
            WHERE f.follower_id = :userId
              AND f.followed_id = a.author_id
          )`,
                        { userId },
                    );

                // Count all matching articles before pagination.
                const articlesCount = await query.getCount();

                const articles = await query
                    .select([
                        'a.id',
                        'a.slug',
                        'a.title',
                        'a.description',
                        'a.authorId',
                        'a.createdAt',
                        'a.updatedAt',
                    ])
                    .orderBy('a.createdAt', 'DESC')
                    .addOrderBy('a.id', 'DESC')
                    .offset(filters.offset)
                    .limit(filters.limit)
                    .getMany();

                if (articles.length === 0) {
                    return {
                        articles: [],
                        articlesCount,
                    };
                }

                const items = await this.buildArticleList(
                    manager,
                    articles,
                    userId,
                );

                return {
                    articles: items,
                    articlesCount,
                };
            },
        );
    }

    async getTags(): Promise<TagsResponseDto> {
        const rows = await this.dataSource
            .getRepository(Tag)
            .createQueryBuilder('tag')
            .innerJoin(
                ArticleTag,
                'link',
                'link.tagId = tag.id',
            )
            .select('tag.name', 'name')
            .distinct(true)
            .orderBy('tag.name', 'ASC')
            .getRawMany<{ name: string }>();

        return {
            tags: rows.map((row) => row.name),
        };
    }


}

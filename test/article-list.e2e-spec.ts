
import {
    type INestApplication,
    ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';

import { User } from '../src/users/entities/user.entity.js';
import { Article } from '../src/articles/entities/article.entity.js';
import { Tag } from '../src/articles/entities/tag.entity.js';
import { ArticleTag } from '../src/articles/entities/article-tag.entity.js';
import { ArticleFavorite } from '../src/articles/entities/article-favorite.entity.js';
import { Follow } from '../src/profiles/entities/follow.entity.js';

describe('Article Listing E2E', () => {
    let app: INestApplication | undefined;
    let databaseVerified = false;

    const createdUsers: Array<{
        id: string;
        email: string;
    }> = [];


    const suffix = randomUUID()
        .replaceAll('-', '')
        .slice(0, 16);

    const password = 'ExamplePass123!';

    const aliceUsername = `list_alice_${suffix}`;
    const bobUsername = `list_bob_${suffix}`;
    const charlieUsername = `list_charlie_${suffix}`;

    const scopeTag = `scope_${suffix}`;
    const nestjsTag = `nestjs_${suffix}`;
    const backendTag = `backend_${suffix}`;
    const typescriptTag = `typescript_${suffix}`;


    beforeAll(async () => {
        const env = process.env;

        if (
            env.NODE_ENV !== 'test' ||
            env.DB_HOST !== '127.0.0.1' ||
            env.DB_PORT !== '3307' ||
            env.DB_DATABASE !== 'medium_clone_test' ||
            env.DB_USERNAME !== 'medium_test_user' ||
            env.REDIS_URL !== 'redis://127.0.0.1:6380' ||
            !env.DB_TEST_SERVER_UUID
        ) {
            throw new Error('Unsafe E2E environment');
        }

        const { AppModule } = await import(
            '../src/app.module.js'
        );

        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();
        app.setGlobalPrefix('api');

        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
            }),
        );

        await app.init();

        const rows = (await app.get(DataSource).query(`
      SELECT
        DATABASE() AS db,
        CURRENT_USER() AS dbUser,
        @@server_uuid AS serverUuid
    `)) as Array<{
            db: string;
            dbUser: string;
            serverUuid: string;
        }>;

        const identity = rows[0];

        if (
            identity?.db !== 'medium_clone_test' ||
            !identity.dbUser.startsWith('medium_test_user@') ||
            identity.serverUuid !== env.DB_TEST_SERVER_UUID
        ) {
            throw new Error(
                'E2E database identity verification failed',
            );
        }

        databaseVerified = true;
    }, 25000);

    afterAll(async () => {
        if (!app) return;

        try {
            if (databaseVerified) {
                const db = app.get(DataSource);

                // Only remove users created by this test.
                // FK cascades remove their articles and links.
                for (const user of createdUsers) {
                    await db.getRepository(User).delete({
                        id: user.id,
                        email: user.email,
                    });
                }

                // Remove only this test's uniquely named tags.
                await db.getRepository(Tag).delete({
                    name: In([
                        scopeTag,
                        nestjsTag,
                        backendTag,
                        typescriptTag,
                    ]),
                });
            }
        } finally {
            await app.close();
        }
    }, 20000);


    it('validates listing, filtering, pagination and viewer state', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }

        const server = app.getHttpServer();
        const db = app.get(DataSource);

        const articles = db.getRepository(Article);
        const favorites = db.getRepository(ArticleFavorite);
        const follows = db.getRepository(Follow);

        // 1. Helper: register and authenticate a user.
        async function registerUser(username: string) {
            const email = `${username}@example.com`;

            const registration = await request(server)
                .post('/api/users')
                .send({
                    email,
                    username,
                    password,
                })
                .expect(201);

            const id = registration.body.user.id as string;

            createdUsers.push({ id, email });

            const login = await request(server)
                .post('/api/users/login')
                .send({ email, password })
                .expect(200);

            return {
                id,
                username,
                authorization:
                    `Bearer ${login.body.accessToken as string}`,
            };
        }

        // 2. Register three independent test users.
        const alice = await registerUser(aliceUsername);
        const bob = await registerUser(bobUsername);
        const charlie = await registerUser(charlieUsername);

        // 3. Helper: create an article.
        async function createArticle(
            authorization: string,
            title: string,
            tagList: string[],
            createdAt: Date,
        ) {
            const response = await request(server)
                .post('/api/articles')
                .set('Authorization', authorization)
                .send({
                    article: {
                        title,
                        description: `Description of ${title}`,
                        body: `Body content of ${title}`,
                        tagList: [scopeTag, ...tagList],
                    },
                })
                .expect(201);

            const article = await articles.findOneByOrFail({
                slug: response.body.article.slug as string,
            });

            // Use deterministic timestamps for sorting tests.
            await articles.update(
                { id: article.id },
                { createdAt },
            );

            return article;
        }

        // 4. Create four articles with known timestamps.
        const articleA = await createArticle(
            alice.authorization,
            'Article A',
            [nestjsTag, backendTag],
            new Date('2025-01-01T00:00:00Z'),
        );

        const articleB = await createArticle(
            alice.authorization,
            'Article B',
            [typescriptTag],
            new Date('2025-01-02T00:00:00Z'),
        );

        const articleC = await createArticle(
            bob.authorization,
            'Article C',
            [nestjsTag, typescriptTag],
            new Date('2025-01-03T00:00:00Z'),
        );

        const articleD = await createArticle(
            bob.authorization,
            'Article D',
            [backendTag],
            new Date('2025-01-04T00:00:00Z'),
        );

        // 5. Seed favorites directly.
        // Favorite endpoints are not implemented yet.
        await favorites.insert([
            {
                userId: charlie.id,
                articleId: articleA.id,
            },
            {
                userId: bob.id,
                articleId: articleB.id,
            },
            {
                userId: charlie.id,
                articleId: articleC.id,
            },
        ]);

        // Charlie follows Alice.
        await follows.insert({
            followerId: charlie.id,
            followedId: alice.id,
        });

        const url = '/api/articles';

        // Helper: extract slugs from a list response.
        function getSlugs(
            items: Array<{ slug: string }>,
        ): string[] {
            return items.map((item) => item.slug);
        }

        // 6. Public listing without query parameters.
        const defaultList = await request(server)
            .get(url)
            .expect(200);

        expect(Array.isArray(defaultList.body.articles))
            .toBe(true);

        expect(defaultList.body.articles.length)
            .toBeLessThanOrEqual(20);

        expect(defaultList.body.articlesCount)
            .toBeGreaterThanOrEqual(4);

        // 7. Public listing ordered newest first.
        const publicList = await request(server)
            .get(url)
            .query({ tag: scopeTag })
            .expect(200);

        expect(publicList.body.articlesCount).toBe(4);

        expect(getSlugs(publicList.body.articles)).toEqual([
            articleD.slug,
            articleC.slug,
            articleB.slug,
            articleA.slug,
        ]);

        // Public users have no personalized state.
        for (const item of publicList.body.articles) {
            expect(item.favorited).toBe(false);
            expect(item.author.following).toBe(false);

            // List responses must not expose article body.
            expect(item).not.toHaveProperty('body');
            expect(item).not.toHaveProperty('authorId');
            expect(item.author).not.toHaveProperty('email');
            expect(item.author).not.toHaveProperty('passwordHash');
        }

        // 8. Filter by tag.
        const byTag = await request(server)
            .get(url)
            .query({
                tag: nestjsTag.toUpperCase(),
            })
            .expect(200);

        expect(byTag.body.articlesCount).toBe(2);

        expect(getSlugs(byTag.body.articles)).toEqual([
            articleC.slug,
            articleA.slug,
        ]);

        // 9. Filter by author.
        const byAuthor = await request(server)
            .get(url)
            .query({
                author: alice.username,
            })
            .expect(200);

        expect(byAuthor.body.articlesCount).toBe(2);

        expect(getSlugs(byAuthor.body.articles)).toEqual([
            articleB.slug,
            articleA.slug,
        ]);

        // 10. Filter by favorited username.
        const byFavorited = await request(server)
            .get(url)
            .query({
                favorited: charlie.username,
            })
            .expect(200);

        expect(byFavorited.body.articlesCount).toBe(2);

        expect(getSlugs(byFavorited.body.articles)).toEqual([
            articleC.slug,
            articleA.slug,
        ]);

        // 11. Combine all three filters using AND.
        const combined = await request(server)
            .get(url)
            .query({
                tag: nestjsTag,
                author: alice.username,
                favorited: charlie.username,
            })
            .expect(200);

        expect(combined.body.articlesCount).toBe(1);

        expect(getSlugs(combined.body.articles)).toEqual([
            articleA.slug,
        ]);

        // 12. Pagination: first page.
        const firstPage = await request(server)
            .get(url)
            .query({
                tag: scopeTag,
                limit: 2,
                offset: 0,
            })
            .expect(200);

        expect(firstPage.body.articlesCount).toBe(4);

        expect(getSlugs(firstPage.body.articles)).toEqual([
            articleD.slug,
            articleC.slug,
        ]);

        // 13. Pagination: second page.
        const secondPage = await request(server)
            .get(url)
            .query({
                tag: scopeTag,
                limit: 2,
                offset: 2,
            })
            .expect(200);

        expect(secondPage.body.articlesCount).toBe(4);

        expect(getSlugs(secondPage.body.articles)).toEqual([
            articleB.slug,
            articleA.slug,
        ]);

        // 14. Offset beyond the last matching article.
        const emptyPage = await request(server)
            .get(url)
            .query({
                tag: scopeTag,
                limit: 2,
                offset: 10,
            })
            .expect(200);

        expect(emptyPage.body.articles).toEqual([]);
        expect(emptyPage.body.articlesCount).toBe(4);

        // 15. No matching filter.
        const noMatches = await request(server)
            .get(url)
            .query({
                tag: `missing_${suffix}`,
            })
            .expect(200);

        expect(noMatches.body.articles).toEqual([]);
        expect(noMatches.body.articlesCount).toBe(0);

        // 16. Authenticated viewer state.
        const personalized = await request(server)
            .get(url)
            .set('Authorization', charlie.authorization)
            .query({
                tag: scopeTag,
            })
            .expect(200);

        expect(personalized.body.articlesCount).toBe(4);

        expect(personalized.body.articles).toMatchObject([
            {
                slug: articleD.slug,
                favorited: false,
                favoritesCount: 0,
                author: {
                    username: bob.username,
                    following: false,
                },
            },
            {
                slug: articleC.slug,
                favorited: true,
                favoritesCount: 1,
                author: {
                    username: bob.username,
                    following: false,
                },
            },
            {
                slug: articleB.slug,
                favorited: false,
                favoritesCount: 1,
                author: {
                    username: alice.username,
                    following: true,
                },
            },
            {
                slug: articleA.slug,
                favorited: true,
                favoritesCount: 1,
                author: {
                    username: alice.username,
                    following: true,
                },
            },
        ]);

        // 17. Verify tag mapping.
        const itemA = personalized.body.articles.find(
            (item: { slug: string }) =>
                item.slug === articleA.slug,
        );

        expect(itemA?.tagList).toEqual(
            [scopeTag, nestjsTag, backendTag].sort(),
        );

        // 18. Invalid supplied JWT.
        await request(server)
            .get(url)
            .set('Authorization', 'Bearer invalid.token')
            .expect(401);

        // 19. Invalid query parameters.
        const invalidQueries = [
            'limit=0',
            'limit=101',
            'limit=-1',
            'limit=1.5',
            'limit=abc',
            'offset=-1',
            'offset=100001',
            'offset=1.5',
            'offset=abc',
            'tag=',
            'author=',
            'favorited=',
            'unknown=value',
        ];

        for (const query of invalidQueries) {
            await request(server)
                .get(`${url}?${query}`)
                .expect(400);
        }
    }, 40000);

});

import {
    type INestApplication,
    ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
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
import { ArticleFavorite } from '../src/articles/entities/article-favorite.entity.js';

describe('Article Feed E2E', () => {
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

    const viewerUsername = `feed_viewer_${suffix}`;
    const aliceUsername = `feed_alice_${suffix}`;
    const bobUsername = `feed_bob_${suffix}`;
    const outsiderUsername = `feed_outside_${suffix}`;

    const scopeTag = `feed_${suffix}`;


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

        await app.listen(0, '127.0.0.1');

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


            }
        } finally {
            await app.close();
        }
    }, 20000);




    it('validates authenticated feed, pagination and follow changes', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }

        const server = app.getHttpServer();
        const db = app.get(DataSource);

        const articles = db.getRepository(Article);
        const favorites = db.getRepository(ArticleFavorite);

        const feedUrl = '/api/articles/feed';

        // 1. Register and authenticate a user.
        async function registerUser(username: string) {
            const email = `${username}@example.com`;

            const registration = await request(server)
                .post('/api/users')
                .send({ email, username, password })
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

        // 2. Four independent users.
        const viewer = await registerUser(viewerUsername);
        const alice = await registerUser(aliceUsername);
        const bob = await registerUser(bobUsername);
        const outsider = await registerUser(outsiderUsername);

        // 3. Helper: create an article with a fixed timestamp.
        async function createArticle(
            authorization: string,
            title: string,
            createdAt: string,
        ) {
            const response = await request(server)
                .post('/api/articles')
                .set('Authorization', authorization)
                .send({
                    article: {
                        title,
                        description: `Description of ${title}`,
                        body: `Body of ${title}`,
                        tagList: [scopeTag],
                    },
                })
                .expect(201);

            const article = await articles.findOneByOrFail({
                slug: response.body.article.slug as string,
            });

            // Deterministic ordering, independent of test speed.
            await articles.update(
                { id: article.id },
                { createdAt: new Date(createdAt) },
            );

            return article;
        }

        // 4. Create five articles.
        const aliceA1 = await createArticle(
            alice.authorization,
            'Alice Article 1',
            '2025-01-01T00:00:00.000Z',
        );

        const aliceA2 = await createArticle(
            alice.authorization,
            'Alice Article 2',
            '2025-01-04T00:00:00.000Z',
        );

        const bobB1 = await createArticle(
            bob.authorization,
            'Bob Article 1',
            '2025-01-03T00:00:00.000Z',
        );

        const outsiderX1 = await createArticle(
            outsider.authorization,
            'Outsider Article',
            '2025-01-05T00:00:00.000Z',
        );

        const viewerSelf = await createArticle(
            viewer.authorization,
            'Viewer Own Article',
            '2025-01-06T00:00:00.000Z',
        );

        // 5. Seed favorites to verify personalized state.
        await favorites.insert([
            {
                userId: viewer.id,
                articleId: aliceA1.id,
            },
            {
                userId: outsider.id,
                articleId: aliceA2.id,
            },
        ]);

        function slugs(
            items: Array<{ slug: string }>,
        ): string[] {
            return items.map((item) => item.slug);
        }

        // 6. JWT is required.
        await request(server)
            .get(feedUrl)
            .expect(401);

        await request(server)
            .get(feedUrl)
            .set('Authorization', 'Bearer invalid.token')
            .expect(401);

        // 7. Invalid pagination and unsupported parameters.
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
            'tag=nestjs',
            'author=alice',
            'favorited=bob',
            'unknown=value',
        ];

        for (const query of invalidQueries) {
            await request(server)
                .get(`${feedUrl}?${query}`)
                .set('Authorization', viewer.authorization)
                .expect(400);
        }

        // 8. Initially, viewer follows nobody.
        const initialFeed = await request(server)
            .get(feedUrl)
            .set('Authorization', viewer.authorization)
            .expect(200);

        expect(initialFeed.body).toMatchObject({
            articles: [],
            articlesCount: 0,
        });

        // 9. Viewer follows Alice through the actual API.
        const followAliceUrl =
            `/api/profiles/${alice.username}/follow`;

        const followBobUrl =
            `/api/profiles/${bob.username}/follow`;

        const followOutsiderUrl =
            `/api/profiles/${outsider.username}/follow`;

        await request(server)
            .post(followAliceUrl)
            .set('Authorization', viewer.authorization)
            .expect(200);

        const aliceFeed = await request(server)
            .get(feedUrl)
            .set('Authorization', viewer.authorization)
            .expect(200);

        expect(aliceFeed.body.articlesCount).toBe(2);

        expect(slugs(aliceFeed.body.articles)).toEqual([
            aliceA2.slug,
            aliceA1.slug,
        ]);

        for (const article of aliceFeed.body.articles) {
            expect(article.author.username)
                .toBe(alice.username);

            expect(article.author.following).toBe(true);
        }

        // 10. Viewer follows Bob as well.
        await request(server)
            .post(followBobUrl)
            .set('Authorization', viewer.authorization)
            .expect(200);

        const combinedFeed = await request(server)
            .get(feedUrl)
            .set('Authorization', viewer.authorization)
            .expect(200);

        expect(combinedFeed.body.articlesCount).toBe(3);

        expect(slugs(combinedFeed.body.articles)).toEqual([
            aliceA2.slug,
            bobB1.slug,
            aliceA1.slug,
        ]);

        // Articles from outsider and viewer are excluded.
        expect(slugs(combinedFeed.body.articles))
            .not.toContain(outsiderX1.slug);

        expect(slugs(combinedFeed.body.articles))
            .not.toContain(viewerSelf.slug);

        // 11. Response fields and personalized state.
        expect(combinedFeed.body.articles).toMatchObject([
            {
                slug: aliceA2.slug,
                favorited: false,
                favoritesCount: 1,
                author: {
                    username: alice.username,
                    following: true,
                },
            },
            {
                slug: bobB1.slug,
                favorited: false,
                favoritesCount: 0,
                author: {
                    username: bob.username,
                    following: true,
                },
            },
            {
                slug: aliceA1.slug,
                favorited: true,
                favoritesCount: 1,
                author: {
                    username: alice.username,
                    following: true,
                },
            },
        ]);

        for (const article of combinedFeed.body.articles) {
            expect(article).not.toHaveProperty('body');
            expect(article).not.toHaveProperty('authorId');

            expect(article.author)
                .not.toHaveProperty('email');

            expect(article.author)
                .not.toHaveProperty('passwordHash');

            expect(article.tagList).toEqual([scopeTag]);

            expect(typeof article.createdAt).toBe('string');
            expect(typeof article.updatedAt).toBe('string');
        }

        // 12. Pagination: first page.
        const firstPage = await request(server)
            .get(feedUrl)
            .set('Authorization', viewer.authorization)
            .query({ limit: 2, offset: 0 })
            .expect(200);

        expect(firstPage.body.articlesCount).toBe(3);

        expect(slugs(firstPage.body.articles)).toEqual([
            aliceA2.slug,
            bobB1.slug,
        ]);

        // 13. Pagination: second page.
        const secondPage = await request(server)
            .get(feedUrl)
            .set('Authorization', viewer.authorization)
            .query({ limit: 2, offset: 2 })
            .expect(200);

        expect(secondPage.body.articlesCount).toBe(3);

        expect(slugs(secondPage.body.articles)).toEqual([
            aliceA1.slug,
        ]);

        // 14. Offset beyond total matches.
        const beyondLastPage = await request(server)
            .get(feedUrl)
            .set('Authorization', viewer.authorization)
            .query({ limit: 2, offset: 10 })
            .expect(200);

        expect(beyondLastPage.body).toMatchObject({
            articles: [],
            articlesCount: 3,
        });

        // 15. Article Detail matches Feed viewer state.
        const detail = await request(server)
            .get(`/api/articles/${aliceA1.slug}`)
            .set('Authorization', viewer.authorization)
            .expect(200);

        expect(detail.body.article).toMatchObject({
            slug: aliceA1.slug,
            favorited: true,
            favoritesCount: 1,
            author: {
                username: alice.username,
                following: true,
            },
        });

        // 16. Unfollow Alice.
        await request(server)
            .delete(followAliceUrl)
            .set('Authorization', viewer.authorization)
            .expect(204);

        const afterUnfollowAlice = await request(server)
            .get(feedUrl)
            .set('Authorization', viewer.authorization)
            .expect(200);

        expect(afterUnfollowAlice.body.articlesCount).toBe(1);

        expect(
            slugs(afterUnfollowAlice.body.articles),
        ).toEqual([bobB1.slug]);

        // 17. Unfollow Bob.
        await request(server)
            .delete(followBobUrl)
            .set('Authorization', viewer.authorization)
            .expect(204);

        const emptyAgain = await request(server)
            .get(feedUrl)
            .set('Authorization', viewer.authorization)
            .expect(200);

        expect(emptyAgain.body).toMatchObject({
            articles: [],
            articlesCount: 0,
        });

        // 18. Follow Outsider: feed updates accordingly.
        await request(server)
            .post(followOutsiderUrl)
            .set('Authorization', viewer.authorization)
            .expect(200);

        const outsiderFeed = await request(server)
            .get(feedUrl)
            .set('Authorization', viewer.authorization)
            .expect(200);

        expect(outsiderFeed.body.articlesCount).toBe(1);

        expect(slugs(outsiderFeed.body.articles))
            .toEqual([outsiderX1.slug]);

        expect(
            outsiderFeed.body.articles[0].author.following,
        ).toBe(true);

        // 19. Clean up the final relationship via API.
        await request(server)
            .delete(followOutsiderUrl)
            .set('Authorization', viewer.authorization)
            .expect(204);

    }, 40000);


});

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

describe('Article Favorite E2E', () => {
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

    const aliceUsername = `fav_alice_${suffix}`;
    const bobUsername = `fav_bob_${suffix}`;
    const charlieUsername = `fav_charlie_${suffix}`;

    const scopeTag = `favorite_${suffix}`;


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

                // Remove only this test's uniquely named tags.
                await db.getRepository(Tag).delete({
                    name: scopeTag,
                });
            }
        } finally {
            await app.close();
        }
    }, 20000);



    it('validates favorite, unfavorite, concurrency and persistence', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }

        const server = app.getHttpServer();
        const db = app.get(DataSource);

        const articles = db.getRepository(Article);
        const favorites = db.getRepository(ArticleFavorite);

        // 1. Register and authenticate a test user.
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

        // 2. Register three independent users.
        const alice = await registerUser(aliceUsername);
        const bob = await registerUser(bobUsername);
        const charlie = await registerUser(charlieUsername);

        // 3. Alice creates an article.
        const created = await request(server)
            .post('/api/articles')
            .set('Authorization', alice.authorization)
            .send({
                article: {
                    title: 'Favorite Test Article',
                    description: 'Testing favorite operations',
                    body: 'Article favorite E2E content',
                    tagList: [scopeTag],
                },
            })
            .expect(201);

        const slug = created.body.article.slug as string;

        const article = await articles.findOneByOrFail({
            slug,
        });

        const detailUrl = `/api/articles/${slug}`;
        const favoriteUrl = `${detailUrl}/favorite`;

        // Helper: verify persisted favorite count.
        async function expectFavoriteCount(
            expected: number,
        ) {
            expect(
                await favorites.countBy({
                    articleId: article.id,
                }),
            ).toBe(expected);
        }

        await expectFavoriteCount(0);

        // 4. Authentication is required.
        await request(server)
            .post(favoriteUrl)
            .expect(401);

        await request(server)
            .delete(favoriteUrl)
            .expect(401);

        await request(server)
            .post(favoriteUrl)
            .set('Authorization', 'Bearer invalid.token')
            .expect(401);

        await request(server)
            .delete(favoriteUrl)
            .set('Authorization', 'Bearer invalid.token')
            .expect(401);

        // 5. Unknown article.
        const missingUrl =
            `/api/articles/missing-${randomUUID()}/favorite`;

        await request(server)
            .post(missingUrl)
            .set('Authorization', bob.authorization)
            .expect(404);

        await request(server)
            .delete(missingUrl)
            .set('Authorization', bob.authorization)
            .expect(404);

        // 6. Bob favorites the article.
        const firstFavorite = await request(server)
            .post(favoriteUrl)
            .set('Authorization', bob.authorization)
            .expect(200);

        expect(firstFavorite.body.article).toMatchObject({
            slug,
            favorited: true,
            favoritesCount: 1,
        });

        expect(
            await favorites.existsBy({
                userId: bob.id,
                articleId: article.id,
            }),
        ).toBe(true);

        await expectFavoriteCount(1);

        // 7. Repeated favorites must be idempotent.
        for (let i = 0; i < 3; i++) {
            const repeated = await request(server)
                .post(favoriteUrl)
                .set('Authorization', bob.authorization)
                .expect(200);

            expect(repeated.body.article).toMatchObject({
                favorited: true,
                favoritesCount: 1,
            });
        }

        await expectFavoriteCount(1);

        // 8. Charlie favorites the same article.
        const secondFavorite = await request(server)
            .post(favoriteUrl)
            .set('Authorization', charlie.authorization)
            .expect(200);

        expect(secondFavorite.body.article).toMatchObject({
            favorited: true,
            favoritesCount: 2,
        });

        await expectFavoriteCount(2);

        // 9. Anonymous article detail.
        const publicDetail = await request(server)
            .get(detailUrl)
            .expect(200);

        expect(publicDetail.body.article).toMatchObject({
            favorited: false,
            favoritesCount: 2,
        });

        // 10. Authenticated article detail.
        const bobDetail = await request(server)
            .get(detailUrl)
            .set('Authorization', bob.authorization)
            .expect(200);

        expect(bobDetail.body.article).toMatchObject({
            favorited: true,
            favoritesCount: 2,
        });

        const aliceDetail = await request(server)
            .get(detailUrl)
            .set('Authorization', alice.authorization)
            .expect(200);

        expect(aliceDetail.body.article).toMatchObject({
            favorited: false,
            favoritesCount: 2,
        });

        // 11. Bob unfavorites the article.
        const unfavorite = await request(server)
            .delete(favoriteUrl)
            .set('Authorization', bob.authorization)
            .expect(200);

        expect(unfavorite.body.article).toMatchObject({
            favorited: false,
            favoritesCount: 1,
        });

        expect(
            await favorites.existsBy({
                userId: bob.id,
                articleId: article.id,
            }),
        ).toBe(false);

        await expectFavoriteCount(1);

        // 12. Repeated unfavorite is also idempotent.
        const repeatedUnfavorite = await request(server)
            .delete(favoriteUrl)
            .set('Authorization', bob.authorization)
            .expect(200);

        expect(
            repeatedUnfavorite.body.article,
        ).toMatchObject({
            favorited: false,
            favoritesCount: 1,
        });

        await expectFavoriteCount(1);

        // 13. Send ten concurrent favorite requests.
        const concurrentFavorites = await Promise.all(
            Array.from({ length: 10 }, () =>
                request(server)
                    .post(favoriteUrl)
                    .set('Authorization', bob.authorization)
                    .expect(200),
            ),
        );

        for (const response of concurrentFavorites) {
            expect(response.body.article).toMatchObject({
                favorited: true,
                favoritesCount: 2,
            });
        }

        // Exactly one relationship for Bob.
        expect(
            await favorites.countBy({
                userId: bob.id,
                articleId: article.id,
            }),
        ).toBe(1);

        // Bob and Charlie.
        await expectFavoriteCount(2);

        // 14. Verify listing and detail consistency.
        const listing = await request(server)
            .get('/api/articles')
            .set('Authorization', bob.authorization)
            .query({ tag: scopeTag })
            .expect(200);

        expect(listing.body.articlesCount).toBe(1);

        expect(listing.body.articles).toMatchObject([
            {
                slug,
                favorited: true,
                favoritesCount: 2,
            },
        ]);

        const favoriteFilter = await request(server)
            .get('/api/articles')
            .query({
                tag: scopeTag,
                favorited: bob.username,
            })
            .expect(200);

        expect(favoriteFilter.body.articlesCount).toBe(1);
        expect(favoriteFilter.body.articles[0].slug)
            .toBe(slug);

        // 15. Send ten concurrent unfavorite requests.
        const concurrentUnfavorites = await Promise.all(
            Array.from({ length: 10 }, () =>
                request(server)
                    .delete(favoriteUrl)
                    .set('Authorization', bob.authorization)
                    .expect(200),
            ),
        );

        for (const response of concurrentUnfavorites) {
            expect(response.body.article).toMatchObject({
                favorited: false,
                favoritesCount: 1,
            });
        }

        expect(
            await favorites.countBy({
                userId: bob.id,
                articleId: article.id,
            }),
        ).toBe(0);

        // Charlie's favorite must remain.
        expect(
            await favorites.existsBy({
                userId: charlie.id,
                articleId: article.id,
            }),
        ).toBe(true);

        await expectFavoriteCount(1);

        // 16. Verify listing after unfavorite.
        const emptyFavorites = await request(server)
            .get('/api/articles')
            .query({
                tag: scopeTag,
                favorited: bob.username,
            })
            .expect(200);

        expect(emptyFavorites.body.articles).toEqual([]);
        expect(emptyFavorites.body.articlesCount).toBe(0);

        const updatedListing = await request(server)
            .get('/api/articles')
            .set('Authorization', bob.authorization)
            .query({ tag: scopeTag })
            .expect(200);

        expect(updatedListing.body.articles).toMatchObject([
            {
                slug,
                favorited: false,
                favoritesCount: 1,
            },
        ]);

        // 17. Delete the article and verify cascade.
        await request(server)
            .delete(detailUrl)
            .set('Authorization', alice.authorization)
            .expect(204);

        await expectFavoriteCount(0);

        expect(
            await articles.existsBy({
                id: article.id,
            }),
        ).toBe(false);

        await request(server)
            .post(favoriteUrl)
            .set('Authorization', bob.authorization)
            .expect(404);

    }, 40000);


});

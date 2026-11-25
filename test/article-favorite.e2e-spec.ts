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
import { ArticleFavorite } from '../src/articles/entities/article-favorite.entity.js';

describe('Article Favorite E2E', () => {
    let app: INestApplication | undefined;
    let databaseVerified = false;

    const createdUsers: Array<{ id: string; email: string }> = [];
    const createdTags = new Set<string>();
    const suiteSuffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const password = 'ExamplePass123!';

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

        const { AppModule } = await import('../src/app.module.js');
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
            throw new Error('E2E database identity verification failed');
        }

        databaseVerified = true;
    }, 25000);

    afterAll(async () => {
        if (!app) return;

        try {
            if (databaseVerified) {
                const db = app.get(DataSource);

                // Only remove users registered by this suite.
                // Their article records and relationships cascade.
                for (const user of createdUsers) {
                    await db.getRepository(User).delete({
                        id: user.id,
                        email: user.email,
                    });
                }

                // Only remove uniquely generated tags from this suite.
                if (createdTags.size > 0) {
                    await db.getRepository(Tag).delete({
                        name: In([...createdTags]),
                    });
                }
            }
        } finally {
            await app.close();
        }
    }, 20000);

    function context() {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }
        return {
            server: app.getHttpServer(),
            db: app.get(DataSource),
        };
    }

    function makeTag(prefix: string): string {
        const value = `${prefix}_${suiteSuffix}_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
        createdTags.add(value);
        return value;
    }

    async function registerUser() {
        const { server } = context();
        const identity = `${suiteSuffix}_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
        const username = `fav_${identity}`;
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
            authorization: `Bearer ${login.body.accessToken as string}`,
        };
    }

    // Each test builds its own users, article and uniquely named tag.
    async function fixture(withCharlie = false) {
        const { server, db } = context();
        const alice = await registerUser();
        const bob = await registerUser();
        const charlie = withCharlie ? await registerUser() : undefined;
        const scopeTag = makeTag('favorite');
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
        const articles = db.getRepository(Article);
        const favorites = db.getRepository(ArticleFavorite);
        const article = await articles.findOneByOrFail({ slug });
        const detailUrl = `/api/articles/${slug}`;
        const favoriteUrl = `${detailUrl}/favorite`;

        const favorite = (authorization: string) => request(server)
            .post(favoriteUrl)
            .set('Authorization', authorization)
            .expect(200);
        const unfavorite = (authorization: string) => request(server)
            .delete(favoriteUrl)
            .set('Authorization', authorization)
            .expect(200);
        const expectCount = async (expected: number) => {
            expect(await favorites.countBy({ articleId: article.id }))
                .toBe(expected);
        };

        return {
            server, articles, favorites, alice, bob, charlie,
            scopeTag, slug, article, detailUrl, favoriteUrl,
            favorite, unfavorite, expectCount,
        };
    }

    it('requires a valid JWT for favorite and unfavorite', async () => {
        const f = await fixture();
        await request(f.server).post(f.favoriteUrl).expect(401);
        await request(f.server).delete(f.favoriteUrl).expect(401);
        await request(f.server).post(f.favoriteUrl)
            .set('Authorization', 'Bearer invalid.token').expect(401);
        await request(f.server).delete(f.favoriteUrl)
            .set('Authorization', 'Bearer invalid.token').expect(401);
        await f.expectCount(0);
    }, 40000);

    it('returns 404 for favorite or unfavorite on an unknown article', async () => {
        const { server } = context();
        const user = await registerUser();
        const url = `/api/articles/missing-${randomUUID()}/favorite`;
        await request(server).post(url)
            .set('Authorization', user.authorization).expect(404);
        await request(server).delete(url)
            .set('Authorization', user.authorization).expect(404);
    }, 40000);

    it('favorites an article and persists exactly one relationship', async () => {
        const f = await fixture();
        await f.expectCount(0);
        const response = await f.favorite(f.bob.authorization);
        expect(response.body.article).toMatchObject({
            slug: f.slug, favorited: true, favoritesCount: 1,
        });
        expect(await f.favorites.existsBy({
            userId: f.bob.id, articleId: f.article.id,
        })).toBe(true);
        await f.expectCount(1);
    }, 40000);

    it('keeps repeated favorite requests idempotent', async () => {
        const f = await fixture();
        await f.favorite(f.bob.authorization);
        for (let i = 0; i < 3; i++) {
            const response = await f.favorite(f.bob.authorization);
            expect(response.body.article).toMatchObject({
                favorited: true, favoritesCount: 1,
            });
        }
        await f.expectCount(1);
    }, 40000);

    it('counts favorites from distinct users', async () => {
        const f = await fixture(true);
        if (!f.charlie) throw new Error('Missing second viewer');
        await f.favorite(f.bob.authorization);
        const response = await f.favorite(f.charlie.authorization);
        expect(response.body.article).toMatchObject({
            favorited: true, favoritesCount: 2,
        });
        for (const user of [f.bob, f.charlie]) {
            expect(await f.favorites.existsBy({
                articleId: f.article.id, userId: user.id,
            })).toBe(true);
        }
        await f.expectCount(2);
    }, 40000);

    it('returns viewer-specific favorite state on article detail', async () => {
        const f = await fixture(true);
        if (!f.charlie) throw new Error('Missing second viewer');
        await f.favorite(f.bob.authorization);
        await f.favorite(f.charlie.authorization);
        const anonymous = await request(f.server).get(f.detailUrl).expect(200);
        expect(anonymous.body.article).toMatchObject({
            favorited: false, favoritesCount: 2,
        });
        const bobDetail = await request(f.server).get(f.detailUrl)
            .set('Authorization', f.bob.authorization).expect(200);
        expect(bobDetail.body.article).toMatchObject({
            favorited: true, favoritesCount: 2,
        });
        const aliceDetail = await request(f.server).get(f.detailUrl)
            .set('Authorization', f.alice.authorization).expect(200);
        expect(aliceDetail.body.article).toMatchObject({
            favorited: false, favoritesCount: 2,
        });
    }, 40000);

    it('unfavorites an article without removing another user\'s favorite', async () => {
        const f = await fixture(true);
        if (!f.charlie) throw new Error('Missing second viewer');
        await f.favorite(f.bob.authorization);
        await f.favorite(f.charlie.authorization);
        const response = await f.unfavorite(f.bob.authorization);
        expect(response.body.article).toMatchObject({
            favorited: false, favoritesCount: 1,
        });
        expect(await f.favorites.existsBy({
            userId: f.bob.id, articleId: f.article.id,
        })).toBe(false);
        expect(await f.favorites.existsBy({
            userId: f.charlie.id, articleId: f.article.id,
        })).toBe(true);
        await f.expectCount(1);
    }, 40000);

    it('keeps repeated unfavorite requests idempotent', async () => {
        const f = await fixture(true);
        if (!f.charlie) throw new Error('Missing second viewer');
        await f.favorite(f.bob.authorization);
        await f.favorite(f.charlie.authorization);
        await f.unfavorite(f.bob.authorization);
        const response = await f.unfavorite(f.bob.authorization);
        expect(response.body.article).toMatchObject({
            favorited: false, favoritesCount: 1,
        });
        await f.expectCount(1);
    }, 40000);

    it('handles ten concurrent favorites without duplicate relationships', async () => {
        const f = await fixture(true);
        if (!f.charlie) throw new Error('Missing second viewer');
        await f.favorite(f.charlie.authorization);
        const responses = await Promise.all(Array.from({ length: 10 }, () =>
            f.favorite(f.bob.authorization),
        ));
        for (const response of responses) {
            expect(response.body.article).toMatchObject({
                favorited: true, favoritesCount: 2,
            });
        }
        expect(await f.favorites.countBy({
            userId: f.bob.id, articleId: f.article.id,
        })).toBe(1);
        await f.expectCount(2);
    }, 40000);

    it('handles ten concurrent unfavorites and preserves other favorites', async () => {
        const f = await fixture(true);
        if (!f.charlie) throw new Error('Missing second viewer');
        await f.favorite(f.bob.authorization);
        await f.favorite(f.charlie.authorization);
        const responses = await Promise.all(Array.from({ length: 10 }, () =>
            f.unfavorite(f.bob.authorization),
        ));
        for (const response of responses) {
            expect(response.body.article).toMatchObject({
                favorited: false, favoritesCount: 1,
            });
        }
        expect(await f.favorites.countBy({
            userId: f.bob.id, articleId: f.article.id,
        })).toBe(0);
        expect(await f.favorites.existsBy({
            userId: f.charlie.id, articleId: f.article.id,
        })).toBe(true);
        await f.expectCount(1);
    }, 40000);

    it('keeps article listing and favorite filters consistent after favoriting', async () => {
        const f = await fixture(true);
        if (!f.charlie) throw new Error('Missing second viewer');
        await f.favorite(f.bob.authorization);
        await f.favorite(f.charlie.authorization);
        const listing = await request(f.server).get('/api/articles')
            .set('Authorization', f.bob.authorization)
            .query({ tag: f.scopeTag }).expect(200);
        expect(listing.body.articlesCount).toBe(1);
        expect(listing.body.articles).toMatchObject([
            { slug: f.slug, favorited: true, favoritesCount: 2 },
        ]);
        const filtered = await request(f.server).get('/api/articles')
            .query({ tag: f.scopeTag, favorited: f.bob.username }).expect(200);
        expect(filtered.body.articlesCount).toBe(1);
        expect(filtered.body.articles.map((item: { slug: string }) => item.slug))
            .toEqual([f.slug]);
    }, 40000);

    it('updates article listing and favorite filters after unfavoriting', async () => {
        const f = await fixture(true);
        if (!f.charlie) throw new Error('Missing second viewer');
        await f.favorite(f.bob.authorization);
        await f.favorite(f.charlie.authorization);
        await f.unfavorite(f.bob.authorization);
        const filtered = await request(f.server).get('/api/articles')
            .query({ tag: f.scopeTag, favorited: f.bob.username }).expect(200);
        expect(filtered.body.articles).toEqual([]);
        expect(filtered.body.articlesCount).toBe(0);
        const listing = await request(f.server).get('/api/articles')
            .set('Authorization', f.bob.authorization)
            .query({ tag: f.scopeTag }).expect(200);
        expect(listing.body.articlesCount).toBe(1);
        expect(listing.body.articles).toMatchObject([
            { slug: f.slug, favorited: false, favoritesCount: 1 },
        ]);
        await f.expectCount(1);
    }, 40000);

    it('cascades favorites when an article is deleted', async () => {
        const f = await fixture();
        await f.favorite(f.bob.authorization);
        await f.expectCount(1);
        await request(f.server).delete(f.detailUrl)
            .set('Authorization', f.alice.authorization).expect(204);
        await f.expectCount(0);
        expect(await f.articles.existsBy({ id: f.article.id })).toBe(false);
        await request(f.server).post(f.favoriteUrl)
            .set('Authorization', f.bob.authorization).expect(404);
    }, 40000);
});

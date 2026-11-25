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

describe('Article Feed E2E', () => {
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
        const username = `feed_${identity}`;
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

    const feedUrl = '/api/articles/feed';

    type TestUser = Awaited<ReturnType<typeof registerUser>>;

    async function createArticle(
        author: TestUser,
        title: string,
        scopeTag: string,
        createdAt: string,
    ) {
        const { server, db } = context();
        const response = await request(server)
            .post('/api/articles')
            .set('Authorization', author.authorization)
            .send({ article: {
                title,
                description: `Description of ${title}`,
                body: `Body of ${title}`,
                tagList: [scopeTag],
            } })
            .expect(201);

        const articles = db.getRepository(Article);
        const article = await articles.findOneByOrFail({
            slug: response.body.article.slug as string,
        });
        await articles.update({ id: article.id }, {
            createdAt: new Date(createdAt),
        });
        return article;
    }

    async function follow(viewer: TestUser, author: TestUser) {
        const { server } = context();
        await request(server)
            .post(`/api/profiles/${author.username}/follow`)
            .set('Authorization', viewer.authorization)
            .expect(200);
    }

    async function unfollow(viewer: TestUser, author: TestUser) {
        const { server } = context();
        await request(server)
            .delete(`/api/profiles/${author.username}/follow`)
            .set('Authorization', viewer.authorization)
            .expect(204);
    }

    async function getFeed(viewer: TestUser, query: { limit?: number; offset?: number } = {}) {
        const { server } = context();
        return request(server)
            .get(feedUrl)
            .set('Authorization', viewer.authorization)
            .query(query)
            .expect(200);
    }

    function slugs(items: Array<{ slug: string }>): string[] {
        return items.map((item) => item.slug);
    }

    // Every call creates a separate set of users, articles and tags.
    // No test depends on a relationship or article from another test.
    async function fixture() {
        const { db } = context();
        const viewer = await registerUser();
        const alice = await registerUser();
        const bob = await registerUser();
        const outsider = await registerUser();
        const scopeTag = makeTag('feed');
        const aliceA1 = await createArticle(alice, 'Alice Article 1', scopeTag, '2025-01-01T00:00:00.000Z');
        const aliceA2 = await createArticle(alice, 'Alice Article 2', scopeTag, '2025-01-04T00:00:00.000Z');
        const bobB1 = await createArticle(bob, 'Bob Article 1', scopeTag, '2025-01-03T00:00:00.000Z');
        const outsiderX1 = await createArticle(outsider, 'Outsider Article', scopeTag, '2025-01-05T00:00:00.000Z');
        const viewerSelf = await createArticle(viewer, 'Viewer Own Article', scopeTag, '2025-01-06T00:00:00.000Z');

        await db.getRepository(ArticleFavorite).insert([
            { userId: viewer.id, articleId: aliceA1.id },
            { userId: outsider.id, articleId: aliceA2.id },
        ]);

        return { viewer, alice, bob, outsider, scopeTag, aliceA1, aliceA2, bobB1, outsiderX1, viewerSelf };
    }

    async function followedFixture() {
        const f = await fixture();
        await follow(f.viewer, f.alice);
        await follow(f.viewer, f.bob);
        return f;
    }

    it('requires a valid JWT to access the feed', async () => {
        const { server } = context();
        await request(server).get(feedUrl).expect(401);
        await request(server).get(feedUrl)
            .set('Authorization', 'Bearer invalid.token')
            .expect(401);
    });

    it.each([
        'limit=0', 'limit=101', 'limit=-1', 'limit=1.5', 'limit=abc',
        'offset=-1', 'offset=100001', 'offset=1.5', 'offset=abc',
        'tag=nestjs', 'author=alice', 'favorited=bob', 'unknown=value',
    ])('rejects invalid feed query: %s', async (query) => {
        const { server } = context();
        const viewer = await registerUser();
        await request(server).get(`${feedUrl}?${query}`)
            .set('Authorization', viewer.authorization)
            .expect(400);
    }, 40000);

    it('returns an empty feed when the viewer follows nobody', async () => {
        const f = await fixture();
        const result = await getFeed(f.viewer);
        expect(result.body).toMatchObject({ articles: [], articlesCount: 0 });
    }, 40000);

    it('returns articles from one followed author in newest-first order', async () => {
        const f = await fixture();
        await follow(f.viewer, f.alice);
        const result = await getFeed(f.viewer);
        expect(result.body.articlesCount).toBe(2);
        expect(slugs(result.body.articles)).toEqual([f.aliceA2.slug, f.aliceA1.slug]);
        for (const article of result.body.articles) {
            expect(article.author).toMatchObject({ username: f.alice.username, following: true });
        }
    }, 40000);

    it('combines followed authors in newest-first order and excludes unrelated and own articles', async () => {
        const f = await followedFixture();
        const result = await getFeed(f.viewer);
        const actual = slugs(result.body.articles);
        expect(result.body.articlesCount).toBe(3);
        expect(actual).toEqual([f.aliceA2.slug, f.bobB1.slug, f.aliceA1.slug]);
        expect(actual).not.toContain(f.outsiderX1.slug);
        expect(actual).not.toContain(f.viewerSelf.slug);
    }, 40000);

    it('maps viewer-specific favorites, following and tags without exposing private fields', async () => {
        const f = await followedFixture();
        const result = await getFeed(f.viewer);
        expect(result.body.articlesCount).toBe(3);
        expect(result.body.articles).toMatchObject([
            { slug: f.aliceA2.slug, favorited: false, favoritesCount: 1, author: { username: f.alice.username, following: true } },
            { slug: f.bobB1.slug, favorited: false, favoritesCount: 0, author: { username: f.bob.username, following: true } },
            { slug: f.aliceA1.slug, favorited: true, favoritesCount: 1, author: { username: f.alice.username, following: true } },
        ]);
        for (const article of result.body.articles) {
            expect(article).not.toHaveProperty('body');
            expect(article).not.toHaveProperty('authorId');
            expect(article.author).not.toHaveProperty('email');
            expect(article.author).not.toHaveProperty('passwordHash');
            expect(article.tagList).toEqual([f.scopeTag]);
            expect(typeof article.createdAt).toBe('string');
            expect(typeof article.updatedAt).toBe('string');
        }
    }, 40000);

    it.each([0, 2, 10])('paginates the feed with limit 2 and offset %i while retaining total count', async (offset) => {
        const f = await followedFixture();
        const result = await getFeed(f.viewer, { limit: 2, offset });
        const expected = [f.aliceA2.slug, f.bobB1.slug, f.aliceA1.slug].slice(offset, offset + 2);
        expect(result.body.articlesCount).toBe(3);
        expect(slugs(result.body.articles)).toEqual(expected);
    }, 40000);

    it('keeps article detail consistent with feed viewer state', async () => {
        const f = await followedFixture();
        const { server } = context();
        const feed = await getFeed(f.viewer);
        const item = feed.body.articles.find((a: { slug: string }) => a.slug === f.aliceA1.slug);
        const detail = await request(server).get(`/api/articles/${f.aliceA1.slug}`)
            .set('Authorization', f.viewer.authorization).expect(200);
        const expected = { slug: f.aliceA1.slug, favorited: true, favoritesCount: 1, author: { username: f.alice.username, following: true } };
        expect(item).toMatchObject(expected);
        expect(detail.body.article).toMatchObject(expected);
    }, 40000);

    it('removes only the unfollowed author articles from the feed', async () => {
        const f = await followedFixture();
        expect((await getFeed(f.viewer)).body.articlesCount).toBe(3);
        await unfollow(f.viewer, f.alice);
        const result = await getFeed(f.viewer);
        expect(result.body.articlesCount).toBe(1);
        expect(slugs(result.body.articles)).toEqual([f.bobB1.slug]);
    }, 40000);

    it('returns an empty feed after unfollowing all authors', async () => {
        const f = await followedFixture();
        await unfollow(f.viewer, f.alice);
        await unfollow(f.viewer, f.bob);
        expect((await getFeed(f.viewer)).body).toMatchObject({ articles: [], articlesCount: 0 });
    }, 40000);

    it('updates the feed when following and unfollowing a previously unrelated author', async () => {
        const f = await fixture();
        expect((await getFeed(f.viewer)).body).toMatchObject({ articles: [], articlesCount: 0 });
        await follow(f.viewer, f.outsider);
        const result = await getFeed(f.viewer);
        expect(result.body.articlesCount).toBe(1);
        expect(slugs(result.body.articles)).toEqual([f.outsiderX1.slug]);
        expect(result.body.articles[0].author.following).toBe(true);
        await unfollow(f.viewer, f.outsider);
        expect((await getFeed(f.viewer)).body).toMatchObject({ articles: [], articlesCount: 0 });
    }, 40000);
});

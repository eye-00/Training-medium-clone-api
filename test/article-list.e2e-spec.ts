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
import { Follow } from '../src/profiles/entities/follow.entity.js';

describe('Article Listing E2E', () => {
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
        const username = `lst_${identity}`;
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

    const url = '/api/articles';
    const getSlugs = (items: Array<{ slug: string }>) =>
        items.map((item) => item.slug);

    async function createArticle(
        authorization: string,
        title: string,
        tagList: string[],
        createdAt: Date,
    ) {
        const { server, db } = context();
        const response = await request(server)
            .post(url)
            .set('Authorization', authorization)
            .send({
                article: {
                    title,
                    description: `Description of ${title}`,
                    body: `Body content of ${title}`,
                    tagList,
                },
            })
            .expect(201);

        const articles = db.getRepository(Article);
        const article = await articles.findOneByOrFail({
            slug: response.body.article.slug as string,
        });
        await articles.update({ id: article.id }, { createdAt });
        return article;
    }

    // Each call creates independent users, tags, articles and viewer state.
    // All exact count/order assertions are scoped to these unique values.
    async function fixture() {
        const { server, db } = context();
        const scopeTag = makeTag('list_scope');
        const nestjsTag = makeTag('list_nestjs');
        const backendTag = makeTag('list_backend');
        const typescriptTag = makeTag('list_typescript');

        const alice = await registerUser();
        const bob = await registerUser();
        const charlie = await registerUser();

        const articleA = await createArticle(
            alice.authorization, 'Article A',
            [scopeTag, nestjsTag, backendTag],
            new Date('2025-01-01T00:00:00Z'),
        );
        const articleB = await createArticle(
            alice.authorization, 'Article B',
            [scopeTag, typescriptTag],
            new Date('2025-01-02T00:00:00Z'),
        );
        const articleC = await createArticle(
            bob.authorization, 'Article C',
            [scopeTag, nestjsTag, typescriptTag],
            new Date('2025-01-03T00:00:00Z'),
        );
        const articleD = await createArticle(
            bob.authorization, 'Article D',
            [scopeTag, backendTag],
            new Date('2025-01-04T00:00:00Z'),
        );

        // Seed viewer relationships; favorite/follow writes have their own suites.
        await db.getRepository(ArticleFavorite).insert([
            { userId: charlie.id, articleId: articleA.id },
            { userId: bob.id, articleId: articleB.id },
            { userId: charlie.id, articleId: articleC.id },
        ]);
        await db.getRepository(Follow).insert({
            followerId: charlie.id,
            followedId: alice.id,
        });

        return {
            server, scopeTag, nestjsTag, backendTag, typescriptTag,
            alice, bob, charlie, articleA, articleB, articleC, articleD,
        };
    }

    it('returns a public article list with the default page size', async () => {
        const { server } = await fixture();
        const response = await request(server).get(url).expect(200);

        expect(Array.isArray(response.body.articles)).toBe(true);
        expect(response.body.articles.length).toBeLessThanOrEqual(20);
        // Other suites may have articles in the same database.
        expect(response.body.articlesCount).toBeGreaterThanOrEqual(4);
    }, 40000);

    it('sorts scoped articles newest first and exposes only public list fields', async () => {
        const f = await fixture();
        const response = await request(f.server)
            .get(url).query({ tag: f.scopeTag }).expect(200);

        expect(response.body.articlesCount).toBe(4);
        expect(getSlugs(response.body.articles)).toEqual([
            f.articleD.slug, f.articleC.slug, f.articleB.slug, f.articleA.slug,
        ]);
        for (const item of response.body.articles) {
            expect(item.favorited).toBe(false);
            expect(item.author.following).toBe(false);
            expect(item).not.toHaveProperty('body');
            expect(item).not.toHaveProperty('authorId');
            expect(item.author).not.toHaveProperty('email');
            expect(item.author).not.toHaveProperty('passwordHash');
        }
    }, 40000);

    it('filters articles by tag regardless of case', async () => {
        const f = await fixture();
        const response = await request(f.server)
            .get(url).query({ tag: f.nestjsTag.toUpperCase() }).expect(200);

        expect(response.body.articlesCount).toBe(2);
        expect(getSlugs(response.body.articles)).toEqual([
            f.articleC.slug, f.articleA.slug,
        ]);
    }, 40000);

    it('filters articles by author username', async () => {
        const f = await fixture();
        const response = await request(f.server)
            .get(url).query({ author: f.alice.username }).expect(200);

        expect(response.body.articlesCount).toBe(2);
        expect(getSlugs(response.body.articles)).toEqual([
            f.articleB.slug, f.articleA.slug,
        ]);
    }, 40000);

    it('filters articles by the username that favorited them', async () => {
        const f = await fixture();
        const response = await request(f.server)
            .get(url).query({ favorited: f.charlie.username }).expect(200);

        expect(response.body.articlesCount).toBe(2);
        expect(getSlugs(response.body.articles)).toEqual([
            f.articleC.slug, f.articleA.slug,
        ]);
    }, 40000);

    it('combines tag, author and favorited filters using AND', async () => {
        const f = await fixture();
        const response = await request(f.server)
            .get(url)
            .query({
                tag: f.nestjsTag,
                author: f.alice.username,
                favorited: f.charlie.username,
            })
            .expect(200);

        expect(response.body.articlesCount).toBe(1);
        expect(getSlugs(response.body.articles)).toEqual([f.articleA.slug]);
    }, 40000);

    it.each([0, 2])('paginates articles with limit 2 and offset %i while retaining total count', async (offset) => {
        const f = await fixture();
        const expected = [f.articleD.slug, f.articleC.slug, f.articleB.slug, f.articleA.slug];
        const response = await request(f.server)
            .get(url).query({ tag: f.scopeTag, limit: 2, offset }).expect(200);

        expect(response.body.articlesCount).toBe(4);
        expect(getSlugs(response.body.articles)).toEqual(expected.slice(offset, offset + 2));
    }, 40000);

    it('returns an empty page but retains the total count beyond the last offset', async () => {
        const f = await fixture();
        const response = await request(f.server)
            .get(url).query({ tag: f.scopeTag, limit: 2, offset: 10 }).expect(200);

        expect(response.body.articles).toEqual([]);
        expect(response.body.articlesCount).toBe(4);
    }, 40000);

    it('returns zero articles and zero total for a nonmatching filter', async () => {
        const { server } = context();
        const missingTag = `missing_${randomUUID().replaceAll('-', '')}`;
        const response = await request(server)
            .get(url).query({ tag: missingTag }).expect(200);

        expect(response.body.articles).toEqual([]);
        expect(response.body.articlesCount).toBe(0);
    }, 40000);

    it('maps favorites, follow state and tag names for an authenticated viewer', async () => {
        const f = await fixture();
        const response = await request(f.server)
            .get(url)
            .set('Authorization', f.charlie.authorization)
            .query({ tag: f.scopeTag })
            .expect(200);

        expect(response.body.articlesCount).toBe(4);
        expect(response.body.articles).toMatchObject([
            {
                slug: f.articleD.slug, favorited: false, favoritesCount: 0,
                author: { username: f.bob.username, following: false },
            },
            {
                slug: f.articleC.slug, favorited: true, favoritesCount: 1,
                author: { username: f.bob.username, following: false },
            },
            {
                slug: f.articleB.slug, favorited: false, favoritesCount: 1,
                author: { username: f.alice.username, following: true },
            },
            {
                slug: f.articleA.slug, favorited: true, favoritesCount: 1,
                author: { username: f.alice.username, following: true },
            },
        ]);
        const itemA = response.body.articles.find(
            (item: { slug: string }) => item.slug === f.articleA.slug,
        );
        expect(itemA?.tagList).toEqual([f.scopeTag, f.nestjsTag, f.backendTag].sort());
    }, 40000);

    it('rejects an invalid supplied JWT on the public listing endpoint', async () => {
        const { server } = context();
        await request(server).get(url)
            .set('Authorization', 'Bearer invalid.token').expect(401);
    }, 40000);

    it.each([
        'limit=0', 'limit=101', 'limit=-1', 'limit=1.5', 'limit=abc',
        'offset=-1', 'offset=100001', 'offset=1.5', 'offset=abc',
        'tag=', 'author=', 'favorited=', 'unknown=value',
    ])('rejects invalid listing query: %s', async (query) => {
        const { server } = context();
        await request(server).get(`${url}?${query}`).expect(400);
    }, 40000);
});

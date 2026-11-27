import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';

import { Article } from '../src/articles/entities/article.entity.js';
import { ArticleFavorite } from '../src/articles/entities/article-favorite.entity.js';
import { Follow } from '../src/profiles/entities/follow.entity.js';

import {
    createTestApp,
    closeTestApp,
    type TestAppContext,
} from './helpers/test-app.helper.js';

import {
    registerUserFixture,
    cleanupUserFixtures,
    type CreatedUser,
} from './helpers/user-fixture.helper.js';

import {
    createArticleFixture,
    cleanupOwnedTagFixtures,
    createOwnedTagFixture,
    OwnedTagRegistry,
} from './helpers/article-fixture.helper.js';
import { runCleanupStages } from './helpers/cleanup-stages.helper.js';

describe('Article Listing E2E', () => {

    let testApp: TestAppContext | undefined;

    const createdUsers: CreatedUser[] = [];
    const createdTags = new OwnedTagRegistry();

    beforeAll(async () => {
        testApp = await createTestApp();
    });

    afterAll(async () => {
        if (!testApp) return;

        await closeTestApp(
            testApp,
            async ({ db, identity }) => {
                await runCleanupStages([
                    () => cleanupUserFixtures(db, createdUsers),
                    () => cleanupOwnedTagFixtures(db, createdTags, identity.serverUuid),
                ]);
            },
        );
    });

    function context(): TestAppContext {
        if (!testApp) {
            throw new Error('Test app is not ready');
        }

        return testApp;
    }

    async function makeTag(prefix: string): Promise<string> {
        const name = `${prefix}_${randomUUID().replaceAll('-', '')}`;
        const { db, identity } = context();
        return (await createOwnedTagFixture(db, createdTags, name, identity.serverUuid)).name;
    }


    function registerUser() {
        return registerUserFixture(
            context(),
            createdUsers,
            { prefix: 'lst' },
        );
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
        const { db } = context();

        const { saved: article } =
            await createArticleFixture(
                context(),
                authorization,
                {
                    title,
                    description: `Description of ${title}`,
                    body: `Body content of ${title}`,
                    tagList,
                },
            );

        await db.getRepository(Article).update(
            { id: article.id },
            { createdAt },
        );

        return article;
    }


    // Each call creates independent users, tags, articles and viewer state.
    // All exact count/order assertions are scoped to these unique values.
    async function fixture() {
        const { server, db } = context();
        const scopeTag = await makeTag('list_scope');
        const nestjsTag = await makeTag('list_nestjs');
        const backendTag = await makeTag('list_backend');
        const typescriptTag = await makeTag('list_typescript');

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

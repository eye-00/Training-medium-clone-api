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

import {
    createTestApp,
    closeTestApp,
    type TestAppContext,
} from './helpers/test-app.helper.js';

import {
    registerUserFixture,
} from './helpers/user-fixture.helper.js';

import {
    seedTagFixture,
    createArticleFixture,
} from './helpers/article-fixture.helper.js';

describe('Article Feed E2E', () => {

    let testApp: TestAppContext | undefined;


    beforeAll(async () => {
        testApp = await createTestApp({
            listen: true,
        });
    });

    afterAll(async () => {
        if (testApp) await closeTestApp(testApp);
    });

    function context(): TestAppContext {
        if (!testApp) {
            throw new Error('Test app is not ready');
        }

        return testApp;
    }

    async function makeTag(prefix: string): Promise<string> {
        const name = `${prefix}_${randomUUID().replaceAll('-', '')}`;
        const { db } = context();
        return seedTagFixture(db, name);
    }


    function registerUser() {
        return registerUserFixture(
            context(),
            { prefix: 'feed' },
        );
    }

    const feedUrl = '/api/articles/feed';

    type TestUser = Awaited<ReturnType<typeof registerUser>>;


    async function createArticle(
        author: TestUser,
        title: string,
        scopeTag: string,
        createdAt: string,
    ) {
        const { db } = context();

        const { saved: article } =
            await createArticleFixture(
                context(),
                author.authorization,
                {
                    title,
                    description: `Description of ${title}`,
                    body: `Body of ${title}`,
                    tagList: [scopeTag],
                },
            );

        await db.getRepository(Article).update(
            { id: article.id },
            { createdAt: new Date(createdAt) },
        );

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
        const scopeTag = await makeTag('feed');
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

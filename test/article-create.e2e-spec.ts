import {
    createTestApp,
    closeTestApp,
    type TestAppContext,
} from './helpers/test-app.helper.js';

import {
    registerUserFixture,
} from './helpers/user-fixture.helper.js';

import {
    makeUniqueTag,
} from './helpers/article-fixture.helper.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { In } from 'typeorm';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';

import { Article } from '../src/articles/entities/article.entity.js';
import { Tag } from '../src/articles/entities/tag.entity.js';
import { ArticleTag } from '../src/articles/entities/article-tag.entity.js';

describe('Article Create E2E', () => {

    let testApp: TestAppContext | undefined;


    beforeAll(async () => {
        testApp = await createTestApp();
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

    function makeTag(prefix: string): string {
        return makeUniqueTag(
            prefix,
        );
    }

    function makePayload(tagList: string[]) {
        return {
            article: {
                title: 'Getting Started with NestJS',
                description: 'A beginner guide',
                body: 'Learning how NestJS and TypeORM work.',
                tagList,
            },
        };
    }


    async function registerAuthor() {
        const user = await registerUserFixture(
            context(),
            { prefix: 'article' },
        );

        return {
            userId: user.id,
            username: user.username,
            authorization: user.authorization,
        };
    }


    async function createArticle(
        authorization: string,
        payload: ReturnType<typeof makePayload>,
    ) {
        const { server } = context();
        return request(server)
            .post('/api/articles')
            .set('Authorization', authorization)
            .send(payload)
            .expect(201);
    }

    it('requires authentication to create an article', async () => {
        const { server } = context();
        const payload = makePayload([]);

        await request(server)
            .post('/api/articles')
            .send(payload)
            .expect(401);

        await request(server)
            .post('/api/articles')
            .set('Authorization', 'Bearer invalid.token')
            .send(payload)
            .expect(401);
    });

    it('rejects malformed create input without persisting an article', async () => {
        const { server, db } = context();
        const author = await registerAuthor();
        const tag = makeTag('invalid');
        const payload = makePayload([tag]);

        await request(server)
            .post('/api/articles')
            .set('Authorization', author.authorization)
            .send({})
            .expect(400);

        for (const invalidArticle of [null, [], { ...payload.article, extra: true }]) {
            await request(server)
                .post('/api/articles')
                .set('Authorization', author.authorization)
                .send({ article: invalidArticle })
                .expect(400);
        }

        await request(server)
            .post('/api/articles')
            .set('Authorization', author.authorization)
            .send({ article: { ...payload.article, title: '   ' } })
            .expect(400);

        await request(server)
            .post('/api/articles')
            .set('Authorization', author.authorization)
            .send({ article: { ...payload.article, authorId: randomUUID() } })
            .expect(400);

        expect(await db.getRepository(Article).countBy({
            authorId: author.userId,
        })).toBe(0);
        expect(await db.getRepository(Tag).countBy({ name: tag })).toBe(0);
    });

    it('round-trips a slug when truncation crosses a supplementary character', async () => {
        const { server, db } = context();
        const author = await registerAuthor();
        const title = 'a'.repeat(179) + '𠀀';
        const payload = makePayload([]);
        payload.article.title = title;

        const created = await createArticle(author.authorization, payload);
        const slug = created.body.article.slug as string;
        const saved = await db.getRepository(Article).findOneByOrFail({ slug });
        expect(saved.title).toBe(title);
        expect(slug).toBe(`${'a'.repeat(179)}-${saved.id}`);
        expect(() => encodeURIComponent(slug)).not.toThrow();
        const response = await request(server)
            .get(`/api/articles/${encodeURIComponent(slug)}`).expect(200);
        expect(response.body.article.slug).toBe(slug);
        expect(response.body.article.title).toBe(title);
    }, 30000);

    it('persists a created article and normalized tag relationships', async () => {
        const { server, db } = context();
        const author = await registerAuthor();
        const tagA = makeTag('backend');
        const tagB = makeTag('nestjs');
        const payload = makePayload([
            ` ${tagB.toUpperCase()} `,
            tagB,
            ` ${tagA.toUpperCase()} `,
        ]);

        const created = await createArticle(author.authorization, payload);
        const article = created.body.article as {
            slug: string;
            title: string;
            tagList: string[];
            createdAt: string;
            updatedAt: string;
            favorited: boolean;
            favoritesCount: number;
            author: { username: string; following: boolean };
        };

        expect(article.slug).toMatch(
            /^getting-started-with-nestjs-[0-9a-f-]{36}$/,
        );
        expect(article.title).toBe(payload.article.title);
        expect(article.tagList).toEqual([tagA, tagB].sort());
        expect(article.favorited).toBe(false);
        expect(article.favoritesCount).toBe(0);
        expect(article.author).toMatchObject({
            username: author.username,
            following: false,
        });
        expect(Number.isNaN(Date.parse(article.createdAt))).toBe(false);
        expect(Number.isNaN(Date.parse(article.updatedAt))).toBe(false);

        const saved = await db.getRepository(Article).findOneByOrFail({
            slug: article.slug,
        });
        expect(saved.authorId).toBe(author.userId);
        expect(saved.body).toBe(payload.article.body);

        const links = await db.getRepository(ArticleTag).findBy({
            articleId: saved.id,
        });
        expect(links).toHaveLength(2);

        const storedTags = await db.getRepository(Tag).findBy({
            id: In(links.map((link) => link.tagId)),
        });
        expect(storedTags.map((tag) => tag.name).sort())
            .toEqual([tagA, tagB].sort());

        const detail = await request(server)
            .get(`/api/articles/${article.slug}`)
            .expect(200);
        expect(created.body.article.tagList)
            .toEqual(detail.body.article.tagList);
    });

    it('returns only public author fields to anonymous and authenticated readers', async () => {
        const { server } = context();
        const author = await registerAuthor();
        const viewer = await registerAuthor();
        expect(viewer.userId).not.toBe(author.userId);
        const tagA = makeTag('backend');
        const tagB = makeTag('nestjs');
        const payload = makePayload([tagA, tagB]);

        const created = await createArticle(author.authorization, payload);
        const slug = created.body.article.slug as string;

        const publicRead = await request(server)
            .get(`/api/articles/${slug}`)
            .expect(200);

        expect(publicRead.body.article).toMatchObject({
            slug,
            title: payload.article.title,
            description: payload.article.description,
            body: payload.article.body,
            tagList: [tagA, tagB].sort(),
            favoritesCount: 0,
            favorited: false,
            author: {
                username: author.username,
                following: false,
            },
        });

        expect(Object.keys(publicRead.body.article.author).sort()).toEqual([
            'bio', 'following', 'image', 'username',
        ]);
        expect(publicRead.body.article.author).toEqual({
            username: author.username,
            bio: null,
            image: null,
            following: false,
        });

        await request(server)
            .post(`/api/profiles/${author.username}/follow`)
            .set('Authorization', viewer.authorization)
            .expect(200);

        const authenticatedRead = await request(server)
            .get(`/api/articles/${slug}`)
            .set('Authorization', viewer.authorization)
            .expect(200);

        expect(authenticatedRead.body.article.slug).toBe(slug);
        expect(authenticatedRead.body.article.favorited).toBe(false);
        expect(Object.keys(authenticatedRead.body.article.author).sort()).toEqual([
            'bio', 'following', 'image', 'username',
        ]);
        expect(authenticatedRead.body.article.author).toEqual({
            username: author.username,
            bio: null,
            image: null,
            following: true,
        });
    });

    it('rejects an invalid JWT on a public article endpoint', async () => {
        const { server } = context();
        const author = await registerAuthor();
        const created = await createArticle(
            author.authorization,
            makePayload([]),
        );
        const slug = created.body.article.slug as string;

        await request(server)
            .get(`/api/articles/${slug}`)
            .set('Authorization', 'Bearer invalid.token')
            .expect(401);
    });

    it('returns 404 for an unknown article slug', async () => {
        const { server } = context();
        await request(server)
            .get(`/api/articles/nonexistent-${randomUUID()}`)
            .expect(404);
    });

    it('creates distinct slugs for identical titles and reuses tags', async () => {
        const { db } = context();
        const author = await registerAuthor();
        const tagA = makeTag('backend');
        const tagB = makeTag('nestjs');
        const payload = makePayload([tagA, tagB]);

        const first = await createArticle(author.authorization, payload);
        const second = await createArticle(author.authorization, payload);

        expect(second.body.article.slug)
            .not.toBe(first.body.article.slug);
        expect(await db.getRepository(Article).countBy({
            authorId: author.userId,
        })).toBe(2);
        expect(await db.getRepository(Tag).countBy({
            name: In([tagA, tagB]),
        })).toBe(2);

        const articleIds = await db.getRepository(Article).find({
            where: { authorId: author.userId },
        });
        const links = await db.getRepository(ArticleTag).findBy({
            articleId: In(articleIds.map((article) => article.id)),
        });
        expect(links).toHaveLength(4);
    });
});

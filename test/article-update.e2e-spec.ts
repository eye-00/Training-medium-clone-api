import {
    createTestApp,
    closeTestApp,
    type TestAppContext,
} from './helpers/test-app.helper.js';

import {
    registerUserFixture,
} from './helpers/user-fixture.helper.js';

import {
    createArticleFixture,
    makeUniqueTag,
} from './helpers/article-fixture.helper.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { In, QueryFailedError, type EntityManager } from 'typeorm';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { Article } from '../src/articles/entities/article.entity.js';
import { Tag } from '../src/articles/entities/tag.entity.js';
import { ArticleTag } from '../src/articles/entities/article-tag.entity.js';

import { ArticlesService } from '../src/articles/articles.service.js';

describe('Article Update E2E', () => {

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


    function registerUser() {
        return registerUserFixture(
            context(),
            { prefix: 'edit' },
        );
    }


    async function fixture() {
        const { server, db } = context();

        const owner = await registerUser();

        const oldTag = makeTag('nestjs');
        const keptTag = makeTag('backend');
        const newTag = makeTag('typescript');

        const initial = {
            title: 'Original NestJS Guide',
            description: 'Original description',
            body: 'Original article body',
        };

        const { saved, response } =
            await createArticleFixture(
                context(),
                owner.authorization,
                {
                    ...initial,
                    tagList: [oldTag, keptTag],
                },
            );

        expect(saved.authorId).toBe(owner.id);

        const slug = response.slug;

        return {
            server,
            db,
            owner,
            initial,
            oldTag,
            keptTag,
            newTag,
            slug,
            url: `/api/articles/${slug}`,
            saved,
            initialTags: [keptTag, oldTag].sort(),
            createdAt: response.createdAt,
            updatedAt: response.updatedAt,
        };
    }


    async function expectUnchanged(f: Awaited<ReturnType<typeof fixture>>) {
        const stored = await f.db.getRepository(Article).findOneByOrFail({ id: f.saved.id });
        expect(stored).toMatchObject({ ...f.initial, slug: f.slug, authorId: f.owner.id });
        expect(stored.updatedAt.toISOString()).toBe(f.updatedAt);
        const detail = await request(f.server).get(f.url).expect(200);
        expect(detail.body.article.tagList).toEqual(f.initialTags);
    }

    it('requires a valid JWT to update an article', async () => {
        const f = await fixture();
        const payload = { article: { title: 'Unauthorized change' } };
        await request(f.server).put(f.url).send(payload).expect(401);
        await request(f.server).put(f.url)
            .set('Authorization', 'Bearer invalid.token').send(payload).expect(401);
        await expectUnchanged(f);
    }, 30000);

    it('forbids non-authors from updating an article', async () => {
        const f = await fixture();
        const other = await registerUser();
        await request(f.server).put(f.url)
            .set('Authorization', other.authorization)
            .send({ article: { title: 'Hacked title', tagList: [f.newTag] } })
            .expect(403);
        await expectUnchanged(f);
    }, 30000);

    it('returns 404 when updating an unknown slug', async () => {
        const { server } = context();
        const owner = await registerUser();
        await request(server).put(`/api/articles/missing-${randomUUID()}`)
            .set('Authorization', owner.authorization)
            .send({ article: { title: 'New title' } }).expect(404);
    }, 30000);

    const invalidUpdates: Array<[string, unknown]> = [
        ['missing article', {}],
        ['null article', { article: null }],
        ['array article', { article: [] }],
        ['empty article', { article: {} }],
        ['blank title', { article: { title: '   ' } }],
        ['null title', { article: { title: null } }],
        ['null description', { article: { description: null } }],
        ['null tagList', { article: { tagList: null } }],
        ['empty tag name', { article: { tagList: [''] } }],
        ['undeclared authorId', { article: { authorId: randomUUID() } }],
    ];

    it.each(invalidUpdates)('rejects invalid update: %s', async (_name, payload) => {
        const f = await fixture();
        await request(f.server).put(f.url)
            .set('Authorization', f.owner.authorization)
            .send(payload as object).expect(400);
        await expectUnchanged(f);
    }, 30000);

    it('does not partially apply a mixed valid and invalid update', async () => {
        const f = await fixture();
        const before = await f.db.getRepository(ArticleTag).findBy({ articleId: f.saved.id });
        await request(f.server).put(f.url)
            .set('Authorization', f.owner.authorization)
            .send({ article: { title: 'Valid new title', description: null, tagList: [f.newTag] } })
            .expect(400);
        await expectUnchanged(f);
        const after = await f.db.getRepository(ArticleTag).findBy({ articleId: f.saved.id });
        expect(after.map((link) => link.tagId).sort()).toEqual(before.map((link) => link.tagId).sort());
        expect(await f.db.getRepository(Tag).countBy({ name: f.newTag })).toBe(0);
    }, 30000);

    it('round-trips an updated slug when truncation crosses a supplementary character', async () => {
        const f = await fixture();
        const title = 'a'.repeat(179) + '𠀀';
        const response = await request(f.server).put(f.url)
            .set('Authorization', f.owner.authorization)
            .send({ article: { title } })
            .expect(200);
        const slug = response.body.article.slug as string;
        const saved = await f.db.getRepository(Article).findOneByOrFail({ id: f.saved.id });
        expect(slug).toBe(`${'a'.repeat(179)}-${saved.id}`);
        expect(() => encodeURIComponent(slug)).not.toThrow();
        expect(saved.slug).toBe(slug);
        expect(saved.title).toBe(title);
        const detail = await request(f.server)
            .get(`/api/articles/${encodeURIComponent(slug)}`).expect(200);
        expect(detail.body.article.slug).toBe(slug);
        expect(detail.body.article.title).toBe(title);
        await request(f.server).get(f.url).expect(404);
    }, 30000);

    it('updates only the description without changing other fields', async () => {
        const f = await fixture();
        const description = 'Updated description';
        const response = await request(f.server).put(f.url)
            .set('Authorization', f.owner.authorization)
            .send({ article: { description } }).expect(200);
        expect(response.body.article).toMatchObject({
            ...f.initial, description, slug: f.slug, tagList: f.initialTags,
            createdAt: f.createdAt,
        });
        const stored = await f.db.getRepository(Article).findOneByOrFail({ id: f.saved.id });
        expect(stored).toMatchObject({ ...f.initial, description, slug: f.slug });
    }, 30000);

    it('regenerates the slug when the title changes without creating another article', async () => {
        const f = await fixture();
        const title = 'Updated NestJS Guide';
        const response = await request(f.server).put(f.url)
            .set('Authorization', f.owner.authorization)
            .send({ article: { title } }).expect(200);
        const updatedSlug = response.body.article.slug as string;
        expect(updatedSlug).not.toBe(f.slug);
        expect(updatedSlug).toMatch(/^updated-nestjs-guide-[0-9a-f-]{36}$/);
        expect(response.body.article).toMatchObject({
            ...f.initial, title, tagList: f.initialTags, createdAt: f.createdAt,
        });
        await request(f.server).get(f.url).expect(404);
        await request(f.server).get(`/api/articles/${updatedSlug}`).expect(200);
        const articles = f.db.getRepository(Article);
        expect(await articles.findOneByOrFail({ id: f.saved.id })).toMatchObject({
            ...f.initial, title, slug: updatedSlug, authorId: f.owner.id,
        });
        expect(await articles.countBy({ authorId: f.owner.id })).toBe(1);
    }, 30000);

    it('updates only the body while retaining other fields', async () => {
        const f = await fixture();
        const body = 'Updated body content';
        const response = await request(f.server).put(f.url)
            .set('Authorization', f.owner.authorization)
            .send({ article: { body } }).expect(200);
        expect(response.body.article).toMatchObject({
            ...f.initial, body, slug: f.slug, tagList: f.initialTags, createdAt: f.createdAt,
        });
        expect(await f.db.getRepository(Article).findOneByOrFail({ id: f.saved.id }))
            .toMatchObject({ ...f.initial, body, slug: f.slug });
    }, 30000);

    it('replaces and normalizes tags, advancing updatedAt but not createdAt', async () => {
        const f = await fixture();
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        const expectedTags = [f.keptTag, f.newTag].sort();
        const response = await request(f.server).put(f.url)
            .set('Authorization', f.owner.authorization)
            .send({ article: { tagList: [` ${f.newTag.toUpperCase()} `, f.newTag, f.keptTag] } })
            .expect(200);
        expect(response.body.article).toMatchObject({
            ...f.initial, slug: f.slug, tagList: expectedTags, createdAt: f.createdAt,
        });
        const updatedAt = response.body.article.updatedAt as string;
        expect(Date.parse(updatedAt)).toBeGreaterThan(Date.parse(f.updatedAt));
        const stored = await f.db.getRepository(Article).findOneByOrFail({ id: f.saved.id });
        expect(stored.updatedAt.toISOString()).toBe(updatedAt);
        expect(stored.createdAt.toISOString()).toBe(f.createdAt);
        expect(stored).toMatchObject({ ...f.initial, slug: f.slug, authorId: f.owner.id });
        const links = await f.db.getRepository(ArticleTag).findBy({ articleId: f.saved.id });
        expect(links).toHaveLength(2);
        const tags = await f.db.getRepository(Tag).findBy({ id: In(links.map((link) => link.tagId)) });
        expect(tags.map((tag) => tag.name).sort()).toEqual(expectedTags);
    }, 30000);

    it('retains existing tag relationships when tagList is omitted', async () => {
        const f = await fixture();
        const links = f.db.getRepository(ArticleTag);
        const before = await links.findBy({ articleId: f.saved.id });
        const response = await request(f.server).put(f.url)
            .set('Authorization', f.owner.authorization)
            .send({ article: { description: 'Tags should remain' } }).expect(200);
        expect(response.body.article.tagList).toEqual(f.initialTags);
        const after = await links.findBy({ articleId: f.saved.id });
        expect(after.map((link) => link.tagId).sort()).toEqual(before.map((link) => link.tagId).sort());
    }, 30000);

    it('removes all tag links when tagList is empty without deleting the article', async () => {
        const f = await fixture();
        const response = await request(f.server).put(f.url)
            .set('Authorization', f.owner.authorization)
            .send({ article: { tagList: [] } }).expect(200);
        expect(response.body.article.tagList).toEqual([]);
        expect(await f.db.getRepository(ArticleTag).countBy({ articleId: f.saved.id })).toBe(0);
        const articles = f.db.getRepository(Article);
        expect(await articles.findOneByOrFail({ id: f.saved.id })).toMatchObject({
            ...f.initial, slug: f.slug, authorId: f.owner.id,
        });
        expect(await articles.countBy({ authorId: f.owner.id })).toBe(1);
        expect(await f.db.getRepository(Tag).countBy({ name: In(f.initialTags) })).toBe(2);
    }, 30000);

    it('retries the whole update transaction after a simulated MySQL deadlock', async () => {
        const f = await fixture();
        // Fail the first attempt after the real helper has written its changes.
        // The exception is simulated; the surrounding transaction is real.
        const service = context().app.get(ArticlesService) as unknown as {
            replaceArticleTags: (manager: EntityManager, articleId: string, names: string[]) => Promise<void>;
        };
        const original = service.replaceArticleTags.bind(service);
        const deadlock = new QueryFailedError(
            'simulated deadlock after tag writes', [],
            Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 }),
        );
        let attempts = 0;
        const spy = vi.spyOn(service, 'replaceArticleTags').mockImplementation(async (manager, articleId, names) => {
            attempts++;
            if (attempts === 2) {
                // Before the second attempt writes tag links, the first attempt
                // must have rolled back both its new tag and its link changes.
                expect(await manager.getRepository(Tag).existsBy({ name: f.newTag })).toBe(false);
                const links = await manager.getRepository(ArticleTag).findBy({ articleId });
                const rows = await manager.getRepository(Tag).findBy({ id: In(links.map((link) => link.tagId)) });
                expect(rows.map((tag) => tag.name).sort()).toEqual(f.initialTags);
            }
            await original(manager, articleId, names);
            if (attempts === 1) throw deadlock;
        });
        try {
            const response = await request(f.server).put(f.url)
                .set('Authorization', f.owner.authorization)
                .send({ article: { description: 'Retried update', tagList: [f.newTag] } })
                .expect(200);
            expect(response.body.article).toMatchObject({ description: 'Retried update', tagList: [f.newTag] });
            expect(spy).toHaveBeenCalledTimes(2);
            const detail = await request(f.server).get(f.url).expect(200);
            expect(detail.body.article).toMatchObject({ description: 'Retried update', tagList: [f.newTag] });
            expect(await f.db.getRepository(Tag).countBy({ name: f.newTag })).toBe(1);
        } finally {
            spy.mockRestore();
        }
    }, 30000);
});

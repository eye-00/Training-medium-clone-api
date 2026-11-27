import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Article } from '../src/articles/entities/article.entity.js';
import { ArticleTag } from '../src/articles/entities/article-tag.entity.js';
import { Tag } from '../src/articles/entities/tag.entity.js';
import { User } from '../src/users/entities/user.entity.js';
import { closeTestApp, createTestApp, type TestAppContext } from './helpers/test-app.helper.js';

describe('Article storage validation E2E', () => {
    let app: TestAppContext | undefined;

    beforeAll(async () => { app = await createTestApp(); });
    afterAll(async () => {
        if (app) await closeTestApp(app);
    });

    function context(): TestAppContext {
        if (!app) throw new Error('Test app not initialized');
        return app;
    }

    async function actor() {
        const { db, server } = context();
        const suffix = randomUUID().replaceAll('-', '');
        const email = `storage-${suffix}@example.com`;
        const username = `storage_${suffix}`;
        const password = randomBytes(32).toString('base64url');
        if (await db.getRepository(User).exists({ where: [{ email }, { username }] })) {
            throw new Error('Generated test user already exists');
        }
        const registration = await request(server).post('/api/users')
            .send({ email, username, password }).expect(201);
        const id: unknown = registration.body.user?.id;
        if (typeof id !== 'string' || !id) throw new Error('Missing test user ID');
        const login = await request(server).post('/api/users/login')
            .send({ email, password }).expect(200);
        const token: unknown = login.body.accessToken;
        if (typeof token !== 'string' || !token) throw new Error('Missing test token');
        return { id, authorization: `Bearer ${token}` };
    }

    async function ownTag(name: string) {
        const tags = context().db.getRepository(Tag);
        // The equality lookup uses the column collation, including accent folding.
        if (await tags.existsBy({ name })) throw new Error('Generated test tag already exists');
        const id = randomUUID();
        if (await tags.existsBy({ id })) throw new Error('Generated test tag ID already exists');
        await tags.insert({ id, name });
        return id;
    }

    async function expectTagInitiallyAbsent(name: string) {
        if (await context().db.getRepository(Tag).existsBy({ name })) {
            throw new Error('Generated test tag already exists');
        }
    }

    async function create(authorization: string, title: string, tagList: string[]) {
        return request(context().server).post('/api/articles')
            .set('Authorization', authorization)
            .send({ article: { title, description: 'storage validation', body: 'test body', tagList } });
    }

    it('accepts 255 title characters and rejects 256 without creating an article', async () => {
        const user = await actor();
        const articles = context().db.getRepository(Article);
        const title = '✈️'.repeat(127) + '✈';
        const tooLong = '✈️'.repeat(128);
        expect(Array.from(title)).toHaveLength(255);
        expect(Array.from(tooLong)).toHaveLength(256);
        const accepted = await create(user.authorization, title, []);
        expect(accepted.status).toBe(201);
        expect(accepted.body.article.title).toBe(title);
        const saved = await articles.findOneByOrFail({ slug: accepted.body.article.slug as string });
        expect(saved.title).toBe(title);
        const before = await articles.countBy({ authorId: user.id });
        expect(before).toBe(1);
        const rejected = await create(user.authorization, tooLong, []);
        expect(rejected.status).toBe(400);
        expect(await articles.countBy({ authorId: user.id })).toBe(before);
    }, 30000);

    it('accepts a 100-codepoint tag and rejects a longer variation sequence', async () => {
        const user = await actor();
        const prefix = randomUUID().replaceAll('-', '');
        const valid = prefix + '✈️'.repeat(34);
        const invalid = prefix + '✈️'.repeat(35);
        expect(Array.from(valid)).toHaveLength(100);
        expect(Array.from(invalid)).toHaveLength(102);
        const tagId = await ownTag(valid);
        const tags = context().db.getRepository(Tag);
        await expectTagInitiallyAbsent(invalid);
        const accepted = await create(user.authorization, 'Valid tag', [valid]);
        expect(accepted.status).toBe(201);
        expect(accepted.body.article.tagList).toEqual([valid]);
        expect((await tags.findOneByOrFail({ id: tagId })).name).toBe(valid);
        const slug = accepted.body.article.slug as string;
        const article = await context().db.getRepository(Article).findOneByOrFail({ slug });
        expect(await context().db.getRepository(ArticleTag).existsBy({ articleId: article.id, tagId })).toBe(true);
        const before = await context().db.getRepository(Article).countBy({ authorId: user.id });
        const rejected = await create(user.authorization, 'Invalid tag', [invalid]);
        expect(rejected.status).toBe(400);
        expect(await context().db.getRepository(Article).countBy({ authorId: user.id })).toBe(before);
        expect(await tags.existsBy({ name: invalid })).toBe(false);
    }, 30000);

    it('rejects lowercase expansion without changing an existing article or tags', async () => {
        const owner = await actor();
        const outsider = await actor();
        const prefix = randomUUID().replaceAll('-', '');
        const valid = prefix + 'a'.repeat(66) + 'İ';
        const invalid = prefix + 'a'.repeat(67) + 'İ';
        const validName = valid.toLowerCase();
        const invalidName = invalid.toLowerCase();
        expect(Array.from(validName)).toHaveLength(100);
        expect(Array.from(invalid)).toHaveLength(100);
        expect(Array.from(invalidName)).toHaveLength(101);
        const tagId = await ownTag(validName);
        const tags = context().db.getRepository(Tag);
        await expectTagInitiallyAbsent(invalidName);
        const created = await create(owner.authorization, 'Original title', [valid]);
        expect(created.status).toBe(201);
        expect(created.body.article.tagList).toEqual([validName]);
        expect((await tags.findOneByOrFail({ id: tagId })).name).toBe(validName);
        const slug = created.body.article.slug as string;
        const db = context().db;
        const articles = db.getRepository(Article);
        const saved = await articles.findOneByOrFail({ slug });
        const links = db.getRepository(ArticleTag);
        const beforeLinks = await links.findBy({ articleId: saved.id });
        expect(beforeLinks).toHaveLength(1);
        expect(beforeLinks[0].tagId).toBe(tagId);
        const countBefore = await articles.countBy({ authorId: owner.id });
        const rejectedCreate = await create(owner.authorization, 'Invalid expansion', [invalid]);
        expect(rejectedCreate.status).toBe(400);
        expect(await articles.countBy({ authorId: owner.id })).toBe(countBefore);
        expect(await tags.existsBy({ name: invalidName })).toBe(false);

        const newTag = `new_${randomUUID().replaceAll('-', '')}`;
        await expectTagInitiallyAbsent(newTag);
        const oversizedTitle = '✈️'.repeat(128);
        const titlePayload = { article: { title: oversizedTitle, tagList: [newTag] } };
        await request(context().server).put(`/api/articles/${slug}`)
            .set('Authorization', owner.authorization).send(titlePayload).expect(400);
        expect(await articles.findOneByOrFail({ id: saved.id })).toEqual(saved);
        expect(await links.findBy({ articleId: saved.id })).toEqual(beforeLinks);
        expect(await tags.existsBy({ name: newTag })).toBe(false);

        const payload = { article: { body: 'Must not be saved', tagList: [newTag, invalid] } };
        await request(context().server).put(`/api/articles/${slug}`)
            .set('Authorization', outsider.authorization).send(payload).expect(403);
        await request(context().server).put(`/api/articles/${slug}`)
            .set('Authorization', owner.authorization).send(payload).expect(400);
        expect(await articles.findOneByOrFail({ id: saved.id })).toEqual(saved);
        expect(await links.findBy({ articleId: saved.id })).toEqual(beforeLinks);
        expect(await tags.existsBy({ name: invalidName })).toBe(false);
        expect(await tags.existsBy({ name: newTag })).toBe(false);
    }, 30000);
});

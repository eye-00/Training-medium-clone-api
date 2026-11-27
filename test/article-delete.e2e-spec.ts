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

import { User } from '../src/users/entities/user.entity.js';
import { Article } from '../src/articles/entities/article.entity.js';
import { Tag } from '../src/articles/entities/tag.entity.js';
import { ArticleTag } from '../src/articles/entities/article-tag.entity.js';

import { ArticleFavorite } from '../src/articles/entities/article-favorite.entity.js';


describe('Article Delete E2E', () => {

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

    async function makeTag(prefix: string): Promise<string> {
        const name = `${prefix}_${randomUUID().replaceAll('-', '')}`;
        const { db } = context();
        return seedTagFixture(db, name);
    }


    function registerUser() {
        return registerUserFixture(
            context(),
            { prefix: 'del' },
        );
    }


    async function createArticle(
        authorization: string,
        title: string,
        tagList: string[],
    ) {
        const { saved } =
            await createArticleFixture(
                context(),
                authorization,
                {
                    title,
                    description: `Description of ${title}`,
                    body: `Body of ${title}`,
                    tagList,
                },
            );

        return saved;
    }


    async function fixture() {
        const { server, db } = context();
        const owner = await registerUser();
        const oldTag = await makeTag('delete_old');
        const sharedTag = await makeTag('delete_shared');
        const article = await createArticle(
            owner.authorization,
            'Article to delete',
            [oldTag, sharedTag],
        );
        expect(article.authorId).toBe(owner.id);
        return {
            server, db, owner, article, oldTag, sharedTag,
            url: `/api/articles/${article.slug}`,
        };
    }

    it('requires a valid JWT to delete an article', async () => {
        const { server, db, article, url } = await fixture();

        await request(server).delete(url).expect(401);
        await request(server)
            .delete(url)
            .set('Authorization', 'Bearer invalid.token')
            .expect(401);

        expect(await db.getRepository(Article).existsBy({
            id: article.id,
        })).toBe(true);
    }, 30000);

    it('forbids a non-author from deleting an article', async () => {
        const { server, db, article, url } = await fixture();
        const other = await registerUser();

        await request(server)
            .delete(url)
            .set('Authorization', other.authorization)
            .expect(403);

        expect(await db.getRepository(Article).existsBy({
            id: article.id,
        })).toBe(true);
        expect(await db.getRepository(ArticleTag).countBy({
            articleId: article.id,
        })).toBe(2);
        await request(server).get(url).expect(200);
    }, 30000);

    it('returns 404 when deleting an unknown slug', async () => {
        const { server } = context();
        const owner = await registerUser();

        await request(server)
            .delete(`/api/articles/missing-${randomUUID()}`)
            .set('Authorization', owner.authorization)
            .expect(404);
    }, 30000);

    it('allows the author to delete an article and returns an empty 204 response', async () => {
        const { server, db, owner, article, url } = await fixture();

        const deleted = await request(server)
            .delete(url)
            .set('Authorization', owner.authorization)
            .expect(204);
        expect(deleted.text).toBe('');

        expect(await db.getRepository(Article).existsBy({
            id: article.id,
        })).toBe(false);
        await request(server).get(url).expect(404);
        await request(server)
            .delete(url)
            .set('Authorization', owner.authorization)
            .expect(404);
    }, 30000);

    it('cascades article-tag links and favorites when deleting an article', async () => {
        const { server, db, owner, article, url } = await fixture();
        const other = await registerUser();
        const links = db.getRepository(ArticleTag);
        const favorites = db.getRepository(ArticleFavorite);

        // Seed dependent data directly to isolate the deletion contract.
        await favorites.insert({ userId: other.id, articleId: article.id });
        expect(await links.countBy({ articleId: article.id })).toBe(2);
        expect(await favorites.countBy({ articleId: article.id })).toBe(1);

        await request(server)
            .delete(url)
            .set('Authorization', owner.authorization)
            .expect(204);

        expect(await db.getRepository(Article).existsBy({
            id: article.id,
        })).toBe(false);
        expect(await links.countBy({ articleId: article.id })).toBe(0);
        expect(await favorites.countBy({ articleId: article.id })).toBe(0);
    }, 30000);

    it('preserves users, tag records and unrelated articles when deleting an article', async () => {
        const { server, db, owner, article, url, oldTag, sharedTag } = await fixture();
        const other = await registerUser();
        const sibling = await createArticle(
            other.authorization,
            'Article to retain',
            [sharedTag],
        );
        const favorites = db.getRepository(ArticleFavorite);
        const links = db.getRepository(ArticleTag);
        const tags = db.getRepository(Tag);

        await favorites.insert([
            { userId: other.id, articleId: article.id },
            { userId: owner.id, articleId: sibling.id },
        ]);
        const sharedTagRow = await tags.findOneByOrFail({ name: sharedTag });
        expect(await links.countBy({ tagId: sharedTagRow.id })).toBe(2);

        await request(server)
            .delete(url)
            .set('Authorization', owner.authorization)
            .expect(204);

        expect(await db.getRepository(User).countBy({
            id: In([owner.id, other.id]),
        })).toBe(2);
        expect(await tags.countBy({
            name: In([oldTag, sharedTag]),
        })).toBe(2);
        expect(await db.getRepository(Article).existsBy({
            id: sibling.id,
        })).toBe(true);
        expect(await links.countBy({ articleId: sibling.id })).toBe(1);
        expect(await links.countBy({ tagId: sharedTagRow.id })).toBe(1);
        expect(await favorites.countBy({
            userId: owner.id, articleId: sibling.id,
        })).toBe(1);
        expect(await favorites.countBy({ articleId: article.id })).toBe(0);
        const detail = await request(server)
            .get(`/api/articles/${sibling.slug}`)
            .expect(200);
        expect(detail.body.article.tagList).toEqual([sharedTag]);
        expect(detail.body.article.favoritesCount).toBe(1);
    }, 30000);
});

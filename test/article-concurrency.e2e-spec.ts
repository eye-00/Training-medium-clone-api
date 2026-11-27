
import { InternalServerErrorException } from '@nestjs/common';
import request from 'supertest';

import {
    In,
    type EntityManager,
} from 'typeorm';

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
import { ArticleFavorite } from '../src/articles/entities/article-favorite.entity.js';
import { ArticlesService } from '../src/articles/articles.service.js';

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
    cleanupTagFixtures,
    makeUniqueTag,
} from './helpers/article-fixture.helper.js';

describe('Article Concurrency E2E', () => {
    let testApp: TestAppContext | undefined;

    const createdUsers: CreatedUser[] = [];
    const createdTags = new Set<string>();

    beforeAll(async () => {
        testApp = await createTestApp({
            listen: true,
        });
    });

    afterAll(async () => {
        if (!testApp) return;

        await closeTestApp(
            testApp,
            async ({ db }) => {
                await cleanupUserFixtures(
                    db,
                    createdUsers,
                );

                await cleanupTagFixtures(
                    db,
                    createdTags,
                );
            },
        );
    });

    function context(): TestAppContext {
        if (!testApp) {
            throw new Error('Test app is not ready');
        }

        return testApp;
    }

    function makeTag(prefix: string): string {
        return makeUniqueTag(
            createdTags,
            prefix,
        );
    }

    function registerUser() {
        return registerUserFixture(
            context(),
            createdUsers,
            { prefix: 'tx' },
        );
    }

    type Actor = Awaited<ReturnType<typeof registerUser>>;

    async function createArticle(
        owner: Actor,
        tagList: string[],
        title = 'Transaction Concurrency Test',
    ) {
        const { server, db } = context();
        const input = {
            title,
            description: 'Original description',
            body: 'Original body',
            tagList,
        };
        const response = await request(server)
            .post('/api/articles')
            .set('Authorization', owner.authorization)
            .send({ article: input })
            .expect(201);
        const slug = response.body.article.slug as string;
        const saved = await db.getRepository(Article).findOneByOrFail({ slug });
        return { saved, slug, url: `/api/articles/${slug}`, input, response };
    }

    async function fixture() {
        const { server, db } = context();
        const owner = await registerUser();
        const initialTag = makeTag('tx_initial');
        const article = await createArticle(owner, [initialTag]);
        return { server, db, owner, initialTag, ...article };
    }

    async function storedTags(articleId: string) {
        const { db } = context();
        const links = await db.getRepository(ArticleTag).findBy({ articleId });
        const tags = links.length === 0 ? [] : await db.getRepository(Tag).findBy({
            id: In(links.map((link) => link.tagId)),
        });
        expect(tags).toHaveLength(links.length);
        return { links, names: tags.map((tag) => tag.name).sort() };
    }

    it('rejects an unauthorized update without changing article data or tags', async () => {
        const f = await fixture();
        const other = await registerUser();
        const unauthorizedTag = makeTag('tx_unauthorized');
        await request(f.server).put(f.url)
            .set('Authorization', other.authorization)
            .send({ article: { description: 'Unauthorized modification', tagList: [unauthorizedTag] } })
            .expect(403);
        const stored = await f.db.getRepository(Article).findOneByOrFail({ id: f.saved.id });
        expect(stored).toMatchObject({
            slug: f.slug, title: f.input.title, description: f.input.description, body: f.input.body,
        });
        expect((await storedTags(f.saved.id)).names).toEqual([f.initialTag]);
        expect(await f.db.getRepository(Tag).existsBy({ name: unauthorizedTag })).toBe(false);
    }, 30000);

    it('preserves a complete article version under concurrent updates', async () => {
        const f = await fixture();
        const tagA = makeTag('tx_nestjs');
        const tagB = makeTag('tx_typescript');
        const sharedTag = makeTag('tx_shared');
        const originalCreatedAt = f.response.body.article.createdAt as string;

        for (let round = 1; round <= 3; round++) {
            const versionA = {
                description: `Round ${round} - Version A`,
                body: `Round ${round} - Body A`,
                tagList: [tagA, sharedTag],
            };
            const versionB = {
                description: `Round ${round} - Version B`,
                body: `Round ${round} - Body B`,
                tagList: [tagB, sharedTag],
            };
            const [responseA, responseB] = await Promise.all([
                request(f.server).put(f.url).set('Authorization', f.owner.authorization)
                    .send({ article: versionA }),
                request(f.server).put(f.url).set('Authorization', f.owner.authorization)
                    .send({ article: versionB }),
            ]);
            expect(responseA.status).toBe(200);
            expect(responseB.status).toBe(200);
            expect(responseA.body.article).toMatchObject({ ...versionA, tagList: [...versionA.tagList].sort() });
            expect(responseB.body.article).toMatchObject({ ...versionB, tagList: [...versionB.tagList].sort() });

            const detail = await request(f.server).get(f.url).expect(200);
            const actual = detail.body.article;
            const finalVersion = actual.description === versionA.description ? versionA : versionB;
            expect(actual).toMatchObject({
                ...finalVersion, tagList: [...finalVersion.tagList].sort(), createdAt: originalCreatedAt,
            });
            const stored = await f.db.getRepository(Article).findOneByOrFail({ id: f.saved.id });
            expect(stored).toMatchObject({ description: finalVersion.description, body: finalVersion.body });
            const tags = await storedTags(f.saved.id);
            expect(tags.links).toHaveLength(2);
            expect(tags.names).toEqual([...finalVersion.tagList].sort());
        }
    }, 40000);

    it('preserves both article changes and favorite state during concurrent writes', async () => {
        const f = await fixture();
        const other = await registerUser();
        const newTag = makeTag('tx_final');
        const changes = {
            description: 'After concurrent favorite',
            body: 'Final article body',
            tagList: [newTag],
        };
        const [favoriteResponse, updateResponse] = await Promise.all([
            request(f.server).post(`${f.url}/favorite`).set('Authorization', other.authorization),
            request(f.server).put(f.url).set('Authorization', f.owner.authorization)
                .send({ article: changes }),
        ]);
        expect(favoriteResponse.status).toBe(200);
        expect(updateResponse.status).toBe(200);
        expect(favoriteResponse.body.article.favorited).toBe(true);
        expect(updateResponse.body.article).toMatchObject(changes);
        const detail = await request(f.server).get(f.url)
            .set('Authorization', other.authorization).expect(200);
        expect(detail.body.article).toMatchObject({ ...changes, favorited: true, favoritesCount: 1 });
        expect(await f.db.getRepository(ArticleFavorite).countBy({ articleId: f.saved.id, userId: other.id })).toBe(1);
        expect((await storedTags(f.saved.id)).names).toEqual([newTag]);
    }, 30000);

    it('reuses canonical tag IDs during concurrent create and update on different articles', async () => {
        const f = await fixture();
        const other = await registerUser();
        const sharedA = makeTag('tx_shared_a');
        const sharedB = makeTag('tx_shared_b');
        const createOnly = makeTag('tx_create');
        const updateOnly = makeTag('tx_update');
        const createInput = {
            title: 'Concurrent Create Article',
            description: 'Concurrent create description',
            body: 'Concurrent create body',
            tagList: [sharedB, createOnly, sharedA],
        };
        const updateInput = {
            description: 'Concurrent update description',
            tagList: [sharedA, updateOnly, sharedB],
        };
        const tags = f.db.getRepository(Tag);
        expect(await tags.countBy({ name: In([sharedA, sharedB]) })).toBe(0);
        const [created, updated] = await Promise.all([
            request(f.server).post('/api/articles').set('Authorization', other.authorization)
                .send({ article: createInput }),
            request(f.server).put(f.url).set('Authorization', f.owner.authorization)
                .send({ article: updateInput }),
        ]);
        expect(created.status).toBe(201);
        expect(updated.status).toBe(200);
        const createSlug = created.body.article.slug as string;
        const createTags = [...createInput.tagList].sort();
        const updateTags = [...updateInput.tagList].sort();
        expect(created.body.article).toMatchObject({ ...createInput, tagList: createTags });
        expect(updated.body.article).toMatchObject({ ...updateInput, slug: f.slug, tagList: updateTags });

        const newArticle = await f.db.getRepository(Article).findOneByOrFail({ slug: createSlug });
        expect(newArticle.authorId).toBe(other.id);
        expect(newArticle.id).not.toBe(f.saved.id);
        const createdLinks = await storedTags(newArticle.id);
        const updatedLinks = await storedTags(f.saved.id);
        expect(createdLinks.names).toEqual(createTags);
        expect(updatedLinks.names).toEqual(updateTags);
        const canonical = await tags.findBy({ name: In([sharedA, sharedB]) });
        expect(canonical).toHaveLength(2);
        const commonIds = createdLinks.links.map((link) => link.tagId)
            .filter((id) => updatedLinks.links.some((link) => link.tagId === id)).sort();
        expect(commonIds).toEqual(canonical.map((tag) => tag.id).sort());
        const createDetail = await request(f.server).get(`/api/articles/${createSlug}`).expect(200);
        const updateDetail = await request(f.server).get(f.url).expect(200);
        expect(createDetail.body.article.tagList).toEqual(createTags);
        expect(updateDetail.body.article.tagList).toEqual(updateTags);
        expect(await f.db.getRepository(Article).countBy({ authorId: other.id })).toBe(1);
        expect(await f.db.getRepository(Article).countBy({ authorId: f.owner.id })).toBe(1);
    }, 40000);

    it('rolls back article and tag changes after an injected failure', async () => {
        const f = await fixture();
        const rollbackTag = makeTag('tx_rollback');
        const tags = f.db.getRepository(Tag);
        expect(await tags.existsBy({ name: rollbackTag })).toBe(false);
        const beforeLinks = (await storedTags(f.saved.id)).links;
        const service = context().app.get(ArticlesService) as unknown as {
            replaceArticleTags: (manager: EntityManager, articleId: string, names: string[]) => Promise<void>;
        };
        const original = service.replaceArticleTags.bind(service);
        let failurePointReached = false;
        const spy = vi.spyOn(service, 'replaceArticleTags').mockImplementation(async (manager, articleId, names) => {
            await original(manager, articleId, names);
            failurePointReached = true;
            throw new InternalServerErrorException('E2E forced rollback');
        });
        try {
            const failed = await request(f.server).put(f.url)
                .set('Authorization', f.owner.authorization)
                .send({
                    article: {
                        title: 'Rollback Modified Article',
                        description: 'Changed description',
                        body: 'Changed body',
                        tagList: [rollbackTag],
                    }
                })
                .expect(500);
            expect(failed.body).toMatchObject({ statusCode: 500, message: 'E2E forced rollback' });
            expect(failurePointReached).toBe(true);
            expect(spy).toHaveBeenCalledOnce();
        } finally {
            spy.mockRestore();
        }
        const after = await f.db.getRepository(Article).findOneByOrFail({ id: f.saved.id });
        expect(after).toMatchObject({
            slug: f.saved.slug, title: f.saved.title, description: f.saved.description,
            body: f.saved.body, authorId: f.saved.authorId,
        });
        expect(after.createdAt.getTime()).toBe(f.saved.createdAt.getTime());
        expect(after.updatedAt.getTime()).toBe(f.saved.updatedAt.getTime());
        const afterTags = await storedTags(f.saved.id);
        expect(afterTags.names).toEqual([f.initialTag]);
        expect(afterTags.links.map((link) => link.tagId).sort())
            .toEqual(beforeLinks.map((link) => link.tagId).sort());
        expect(await tags.existsBy({ name: rollbackTag })).toBe(false);
        const detail = await request(f.server).get(f.url).expect(200);
        expect(detail.body.article).toMatchObject({ slug: f.slug, ...f.input });
    }, 30000);
});

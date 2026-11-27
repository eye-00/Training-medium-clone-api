
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';

import { Comment } from '../src/comments/entities/comment.entity.js';

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
} from './helpers/article-fixture.helper.js';

import {
    commentEndpoint as url,
    postComment as buildPostComment,
} from './helpers/comment-fixture.helper.js';

describe('Comment Create E2E', () => {
    let testApp: TestAppContext | undefined;

    const createdUsers: CreatedUser[] = [];

    beforeAll(async () => {
        testApp = await createTestApp();
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
            },
        );
    });

    function context(): TestAppContext {
        if (!testApp) {
            throw new Error('Test app is not ready');
        }

        return testApp;
    }

    function registerUser() {
        return registerUserFixture(
            context(),
            createdUsers,
            { prefix: 'cmt' },
        );
    }

    async function fixture() {
        const user = await registerUser();

        const { saved: article } =
            await createArticleFixture(
                context(),
                user.authorization,
            );

        return {
            user,
            article,
            url: url(article.slug),
        };
    }

    function postComment(
        endpoint: string,
        authorization: string,
        body: string,
    ) {
        return buildPostComment(
            context(),
            endpoint,
            authorization,
            body,
        );
    }

    it.each(['missing', 'invalid'] as const)(
        'rejects %s JWT without persisting a comment',
        async (kind) => {
            const { server, db } = context();
            const f = await fixture();
            const req = request(server).post(f.url).send({ comment: { body: 'Valid body' } });
            if (kind === 'invalid') req.set('Authorization', 'Bearer invalid.token');
            await req.expect(401);
            expect(await db.getRepository(Comment).countBy({ articleId: f.article.id })).toBe(0);
        },
    );

    it('returns 404 for an unknown article without creating a comment', async () => {
        const { db } = context();
        const user = await registerUser();
        await postComment(url(`missing-${randomUUID()}`), user.authorization, 'Valid body').expect(404);
        expect(await db.getRepository(Comment).countBy({ authorId: user.id })).toBe(0);
    });

    const invalidInputs: Array<{ label: string; payload: Record<string, unknown> }> = [
        { label: 'missing comment', payload: {} },
        { label: 'null comment', payload: { comment: null } },
        { label: 'array comment', payload: { comment: [{ body: 'Valid' }] } },
        { label: 'string comment', payload: { comment: 'Valid' } },
        { label: 'missing body', payload: { comment: {} } },
        { label: 'null body', payload: { comment: { body: null } } },
        { label: 'numeric body', payload: { comment: { body: 123 } } },
        { label: 'empty body', payload: { comment: { body: '' } } },
        { label: 'whitespace-only body', payload: { comment: { body: ' \t\n ' } } },
        { label: 'body above 5000 characters', payload: { comment: { body: 'a'.repeat(5001) } } },
        { label: 'undeclared authorId', payload: { comment: { body: 'Valid', authorId: randomUUID() } } },
        { label: 'undeclared articleId', payload: { comment: { body: 'Valid', articleId: randomUUID() } } },
        { label: 'undeclared top-level field', payload: { comment: { body: 'Valid' }, extra: true } },
    ];

    it.each(invalidInputs)('rejects $label without persisting a comment', async ({ payload }) => {
        const { server, db } = context();
        const f = await fixture();
        await request(server)
            .post(f.url)
            .set('Authorization', f.user.authorization)
            .send(payload)
            .expect(400);
        expect(await db.getRepository(Comment).countBy({ articleId: f.article.id })).toBe(0);
    });

    it('creates a comment as another user and returns only public persisted fields', async () => {
        const { db } = context();
        const f = await fixture();
        const commenter = await registerUser();
        const body = 'This is a great article!';
        const response = await postComment(f.url, commenter.authorization, body).expect(201);
        const result = response.body.comment as { id: number; createdAt: string; updatedAt: string };
        expect(Number.isInteger(result.id)).toBe(true);
        expect(result.id).toBeGreaterThan(0);
        const saved = await db.getRepository(Comment).findOneByOrFail({ id: result.id });
        expect(saved.articleId).toBe(f.article.id);
        expect(saved.authorId).toBe(commenter.id);
        expect(saved.authorId).not.toBe(f.user.id);
        expect(saved.body).toBe(body);
        expect(response.body).toEqual({
            comment: {
                id: saved.id,
                body: saved.body,
                createdAt: saved.createdAt.toISOString(),
                updatedAt: saved.updatedAt.toISOString(),
                author: { username: commenter.username, bio: null, image: null, following: false },
            }
        });
        expect(Number.isNaN(Date.parse(result.createdAt))).toBe(false);
        expect(Number.isNaN(Date.parse(result.updatedAt))).toBe(false);
        expect(await db.getRepository(Comment).countBy({ articleId: f.article.id })).toBe(1);
    });

    it('allows the article author to comment on their own article', async () => {
        const { db } = context();
        const f = await fixture();
        const response = await postComment(f.url, f.user.authorization, 'Author comment').expect(201);
        const saved = await db.getRepository(Comment).findOneByOrFail({ id: response.body.comment.id as number });
        expect(saved.authorId).toBe(f.user.id);
        expect(saved.articleId).toBe(f.article.id);
        expect(response.body.comment.author.following).toBe(false);
    });

    it('trims surrounding whitespace and preserves internal Unicode text', async () => {
        const { db } = context();
        const f = await fixture();
        const text = 'Bình luận tiếng Việt\nDòng thứ hai 😊';
        const response = await postComment(f.url, f.user.authorization, ` \t${text}\n `).expect(201);
        const saved = await db.getRepository(Comment).findOneByOrFail({ id: response.body.comment.id as number });
        expect(response.body.comment.body).toBe(text);
        expect(saved.body).toBe(text);
    });

    it('accepts a comment at the 5000-character boundary', async () => {
        const { db } = context();
        const f = await fixture();
        const body = 'a'.repeat(5000);
        const response = await postComment(f.url, f.user.authorization, body).expect(201);
        const saved = await db.getRepository(Comment).findOneByOrFail({ id: response.body.comment.id as number });
        expect(response.body.comment.body).toBe(body);
        expect(saved.body).toBe(body);
    });

    it('creates distinct comments for repeated valid requests', async () => {
        const { db } = context();
        const f = await fixture();
        const body = 'Repeated comment';
        const first = await postComment(f.url, f.user.authorization, body).expect(201);
        const second = await postComment(f.url, f.user.authorization, body).expect(201);
        expect(first.body.comment.id).not.toBe(second.body.comment.id);
        const stored = await db.getRepository(Comment).findBy({ articleId: f.article.id });
        expect(stored.map(comment => comment.id).sort((a, b) => a - b)).toEqual(
            [first.body.comment.id as number, second.body.comment.id as number].sort((a, b) => a - b),
        );
        expect(stored.every(comment => comment.body === body && comment.authorId === f.user.id)).toBe(true);
    });
});

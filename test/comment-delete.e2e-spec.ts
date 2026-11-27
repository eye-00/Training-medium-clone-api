import { randomUUID } from 'node:crypto';
import request from 'supertest';

import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';

import { User } from '../src/users/entities/user.entity.js';
import { Article } from '../src/articles/entities/article.entity.js';
import { Comment } from '../src/comments/entities/comment.entity.js';

import {
    createTestApp,
    closeTestApp,
    type TestAppContext,
} from './helpers/test-app.helper.js';

import {
    registerUserFixture,
    type CreatedUser,
} from './helpers/user-fixture.helper.js';

import {
    createArticleFixture,
} from './helpers/article-fixture.helper.js';

import {
    commentEndpoint as url,
    createCommentFixture,
    getComments as buildGetComments,
    deleteComment as buildDeleteComment,
} from './helpers/comment-fixture.helper.js';

describe('Comment Delete E2E', () => {
    let testApp: TestAppContext | undefined;

    const createdUsers: CreatedUser[] = [];

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

    function registerUser() {
        return registerUserFixture(
            context(),
            { prefix: 'cmd' },
            createdUsers,
        );
    }

    async function createArticle(
        authorization: string,
    ) {
        const { saved } =
            await createArticleFixture(
                context(),
                authorization,
            );

        return saved;
    }

    async function fixture() {
        const user = await registerUser();

        const article = await createArticle(
            user.authorization,
        );

        return {
            user,
            article,
            url: url(article.slug),
        };
    }

    function createComment(
        endpoint: string,
        authorization: string,
        body: string,
    ) {
        return createCommentFixture(
            context(),
            endpoint,
            authorization,
            body,
        );
    }

    function getComments(
        endpoint: string,
        authorization?: string,
    ) {
        return buildGetComments(
            context(),
            endpoint,
            authorization,
        );
    }

    function deleteComment(
        endpoint: string,
        id: number | string,
        authorization?: string,
    ) {
        return buildDeleteComment(
            context(),
            endpoint,
            id,
            authorization,
        );
    }

    async function commentedFixture() {
        const f = await fixture();
        const commenter = await registerUser();
        const { saved } = await createComment(f.url, commenter.authorization, 'Comment to delete');
        return { ...f, commenter, comment: saved };
    }

    async function expectUnchanged(comment: Comment) {
        const saved = await context().db.getRepository(Comment).findOneByOrFail({ id: comment.id });
        expect(saved).toEqual(comment);
    }

    it.each([
        ['missing JWT', undefined],
        ['invalid JWT', 'Bearer invalid.token'],
    ] as const)('rejects %s and preserves the comment', async (_name, authorization) => {
        const f = await commentedFixture();
        await deleteComment(f.url, f.comment.id, authorization).expect(401);
        await expectUnchanged(f.comment);
    });

    const invalidIds: Array<[string, (id: number) => string]> = [
        ['zero', () => '0'],
        ['negative', () => '-1'],
        ['non-numeric', () => 'abc'],
        ['unsigned int overflow', () => '4294967296'],
        ['unsafe integer', () => '9007199254740993'],
        ['fractional', () => '1.5'],
        ['leading zero', id => `0${id}`],
        ['scientific notation', id => `${id}e0`],
        ['decimal representation', id => `${id}.0`],
        ['explicit plus sign', id => `%2B${id}`],
        ['leading whitespace', id => `%20${id}`],
        ['trailing newline', id => `${id}%0A`],
    ];

    it.each(invalidIds)('rejects %s comment ID without deleting the comment', async (_name, makeId) => {
        const f = await commentedFixture();
        await deleteComment(f.url, makeId(f.comment.id), f.commenter.authorization).expect(400);
        await expectUnchanged(f.comment);
    });

    it('returns 404 for an unknown article without deleting an existing comment', async () => {
        const f = await commentedFixture();
        await deleteComment(url(`missing-${randomUUID()}`), f.comment.id, f.commenter.authorization).expect(404);
        await expectUnchanged(f.comment);
    });

    it('returns 404 for a missing comment with a valid unsigned integer ID', async () => {
        const f = await fixture();
        // The article has no comments. The maximum valid ID must pass validation.
        await deleteComment(f.url, 4294967295, f.user.authorization).expect(404);
        expect(await context().db.getRepository(Comment).countBy({ articleId: f.article.id })).toBe(0);
    });

    it('returns 404 when the comment owner supplies a different article slug', async () => {
        const f = await commentedFixture();
        const other = await createArticle(f.user.authorization);
        await deleteComment(url(other.slug), f.comment.id, f.commenter.authorization).expect(404);
        await expectUnchanged(f.comment);
        expect(await context().db.getRepository(Comment).countBy({ articleId: other.id })).toBe(0);
    });

    it('returns 404 for a non-owner using a comment ID from another article', async () => {
        const f = await commentedFixture();
        const other = await createArticle(f.user.authorization);
        await deleteComment(url(other.slug), f.comment.id, f.user.authorization).expect(404);
        await expectUnchanged(f.comment);
    });

    it('forbids the article author from deleting another user\'s comment', async () => {
        const f = await commentedFixture();
        await deleteComment(f.url, f.comment.id, f.user.authorization).expect(403);
        await expectUnchanged(f.comment);
    });

    it('forbids an unrelated authenticated user from deleting a comment', async () => {
        const f = await commentedFixture();
        const outsider = await registerUser();
        await deleteComment(f.url, f.comment.id, outsider.authorization).expect(403);
        await expectUnchanged(f.comment);
    });

    it('allows the comment author to delete and returns an empty 204 response', async () => {
        const f = await commentedFixture();
        const response = await deleteComment(f.url, f.comment.id, f.commenter.authorization).expect(204);
        expect(response.text).toBe('');
        expect(await context().db.getRepository(Comment).findOneBy({ id: f.comment.id })).toBeNull();
        expect((await getComments(f.url).expect(200)).body).toEqual({ comments: [] });
    });

    it('allows an article author to delete their own comment', async () => {
        const f = await fixture();
        const { saved } = await createComment(f.url, f.user.authorization, 'Own comment');
        await deleteComment(f.url, saved.id, f.user.authorization).expect(204);
        expect(await context().db.getRepository(Comment).findOneBy({ id: saved.id })).toBeNull();
    });

    it('returns 404 on a repeated deletion of the same comment', async () => {
        const f = await commentedFixture();
        await deleteComment(f.url, f.comment.id, f.commenter.authorization).expect(204);
        await deleteComment(f.url, f.comment.id, f.commenter.authorization).expect(404);
        expect(await context().db.getRepository(Comment).countBy({ id: f.comment.id })).toBe(0);
    });

    it('preserves other comments, articles and users after deletion', async () => {
        const f = await commentedFixture();
        const otherArticle = await createArticle(f.user.authorization);
        const { saved: sibling } = await createComment(f.url, f.user.authorization, 'Keep same article');
        const { saved: other } = await createComment(url(otherArticle.slug), f.commenter.authorization, 'Keep other article');
        await deleteComment(f.url, f.comment.id, f.commenter.authorization).expect(204);
        await expectUnchanged(sibling);
        await expectUnchanged(other);
        const { db } = context();
        expect(await db.getRepository(Article).findOneBy({ id: f.article.id })).not.toBeNull();
        expect(await db.getRepository(Article).findOneBy({ id: otherArticle.id })).not.toBeNull();
        expect(await db.getRepository(User).findOneBy({ id: f.commenter.id })).not.toBeNull();
        expect(await db.getRepository(User).findOneBy({ id: f.user.id })).not.toBeNull();
        expect((await getComments(f.url).expect(200)).body.comments.map((c: { id: number }) => c.id)).toEqual([sibling.id]);
    });

    it('cascades comments when deleting the parent article through the API', async () => {
        const f = await commentedFixture();
        const { saved: sibling } = await createComment(f.url, f.user.authorization, 'Second comment');
        const otherArticle = await createArticle(f.user.authorization);
        const { saved: other } = await createComment(url(otherArticle.slug), f.commenter.authorization, 'Keep this comment');
        await request(context().server)
            .delete(`/api/articles/${f.article.slug}`)
            .set('Authorization', f.user.authorization)
            .expect(204);
        const repo = context().db.getRepository(Comment);
        expect(await repo.findOneBy({ id: f.comment.id })).toBeNull();
        expect(await repo.findOneBy({ id: sibling.id })).toBeNull();
        expect(await repo.countBy({ articleId: f.article.id })).toBe(0);
        await expectUnchanged(other);
        await getComments(f.url).expect(404);
    });

    it('cascades only comments by a deleted user on surviving articles', async () => {
        const f = await commentedFixture();
        const { saved: sibling } = await createComment(f.url, f.user.authorization, 'Keep this comment');
        const { db } = context();
        const registered = createdUsers.find(user => user.id === f.commenter.id);
        if (!registered) throw new Error('Missing suite-owned user');
        await db.getRepository(User).delete({ id: registered.id, email: registered.email });
        expect(await db.getRepository(Comment).findOneBy({ id: f.comment.id })).toBeNull();
        await expectUnchanged(sibling);
        expect(await db.getRepository(Article).findOneBy({ id: f.article.id })).not.toBeNull();
        expect((await getComments(f.url).expect(200)).body.comments.map((c: { id: number }) => c.id)).toEqual([sibling.id]);
    });
});

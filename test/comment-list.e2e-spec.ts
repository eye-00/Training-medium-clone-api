
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
    createCommentFixture,
    getComments as buildGetComments,
} from './helpers/comment-fixture.helper.js';

describe('Comment List E2E', () => {
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
            { prefix: 'cml' },
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

    async function follow(authorization: string, username: string) {
        await request(context().server)
            .post(`/api/profiles/${username}/follow`)
            .set('Authorization', authorization)
            .expect(200);
    }

    async function unfollow(authorization: string, username: string) {
        await request(context().server)
            .delete(`/api/profiles/${username}/follow`)
            .set('Authorization', authorization)
            .expect(204);
    }

    function ids(items: Array<{ id: number }>): number[] {
        return items.map(item => item.id);
    }

    it.each(['anonymous', 'authenticated'] as const)(
        'returns an empty comment list for an %s viewer',
        async (viewer) => {
            const f = await fixture();
            const response = await getComments(
                f.url,
                viewer === 'authenticated' ? f.user.authorization : undefined,
            ).expect(200);
            expect(response.body).toEqual({ comments: [] });
        },
    );

    it.each(['anonymous', 'authenticated'] as const)(
        'returns 404 for an unknown article for an %s viewer',
        async (viewer) => {
            const authorization = viewer === 'authenticated'
                ? (await registerUser()).authorization
                : undefined;
            await getComments(url(`missing-${randomUUID()}`), authorization).expect(404);
        },
    );

    it('rejects an invalid JWT even though comments are public', async () => {
        const f = await fixture();
        await getComments(f.url, 'Bearer invalid.token').expect(401);
    });

    it('returns exactly the public persisted comment fields and matches the create response', async () => {
        const f = await fixture();
        const commenter = await registerUser();
        const body = 'Bình luận công khai 😊';
        const created = await createComment(f.url, commenter.authorization, body);
        const { saved } = created;
        const response = await getComments(f.url).expect(200);
        expect(response.body).toEqual({
            comments: [{
                id: saved.id,
                createdAt: saved.createdAt.toISOString(),
                updatedAt: saved.updatedAt.toISOString(),
                body,
                author: { username: commenter.username, bio: null, image: null, following: false },
            }]
        });
        expect(response.body.comments[0]).toEqual(created.response);
    });

    it('returns only comments belonging to the requested article', async () => {
        const f = await fixture();
        const otherArticle = await createArticle(f.user.authorization);
        const first = await createComment(f.url, f.user.authorization, 'Target comment');
        const unrelated = await createComment(url(otherArticle.slug), f.user.authorization, 'Other comment');
        const targetResponse = await getComments(f.url).expect(200);
        const otherResponse = await getComments(url(otherArticle.slug)).expect(200);
        expect(ids(targetResponse.body.comments)).toEqual([first.saved.id]);
        expect(ids(otherResponse.body.comments)).toEqual([unrelated.saved.id]);
    });

    it('sorts comments by createdAt descending rather than insertion order', async () => {
        const { db } = context();
        const f = await fixture();
        const newest = await createComment(f.url, f.user.authorization, 'Newest');
        const oldest = await createComment(f.url, f.user.authorization, 'Oldest');
        const middle = await createComment(f.url, f.user.authorization, 'Middle');
        const repo = db.getRepository(Comment);
        await repo.update({ id: newest.saved.id }, { createdAt: new Date('2025-01-03T00:00:00.000Z') });
        await repo.update({ id: oldest.saved.id }, { createdAt: new Date('2025-01-01T00:00:00.000Z') });
        await repo.update({ id: middle.saved.id }, { createdAt: new Date('2025-01-02T00:00:00.000Z') });
        const response = await getComments(f.url).expect(200);
        expect(ids(response.body.comments)).toEqual([newest.saved.id, middle.saved.id, oldest.saved.id]);
    });

    it('breaks equal createdAt timestamps using descending comment IDs', async () => {
        const { db } = context();
        const f = await fixture();
        const first = await createComment(f.url, f.user.authorization, 'First');
        const second = await createComment(f.url, f.user.authorization, 'Second');
        const date = new Date('2025-01-01T00:00:00.000Z');
        const repo = db.getRepository(Comment);
        await repo.update({ articleId: f.article.id }, { createdAt: date });
        const response = await getComments(f.url).expect(200);
        expect(ids(response.body.comments)).toEqual([first.saved.id, second.saved.id].sort((a, b) => b - a));
        expect(response.body.comments.map((item: { createdAt: string }) => item.createdAt)).toEqual([
            date.toISOString(), date.toISOString(),
        ]);
    });

    it('maps following for every comment using the viewer direction and excludes self-follow', async () => {
        const f = await fixture();
        const alice = await registerUser();
        const bob = await registerUser();
        await follow(f.user.authorization, alice.username);
        // Bob follows the viewer, not the other way around.
        await follow(bob.authorization, f.user.username);
        const aliceFirst = await createComment(f.url, alice.authorization, 'Alice one');
        const aliceSecond = await createComment(f.url, alice.authorization, 'Alice two');
        const bobComment = await createComment(f.url, bob.authorization, 'Bob comment');
        const self = await createComment(f.url, f.user.authorization, 'Viewer comment');
        const response = await getComments(f.url, f.user.authorization).expect(200);
        const expected = new Map([
            [aliceFirst.saved.id, { username: alice.username, following: true }],
            [aliceSecond.saved.id, { username: alice.username, following: true }],
            [bobComment.saved.id, { username: bob.username, following: false }],
            [self.saved.id, { username: f.user.username, following: false }],
        ]);
        expect(ids(response.body.comments).sort((a, b) => a - b)).toEqual([...expected.keys()].sort((a, b) => a - b));
        for (const comment of response.body.comments as Array<{ id: number; author: unknown }>) {
            expect(comment.author).toEqual({ ...expected.get(comment.id), bio: null, image: null });
        }
        const bobView = await getComments(f.url, bob.authorization).expect(200);
        expect(bobView.body.comments.find((c: { id: number }) => c.id === self.saved.id).author.following).toBe(true);
        expect(bobView.body.comments.find((c: { id: number }) => c.id === aliceFirst.saved.id).author.following).toBe(false);
    });

    it('returns following false to anonymous viewers even when follow relationships exist', async () => {
        const f = await fixture();
        const commenter = await registerUser();
        await follow(f.user.authorization, commenter.username);
        const created = await createComment(f.url, commenter.authorization, 'Public comment');
        const response = await getComments(f.url).expect(200);
        expect(response.body.comments).toHaveLength(1);
        expect(response.body.comments[0]).toMatchObject({
            id: created.saved.id,
            author: { username: commenter.username, following: false },
        });
    });

    it('reflects unfollow changes without removing or modifying comments', async () => {
        const { db } = context();
        const f = await fixture();
        const commenter = await registerUser();
        const created = await createComment(f.url, commenter.authorization, 'Preserved comment');
        await follow(f.user.authorization, commenter.username);
        const before = await getComments(f.url, f.user.authorization).expect(200);
        expect(before.body.comments).toHaveLength(1);
        expect(before.body.comments[0].author.following).toBe(true);
        await unfollow(f.user.authorization, commenter.username);
        const after = await getComments(f.url, f.user.authorization).expect(200);
        expect(after.body).toEqual({
            comments: [{
                ...before.body.comments[0],
                author: { ...before.body.comments[0].author, following: false },
            }]
        });
        expect(await db.getRepository(Comment).findOneByOrFail({ id: created.saved.id })).toEqual(created.saved);
    });
});

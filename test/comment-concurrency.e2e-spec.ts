import { InternalServerErrorException } from '@nestjs/common';
import request from 'supertest';

import {
    QueryFailedError,
    Repository,
    type ObjectLiteral,
} from 'typeorm';

import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import type { User } from '../src/users/entities/user.entity.js';
import { Article } from '../src/articles/entities/article.entity.js';
import { Comment } from '../src/comments/entities/comment.entity.js';
import { CommentsService } from '../src/comments/comments.service.js';
import type { CommentDetailsDto } from '../src/comments/dto/comment-response.dto.js';

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
    postComment as buildPostComment,
    getComments as buildGetComments,
    deleteComment as buildDeleteComment,
} from './helpers/comment-fixture.helper.js';

describe('Comment Concurrency E2E', () => {
    let testApp: TestAppContext | undefined;

    const createdUsers: CreatedUser[] = [];

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
            { prefix: 'cmc' },
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

    function deleteArticle(
        slug: string,
        authorization: string,
    ) {
        return request(context().server)
            .delete(`/api/articles/${slug}`)
            .set('Authorization', authorization);
    }

    function mappingTarget() {
        return context().app.get(
            CommentsService,
        ) as unknown as {
            toCommentDetails: (
                comment: Comment,
                author: User,
                following: boolean,
            ) => CommentDetailsDto;
        };
    }

    function deadlockError() {
        return new QueryFailedError('E2E simulated deadlock', [], Object.assign(
            new Error('Simulated MySQL deadlock'),
            { code: 'ER_LOCK_DEADLOCK', errno: 1213 },
        ));
    }

    function injectDeleteFailure(
        targetId: number,
        errorForAttempt: (attempt: number) => Error | undefined,
    ) {
        // Preserve the original method before installing the spy.
        // Its repository context is explicitly restored using .call(this, criteria).
        // oxlint-disable-next-line typescript/unbound-method
        const originalDelete = Repository.prototype.delete;

        const observations: Array<{
            affected: number | null | undefined;
            transactionActive: boolean;
            existsAfterDelete: boolean;
        }> = [];

        const spy = vi
            .spyOn(Repository.prototype, 'delete')
            .mockImplementation(async function (
                this: Repository<ObjectLiteral>,
                criteria,
            ) {
                const result = await originalDelete.call(
                    this,
                    criteria,
                );

                // Only inject failures into DELETE operations
                // targeting the specific comment under test.
                if (
                    this.metadata.target !== Comment ||
                    typeof criteria !== 'object' ||
                    criteria === null ||
                    !('id' in criteria) ||
                    criteria.id !== targetId
                ) {
                    return result;
                }

                const transactionActive =
                    this.manager.queryRunner
                        ?.isTransactionActive === true;

                const existsAfterDelete = await this.manager
                    .getRepository(Comment)
                    .existsBy({ id: targetId });

                observations.push({
                    affected: result.affected,
                    transactionActive,
                    existsAfterDelete,
                });

                const error = errorForAttempt(
                    observations.length,
                );

                if (error) {
                    throw error;
                }

                return result;
            });

        return {
            spy,
            observations,
        };
    }

    function expectDeleteAttempts(
        observations: Array<{
            affected: number | null | undefined;
            transactionActive: boolean;
            existsAfterDelete: boolean;
        }>,
        expectedAttempts: number,
    ) {
        expect(observations).toHaveLength(expectedAttempts);

        for (const observation of observations) {
            expect(observation).toEqual({
                affected: 1,
                transactionActive: true,
                existsAfterDelete: false,
            });
        }
    }


    it('persists all ten concurrent creates without duplicate IDs or lost comments', async () => {
        const f = await fixture();
        const other = await registerUser();
        const inputs = Array.from({ length: 10 }, (_, i) => ({
            body: `Concurrent comment ${i}`,
            user: i % 2 === 0 ? f.user : other,
        }));
        const responses = await Promise.all(inputs.map(input =>
            postComment(f.url, input.user.authorization, input.body),
        ));
        const ids = responses.map(response => response.body.comment?.id as number);
        expect(responses.map(response => response.status)).toEqual(Array(10).fill(201));
        expect(new Set(ids).size).toBe(10);
        const rows = await context().db.getRepository(Comment).findBy({ articleId: f.article.id });
        expect(rows).toHaveLength(10);
        const byId = new Map(rows.map(row => [row.id, row]));
        inputs.forEach((input, i) => {
            expect(byId.get(ids[i]!)).toMatchObject({ body: input.body, authorId: input.user.id });
        });
        const list = await getComments(f.url).expect(200);
        expect(list.body.comments.map((c: CommentDetailsDto) => c.id).sort((a: number, b: number) => a - b))
            .toEqual([...ids].sort((a, b) => a - b));
    }, 40000);

    it('allows exactly one of ten concurrent deletes and preserves unrelated comments', async () => {
        const f = await fixture();
        const target = await createComment(f.url, f.user.authorization, 'Delete target');
        const other = await createComment(f.url, f.user.authorization, 'Keep this');
        const responses = await Promise.all(Array.from({ length: 10 }, () =>
            deleteComment(f.url, target.saved.id, f.user.authorization),
        ));
        expect(responses.map(r => r.status).sort((a, b) => a - b)).toEqual([204, ...Array(9).fill(404)]);
        expect(responses.find(r => r.status === 204)?.text).toBe('');
        const rows = await context().db.getRepository(Comment).findBy({ articleId: f.article.id });
        expect(rows).toEqual([other.saved]);
    }, 40000);

    it('never lets a non-owner win a concurrent deletion against the comment owner', async () => {
        const f = await fixture();
        const commenter = await registerUser();
        const target = await createComment(f.url, commenter.authorization, 'Owned by commenter');
        const [owner, nonOwner] = await Promise.all([
            deleteComment(f.url, target.saved.id, commenter.authorization),
            deleteComment(f.url, target.saved.id, f.user.authorization),
        ]);
        expect(owner.status).toBe(204);
        expect([403, 404]).toContain(nonOwner.status);
        expect(await context().db.getRepository(Comment).existsBy({ id: target.saved.id })).toBe(false);
    }, 30000);

    it('handles concurrent article deletion and comment creation without orphan rows', async () => {
        const f = await fixture();
        const commenter = await registerUser();
        const survivor = await fixture();
        const retained = await createComment(survivor.url, commenter.authorization, 'Retained comment');
        const [created, deleted] = await Promise.all([
            postComment(f.url, commenter.authorization, 'Racing comment'),
            deleteArticle(f.article.slug, f.user.authorization),
        ]);
        expect(deleted.status).toBe(204);
        expect([201, 404]).toContain(created.status);
        const db = context().db;
        expect(await db.getRepository(Article).existsBy({ id: f.article.id })).toBe(false);
        expect(await db.getRepository(Comment).countBy({ articleId: f.article.id })).toBe(0);
        expect(await db.getRepository(Comment).findOneByOrFail({ id: retained.saved.id })).toEqual(retained.saved);
        await getComments(f.url).expect(404);
    }, 30000);

    it('returns a consistent comment snapshot or 404 during concurrent article deletion', async () => {
        const f = await fixture();
        const commenter = await registerUser();
        const a = await createComment(f.url, commenter.authorization, 'First');
        const b = await createComment(f.url, f.user.authorization, 'Second');
        const [listed, deleted] = await Promise.all([
            getComments(f.url),
            deleteArticle(f.article.slug, f.user.authorization),
        ]);
        expect(deleted.status).toBe(204);
        expect([200, 404]).toContain(listed.status);
        if (listed.status === 200) {
            expect(listed.body.comments).toHaveLength(2);
            expect(listed.body.comments).toEqual(expect.arrayContaining([a.response, b.response]));
        }
        expect(await context().db.getRepository(Comment).countBy({ articleId: f.article.id })).toBe(0);
        await getComments(f.url).expect(404);
    }, 30000);

    it('retries the whole create transaction after an injected deadlock following INSERT', async () => {
        const f = await fixture();
        const service = mappingTarget();
        const original = service.toCommentDetails.bind(service);
        const attemptedIds: number[] = [];
        const spy = vi.spyOn(service, 'toCommentDetails').mockImplementation((comment, author, following) => {
            attemptedIds.push(comment.id);
            if (attemptedIds.length === 1) throw deadlockError();
            return original(comment, author, following);
        });
        try {
            const response = await postComment(f.url, f.user.authorization, 'Retry once').expect(201);
            expect(spy).toHaveBeenCalledTimes(2);
            expect(attemptedIds[0]).not.toBe(attemptedIds[1]);
            const rows = await context().db.getRepository(Comment).findBy({ articleId: f.article.id });
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ id: response.body.comment.id, body: 'Retry once', authorId: f.user.id });
            expect(rows[0]!.id).toBe(attemptedIds[1]);
        } finally {
            spy.mockRestore();
        }
    }, 30000);

    it('stops after three deadlock attempts and rolls back every attempted insert', async () => {
        const f = await fixture();
        const spy = vi.spyOn(mappingTarget(), 'toCommentDetails').mockImplementation(() => {
            throw deadlockError();
        });
        try {
            await postComment(f.url, f.user.authorization, 'Always deadlocks').expect(500);
            expect(spy).toHaveBeenCalledTimes(3);
            expect(await context().db.getRepository(Comment).countBy({ articleId: f.article.id })).toBe(0);
        } finally {
            spy.mockRestore();
        }
    }, 30000);

    it('rolls back a non-deadlock failure without retrying the create transaction', async () => {
        const f = await fixture();
        const spy = vi.spyOn(mappingTarget(), 'toCommentDetails').mockImplementation(() => {
            throw new InternalServerErrorException('E2E forced rollback');
        });
        try {
            const response = await postComment(f.url, f.user.authorization, 'Must roll back').expect(500);
            expect(response.body.message).toBe('E2E forced rollback');
            expect(spy).toHaveBeenCalledTimes(1);
            expect(await context().db.getRepository(Comment).countBy({ articleId: f.article.id })).toBe(0);
        } finally {
            spy.mockRestore();
        }
    }, 30000);

    it('retries the whole delete transaction after an injected deadlock following DELETE', async () => {
        const f = await fixture();

        const target = await createComment(
            f.url,
            f.user.authorization,
            'Delete with retry',
        );

        const sibling = await createComment(
            f.url,
            f.user.authorization,
            'Preserved sibling',
        );

        const { spy, observations } = injectDeleteFailure(
            target.saved.id,
            attempt => attempt === 1
                ? deadlockError()
                : undefined,
        );

        try {
            const response = await deleteComment(
                f.url,
                target.saved.id,
                f.user.authorization,
            ).expect(204);

            expect(response.text).toBe('');

            expectDeleteAttempts(observations, 2);
        } finally {
            spy.mockRestore();
        }

        const repository = context()
            .db.getRepository(Comment);

        expect(
            await repository.existsBy({
                id: target.saved.id,
            }),
        ).toBe(false);

        expect(
            await repository.findOneByOrFail({
                id: sibling.saved.id,
            }),
        ).toEqual(sibling.saved);

        expect(
            await repository.countBy({
                articleId: f.article.id,
            }),
        ).toBe(1);

        // The deletion has been committed.
        await deleteComment(
            f.url,
            target.saved.id,
            f.user.authorization,
        ).expect(404);
    }, 30000);

    it('stops after three deadlock attempts and rolls back every attempted deletion', async () => {
        const f = await fixture();

        const target = await createComment(
            f.url,
            f.user.authorization,
            'Must survive all deadlocks',
        );

        const sibling = await createComment(
            f.url,
            f.user.authorization,
            'Preserved sibling',
        );

        const { spy, observations } = injectDeleteFailure(
            target.saved.id,
            () => deadlockError(),
        );

        try {
            await deleteComment(
                f.url,
                target.saved.id,
                f.user.authorization,
            ).expect(500);

            expectDeleteAttempts(observations, 3);
        } finally {
            spy.mockRestore();
        }

        const repository = context()
            .db.getRepository(Comment);

        expect(
            await repository.findOneByOrFail({
                id: target.saved.id,
            }),
        ).toEqual(target.saved);

        expect(
            await repository.findOneByOrFail({
                id: sibling.saved.id,
            }),
        ).toEqual(sibling.saved);

        expect(
            await repository.countBy({
                articleId: f.article.id,
            }),
        ).toBe(2);
    }, 30000);

    it('rolls back a non-deadlock failure without retrying the delete transaction', async () => {
        const f = await fixture();

        const target = await createComment(
            f.url,
            f.user.authorization,
            'Must survive ordinary failure',
        );

        const sibling = await createComment(
            f.url,
            f.user.authorization,
            'Preserved sibling',
        );

        const { spy, observations } = injectDeleteFailure(
            target.saved.id,
            () => new InternalServerErrorException(
                'E2E forced delete rollback',
            ),
        );

        try {
            const response = await deleteComment(
                f.url,
                target.saved.id,
                f.user.authorization,
            ).expect(500);

            expect(response.body.message).toBe(
                'E2E forced delete rollback',
            );

            expectDeleteAttempts(observations, 1);
        } finally {
            spy.mockRestore();
        }

        const repository = context()
            .db.getRepository(Comment);

        expect(
            await repository.findOneByOrFail({
                id: target.saved.id,
            }),
        ).toEqual(target.saved);

        expect(
            await repository.findOneByOrFail({
                id: sibling.saved.id,
            }),
        ).toEqual(sibling.saved);

        expect(
            await repository.countBy({
                articleId: f.article.id,
            }),
        ).toBe(2);
    }, 30000);

});

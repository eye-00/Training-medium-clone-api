import {
    type INestApplication,
    ValidationPipe,
    InternalServerErrorException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource, QueryFailedError } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { User } from '../src/users/entities/user.entity.js';
import { Article } from '../src/articles/entities/article.entity.js';
import { Comment } from '../src/comments/entities/comment.entity.js';
import { CommentsService } from '../src/comments/comments.service.js';
import type { CommentDetailsDto } from '../src/comments/dto/comment-response.dto.js';

describe('Comment Concurrency E2E', () => {
    let app: INestApplication | undefined;
    let databaseVerified = false;
    const createdUsers: Array<{ id: string; email: string }> = [];
    const password = 'ExamplePass123!';

    beforeAll(async () => {
        const env = process.env;
        if (
            env.NODE_ENV !== 'test' ||
            env.DB_HOST !== '127.0.0.1' ||
            env.DB_PORT !== '3307' ||
            env.DB_DATABASE !== 'medium_clone_test' ||
            env.DB_USERNAME !== 'medium_test_user' ||
            env.REDIS_URL !== 'redis://127.0.0.1:6380' ||
            !env.DB_TEST_SERVER_UUID?.trim()
        ) {
            throw new Error('Unsafe E2E environment');
        }

        const { AppModule } = await import('../src/app.module.js');
        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();
        app = moduleRef.createNestApplication();
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));
        await app.listen(0, '127.0.0.1');

        const rows = (await app.get(DataSource).query(`
            SELECT DATABASE() AS db,
                   CURRENT_USER() AS dbUser,
                   @@server_uuid AS serverUuid
        `)) as Array<{ db: string; dbUser: string; serverUuid: string }>;
        const identity = rows[0];
        if (
            identity?.db !== 'medium_clone_test' ||
            !identity.dbUser.startsWith('medium_test_user@') ||
            identity.serverUuid !== env.DB_TEST_SERVER_UUID.trim()
        ) {
            throw new Error('E2E database identity verification failed');
        }
        databaseVerified = true;
    }, 25000);

    afterAll(async () => {
        if (!app) return;
        try {
            if (databaseVerified) {
                const db = app.get(DataSource);
                // Delete only users created by this suite. FK cascades
                // remove their articles and comments. No tags are seeded.
                for (const user of createdUsers) {
                    await db.getRepository(User).delete({
                        id: user.id,
                        email: user.email,
                    });
                }
            }
        } finally {
            await app.close();
        }
    }, 20000);

    function context() {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }
        return { server: app.getHttpServer(), db: app.get(DataSource) };
    }

    async function registerUser() {
        const { server } = context();
        const username = `cmc_${randomUUID().replaceAll('-', '')}`;
        const email = `${username}@example.com`;
        const registered = await request(server)
            .post('/api/users')
            .send({ email, username, password })
            .expect(201);
        const id = registered.body.user.id as string;
        createdUsers.push({ id, email });

        const login = await request(server)
            .post('/api/users/login')
            .send({ email, password })
            .expect(200);
        return {
            id,
            username,
            authorization: `Bearer ${login.body.accessToken as string}`,
        };
    }

    async function createArticle(authorization: string) {
        const { server, db } = context();
        const response = await request(server)
            .post('/api/articles')
            .set('Authorization', authorization)
            .send({ article: {
                title: 'Comment E2E article',
                description: 'Comment E2E description',
                body: 'Comment E2E body',
                tagList: [],
            } })
            .expect(201);
        return db.getRepository(Article).findOneByOrFail({
            slug: response.body.article.slug as string,
        });
    }

    const url = (slug: string) => `/api/articles/${slug}/comments`;

    async function fixture() {
        const user = await registerUser();
        const article = await createArticle(user.authorization);
        return { user, article, url: url(article.slug) };
    }

    function postComment(endpoint: string, authorization: string, body: string) {
        return request(context().server)
            .post(endpoint)
            .set('Authorization', authorization)
            .send({ comment: { body } });
    }

    async function createComment(endpoint: string, authorization: string, body: string) {
        const response = await postComment(endpoint, authorization, body).expect(201);
        const id = response.body.comment.id as number;
        const saved = await context().db.getRepository(Comment).findOneByOrFail({ id });
        return { saved, response: response.body.comment };
    }

    function getComments(endpoint: string, authorization?: string) {
        const req = request(context().server).get(endpoint);
        if (authorization !== undefined) req.set('Authorization', authorization);
        return req;
    }

    function deleteComment(endpoint: string, id: number | string, authorization?: string) {
        const req = request(context().server).delete(`${endpoint}/${id}`);
        if (authorization !== undefined) req.set('Authorization', authorization);
        return req;
    }

    function deleteArticle(slug: string, authorization: string) {
        return request(context().server)
            .delete(`/api/articles/${slug}`)
            .set('Authorization', authorization);
    }

    function mappingTarget() {
        if (!app) throw new Error('Test app is not ready');
        return app.get(CommentsService) as unknown as {
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
});

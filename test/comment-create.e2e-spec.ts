import {
    type INestApplication,
    ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { User } from '../src/users/entities/user.entity.js';
import { Article } from '../src/articles/entities/article.entity.js';
import { Comment } from '../src/comments/entities/comment.entity.js';

describe('Comment Create E2E', () => {
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
        await app.init();

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
        const username = `cmt_${randomUUID().replaceAll('-', '')}`;
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
        expect(response.body).toEqual({ comment: {
            id: saved.id,
            body: saved.body,
            createdAt: saved.createdAt.toISOString(),
            updatedAt: saved.updatedAt.toISOString(),
            author: { username: commenter.username, bio: null, image: null, following: false },
        } });
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

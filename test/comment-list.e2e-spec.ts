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

describe('Comment List E2E', () => {
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
        const username = `cml_${randomUUID().replaceAll('-', '')}`;
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
        expect(response.body).toEqual({ comments: [{
            id: saved.id,
            createdAt: saved.createdAt.toISOString(),
            updatedAt: saved.updatedAt.toISOString(),
            body,
            author: { username: commenter.username, bio: null, image: null, following: false },
        }] });
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
        expect(after.body).toEqual({ comments: [{
            ...before.body.comments[0],
            author: { ...before.body.comments[0].author, following: false },
        }] });
        expect(await db.getRepository(Comment).findOneByOrFail({ id: created.saved.id })).toEqual(created.saved);
    });
});

import {
    type INestApplication,
    ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
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

describe('Article Create E2E', () => {
    let app: INestApplication | undefined;
    let databaseVerified = false;

    const createdUsers: Array<{ id: string; email: string }> = [];
    const createdTags = new Set<string>();
    const suiteSuffix = randomUUID().replaceAll('-', '').slice(0, 8);
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
            !env.DB_TEST_SERVER_UUID
        ) {
            throw new Error('Unsafe E2E environment');
        }

        const { AppModule } = await import('../src/app.module.js');
        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();
        app.setGlobalPrefix('api');
        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
            }),
        );

        await app.init();

        const rows = (await app.get(DataSource).query(`
            SELECT
                DATABASE() AS db,
                CURRENT_USER() AS dbUser,
                @@server_uuid AS serverUuid
        `)) as Array<{
            db: string;
            dbUser: string;
            serverUuid: string;
        }>;

        const identity = rows[0];

        if (
            identity?.db !== 'medium_clone_test' ||
            !identity.dbUser.startsWith('medium_test_user@') ||
            identity.serverUuid !== env.DB_TEST_SERVER_UUID
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

                // Only remove users registered by this suite.
                // Their article records and relationships cascade.
                for (const user of createdUsers) {
                    await db.getRepository(User).delete({
                        id: user.id,
                        email: user.email,
                    });
                }

                // Only remove uniquely generated tags from this suite.
                if (createdTags.size > 0) {
                    await db.getRepository(Tag).delete({
                        name: In([...createdTags]),
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
        return {
            server: app.getHttpServer(),
            db: app.get(DataSource),
        };
    }

    function makeTag(prefix: string): string {
        const value = `${prefix}_${suiteSuffix}_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
        createdTags.add(value);
        return value;
    }

    function makePayload(tagList: string[]) {
        return {
            article: {
                title: 'Getting Started with NestJS',
                description: 'A beginner guide',
                body: 'Learning how NestJS and TypeORM work.',
                tagList,
            },
        };
    }

    async function registerAuthor() {
        const { server } = context();
        const identity = `${suiteSuffix}_${randomUUID().replaceAll('-', '').slice(0, 6)}`;
        const email = `e2e-article-${identity}@example.com`;
        const username = `article_${identity}`;

        const registered = await request(server)
            .post('/api/users')
            .send({ email, username, password })
            .expect(201);

        const userId = registered.body.user.id as string;
        createdUsers.push({ id: userId, email });

        const login = await request(server)
            .post('/api/users/login')
            .send({ email, password })
            .expect(200);

        return {
            userId,
            username,
            authorization: `Bearer ${login.body.accessToken as string}`,
        };
    }

    async function createArticle(
        authorization: string,
        payload: ReturnType<typeof makePayload>,
    ) {
        const { server } = context();
        return request(server)
            .post('/api/articles')
            .set('Authorization', authorization)
            .send(payload)
            .expect(201);
    }

    it('requires authentication to create an article', async () => {
        const { server } = context();
        const payload = makePayload([]);

        await request(server)
            .post('/api/articles')
            .send(payload)
            .expect(401);

        await request(server)
            .post('/api/articles')
            .set('Authorization', 'Bearer invalid.token')
            .send(payload)
            .expect(401);
    });

    it('rejects malformed create input without persisting an article', async () => {
        const { server, db } = context();
        const author = await registerAuthor();
        const payload = makePayload([]);

        await request(server)
            .post('/api/articles')
            .set('Authorization', author.authorization)
            .send({})
            .expect(400);

        await request(server)
            .post('/api/articles')
            .set('Authorization', author.authorization)
            .send({ article: { ...payload.article, title: '   ' } })
            .expect(400);

        await request(server)
            .post('/api/articles')
            .set('Authorization', author.authorization)
            .send({ article: { ...payload.article, authorId: randomUUID() } })
            .expect(400);

        expect(await db.getRepository(Article).countBy({
            authorId: author.userId,
        })).toBe(0);
    });

    it('persists a created article and normalized tag relationships', async () => {
        const { server, db } = context();
        const author = await registerAuthor();
        const tagA = makeTag('backend');
        const tagB = makeTag('nestjs');
        const payload = makePayload([
            ` ${tagB.toUpperCase()} `,
            tagB,
            ` ${tagA.toUpperCase()} `,
        ]);

        const created = await createArticle(author.authorization, payload);
        const article = created.body.article as {
            slug: string;
            title: string;
            tagList: string[];
            createdAt: string;
            updatedAt: string;
            favorited: boolean;
            favoritesCount: number;
            author: { username: string; following: boolean };
        };

        expect(article.slug).toMatch(
            /^getting-started-with-nestjs-[0-9a-f-]{36}$/,
        );
        expect(article.title).toBe(payload.article.title);
        expect(article.tagList).toEqual([tagA, tagB].sort());
        expect(article.favorited).toBe(false);
        expect(article.favoritesCount).toBe(0);
        expect(article.author).toMatchObject({
            username: author.username,
            following: false,
        });
        expect(Number.isNaN(Date.parse(article.createdAt))).toBe(false);
        expect(Number.isNaN(Date.parse(article.updatedAt))).toBe(false);

        const saved = await db.getRepository(Article).findOneByOrFail({
            slug: article.slug,
        });
        expect(saved.authorId).toBe(author.userId);
        expect(saved.body).toBe(payload.article.body);

        const links = await db.getRepository(ArticleTag).findBy({
            articleId: saved.id,
        });
        expect(links).toHaveLength(2);

        const storedTags = await db.getRepository(Tag).findBy({
            id: In(links.map((link) => link.tagId)),
        });
        expect(storedTags.map((tag) => tag.name).sort())
            .toEqual([tagA, tagB].sort());

        const detail = await request(server)
            .get(`/api/articles/${article.slug}`)
            .expect(200);
        expect(created.body.article.tagList)
            .toEqual(detail.body.article.tagList);
    });

    it('allows anonymous and authenticated article reads', async () => {
        const { server } = context();
        const author = await registerAuthor();
        const tagA = makeTag('backend');
        const tagB = makeTag('nestjs');
        const payload = makePayload([tagA, tagB]);

        const created = await createArticle(author.authorization, payload);
        const slug = created.body.article.slug as string;

        const publicRead = await request(server)
            .get(`/api/articles/${slug}`)
            .expect(200);

        expect(publicRead.body.article).toMatchObject({
            slug,
            title: payload.article.title,
            description: payload.article.description,
            body: payload.article.body,
            tagList: [tagA, tagB].sort(),
            favoritesCount: 0,
            favorited: false,
            author: {
                username: author.username,
                following: false,
            },
        });

        const authenticatedRead = await request(server)
            .get(`/api/articles/${slug}`)
            .set('Authorization', author.authorization)
            .expect(200);

        expect(authenticatedRead.body.article.slug).toBe(slug);
        expect(authenticatedRead.body.article.favorited).toBe(false);
    });

    it('rejects an invalid JWT on a public article endpoint', async () => {
        const { server } = context();
        const author = await registerAuthor();
        const created = await createArticle(
            author.authorization,
            makePayload([]),
        );
        const slug = created.body.article.slug as string;

        await request(server)
            .get(`/api/articles/${slug}`)
            .set('Authorization', 'Bearer invalid.token')
            .expect(401);
    });

    it('returns 404 for an unknown article slug', async () => {
        const { server } = context();
        await request(server)
            .get(`/api/articles/nonexistent-${randomUUID()}`)
            .expect(404);
    });

    it('creates distinct slugs for identical titles and reuses tags', async () => {
        const { db } = context();
        const author = await registerAuthor();
        const tagA = makeTag('backend');
        const tagB = makeTag('nestjs');
        const payload = makePayload([tagA, tagB]);

        const first = await createArticle(author.authorization, payload);
        const second = await createArticle(author.authorization, payload);

        expect(second.body.article.slug)
            .not.toBe(first.body.article.slug);
        expect(await db.getRepository(Article).countBy({
            authorId: author.userId,
        })).toBe(2);
        expect(await db.getRepository(Tag).countBy({
            name: In([tagA, tagB]),
        })).toBe(2);

        const articleIds = await db.getRepository(Article).find({
            where: { authorId: author.userId },
        });
        const links = await db.getRepository(ArticleTag).findBy({
            articleId: In(articleIds.map((article) => article.id)),
        });
        expect(links).toHaveLength(4);
    });
});

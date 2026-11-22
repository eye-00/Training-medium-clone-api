
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
    let createdUserId: string | undefined;

    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const email = `e2e-article-${suffix}@example.com`;
    const username = `article_${suffix}`;
    const password = 'ExamplePass123!';

    const tagA = `backend_${suffix}`;
    const tagB = `nestjs_${suffix}`;

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

        const { AppModule } = await import(
            '../src/app.module.js'
        );

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
            throw new Error(
                'E2E database identity verification failed',
            );
        }

        databaseVerified = true;
    }, 25000);

    afterAll(async () => {
        if (!app) return;

        try {
            if (databaseVerified && createdUserId) {
                const db = app.get(DataSource);

                // Deleting this test user cascades to its articles,
                // article_tags and article_favorites.
                await db.getRepository(User).delete({
                    id: createdUserId,
                    email,
                });

                // Only remove tags uniquely named for this test.
                await db.getRepository(Tag).delete({
                    name: In([tagA, tagB]),
                });
            }
        } finally {
            await app.close();
        }
    }, 20000);

    it('validates authentication, article creation and persistence', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }

        const server = app.getHttpServer();
        const db = app.get(DataSource);

        const articles = db.getRepository(Article);
        const tags = db.getRepository(Tag);
        const articleTags = db.getRepository(ArticleTag);

        // 1. Register a dedicated author.
        const registration = await request(server)
            .post('/api/users')
            .send({ email, username, password })
            .expect(201);

        const userId = registration.body.user.id as string;
        createdUserId = userId;

        const login = await request(server)
            .post('/api/users/login')
            .send({ email, password })
            .expect(200);

        const authorization =
            `Bearer ${login.body.accessToken as string}`;

        const payload = {
            article: {
                title: 'Getting Started with NestJS',
                description: 'A beginner guide',
                body: 'Learning how NestJS and TypeORM work.',
                tagList: [
                    ` ${tagB.toUpperCase()} `,
                    tagB,
                    ` ${tagA.toUpperCase()} `,
                ],
            },
        };

        // 2. Missing and invalid JWT.
        await request(server)
            .post('/api/articles')
            .send(payload)
            .expect(401);

        await request(server)
            .post('/api/articles')
            .set('Authorization', 'Bearer invalid.token')
            .send(payload)
            .expect(401);

        // 3. DTO validation.
        await request(server)
            .post('/api/articles')
            .set('Authorization', authorization)
            .send({})
            .expect(400);

        await request(server)
            .post('/api/articles')
            .set('Authorization', authorization)
            .send({
                article: {
                    ...payload.article,
                    title: '   ',
                },
            })
            .expect(400);

        await request(server)
            .post('/api/articles')
            .set('Authorization', authorization)
            .send({
                article: {
                    ...payload.article,
                    authorId: randomUUID(),
                },
            })
            .expect(400);

        expect(await articles.countBy({
            authorId: userId,
        })).toBe(0);

        // 4. Create a valid article.
        const created = await request(server)
            .post('/api/articles')
            .set('Authorization', authorization)
            .send(payload)
            .expect(201);

        const article = created.body.article as {
            slug: string;
            title: string;
            description: string;
            body: string;
            tagList: string[];
            createdAt: string;
            updatedAt: string;
            favorited: boolean;
            favoritesCount: number;
            author: {
                username: string;
                following: boolean;
            };
        };

        expect(article.slug).toMatch(
            /^getting-started-with-nestjs-[0-9a-f-]{36}$/,
        );

        expect(article.title).toBe(
            payload.article.title,
        );

        expect(article.tagList).toEqual([
            tagA,
            tagB,
        ]);

        expect(article.favorited).toBe(false);
        expect(article.favoritesCount).toBe(0);

        expect(article.author).toMatchObject({
            username,
            following: false,
        });

        expect(Number.isNaN(
            Date.parse(article.createdAt),
        )).toBe(false);

        // 5. Verify database records and relationships.
        const saved = await articles.findOneByOrFail({
            slug: article.slug,
        });

        expect(saved.authorId).toBe(userId);
        expect(saved.body).toBe(payload.article.body);

        const links = await articleTags.findBy({
            articleId: saved.id,
        });

        expect(links).toHaveLength(2);

        const storedTags = await tags.findBy({
            id: In(links.map((link) => link.tagId)),
        });

        expect(storedTags.map((tag) => tag.name).sort())
            .toEqual([tagA, tagB]);



        // 7. Anonymous users can read an article.
        const publicRead = await request(server)
            .get(`/api/articles/${article.slug}`)
            .expect(200);

        expect(publicRead.body.article).toMatchObject({
            slug: article.slug,
            title: payload.article.title,
            description: payload.article.description,
            body: payload.article.body,
            tagList: [tagA, tagB],
            favoritesCount: 0,
            favorited: false,
            author: {
                username,
                following: false,
            },
        });

        // 8. Authenticated users can also read.
        const authenticatedRead = await request(server)
            .get(`/api/articles/${article.slug}`)
            .set('Authorization', authorization)
            .expect(200);

        expect(authenticatedRead.body.article.slug)
            .toBe(article.slug);

        expect(authenticatedRead.body.article.favorited)
            .toBe(false);

        // 9. A supplied invalid JWT must be rejected.
        await request(server)
            .get(`/api/articles/${article.slug}`)
            .set('Authorization', 'Bearer invalid.token')
            .expect(401);

        // 10. Unknown slug returns 404.
        await request(server)
            .get(`/api/articles/nonexistent-${randomUUID()}`)
            .expect(404);


        // 6. Same title must produce a distinct slug.
        const second = await request(server)
            .post('/api/articles')
            .set('Authorization', authorization)
            .send(payload)
            .expect(201);

        expect(second.body.article.slug)
            .not.toBe(article.slug);

        expect(await articles.countBy({
            authorId: userId,
        })).toBe(2);

        // Both articles reuse the same tag records.
        expect(await tags.countBy({
            name: In([tagA, tagB]),
        })).toBe(2);

    }, 40000);
});

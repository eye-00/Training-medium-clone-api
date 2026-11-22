import {
    type INestApplication,
    ValidationPipe,
    InternalServerErrorException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource, In, EntityManager } from 'typeorm';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { User } from '../src/users/entities/user.entity.js';
import { Article } from '../src/articles/entities/article.entity.js';
import { Tag } from '../src/articles/entities/tag.entity.js';
import { ArticleTag } from '../src/articles/entities/article-tag.entity.js';
import { ArticleFavorite } from '../src/articles/entities/article-favorite.entity.js';
import { ArticlesService } from '../src/articles/articles.service.js';
describe('Article Concurrency E2E', () => {
    let app: INestApplication | undefined;
    let databaseVerified = false;

    const createdUsers: Array<{
        id: string;
        email: string;
    }> = [];

    const suffix = randomUUID()
        .replaceAll('-', '')
        .slice(0, 16);

    const password = 'ExamplePass123!';

    const ownerUsername = `tx_owner_${suffix}`;
    const otherUsername = `tx_other_${suffix}`;

    const initialTag = `tx_initial_${suffix}`;
    const tagA = `tx_nestjs_${suffix}`;
    const tagB = `tx_typescript_${suffix}`;
    const sharedTag = `tx_shared_${suffix}`;

    const rollbackTag = `tx_rollback_${suffix}`;

    const testTags = [
        initialTag,
        tagA,
        tagB,
        sharedTag,
    ];

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

        await app.listen(0, '127.0.0.1');

        const rows = (await app
            .get(DataSource)
            .query(`
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
            if (databaseVerified) {
                const db = app.get(DataSource);

                // Delete only users created by this test.
                // Their articles and article-tag links cascade.
                for (const user of createdUsers) {
                    await db.getRepository(User).delete({
                        id: user.id,
                        email: user.email,
                    });
                }

                // Delete only this test's uniquely named tags.
                await db.getRepository(Tag).delete({
                    name: In(testTags),
                });
            }
        } finally {
            await app.close();
        }
    }, 20000);


    it('preserves article consistency under concurrent writes', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }

        const server = app.getHttpServer();
        const db = app.get(DataSource);

        const articlesRepository =
            db.getRepository(Article);

        const tagsRepository =
            db.getRepository(Tag);

        const linksRepository =
            db.getRepository(ArticleTag);

        async function registerUser(username: string) {
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
                authorization:
                    `Bearer ${login.body.accessToken as string}`,
            };
        }

        // 1. Create two users.
        const owner = await registerUser(ownerUsername);
        const other = await registerUser(otherUsername);

        // 2. Create one article.
        const created = await request(server)
            .post('/api/articles')
            .set('Authorization', owner.authorization)
            .send({
                article: {
                    title: 'Transaction Concurrency Test',
                    description: 'Initial description',
                    body: 'Initial body',
                    tagList: [initialTag],
                },
            })
            .expect(201);

        const slug = created.body.article.slug as string;
        const articleUrl = `/api/articles/${slug}`;

        const article = await articlesRepository
            .findOneByOrFail({ slug });

        const originalCreatedAt =
            created.body.article.createdAt as string;

        // 3. Unauthorized updates cannot modify the article.
        await request(server)
            .put(articleUrl)
            .set('Authorization', other.authorization)
            .send({
                article: {
                    description: 'Unauthorized modification',
                    tagList: [tagA],
                },
            })
            .expect(403);

        // 4. Repeat concurrent updates three times.
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

            const [responseA, responseB] =
                await Promise.all([
                    request(server)
                        .put(articleUrl)
                        .set('Authorization', owner.authorization)
                        .send({ article: versionA })
                        .expect(200),

                    request(server)
                        .put(articleUrl)
                        .set('Authorization', owner.authorization)
                        .send({ article: versionB })
                        .expect(200),
                ]);

            // Each response must represent its own update.
            expect(responseA.body.article).toMatchObject({
                description: versionA.description,
                body: versionA.body,
                tagList: [...versionA.tagList].sort(),
            });

            expect(responseB.body.article).toMatchObject({
                description: versionB.description,
                body: versionB.body,
                tagList: [...versionB.tagList].sort(),
            });

            // 5. Read final article state.
            const detail = await request(server)
                .get(articleUrl)
                .expect(200);

            const actual = detail.body.article;

            // Last transaction to commit may be A or B.
            const finalVersion =
                actual.description === versionA.description
                    ? versionA
                    : versionB;

            // But all fields must belong to that version.
            expect(actual.description)
                .toBe(finalVersion.description);

            expect(actual.body)
                .toBe(finalVersion.body);

            expect(actual.tagList)
                .toEqual([...finalVersion.tagList].sort());

            expect(actual.createdAt)
                .toBe(originalCreatedAt);

            // 6. Verify persisted article state.
            const stored = await articlesRepository
                .findOneByOrFail({ id: article.id });

            expect(stored.description)
                .toBe(finalVersion.description);

            expect(stored.body)
                .toBe(finalVersion.body);

            // 7. Verify article-tag relationships.
            const links = await linksRepository.findBy({
                articleId: article.id,
            });

            expect(links).toHaveLength(2);

            const tagRows = await tagsRepository.findBy({
                id: In(links.map((link) => link.tagId)),
            });

            expect(
                tagRows.map((tag) => tag.name).sort(),
            ).toEqual([...finalVersion.tagList].sort());
        }

        // 8. Favorite and Update operate concurrently.
        const favoriteUrl = `${articleUrl}/favorite`;

        const [favoriteResponse, updateResponse] =
            await Promise.all([
                request(server)
                    .post(favoriteUrl)
                    .set('Authorization', other.authorization)
                    .expect(200),

                request(server)
                    .put(articleUrl)
                    .set('Authorization', owner.authorization)
                    .send({
                        article: {
                            description: 'After concurrent favorite',
                            body: 'Final article body',
                            tagList: [initialTag],
                        },
                    })
                    .expect(200),
            ]);

        expect(favoriteResponse.body.article.favorited)
            .toBe(true);

        expect(updateResponse.body.article.description)
            .toBe('After concurrent favorite');

        // 9. Verify final combined state.
        const finalDetail = await request(server)
            .get(articleUrl)
            .set('Authorization', other.authorization)
            .expect(200);

        expect(finalDetail.body.article).toMatchObject({
            description: 'After concurrent favorite',
            body: 'Final article body',
            tagList: [initialTag],
            favorited: true,
            favoritesCount: 1,
        });

        expect(
            await db.getRepository(ArticleFavorite).countBy({
                articleId: article.id,
                userId: other.id,
            }),
        ).toBe(1);

        const finalLinks = await linksRepository.findBy({
            articleId: article.id,
        });

        expect(finalLinks).toHaveLength(1);

        const finalTag = await tagsRepository
            .findOneByOrFail({ id: finalLinks[0].tagId });

        expect(finalTag.name).toBe(initialTag);

        // No explicit deletion is needed here.
        // afterAll removes this test's users and tags.
    }, 40000);

    it('rolls back article and tag changes after an injected failure', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }

        const server = app.getHttpServer();
        const db = app.get(DataSource);

        const articles = db.getRepository(Article);
        const tags = db.getRepository(Tag);
        const links = db.getRepository(ArticleTag);

        // 1. Create an independent test user.
        const username = `tx_rollback_user_${suffix}`;
        const email = `${username}@example.com`;

        const registration = await request(server)
            .post('/api/users')
            .send({ email, username, password })
            .expect(201);

        const userId = registration.body.user.id as string;
        createdUsers.push({ id: userId, email });

        const login = await request(server)
            .post('/api/users/login')
            .send({ email, password })
            .expect(200);

        const authorization =
            `Bearer ${login.body.accessToken as string}`;

        // 2. Create an article with one initial tag.
        const created = await request(server)
            .post('/api/articles')
            .set('Authorization', authorization)
            .send({
                article: {
                    title: 'Rollback Original Article',
                    description: 'Original description',
                    body: 'Original body',
                    tagList: [initialTag],
                },
            })
            .expect(201);

        const slug = created.body.article.slug as string;
        const articleUrl = `/api/articles/${slug}`;

        const before = await articles.findOneByOrFail({
            slug,
        });

        expect(
            await tags.existsBy({ name: rollbackTag }),
        ).toBe(false);

        // 3. Obtain the actual service instance.
        // The cast exposes the private method to
        // this test without changing production code.
        const service = app.get(ArticlesService) as unknown as {
            replaceArticleTags: (
                manager: EntityManager,
                articleId: string,
                names: string[],
            ) => Promise<void>;
        };

        const originalReplace =
            service.replaceArticleTags.bind(service);

        let failurePointReached = false;

        // 4. Inject a failure AFTER the real helper
        // completes its database write operations.
        const spy = vi
            .spyOn(service, 'replaceArticleTags')
            .mockImplementation(
                async (manager, articleId, names) => {
                    await originalReplace(
                        manager,
                        articleId,
                        names,
                    );

                    failurePointReached = true;

                    throw new InternalServerErrorException(
                        'E2E forced rollback',
                    );
                },
            );

        try {
            // 5. Attempt to modify article fields and tags.
            const failedUpdate = await request(server)
                .put(articleUrl)
                .set('Authorization', authorization)
                .send({
                    article: {
                        title: 'Rollback Modified Article',
                        description: 'Changed description',
                        body: 'Changed body',
                        tagList: [rollbackTag],
                    },
                })
                .expect(500);

            expect(failedUpdate.body).toMatchObject({
                statusCode: 500,
                message: 'E2E forced rollback',
            });

            expect(failurePointReached).toBe(true);
            expect(spy).toHaveBeenCalledOnce();
        } finally {
            // Always restore the service, even if
            // an assertion or request fails.
            spy.mockRestore();
        }

        // 6. Verify all Article fields were rolled back.
        const after = await articles.findOneByOrFail({
            id: before.id,
        });

        expect(after.slug).toBe(before.slug);
        expect(after.title).toBe(before.title);
        expect(after.description).toBe(before.description);
        expect(after.body).toBe(before.body);

        expect(after.createdAt.getTime())
            .toBe(before.createdAt.getTime());

        expect(after.updatedAt.getTime())
            .toBe(before.updatedAt.getTime());

        // 7. Verify the original article-tag link remains.
        const savedLinks = await links.findBy({
            articleId: before.id,
        });

        expect(savedLinks).toHaveLength(1);

        const savedTag = await tags.findOneByOrFail({
            id: savedLinks[0].tagId,
        });

        expect(savedTag.name).toBe(initialTag);

        // 8. Verify the newly inserted tag was rolled back.
        expect(
            await tags.existsBy({ name: rollbackTag }),
        ).toBe(false);

        // 9. Confirm the public API returns the original state.
        const detail = await request(server)
            .get(articleUrl)
            .expect(200);

        expect(detail.body.article).toMatchObject({
            slug,
            title: 'Rollback Original Article',
            description: 'Original description',
            body: 'Original body',
            tagList: [initialTag],
        });

    }, 30000);


});

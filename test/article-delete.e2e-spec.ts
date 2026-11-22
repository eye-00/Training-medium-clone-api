
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
import { ArticleFavorite } from '../src/articles/entities/article-favorite.entity.js';

describe('Article Delete E2E', () => {
    let app: INestApplication | undefined;
    let databaseVerified = false;

    const createdUsers: Array<{
        id: string;
        email: string;
    }> = [];

    const suffix = randomUUID()
        .replaceAll('-', '')
        .slice(0, 16);

    const ownerEmail = `e2e-delete-owner-${suffix}@example.com`;
    const otherEmail = `e2e-delete-other-${suffix}@example.com`;

    const ownerUsername = `edit_owner_${suffix}`;
    const otherUsername = `edit_other_${suffix}`;

    const password = 'ExamplePass123!';

    const oldTag = `nestjs_${suffix}`;
    const keptTag = `backend_${suffix}`;
    const newTag = `typescript_${suffix}`;

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
            if (databaseVerified) {
                const db = app.get(DataSource);

                // Only remove users created by this test.
                // FK cascades remove their articles and links.
                for (const user of createdUsers) {
                    await db.getRepository(User).delete({
                        id: user.id,
                        email: user.email,
                    });
                }

                // Remove only this test's uniquely named tags.
                await db.getRepository(Tag).delete({
                    name: In([oldTag, keptTag, newTag]),
                });
            }
        } finally {
            await app.close();
        }
    }, 20000);


    it('validates authorization, deletion and cascade constraints', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }

        const server = app.getHttpServer();
        const db = app.get(DataSource);

        const users = db.getRepository(User);
        const articles = db.getRepository(Article);
        const tags = db.getRepository(Tag);
        const articleTags = db.getRepository(ArticleTag);
        const favorites = db.getRepository(ArticleFavorite);

        // 1. Register the article owner.
        const ownerRegistration = await request(server)
            .post('/api/users')
            .send({
                email: ownerEmail,
                username: ownerUsername,
                password,
            })
            .expect(201);

        const ownerId =
            ownerRegistration.body.user.id as string;

        createdUsers.push({
            id: ownerId,
            email: ownerEmail,
        });

        // 2. Register another user.
        const otherRegistration = await request(server)
            .post('/api/users')
            .send({
                email: otherEmail,
                username: otherUsername,
                password,
            })
            .expect(201);

        const otherId =
            otherRegistration.body.user.id as string;

        createdUsers.push({
            id: otherId,
            email: otherEmail,
        });

        // 3. Authenticate both users.
        const ownerLogin = await request(server)
            .post('/api/users/login')
            .send({ email: ownerEmail, password })
            .expect(200);

        const otherLogin = await request(server)
            .post('/api/users/login')
            .send({ email: otherEmail, password })
            .expect(200);

        const ownerAuth =
            `Bearer ${ownerLogin.body.accessToken as string}`;

        const otherAuth =
            `Bearer ${otherLogin.body.accessToken as string}`;

        // 4. Create the article that will be deleted.
        const created = await request(server)
            .post('/api/articles')
            .set('Authorization', ownerAuth)
            .send({
                article: {
                    title: 'Article to delete',
                    description: 'Testing article deletion',
                    body: 'This article will be deleted.',
                    tagList: [oldTag, keptTag],
                },
            })
            .expect(201);

        const slug = created.body.article.slug as string;

        const article = await articles.findOneByOrFail({
            slug,
        });

        const url = `/api/articles/${slug}`;

        // 5. Create an unrelated article sharing a tag.
        const siblingResponse = await request(server)
            .post('/api/articles')
            .set('Authorization', otherAuth)
            .send({
                article: {
                    title: 'Article to retain',
                    description: 'This article must survive',
                    body: 'Unrelated article content',
                    tagList: [keptTag],
                },
            })
            .expect(201);

        const siblingArticle =
            await articles.findOneByOrFail({
                slug: siblingResponse.body.article.slug as string,
            });

        // 6. Seed favorites directly because the
        // Favorite API has not been implemented yet.
        await favorites.insert([
            {
                userId: otherId,
                articleId: article.id,
            },
            {
                userId: ownerId,
                articleId: siblingArticle.id,
            },
        ]);

        // Verify dependent records exist before deletion.
        expect(
            await articleTags.countBy({
                articleId: article.id,
            }),
        ).toBe(2);

        expect(
            await favorites.countBy({
                articleId: article.id,
            }),
        ).toBe(1);

        // 7. Authentication is required.
        await request(server)
            .delete(url)
            .expect(401);

        await request(server)
            .delete(url)
            .set('Authorization', 'Bearer invalid.token')
            .expect(401);

        // 8. Another user cannot delete the article.
        await request(server)
            .delete(url)
            .set('Authorization', otherAuth)
            .expect(403);

        expect(
            await articles.existsBy({
                id: article.id,
            }),
        ).toBe(true);

        // 9. Unknown slug.
        await request(server)
            .delete(`/api/articles/missing-${randomUUID()}`)
            .set('Authorization', ownerAuth)
            .expect(404);

        // 10. The author deletes the article.
        const deleted = await request(server)
            .delete(url)
            .set('Authorization', ownerAuth)
            .expect(204);

        expect(deleted.text).toBe('');

        // 11. The article is no longer accessible.
        await request(server)
            .get(url)
            .expect(404);

        await request(server)
            .delete(url)
            .set('Authorization', ownerAuth)
            .expect(404);

        // 12. Verify actual database deletion.
        expect(
            await articles.existsBy({
                id: article.id,
            }),
        ).toBe(false);

        // 13. Verify cascading deletes.
        expect(
            await articleTags.countBy({
                articleId: article.id,
            }),
        ).toBe(0);

        expect(
            await favorites.countBy({
                articleId: article.id,
            }),
        ).toBe(0);

        // 14. The two users still exist.
        expect(
            await users.countBy({
                id: In([ownerId, otherId]),
            }),
        ).toBe(2);

        // 15. Shared tag records are retained.
        expect(
            await tags.countBy({
                name: In([oldTag, keptTag]),
            }),
        ).toBe(2);

        // 16. The unrelated article is unaffected.
        expect(
            await articles.existsBy({
                id: siblingArticle.id,
            }),
        ).toBe(true);

        expect(
            await articleTags.countBy({
                articleId: siblingArticle.id,
            }),
        ).toBe(1);

        expect(
            await favorites.countBy({
                articleId: siblingArticle.id,
            }),
        ).toBe(1);

        await request(server)
            .get(`/api/articles/${siblingArticle.slug}`)
            .expect(200);

    }, 40000);

});

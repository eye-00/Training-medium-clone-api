import {
    type INestApplication,
    ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';

import { Follow } from '../src/profiles/entities/follow.entity.js';
import { User } from '../src/users/entities/user.entity.js';

describe('Follow / Unfollow E2E', () => {
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

    const follower = {
        email: `e2e-follow-a-${suffix}@example.com`,
        username: `follow_a_${suffix}`,
    };

    const target = {
        email: `e2e-follow-b-${suffix}@example.com`,
        username: `follow_b_${suffix}`,
    };

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

        const dataSource = app.get(DataSource);

        const rows = (await dataSource.query(`
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
                const usersRepository = app
                    .get(DataSource)
                    .getRepository(User);

                // The follows table has ON DELETE CASCADE.
                // Delete only users created by this test.
                for (const user of createdUsers) {
                    await usersRepository.delete({
                        id: user.id,
                        email: user.email,
                    });
                }
            }
        } finally {
            await app.close();
        }
    }, 15000);

    it('validates follow, unfollow and concurrent requests', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test app is not ready');
        }

        const server = app.getHttpServer();

        const followerResponse = await request(server)
            .post('/api/users')
            .send({ ...follower, password })
            .expect(201);

        const followerId =
            followerResponse.body.user.id as string;

        createdUsers.push({
            id: followerId,
            email: follower.email,
        });

        const targetResponse = await request(server)
            .post('/api/users')
            .send({ ...target, password })
            .expect(201);

        const targetId =
            targetResponse.body.user.id as string;

        createdUsers.push({
            id: targetId,
            email: target.email,
        });

        const login = await request(server)
            .post('/api/users/login')
            .send({
                email: follower.email,
                password,
            })
            .expect(200);

        const token = login.body.accessToken as string;
        const authorization = `Bearer ${token}`;

        const followUrl =
            `/api/profiles/${target.username}/follow`;

        const ownFollowUrl =
            `/api/profiles/${follower.username}/follow`;

        const unknownFollowUrl =
            `/api/profiles/missing_${suffix}/follow`;

        const followsRepository = app
            .get(DataSource)
            .getRepository(Follow);

        const countRelationship = () =>
            followsRepository.count({
                where: {
                    followerId,
                    followedId: targetId,
                },
            });

        // 1. Follow / Unfollow require JWT.
        await request(server)
            .post(followUrl)
            .expect(401);

        await request(server)
            .delete(followUrl)
            .expect(401);

        // 2. Invalid token must be rejected.
        await request(server)
            .post(followUrl)
            .set('Authorization', 'Bearer invalid-token')
            .expect(401);

        // 3. Unknown username.
        await request(server)
            .post(unknownFollowUrl)
            .set('Authorization', authorization)
            .expect(404);

        await request(server)
            .delete(unknownFollowUrl)
            .set('Authorization', authorization)
            .expect(404);

        // 4. Self-follow and self-unfollow.
        await request(server)
            .post(ownFollowUrl)
            .set('Authorization', authorization)
            .expect(400);

        await request(server)
            .delete(ownFollowUrl)
            .set('Authorization', authorization)
            .expect(204);

        // 5. Follow successfully.
        await request(server)
            .post(followUrl)
            .set('Authorization', authorization)
            .expect(200);

        expect(await countRelationship()).toBe(1);

        // 6. Verify public profile counts.
        const targetProfile = await request(server)
            .get(`/api/profiles/${target.username}`)
            .expect(200);

        expect(
            targetProfile.body.profile.followersCount,
        ).toBe(1);

        expect(
            targetProfile.body.profile.followingCount,
        ).toBe(0);

        const followerProfile = await request(server)
            .get(`/api/profiles/${follower.username}`)
            .expect(200);

        expect(
            followerProfile.body.profile.followersCount,
        ).toBe(0);

        expect(
            followerProfile.body.profile.followingCount,
        ).toBe(1);

        // 7. Duplicate follow returns 409.
        await request(server)
            .post(followUrl)
            .set('Authorization', authorization)
            .expect(409);

        expect(await countRelationship()).toBe(1);

        // 8. Unfollow successfully.
        await request(server)
            .delete(followUrl)
            .set('Authorization', authorization)
            .expect(204);

        expect(await countRelationship()).toBe(0);

        // 9. Unfollow is idempotent.
        await request(server)
            .delete(followUrl)
            .set('Authorization', authorization)
            .expect(204);

        expect(await countRelationship()).toBe(0);

        // 10. Send two follow requests concurrently.
        const [first, second] = await Promise.all([
            request(server)
                .post(followUrl)
                .set('Authorization', authorization),

            request(server)
                .post(followUrl)
                .set('Authorization', authorization),
        ]);

        const statuses = [
            first.status,
            second.status,
        ].sort((a, b) => a - b);

        expect(statuses).toEqual([200, 409]);

        // Exactly one relationship must exist.
        expect(await countRelationship()).toBe(1);

        // Public count must also reflect one follow.
        const finalProfile = await request(server)
            .get(`/api/profiles/${target.username}`)
            .expect(200);

        expect(
            finalProfile.body.profile.followersCount,
        ).toBe(1);

        // Clean up the relationship through the API.
        await request(server)
            .delete(followUrl)
            .set('Authorization', authorization)
            .expect(204);

        expect(await countRelationship()).toBe(0);
    }, 30000);
});

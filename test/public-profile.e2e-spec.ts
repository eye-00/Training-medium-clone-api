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

import { User } from '../src/users/entities/user.entity.js';
import { Follow } from '../src/profiles/entities/follow.entity.js';

describe('Public Profile E2E', () => {
    let app: INestApplication | undefined;
    let databaseVerified = false;

    const createdUsers: Array<{
        id: string;
        email: string;
    }> = [];

    const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
    const password = 'ExamplePass123!';

    const users = [
        {
            email: `e2e-public-a-${suffix}@example.com`,
            username: `public_a_${suffix}`,
        },
        {
            email: `e2e-public-b-${suffix}@example.com`,
            username: `public_b_${suffix}`,
        },
        {
            email: `e2e-public-c-${suffix}@example.com`,
            username: `public_c_${suffix}`,
        },
    ];

    beforeAll(async () => {
        const env = process.env;

        // Check the environment before importing AppModule.
        if (
            env.NODE_ENV !== 'test' ||
            env.DB_HOST !== '127.0.0.1' ||
            env.DB_PORT !== '3307' ||
            env.DB_DATABASE !== 'medium_clone_test' ||
            env.DB_USERNAME !== 'medium_test_user' ||
            env.REDIS_URL !== 'redis://127.0.0.1:6380' ||
            !env.DB_TEST_SERVER_UUID
        ) {
            throw new Error(
                'Unsafe E2E environment: expected isolated test services',
            );
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
    }, 20000);

    afterAll(async () => {
        if (!app) return;

        try {
            if (databaseVerified) {
                const repository = app
                    .get(DataSource)
                    .getRepository(User);

                // Follow rows are removed by ON DELETE CASCADE.
                for (const user of createdUsers) {
                    await repository.delete({
                        id: user.id,
                        email: user.email,
                    });
                }
            }
        } finally {
            await app.close();
        }
    });

    it('returns public profiles and correct follow counts', async () => {
        if (!app || !databaseVerified) {
            throw new Error('Test application is not ready');
        }

        const server = app.getHttpServer();
        const ids: string[] = [];

        // Register three isolated test users.
        for (const user of users) {
            const response = await request(server)
                .post('/api/users')
                .send({
                    email: user.email,
                    username: user.username,
                    password,
                })
                .expect(201);

            const id = response.body.user.id as string;

            createdUsers.push({
                id,
                email: user.email,
            });

            ids.push(id);
        }

        const [userA, userB, userC] = ids;

        if (!userA || !userB || !userC) {
            throw new Error('Test users were not created');
        }

        // B follows A, C follows A, A follows B.
        const followsRepository = app
            .get(DataSource)
            .getRepository(Follow);

        await followsRepository.insert([
            { followerId: userB, followedId: userA },
            { followerId: userC, followedId: userA },
            { followerId: userA, followedId: userB },
        ]);

        // Public endpoint: no Authorization header.
        const response = await request(server)
            .get(`/api/profiles/${users[0]!.username}`)
            .expect(200);

        expect(response.body).toEqual({
            profile: {
                username: users[0]!.username,
                bio: null,
                image: null,
                followersCount: 2,
                followingCount: 1,
            },
        });

        // Private fields must not appear.
        expect(response.body.profile).not.toHaveProperty('id');
        expect(response.body.profile).not.toHaveProperty('email');
        expect(response.body.profile).not.toHaveProperty(
            'passwordHash',
        );

        // Verify the opposite direction for User B.
        const profileB = await request(server)
            .get(`/api/profiles/${users[1]!.username}`)
            .expect(200);

        expect(profileB.body.profile.followersCount).toBe(1);
        expect(profileB.body.profile.followingCount).toBe(1);

        // Unknown username must return 404.
        await request(server)
            .get(`/api/profiles/unknown_${suffix}`)
            .expect(404);
    }, 15000);
});

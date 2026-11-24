
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

describe('Authentication E2E', () => {
    let app: INestApplication | undefined;
    let createdUserId: string | undefined;

    const suffix = randomUUID().replaceAll('-', '');
    const email = `e2e-${suffix}@example.com`;
    const username = `e2e_${suffix.slice(0, 20)}`;
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
            throw new Error(
                'Unsafe E2E environment: expected isolated test services',
            );
        }

        // Import the application only after checking the environment.
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
    });

    afterAll(async () => {
        if (!app) return;

        try {
            if (createdUserId) {
                await app
                    .get(DataSource)
                    .getRepository(User)
                    .delete({
                        id: createdUserId,
                        email,
                    });
            }
        } finally {
            await app.close();
        }
    });

    it('registers, logs in, reads user and logs out', async () => {
        if (!app) {
            throw new Error('Test application was not initialized');
        }

        const server = app.getHttpServer();



        // Invalid registration: malformed email
        await request(server)
            .post('/api/users')
            .send({
                email: 'invalid-email',
                username,
                password,
            })
            .expect(400);

        // Invalid registration: unexpected field
        await request(server)
            .post('/api/users')
            .send({
                email,
                username,
                password,
                role: 'admin',
            })
            .expect(400);

        // Register
        const register = await request(server)
            .post('/api/users')
            .send({ email, username, password })
            .expect(201);

        createdUserId = register.body.user.id as string;

        expect(register.body.user.email).toBe(email);
        expect(register.body.user).not.toHaveProperty(
            'passwordHash',
        );

        // Duplicate registration
        await request(server)
            .post('/api/users')
            .send({ email, username, password })
            .expect(409);

        // Login
        const login = await request(server)
            .post('/api/users/login')
            .send({ email, password })
            .expect(200);

        const token = login.body.accessToken as string;

        expect(typeof token).toBe('string');
        expect(token.split('.')).toHaveLength(3);


        // Incorrect password
        const wrongPassword = await request(server)
            .post('/api/users/login')
            .send({
                email,
                password: 'WrongPassword123!',
            })
            .expect(401);

        // Unknown email
        const unknownEmail = await request(server)
            .post('/api/users/login')
            .send({
                email: `unknown-${suffix}@example.com`,
                password,
            })
            .expect(401);

        // Both cases must return the same error.
        expect(wrongPassword.body.message).toBe(
            'Invalid email or password',
        );

        expect(unknownEmail.body.message).toBe(
            wrongPassword.body.message,
        );



        // Missing access token
        await request(server)
            .get('/api/user')
            .expect(401);

        // Invalid access token
        await request(server)
            .get('/api/user')
            .set(
                'Authorization',
                'Bearer invalid.token.value',
            )
            .expect(401);


        // Current user
        const currentUser = await request(server)
            .get('/api/user')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(currentUser.body.user.id).toBe(
            createdUserId,
        );

        // Logout
        const logout = await request(server)
            .post('/api/users/logout')
            .set('Authorization', `Bearer ${token}`)
            .expect(204);

        expect(logout.text).toBe('');

        // Revoked token
        await request(server)
            .get('/api/user')
            .set('Authorization', `Bearer ${token}`)
            .expect(401);

        // Logging out again with the revoked token
        await request(server)
            .post('/api/users/logout')
            .set('Authorization', `Bearer ${token}`)
            .expect(401);

    });
});

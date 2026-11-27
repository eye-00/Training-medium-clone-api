import { randomBytes, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { createClient } from 'redis';
import request from 'supertest';
import { User } from '../src/users/entities/user.entity.js';
import { assertDedicatedE2eEnvironment } from './helpers/dedicated-e2e-database.js';

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';

import {
    createTestApp,
    closeTestApp,
    type TestAppContext,
} from './helpers/test-app.helper.js';


describe('Authentication E2E', () => {
    let testApp: TestAppContext | undefined;
    let revokedFixtureJti: string | undefined;

    const suffix = randomUUID().replaceAll('-', '');
    const email = `e2e-${suffix}@example.com`;
    const username = `e2e_${suffix.slice(0, 20)}`;
    const password = 'ExamplePass123!';

    beforeAll(async () => {
        testApp = await createTestApp();
    });

    afterEach(async () => {
        if (!revokedFixtureJti) return;
        assertDedicatedE2eEnvironment();
        const redis = createClient({
            url: process.env.REDIS_URL,
            socket: { connectTimeout: 5000, reconnectStrategy: false },
        });
        redis.on('error', () => { /* Commands report connection errors. */ });
        try {
            await redis.connect();
            const key = `auth:blacklist:${revokedFixtureJti}`;
            await redis.del(key);
            expect(await redis.exists(key)).toBe(0);
        } finally {
            if (redis.isOpen) await redis.close();
            revokedFixtureJti = undefined;
        }
    });

    afterAll(async () => {
        if (testApp) await closeTestApp(testApp);
    });

    it('registers, logs in, reads user and logs out', async () => {
        if (!testApp) {
            throw new Error('Test application was not initialized');
        }

        const { server } = testApp;



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

        const createdUserId = register.body.user.id as string;

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

        // Track the exact test-created revocation key even if logout's response fails.
        const claims = await testApp.app.get(JwtService).verifyAsync<{ jti: string }>(token);
        revokedFixtureJti = claims.jti;
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

    describe('AuthController login conditions', () => {
        let fixture: { id: string; email: string; username: string };

        function context(): TestAppContext {
            if (!testApp) throw new Error('Test application was not initialized');
            return testApp;
        }

        beforeEach(async () => {
            const unique = randomUUID().replaceAll('-', '');
            const email = `c2-${unique}@example.com`;
            const username = `c2_${unique}`;
            const { server, db } = context();
            await request(server).post('/api/users').send({ email, username, password }).expect(201);
            const { id } = await db.getRepository(User).findOneByOrFail({ email });
            fixture = { id, email, username };
        });

        it('C2-01 logs in with a matching password and returns the stored public user', async () => {
            const { app, server } = context();
            const response = await request(server).post('/api/users/login')
                .send({ email: ` ${fixture.email.toUpperCase()} `, password }).expect(200);
            expect(response.body.user).toEqual({ ...fixture, bio: null, image: null });
            const token: string = response.body.accessToken;
            const claims = await app.get(JwtService).verifyAsync<{ sub: string; iat: number; exp: number }>(token, {
                algorithms: ['HS256'],
            });
            expect(claims.sub).toBe(fixture.id);
            expect(claims.exp - claims.iat).toBe(900);
            const current = await request(server).get('/api/user').set('Authorization', `Bearer ${token}`).expect(200);
            expect(current.body.user.id).toBe(fixture.id);
        });

        it('C2-02 rejects a missing user with the generic credentials error', async () => {
            const { db, server } = context();
            const email = `missing-${randomUUID()}@example.com`;
            expect(await db.getRepository(User).existsBy({ email })).toBe(false);
            const response = await request(server).post('/api/users/login').send({ email, password }).expect(401);
            expect(response.body.message).toBe('Invalid email or password');
        });

        it.each([
            ['C2-03 wrong password', 'DifferentPassword123!'],
            ['C2-04 oversized UTF-8 password', '😀'.repeat(18) + 'x'],
        ])('rejects %s with the generic credentials error', async (_scenario, attemptedPassword) => {
            const response = await request(context().server).post('/api/users/login')
                .send({ email: fixture.email, password: attemptedPassword }).expect(401);
            expect(response.body.message).toBe('Invalid email or password');
        });

        it('rejects invalid login input before calling the controller', async () => {
            const response = await request(context().server).post('/api/users/login')
                .send({ email: 'invalid-email', password }).expect(400);
            expect(response.body.message).toContain('email must be an email');
        });

        it.each(['wrong signature', 'expired', 'invalid payload', 'missing user'] as const)(
            'rejects a token with %s on the protected route',
            async (scenario) => {
                const { app, server } = context();
                const jwt = app.get(JwtService);
                const token = await jwt.signAsync({
                    sub: scenario === 'missing user' ? randomUUID() : fixture.id,
                    jti: scenario === 'invalid payload' ? 'invalid-jti' : randomUUID(),
                }, {
                    ...(scenario === 'wrong signature' ? { secret: randomBytes(32).toString('hex') } : {}),
                    ...(scenario === 'expired' ? { expiresIn: -1 } : {}),
                });
                const response = await request(server).get('/api/user').set('Authorization', `Bearer ${token}`).expect(401);
                expect(response.body.message).toBe(scenario === 'invalid payload'
                    ? 'Invalid access token payload'
                    : 'Invalid or expired access token');
            },
        );
    });
});

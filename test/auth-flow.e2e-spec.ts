import { randomUUID } from 'node:crypto';
import request from 'supertest';

import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';

import {
    createTestApp,
    closeTestApp,
    type TestAppContext,
} from './helpers/test-app.helper.js';

import {
    cleanupUserFixtures,
} from './helpers/user-fixture.helper.js';

describe('Authentication E2E', () => {
    let testApp: TestAppContext | undefined;
    let createdUserId: string | undefined;

    const suffix = randomUUID().replaceAll('-', '');
    const email = `e2e-${suffix}@example.com`;
    const username = `e2e_${suffix.slice(0, 20)}`;
    const password = 'ExamplePass123!';

    beforeAll(async () => {
        testApp = await createTestApp();
    });

    afterAll(async () => {
        if (!testApp) return;

        await closeTestApp(
            testApp,
            async ({ db }) => {
                if (createdUserId) {
                    await cleanupUserFixtures(
                        db,
                        [{ id: createdUserId, email }],
                    );
                }
            },
        );
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

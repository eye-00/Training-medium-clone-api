import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';

import { Follow } from '../src/profiles/entities/follow.entity.js';

import {
    createTestApp,
    closeTestApp,
    type TestAppContext,
} from './helpers/test-app.helper.js';


describe('Public Profile E2E', () => {
    let testApp: TestAppContext | undefined;


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
        testApp = await createTestApp();
    });

    afterAll(async () => {
        if (testApp) await closeTestApp(testApp);
    });


    it('returns public profiles and correct follow counts', async () => {
        if (!testApp) {
            throw new Error('Test application is not ready');
        }

        const { server, db } = testApp;
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


            ids.push(id);
        }

        const [userA, userB, userC] = ids;

        if (!userA || !userB || !userC) {
            throw new Error('Test users were not created');
        }

        // B follows A, C follows A, A follows B.
        const followsRepository = db.getRepository(Follow);

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

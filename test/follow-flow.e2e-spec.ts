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

import {
    registerUserFixture,
} from './helpers/user-fixture.helper.js';

describe('Follow / Unfollow E2E', () => {
    let testApp: TestAppContext | undefined;


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
        testApp = await createTestApp();
    });

    afterAll(async () => {
        if (testApp) await closeTestApp(testApp);
    });


    it('validates follow, unfollow and concurrent requests', async () => {
        if (!testApp) {
            throw new Error('Test app is not ready');
        }

        const { server, db } = testApp;

        const followerResponse = await request(server)
            .post('/api/users')
            .send({ ...follower, password })
            .expect(201);

        const followerId =
            followerResponse.body.user.id as string;


        const targetResponse = await request(server)
            .post('/api/users')
            .send({ ...target, password })
            .expect(201);

        const targetId =
            targetResponse.body.user.id as string;


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

        const followsRepository = db.getRepository(Follow);

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

    it('unfollowing one user preserves another user’s follow', async () => {
        if (!testApp) {
            throw new Error('Test app is not ready');
        }

        const { server, db } = testApp;
        const alice = await registerUserFixture(testApp, { prefix: 'follow_a' });
        const bob = await registerUserFixture(testApp, { prefix: 'follow_b' });
        const charlie = await registerUserFixture(testApp, { prefix: 'follow_c' });
        const followUrl = `/api/profiles/${charlie.username}/follow`;
        const follows = db.getRepository(Follow);
        const aliceEdge = { followerId: alice.id, followedId: charlie.id };
        const bobEdge = { followerId: bob.id, followedId: charlie.id };

        await request(server).post(followUrl)
            .set('Authorization', alice.authorization).expect(200);
        await request(server).post(followUrl)
            .set('Authorization', bob.authorization).expect(200);

        expect(await follows.existsBy(aliceEdge)).toBe(true);
        expect(await follows.existsBy(bobEdge)).toBe(true);
        expect(await follows.countBy({ followedId: charlie.id })).toBe(2);
        const before = await request(server)
            .get(`/api/profiles/${charlie.username}`).expect(200);
        expect(before.body.profile.followersCount).toBe(2);

        await request(server).delete(followUrl)
            .set('Authorization', alice.authorization).expect(204);

        expect(await follows.existsBy(aliceEdge)).toBe(false);
        expect(await follows.existsBy(bobEdge)).toBe(true);
        expect(await follows.countBy({ followedId: charlie.id })).toBe(1);
        const after = await request(server)
            .get(`/api/profiles/${charlie.username}`).expect(200);
        expect(after.body.profile.followersCount).toBe(1);
        const aliceProfile = await request(server)
            .get(`/api/profiles/${alice.username}`).expect(200);
        const bobProfile = await request(server)
            .get(`/api/profiles/${bob.username}`).expect(200);
        expect(aliceProfile.body.profile.followingCount).toBe(0);
        expect(bobProfile.body.profile.followingCount).toBe(1);
    }, 30000);
});

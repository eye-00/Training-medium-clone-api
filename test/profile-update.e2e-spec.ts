import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { User } from '../src/users/entities/user.entity.js';

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
  registerUserFixture,
  type CreatedUser,
} from './helpers/user-fixture.helper.js';

describe('Update Profile E2E', () => {
  let testApp: TestAppContext | undefined;

  const createdUsers: CreatedUser[] = [];

  const suffix = randomUUID().replaceAll('-', '');

  const email = `e2e-profile-${suffix}@example.com`;
  const username = `profile_${suffix.slice(0, 16)}`;
  const otherUsername = `other_${suffix.slice(0, 16)}`;
  const updatedUsername = `edited_${suffix.slice(0, 16)}`;
  const password = 'ExamplePass123!';

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    if (!testApp) return;

    await closeTestApp(
      testApp,
      async ({ db }) => {
        await cleanupUserFixtures(
          db,
          createdUsers,
        );
      },
    );
  });

  it('updates profile with validation and authorization', async () => {
    if (!testApp) {
      throw new Error('Test app not initialized');
    }

    const { server } = testApp;

    // Register the first user
    const register = await request(server)
      .post('/api/users')
      .send({ email, username, password })
      .expect(201);

    const userId = register.body.user.id as string;
    createdUsers.push({ id: userId, email });

    // Register another user to test duplicate username
    const otherEmail =
      `e2e-other-${suffix}@example.com`;

    const otherRegister = await request(server)
      .post('/api/users')
      .send({
        email: otherEmail,
        username: otherUsername,
        password,
      })
      .expect(201);

    createdUsers.push({
      id: otherRegister.body.user.id as string,
      email: otherEmail,
    });

    // Login
    const login = await request(server)
      .post('/api/users/login')
      .send({ email, password })
      .expect(200);

    const token = login.body.accessToken as string;
    const authorization = `Bearer ${token}`;

    // Missing JWT
    await request(server)
      .put('/api/user')
      .send({ bio: 'Unauthorized update' })
      .expect(401);

    // Empty request
    await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({})
      .expect(400);

    // Invalid username
    await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ username: null })
      .expect(400);

    // Forbidden field
    await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ email: 'changed@example.com' })
      .expect(400);

    // Bio exceeds 500 characters
    await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ bio: 'x'.repeat(501) })
      .expect(400);

    // Duplicate username
    await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ username: otherUsername })
      .expect(409);

    // Update bio only
    const bioUpdate = await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ bio: 'Learning NestJS' })
      .expect(200);

    expect(bioUpdate.body.user.username).toBe(
      username,
    );

    expect(bioUpdate.body.user.bio).toBe(
      'Learning NestJS',
    );

    // Update username only
    const usernameUpdate = await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ username: updatedUsername })
      .expect(200);

    expect(usernameUpdate.body.user.username).toBe(
      updatedUsername,
    );

    expect(usernameUpdate.body.user.bio).toBe(
      'Learning NestJS',
    );

    // Clear bio
    const cleared = await request(server)
      .put('/api/user')
      .set('Authorization', authorization)
      .send({ bio: null })
      .expect(200);

    expect(cleared.body.user.bio).toBeNull();

    // Verify persisted data
    const current = await request(server)
      .get('/api/user')
      .set('Authorization', authorization)
      .expect(200);

    expect(current.body.user.id).toBe(userId);
    expect(current.body.user.email).toBe(email);
    expect(current.body.user.username).toBe(
      updatedUsername,
    );
    expect(current.body.user.bio).toBeNull();
    expect(current.body.user).not.toHaveProperty(
      'passwordHash',
    );

    // Original credentials must still work
    await request(server)
      .post('/api/users/login')
      .send({ email, password })
      .expect(200);
  });

  it('updates only the authenticated user and leaves another user unchanged', async () => {
    if (!testApp) {
      throw new Error('Test app not initialized');
    }

    const userA = await registerUserFixture(testApp, createdUsers, { prefix: 'profile_a' });
    const userB = await registerUserFixture(testApp, createdUsers, { prefix: 'profile_b' });
    const users = testApp.db.getRepository(User);
    const loadUser = (id: string) => users.findOneByOrFail({ id });
    const beforeB = await loadUser(userB.id);

    const response = await request(testApp.server)
      .put('/api/user')
      .set('Authorization', userA.authorization)
      .send({ bio: 'Updated only for user A' })
      .expect(200);

    expect(response.body.user.id).toBe(userA.id);
    expect(response.body.user.bio).toBe('Updated only for user A');
    expect((await loadUser(userA.id)).bio).toBe('Updated only for user A');
    expect(await loadUser(userB.id)).toEqual(beforeB);
  });

  it.each(['id', 'email', 'passwordHash', 'image'] as const)(
    'rejects a forbidden %s alongside a valid bio without changing either user',
    async (field) => {
      if (!testApp) {
        throw new Error('Test app not initialized');
      }

      const userA = await registerUserFixture(testApp, createdUsers, { prefix: 'protect_a' });
      const userB = await registerUserFixture(testApp, createdUsers, { prefix: 'protect_b' });
      const users = testApp.db.getRepository(User);
      const loadUser = (id: string) => users.createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.id = :id', { id })
        .getOneOrFail();
      const beforeA = JSON.stringify(await loadUser(userA.id));
      const beforeB = JSON.stringify(await loadUser(userB.id));
      const forbiddenValues = {
        id: userB.id,
        email: `forbidden-${randomUUID()}@example.com`,
        passwordHash: 'forged-password-hash',
        image: '/api/avatars/forged',
      };

      await request(testApp.server)
        .put('/api/user')
        .set('Authorization', userA.authorization)
        .send({ bio: 'A valid update that must not be applied', [field]: forbiddenValues[field] })
        .expect(400);

      // Compare as booleans so assertion failures never print password hashes.
      expect(JSON.stringify(await loadUser(userA.id)) === beforeA).toBe(true);
      expect(JSON.stringify(await loadUser(userB.id)) === beforeB).toBe(true);
    },
  );
});

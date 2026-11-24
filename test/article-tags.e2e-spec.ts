import {
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { User } from '../src/users/entities/user.entity.js';
import { Article } from '../src/articles/entities/article.entity.js';
import { Tag } from '../src/articles/entities/tag.entity.js';
import { ArticleTag } from '../src/articles/entities/article-tag.entity.js';

describe('Article Tags E2E', () => {
  let app: INestApplication | undefined;
  let databaseVerified = false;

  const password = 'ExamplePass123!';
  const createdUsers: Array<{ id: string; email: string }> = [];
  const createdTagNames = new Set<string>();

  function uniquePart(): string {
    return randomUUID().replaceAll('-', '').slice(0, 16);
  }

  function makeTag(label: string): string {
    const name = `e2e_${label}_${uniquePart()}`;
    createdTagNames.add(name);
    return name;
  }

  function makeAccentPair(): [string, string] {
    const suffix = uniquePart();
    const plain = `e2e_cafe_${suffix}`;
    const accented = `e2e_café_${suffix}`;
    createdTagNames.add(plain);
    createdTagNames.add(accented);
    return [plain, accented];
  }

  function context() {
    if (!app || !databaseVerified) {
      throw new Error('Test app is not ready');
    }
    return { server: app.getHttpServer(), db: app.get(DataSource) };
  }

  async function registerUser() {
    const { server } = context();
    const username = `tags_${uniquePart()}`;
    const email = `${username}@example.com`;

    const registration = await request(server)
      .post('/api/users')
      .send({ email, username, password })
      .expect(201);

    const id = registration.body.user.id as string;
    createdUsers.push({ id, email });

    const login = await request(server)
      .post('/api/users/login')
      .send({ email, password })
      .expect(200);

    return {
      id,
      authorization: `Bearer ${login.body.accessToken as string}`,
    };
  }

  async function createArticle(
    authorization: string,
    tagList: string[],
  ) {
    const { server, db } = context();
    const title = `Article Tags ${uniquePart()}`;

    const response = await request(server)
      .post('/api/articles')
      .set('Authorization', authorization)
      .send({
        article: {
          title,
          description: `Description for ${title}`,
          body: `Body for ${title}`,
          tagList,
        },
      })
      .expect(201);

    const slug = response.body.article.slug as string;
    const saved = await db.getRepository(Article).findOneByOrFail({ slug });
    return { response, saved };
  }

  async function getActiveOwnTags(names: string[]): Promise<string[]> {
    const { server } = context();
    const result = await request(server).get('/api/tags').expect(200);
    expect(Array.isArray(result.body.tags)).toBe(true);
    return (result.body.tags as string[]).filter((name) =>
      names.includes(name),
    );
  }

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
    await app.listen(0, '127.0.0.1');

    const rows = (await app.get(DataSource).query(`
      SELECT DATABASE() AS db,
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
      throw new Error('E2E database identity verification failed');
    }
    databaseVerified = true;
  }, 25000);

  afterAll(async () => {
    if (!app) return;
    try {
      if (databaseVerified) {
        const db = app.get(DataSource);
        // Each test owns a separate user and uniquely named tags.
        // Cascading deletion removes only those users' articles/links.
        for (const user of createdUsers) {
          await db.getRepository(User).delete({
            id: user.id,
            email: user.email,
          });
        }
        if (createdTagNames.size > 0) {
          await db.getRepository(Tag).delete({
            name: In([...createdTagNames]),
          });
        }
      }
    } finally {
      await app.close();
    }
  }, 30000);

  it('exposes only active, unique tags on the public endpoint', async () => {
    const { db } = context();
    const user = await registerUser();
    const activeTag = makeTag('active');
    const orphanTag = makeTag('orphan');

    expect(await getActiveOwnTags([activeTag, orphanTag])).toEqual([]);

    const { saved } = await createArticle(user.authorization, [
      activeTag,
      ` ${activeTag.toUpperCase()} `,
    ]);

    await db.getRepository(Tag).insert({
      id: randomUUID(),
      name: orphanTag,
    });

    expect(await getActiveOwnTags([activeTag, orphanTag])).toEqual([
      activeTag,
    ]);

    expect(await db.getRepository(Tag).countBy({ name: activeTag }))
      .toBe(1);
    expect(await db.getRepository(ArticleTag).countBy({
      articleId: saved.id,
    })).toBe(1);
  });

  it('reuses the same canonical tag across two articles', async () => {
    const { db } = context();
    const firstUser = await registerUser();
    const secondUser = await registerUser();
    const sharedTag = makeTag('shared');

    await createArticle(firstUser.authorization, [sharedTag]);
    await createArticle(secondUser.authorization, [sharedTag]);

    const tagRow = await db.getRepository(Tag).findOneByOrFail({
      name: sharedTag,
    });
    expect(await db.getRepository(ArticleTag).countBy({
      tagId: tagRow.id,
    })).toBe(2);
    expect(await db.getRepository(Tag).countBy({ name: sharedTag }))
      .toBe(1);
  });

  it('replaces article tags while retaining unused tag records', async () => {
    const { db, server } = context();
    const user = await registerUser();
    const oldTag = makeTag('old');
    const keepTag = makeTag('keep');
    const newTag = makeTag('new');
    const { saved } = await createArticle(user.authorization, [
      oldTag,
      keepTag,
    ]);

    const updated = await request(server)
      .put(`/api/articles/${saved.slug}`)
      .set('Authorization', user.authorization)
      .send({ article: { tagList: [keepTag, newTag] } })
      .expect(200);

    expect(updated.body.article.tagList).toEqual(
      [keepTag, newTag].sort(),
    );
    const oldRow = await db.getRepository(Tag).findOneByOrFail({
      name: oldTag,
    });
    expect(await db.getRepository(ArticleTag).countBy({
      tagId: oldRow.id,
    })).toBe(0);
    expect(await getActiveOwnTags([oldTag, keepTag, newTag])).toEqual(
      [keepTag, newTag].sort(),
    );
  });

  it('clears tag links without removing the article or tag records', async () => {
    const { db, server } = context();
    const user = await registerUser();
    const tagA = makeTag('clear_a');
    const tagB = makeTag('clear_b');
    const { saved } = await createArticle(user.authorization, [tagA, tagB]);

    const result = await request(server)
      .put(`/api/articles/${saved.slug}`)
      .set('Authorization', user.authorization)
      .send({ article: { tagList: [] } })
      .expect(200);

    expect(result.body.article.tagList).toEqual([]);
    expect(await db.getRepository(ArticleTag).countBy({
      articleId: saved.id,
    })).toBe(0);
    expect(await db.getRepository(Article).existsBy({ id: saved.id }))
      .toBe(true);
    expect(await db.getRepository(Tag).countBy({
      name: In([tagA, tagB]),
    })).toBe(2);
    expect(await getActiveOwnTags([tagA, tagB])).toEqual([]);
  });

  it('keeps a shared tag active until its last article is deleted', async () => {
    const { db, server } = context();
    const firstUser = await registerUser();
    const secondUser = await registerUser();
    const sharedTag = makeTag('deletion');
    const first = await createArticle(firstUser.authorization, [sharedTag]);
    const second = await createArticle(secondUser.authorization, [sharedTag]);

    await request(server)
      .delete(`/api/articles/${first.saved.slug}`)
      .set('Authorization', firstUser.authorization)
      .expect(204);
    expect(await getActiveOwnTags([sharedTag])).toEqual([sharedTag]);

    await request(server)
      .delete(`/api/articles/${second.saved.slug}`)
      .set('Authorization', secondUser.authorization)
      .expect(204);
    expect(await getActiveOwnTags([sharedTag])).toEqual([]);
    expect(await db.getRepository(Tag).existsBy({ name: sharedTag }))
      .toBe(true);
  });

  it('returns persisted canonical tags on POST with accent-equivalent names', async () => {
    const { db, server } = context();
    const user = await registerUser();
    const [plainTag, accentedTag] = makeAccentPair();
    const { response, saved } = await createArticle(user.authorization, [
      plainTag,
      accentedTag,
    ]);

    const detail = await request(server)
      .get(`/api/articles/${saved.slug}`)
      .expect(200);

    expect(response.body.article.tagList).toEqual(detail.body.article.tagList);
    expect(response.body.article.tagList).toHaveLength(1);
    expect(await db.getRepository(Tag).countBy({
      name: In([plainTag, accentedTag]),
    })).toBe(1);
    expect(await db.getRepository(ArticleTag).countBy({
      articleId: saved.id,
    })).toBe(1);
  });

  it('deduplicates accent-equivalent tags when updating an article', async () => {
    const { db, server } = context();
    const user = await registerUser();
    const initialTag = makeTag('initial');
    const [plainTag, accentedTag] = makeAccentPair();
    const { saved } = await createArticle(user.authorization, [initialTag]);

    const updated = await request(server)
      .put(`/api/articles/${saved.slug}`)
      .set('Authorization', user.authorization)
      .send({ article: { tagList: [accentedTag, plainTag] } })
      .expect(200);

    const detail = await request(server)
      .get(`/api/articles/${saved.slug}`)
      .expect(200);

    expect(updated.body.article.tagList).toEqual(detail.body.article.tagList);
    expect(updated.body.article.tagList).toHaveLength(1);
    expect(await db.getRepository(ArticleTag).countBy({
      articleId: saved.id,
    })).toBe(1);
    expect(await db.getRepository(Tag).countBy({
      name: In([plainTag, accentedTag]),
    })).toBe(1);
    const active = await getActiveOwnTags([plainTag, accentedTag]);
    expect(active).toHaveLength(1);
  });

  it.each([
    { label: 'null', value: null },
    { label: 'string', value: 'nestjs' },
    { label: 'numeric element', value: [123] },
    { label: 'null element', value: [null] },
    { label: 'blank element', value: ['   '] },
    { label: 'mixed valid and blank elements', value: ['nestjs', '   '] },
  ])('rejects invalid tagList ($label) on create and update', async ({ value }) => {
    const { server } = context();
    const user = await registerUser();
    const validTag = makeTag('valid');
    const { saved } = await createArticle(user.authorization, [validTag]);
    const url = `/api/articles/${saved.slug}`;

    const before = await request(server).get(url).expect(200);

    await request(server)
      .post('/api/articles')
      .set('Authorization', user.authorization)
      .send({
        article: {
          title: `Invalid Tags ${uniquePart()}`,
          description: 'Validation test',
          body: 'Validation test body',
          tagList: value,
        },
      })
      .expect(400);

    await request(server)
      .put(url)
      .set('Authorization', user.authorization)
      .send({ article: { tagList: value } })
      .expect(400);

    const after = await request(server).get(url).expect(200);
    expect(after.body.article).toEqual(before.body.article);
  });

  it('rejects undeclared update fields without modifying the article', async () => {
    const { server } = context();
    const user = await registerUser();
    const tag = makeTag('unknown_field');
    const { saved } = await createArticle(user.authorization, [tag]);
    const url = `/api/articles/${saved.slug}`;
    const before = await request(server).get(url).expect(200);

    await request(server)
      .put(url)
      .set('Authorization', user.authorization)
      .send({ article: { tagList: [tag], unexpectedField: true } })
      .expect(400);

    const after = await request(server).get(url).expect(200);
    expect(after.body.article).toEqual(before.body.article);
  });
});

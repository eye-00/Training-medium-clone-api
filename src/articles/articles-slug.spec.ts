import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';

import { ArticlesService } from './articles.service.js';
import { Article } from './entities/article.entity.js';
import type { ArticleResponseDto } from './dto/article-response.dto.js';

const owner = {
    id: '308fac1d-401f-4a06-b2bd-32dd50234048',
    username: 'test_user',
    email: 'test@example.com',
    bio: null,
    image: null,
};
const articleId = 'b5740140-c476-44c0-b860-ec523c5308dd';

function makeService() {
    const insert = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const deleteLinks = vi.fn().mockResolvedValue(undefined);
    const query = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({
            id: articleId, slug: 'old-slug', authorId: owner.id,
        }),
    };
    const articleRepo = { insert, update, createQueryBuilder: () => query };
    const manager = {
        getRepository: (entity: { name: string }) => {
            if (entity === Article) return articleRepo;
            if (entity.name === 'ArticleTag') return { delete: deleteLinks };
            return {};
        },
    };
    const dataSource = {
        transaction: async (_isolation: string, callback: (value: typeof manager) => unknown) =>
            callback(manager),
    } as unknown as DataSource;
    const service = new ArticlesService(dataSource);
    vi.spyOn(service, 'findOne').mockImplementation(async (slug) =>
        ({ article: { slug } }) as unknown as ArticleResponseDto,
    );
    return { service, insert, update };
}

const cases = [
    { label: 'ASCII at the budget', title: 'a'.repeat(180), base: 'a'.repeat(180) },
    { label: 'ASCII beyond the budget', title: 'a'.repeat(181), base: 'a'.repeat(180) },
    { label: 'supplementary letter ending at the budget', title: 'a'.repeat(178) + '𠀀', base: 'a'.repeat(178) + '𠀀' },
    { label: 'supplementary letter crossing the budget', title: 'a'.repeat(179) + '𠀀', base: 'a'.repeat(179) },
    { label: 'trailing separator after truncation', title: 'a'.repeat(179) + '-z', base: 'a'.repeat(179) },
    { label: 'normalization and separators', title: 'Crème brûlée!', base: 'creme-brulee' },
    { label: 'fallback when no letters or digits remain', title: '!!!', base: 'article' },
];

describe('Article slug Unicode boundary', () => {
    it.each(cases)('creates a well-formed slug: $label', async ({ title, base }) => {
        const { service, insert } = makeService();
        const result = await service.create(owner, {
            article: { title, description: 'description', body: 'body' },
        });
        const inserted = insert.mock.calls[0]?.[0] as { id: string; slug: string };
        expect(inserted.slug).toBe(`${base}-${inserted.id}`);
        expect(() => encodeURIComponent(inserted.slug)).not.toThrow();
        expect(result.article.slug).toBe(inserted.slug);
    });

    it.each(cases)('updates to a well-formed slug: $label', async ({ title, base }) => {
        const { service, update } = makeService();
        const result = await service.update('old-slug', owner.id, { article: { title } });
        const values = update.mock.calls[0]?.[1] as { slug: string };
        expect(values.slug).toBe(`${base}-${articleId}`);
        expect(() => encodeURIComponent(values.slug)).not.toThrow();
        expect(result.article.slug).toBe(values.slug);
    });
});

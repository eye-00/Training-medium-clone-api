import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ArticlesService } from './articles.service.js';
import { Article } from './entities/article.entity.js';
import { ArticleTag } from './entities/article-tag.entity.js';
import { Tag } from './entities/tag.entity.js';
import type { ArticleResponseDto } from './dto/article-response.dto.js';

const owner = {
    id: '308fac1d-401f-4a06-b2bd-32dd50234048',
    username: 'test_user', email: 'test@example.com', bio: null, image: null,
};
const articleId = 'b5740140-c476-44c0-b860-ec523c5308dd';
const title255 = '✈️'.repeat(127) + 'a';
const title256 = '✈️'.repeat(128);
const tag100 = 'İ'.repeat(50);
const tag102 = 'İ'.repeat(51);
const tag200 = 'İ'.repeat(100);

function fixture(article: unknown = { id: articleId, slug: 'old-slug', authorId: owner.id }) {
    const insertArticle = vi.fn().mockResolvedValue(undefined);
    const updateArticle = vi.fn().mockResolvedValue(undefined);
    const deleteLinks = vi.fn().mockResolvedValue(undefined);
    const insertLinks = vi.fn().mockResolvedValue(undefined);
    const insertTags = vi.fn().mockResolvedValue(undefined);
    const query = {
        setLock: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(article),
    };
    const manager = {
        query: insertTags,
        getRepository: (entity: { name: string }) => {
            if (entity === Article) return { insert: insertArticle, update: updateArticle, createQueryBuilder: () => query };
            if (entity === ArticleTag) return { delete: deleteLinks, insert: insertLinks };
            if (entity === Tag) return { findBy: vi.fn().mockResolvedValue([{ id: 'tag-id' }]) };
            throw new Error('Unexpected repository');
        },
    };
    const transaction = vi.fn(async (_isolation: string, callback: (value: typeof manager) => unknown) => callback(manager));
    const service = new ArticlesService({ transaction } as unknown as DataSource);
    vi.spyOn(service, 'findOne').mockResolvedValue({ article: {} } as ArticleResponseDto);
    const expectNoWrites = () => {
        expect(insertArticle).not.toHaveBeenCalled();
        expect(updateArticle).not.toHaveBeenCalled();
        expect(insertTags).not.toHaveBeenCalled();
        expect(deleteLinks).not.toHaveBeenCalled();
        expect(insertLinks).not.toHaveBeenCalled();
    };
    return { service, transaction, query, insertArticle, updateArticle, insertTags, deleteLinks, expectNoWrites };
}

const payload = (title: string, tagList?: string[]) => ({
    article: { title, description: 'description', body: 'body', ...(tagList === undefined ? {} : { tagList }) },
});

describe('Article storage length validation', () => {
    it('accepts a 255-code-point title on create and update', async () => {
        expect(Array.from(title255)).toHaveLength(255);
        const f = fixture();
        await expect(f.service.create(owner, payload(title255))).resolves.toBeDefined();
        await expect(f.service.update('old-slug', owner.id, { article: { title: title255 } })).resolves.toBeDefined();
        expect(f.insertArticle).toHaveBeenCalledOnce();
        expect(f.updateArticle).toHaveBeenCalledOnce();
    });

    it('rejects a 256-code-point title before create writes', async () => {
        expect(Array.from(title256)).toHaveLength(256);
        const f = fixture();
        await expect(f.service.create(owner, payload(title256))).rejects.toBeInstanceOf(BadRequestException);
        f.expectNoWrites();
    });

    it('rejects a 256-code-point title after ownership lookup but before update writes', async () => {
        const f = fixture();
        await expect(f.service.update('old-slug', owner.id, { article: { title: title256 } }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(f.query.setLock).toHaveBeenCalledWith('pessimistic_write');
        expect(f.query.getOne).toHaveBeenCalledOnce();
        f.expectNoWrites();
    });

    it('accepts a tag that expands to 100 code points and stores the normalized value', async () => {
        const f = fixture();
        expect(Array.from(tag100.toLowerCase())).toHaveLength(100);
        await f.service.create(owner, payload('title', [tag100]));
        expect(f.insertTags).toHaveBeenCalledOnce();
        expect(f.insertTags.mock.calls[0]?.[1]).toContain(tag100.toLowerCase());
    });

    it('validates update tags after normalization and preserves deduplication', async () => {
        const f = fixture();
        await f.service.update('old-slug', owner.id, {
            article: { tagList: [tag100, ` ${tag100} `] },
        });
        const parameters = f.insertTags.mock.calls[0]?.[1] as unknown[];
        expect(parameters).toHaveLength(2);
        expect(parameters[1]).toBe(tag100.toLowerCase());
        expect(f.deleteLinks).toHaveBeenCalledOnce();
    });

    it.each([tag102, tag200, '✈️'.repeat(51)])(
        'rejects an overlong normalized tag before any create write', async (invalid) => {
            const f = fixture();
            expect(Array.from(invalid.trim().toLowerCase()).length).toBeGreaterThan(100);
            await expect(f.service.create(owner, payload('title', ['valid', invalid])))
                .rejects.toBeInstanceOf(BadRequestException);
            f.expectNoWrites();
        },
    );

    it.each([tag102, tag200, '✈️'.repeat(51)])(
        'rejects mixed valid/overlong tags before any update write', async (invalid) => {
            const f = fixture();
            await expect(f.service.update('old-slug', owner.id, {
                article: { title: 'valid replacement', tagList: ['valid', invalid] },
            })).rejects.toBeInstanceOf(BadRequestException);
            expect(f.query.getOne).toHaveBeenCalledOnce();
            f.expectNoWrites();
        },
    );

    it('preserves 404 and 403 precedence over storage validation', async () => {
        const missing = fixture(null);
        await expect(missing.service.update('missing', owner.id, { article: { title: title256 } }))
            .rejects.toBeInstanceOf(NotFoundException);
        missing.expectNoWrites();
        const other = fixture({ id: articleId, slug: 'old-slug', authorId: 'other' });
        await expect(other.service.update('old-slug', owner.id, { article: { tagList: [tag102] } }))
            .rejects.toBeInstanceOf(ForbiddenException);
        other.expectNoWrites();
    });

    it('retains omitted and empty tag update behavior', async () => {
        const omitted = fixture();
        await omitted.service.update('old-slug', owner.id, { article: { title: 'new' } });
        expect(omitted.deleteLinks).not.toHaveBeenCalled();
        const empty = fixture();
        await empty.service.update('old-slug', owner.id, { article: { tagList: [] } });
        expect(empty.deleteLinks).toHaveBeenCalledOnce();
        expect(empty.insertTags).not.toHaveBeenCalled();
    });
});

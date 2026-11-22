
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { UsersModule } from '../users/users.module.js';

import { Article } from './entities/article.entity.js';
import { Tag } from './entities/tag.entity.js';
import { ArticleTag } from './entities/article-tag.entity.js';
import { ArticleFavorite } from './entities/article-favorite.entity.js';

import { ArticlesController } from './articles.controller.js';
import { ArticlesService } from './articles.service.js';
import { TagsController } from './tags.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Article,
      Tag,
      ArticleTag,
      ArticleFavorite,
    ]),
    AuthModule,
    RedisModule,
    UsersModule,
  ],
  controllers: [ArticlesController, TagsController],
  providers: [ArticlesService],
})
export class ArticlesModule { }

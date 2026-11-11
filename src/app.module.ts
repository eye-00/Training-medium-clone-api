import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
// import { ArticlesModule } from './articles/articles.module.js';
import {
  AcceptLanguageLocaleResolver,
  I18nModule,
  JsonI18nLoader,
  QueryLocaleResolver,
} from '@nestjs/i18n';
import { join } from 'node:path';

import { TypeOrmModule } from '@nestjs/typeorm';
import { envSchema, type DatabaseEnv } from './config/env.schema.js';
import { createDatabaseOptions } from './database/database.options.js';
import { RedisModule } from './redis/redis.module.js';
import { ConfigModule, ConfigService } from '@nestjs/config'
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
    }),

    I18nModule.forRoot({
      defaultLocale: 'en',
      supportedLocales: ['en', 'vi'],
      loader: new JsonI18nLoader({
        path: join(import.meta.dirname, 'i18n'),
      }),
      resolvers: [
        new QueryLocaleResolver('lang'),
        new AcceptLanguageLocaleResolver(),
      ],
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseConfig: DatabaseEnv = {
          DB_HOST: config.getOrThrow<string>('DB_HOST'),
          DB_PORT: config.getOrThrow<number>('DB_PORT'),
          DB_USERNAME: config.getOrThrow<string>('DB_USERNAME'),
          DB_PASSWORD: config.getOrThrow<string>('DB_PASSWORD'),
          DB_DATABASE: config.getOrThrow<string>('DB_DATABASE'),
        };
        return createDatabaseOptions(databaseConfig);
      },
    }),

    RedisModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

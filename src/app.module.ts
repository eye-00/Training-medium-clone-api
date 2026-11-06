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
@Module({
  imports: [
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

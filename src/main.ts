import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  DocumentBuilder,
  SwaggerModule,
}from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Medium Clone API')
    .setDescription('Backend API document for the Medium Clone tutorial project',)
    .setVersion('1.0.0')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, documentFactory());

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();

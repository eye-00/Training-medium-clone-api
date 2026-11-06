import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHello: () => 'Hello World!',
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('should return a greeting response', () => {
    expect(appController.getHello()).toEqual({
      message: 'Hello World!',
    });
  });
});

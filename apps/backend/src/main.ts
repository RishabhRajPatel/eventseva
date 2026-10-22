import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, configureApp } from './app.module';
import { loadConfig } from './config';

async function bootstrap() {
  const config = loadConfig();
  // rawBody: the payment webhook signature is checked against the exact bytes Razorpay sent.
  const app = configureApp(await NestFactory.create(AppModule, { rawBody: true }));
  await app.listen(config.port);
  console.log(`EventSeva API on http://localhost:${config.port}`);
}

bootstrap();

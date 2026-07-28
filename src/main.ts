import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

process.on('uncaughtException', (err) => {
  console.error('[Process Safety] Uncaught Exception:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process Safety] Unhandled Rejection:', reason);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`App running on http://localhost:${port}`);
}
bootstrap();

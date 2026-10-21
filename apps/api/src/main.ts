import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { readApiConfig } from "@platform/config";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = readApiConfig(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter()
  );
  await app.listen(config.port, "0.0.0.0");
}

await bootstrap();

import { createClient } from "redis";
import { loadConfig } from "./config";
import { createLogger } from "./lib/logger";
import { createCognitoVerifiers } from "./middleware/auth";
import { createApp } from "./app";
import { OnboardingSessionStore } from "./lib/onboarding-session-store";
import { InMemoryStore } from "./lib/in-memory-store";
import type { RedisLike } from "./lib/onboarding-session-store";
import { S3Client } from "@aws-sdk/client-s3";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  let kv: RedisLike;

  if (config.redisUrl) {
    const redis = createClient({ url: config.redisUrl });
    redis.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, "Redis client error");
    });

    await redis.connect();
    logger.info({ redisUrl: config.redisUrl }, "Redis connected");
    kv = redis as unknown as RedisLike;
  } else if (config.nodeEnv === "production") {
    throw new Error("REDIS_URL is required in production");
  } else {
    logger.warn("REDIS_URL not set — using in-memory store (dev only, not durable across restarts)");
    kv = new InMemoryStore();
  }

  const sessionStore = new OnboardingSessionStore(kv, {
    ttlSeconds: config.onboardingSessionTtlSeconds,
    frontendOrigin: config.onboardingFrontendOrigin,
  });

  const s3 = new S3Client({ region: config.awsRegion });

  const { accessTokenVerifier, idTokenVerifier } = createCognitoVerifiers(
    config.cognitoUserPoolId,
    config.cognitoClientId,
  );

  const app = createApp({
    auth: { accessTokenVerifier, idTokenVerifier, logger },
    logger,
    config,
    kv: kv as any,
    sessionStore,
    s3,
  });

  app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv },
      "Onboarding API started",
    );
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start onboarding-api:", err);
  process.exit(1);
});

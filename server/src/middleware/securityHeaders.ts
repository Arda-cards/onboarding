import helmet from 'helmet';

function uniqueOrigins(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export function buildContentSecurityPolicyDirectives() {
  const trustedOrigins = uniqueOrigins([
    process.env.FRONTEND_URL,
    process.env.BACKEND_URL,
  ]);

  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    connectSrc: ["'self'", ...trustedOrigins],
    fontSrc: ["'self'", 'data:'],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    imgSrc: ["'self'", 'data:', ...trustedOrigins],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
  };
}

export function createSecurityHeadersMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      directives: buildContentSecurityPolicyDirectives(),
    },
    crossOriginEmbedderPolicy: false,
  });
}

export const securityHeaders = createSecurityHeadersMiddleware();

import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { API_PREFIX, SECURITY } from '#config/security.js';
import type { AppModule } from '#shared/composition/app-module.js';
import type { AppContainer } from '#shared/composition/container.js';
import { createErrorHandler, notFoundHandler } from '#shared/http/error-handler.js';
import { createRateLimiter } from '#shared/http/middlewares/rate-limit.js';
import { createRequestLogger } from '#shared/http/middlewares/request-logger.js';
import { noStore, requireJsonBody } from '#shared/http/middlewares/security-headers.js';
import { buildOpenApiDocument } from '#shared/http/openapi.js';
import { buildApiRouter } from '#shared/http/router.js';

export function createApp(container: AppContainer, modules: readonly AppModule[]): Express {
  const { env, logger, rateLimits } = container.cradle;
  const routes = modules.flatMap((module) => module.routes?.(container) ?? []);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxyHops > 0 ? env.trustProxyHops : false);

  app.use(createRequestLogger(logger, [`${API_PREFIX}/health`]));
  app.use(
    helmet({
      contentSecurityPolicy: {
        // HTTPS forzado solo en produccion; en localhost romperia /docs
        directives: { upgradeInsecureRequests: env.isProduction ? [] : null },
      },
    }),
  );
  app.use(
    cors({
      origin: env.corsOrigins.includes('*') ? '*' : [...env.corsOrigins],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
    }),
  );
  app.use(createRateLimiter(rateLimits.global));

  if (!env.isProduction) {
    const document = buildOpenApiDocument(routes);
    app.get('/docs/openapi.json', (_req, res) => {
      res.json(document);
    });
    app.use(
      '/docs',
      swaggerUi.serve,
      swaggerUi.setup(document, {
        customSiteTitle: 'WorkTime API',
        swaggerOptions: {
          persistAuthorization: true,
          displayRequestDuration: true,
          tryItOutEnabled: true,
          docExpansion: 'list',
          filter: true,
        },
      }),
    );
  }

  app.use(
    API_PREFIX,
    noStore,
    requireJsonBody,
    express.json({ limit: SECURITY.http.bodyLimit }),
    buildApiRouter(routes, {
      getAuthenticator: () => container.resolve('authenticator'),
      createRateLimiter: (preset) => createRateLimiter(rateLimits.presets[preset]),
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}

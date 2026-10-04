import { EnvValidationError, loadEnv } from '#config/env.js';
import { SECURITY } from '#config/security.js';
import { modules } from '#modules/index.js';
import { bootstrap } from './bootstrap.js';

function start(): void {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(`\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const { app, container } = bootstrap(env, modules);
  const { logger } = container.cradle;

  const server = app.listen(env.port, (error) => {
    if (error) {
      logger.fatal({ err: error }, 'No se pudo iniciar el servidor');
      process.exit(1);
    }
    logger.info(
      {
        port: env.port,
        env: env.nodeEnv,
        docs: env.isProduction ? undefined : `http://localhost:${env.port}/docs`,
      },
      'WorkTime API lista',
    );
  });

  const timers: NodeJS.Timeout[] = [];
  for (const module of modules) {
    for (const job of module.jobs?.(container) ?? []) {
      let running = false;
      const timer = setInterval(() => {
        if (running) return;
        running = true;
        Promise.resolve()
          .then(() => job.run())
          .catch((err: unknown) => {
            logger.error({ err, job: job.name }, 'Falló una tarea periódica');
          })
          .finally(() => {
            running = false;
          });
      }, job.intervalMs);
      timer.unref();
      timers.push(timer);
    }
  }

  server.requestTimeout = SECURITY.http.requestTimeoutMs;
  server.headersTimeout = SECURITY.http.headersTimeoutMs;
  server.keepAliveTimeout = SECURITY.http.keepAliveTimeoutMs;

  let shuttingDown = false;
  // Salir con 1 hace que Docker lo reinicie
  const shutdown = (signal: string, exitCode = 0): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, exitCode }, 'Cerrando servidor…');

    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();

    timers.forEach(clearInterval);
    server.close(() => {
      container
        .dispose()
        .then(() => process.exit(exitCode))
        .catch((err: unknown) => {
          logger.error({ err }, 'Error al liberar recursos');
          process.exit(1);
        });
    });
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Excepción no capturada');
    shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Promesa rechazada sin manejar');
    shutdown('unhandledRejection', 1);
  });
}

start();

/**
 * Slark Server 入口（MVP-3 + MVP-4）
 *
 * 组件装配:
 *   REST routes    → routes/*.ts
 *   WebSocket      → ws/handler.ts（使用 hub.ts 做订阅）
 *   Message Router → messaging/router.ts
 *   Agent Engine   → agents/engine.ts + cursor-adapter.ts + runner.ts
 */

// Sprint 4-ext：必须在 import config / 任何依赖 process.env 的模块之前加载 .env / settings.json，
// 否则像 SLARK_CURSOR_BACKEND / CURSOR_API_KEY 这类后端切换变量在 import 时被读到的是 undefined。
//
// 优先级（后到不覆盖前到的）：
//   1. shell export 的 env (loadDotenv 不动)
//   2. .env (loadDotenv 注入)
//   3. ~/.slark/settings.json (mergeUserSettings 注入)  ← UI 改这个
//   4. defaults
import { loadDotenv, mergeUserSettings, configureCursorRipgrep } from './load-env.js';
const __envLoad = loadDotenv();
const __settingsLoad = mergeUserSettings();
const __rgConfig = configureCursorRipgrep();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { closeAllDbs, openProjectDb } from './db/index.js';
import { runStartupCheck } from './db/seed.js';
import { workflowRepo } from './db/repos.js';
import { importBuiltinsForProject } from './workflows/builtin-import.js';
import { deriveResponsibilitiesForWorkflow } from './workflows/derive-responsibilities.js';
import { startEvaluatorScheduler } from './system-agents/evaluator.js';
import { channelRoutes } from './routes/channels.js';
import { agentRoutes } from './routes/agents.js';
import { taskRoutes } from './routes/tasks.js';
import { runtimesRoutes } from './routes/runtimes.js';
import { settingsRoutes } from './routes/settings.js';
import { extraRoutes } from './routes/extras.js';
import { feedbackRoutes } from './routes/feedback.js';
import { intelligenceRoutes } from './routes/intelligence.js';
import { projectRoutes } from './routes/projects.js';
import { skillRoutes } from './routes/skills.js';
import { workflowRoutes } from './routes/workflows.js';
import { workflowSessionRoutes } from './routes/workflow-sessions.js';
import { registerWSRoute } from './ws/handler.js';
import { hub } from './ws/hub.js';
import { concurrencyQueue } from './agents/queue.js';
import { projectsService } from './config/projects-service.js';
import { warmUpAllProjects } from './routes/_helpers.js';

async function main() {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  if (__envLoad.loaded) {
    app.log.info(
      { source: __envLoad.source, keys: __envLoad.keysApplied },
      '[env] loaded .env file',
    );
  }
  if (__settingsLoad.loaded) {
    app.log.info(
      { source: __settingsLoad.source, keys: __settingsLoad.keysApplied },
      '[env] merged user settings.json',
    );
  }
  if (__rgConfig.configured) {
    if (!__rgConfig.alreadySet) {
      app.log.info(
        { CURSOR_RIPGREP_PATH: __rgConfig.path },
        '[env] auto-configured Cursor SDK ripgrep path',
      );
    }
  } else if (__rgConfig.reason && !__rgConfig.reason.startsWith('SLARK_CURSOR_BACKEND')) {
    app.log.warn({ reason: __rgConfig.reason }, '[env] Cursor SDK ripgrep not located');
  }

  await app.register(cors, {
    origin: [config.webOrigin, 'http://127.0.0.1:4178'],
    credentials: true,
  });

  await app.register(websocket);

  // D-21：启动期不再有"中央 db"。仅打印 recent projects 状态。
  await runStartupCheck({
    info: (m: string) => app.log.info(m),
    warn: (m: string) => app.log.warn(m),
  });

  // Warm-up：把 ~/.slark/projects.json 中所有 recent project 的 db 都打开
  // 让全局视图（/inbox /threads /tasks）+ 资源反查（findDbByResource）能正常工作
  const warm = warmUpAllProjects();
  app.log.info({ opened: warm.opened, errors: warm.errors }, '[startup] warmed up project dbs');

  // 给已存在的 project 补 builtin workflows + derive responsibilities
  for (const p of projectsService.list()) {
    try {
      const db = openProjectDb(p.workspace_path);
      const res = importBuiltinsForProject(db);
      if (res.imported > 0) {
        app.log.info(
          { project: p.name, ...res },
          '[workflows] builtin templates seeded',
        );
      }
      for (const wf of workflowRepo.list(db)) {
        try {
          deriveResponsibilitiesForWorkflow(db, wf.id);
        } catch (e) {
          app.log.warn(
            { err: e, workflow: wf.name, project: p.name },
            '[workflows] derive failed',
          );
        }
      }
    } catch (e) {
      app.log.warn({ project: p.name, err: e }, '[startup] project init failed');
    }
  }

  // REST
  app.get('/api/health', async () => ({
    ok: true,
    version: '0.1.0',
    slark_home: config.slarkHome,
    projects: projectsService.list().length,
    ws: hub.snapshot(),
    queue: concurrencyQueue.snapshot(),
  }));

  await runtimesRoutes(app);
  await settingsRoutes(app);
  await projectRoutes(app);
  await channelRoutes(app);
  await agentRoutes(app);
  await taskRoutes(app);
  await workflowRoutes(app);
  await intelligenceRoutes(app);
  await feedbackRoutes(app);
  await skillRoutes(app);
  await workflowSessionRoutes(app);
  await extraRoutes(app);

  // WebSocket
  registerWSRoute(app);

  // Sprint 5 CP2：Evaluator 调度（D-21 后改为遍历所有 open project 各跑一轮）
  startEvaluatorScheduler({
    info: (m: string) => app.log.info(m),
    warn: (m: string) => app.log.warn(m),
    error: (m: string) => app.log.error(m),
  });

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`✓ Slark server listening on http://${config.host}:${config.port}`);
    app.log.info(`  REST:      http://${config.host}:${config.port}/api/health`);
    app.log.info(`  WebSocket: ws://${config.host}:${config.port}/ws`);

    const onShutdown = () => {
      app.log.info('shutting down...');
      closeAllDbs();
      app.close().then(() => process.exit(0));
    };
    process.on('SIGINT', onShutdown);
    process.on('SIGTERM', onShutdown);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

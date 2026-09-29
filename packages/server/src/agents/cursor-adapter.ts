/**
 * Cursor CLI 适配器（从 spike 迁移，Phase 0 验证过）
 *
 * CLI: cursor-agent -p --output-format stream-json --stream-partial-output --trust
 * 输出映射见 docs/cli-event-format.md
 */

import type {
  AdapterCapabilities,
  BuildCommandParams,
  CLIAdapter,
  CLIEvent,
  SpawnSpec,
} from './types.js';
import { execCli, resolveCli } from '../cli-resolve.js';

export class CursorAdapter implements CLIAdapter {
  readonly name = 'cursor';

  readonly capabilities: AdapterCapabilities = {
    // text.delta 不流式：方案 A，Cursor 关闭 --stream-partial-output
    // 原因：stream-partial-output 模式下最后一条 assistant 是完整 replay（内容经 Composer
    // 重新整理，与前面累加的 chunks 不完全一致），前端会看到"流式输出后突然覆盖"的
    // 跳动。改为非流式：assistant 只发一条完整文本，thinking.delta 仍保留给用户视觉反馈。
    supportsTextDelta: false,
    supportsThinking: true,
    supportsWorkingDirectory: true,
    supportsEnvVars: true,
    supportsModelSelection: true,
    supportsReasoningEffort: false,
    supportsStdinContext: true,
  };

  async checkInstallation() {
    try {
      const resolved = await resolveCli('cursor-agent');
      if (!resolved) return { installed: false, error: 'cursor-agent not found on PATH' };
      const { stdout: version } = await execCli('cursor-agent', ['--version'], { timeout: 10_000 });
      return {
        installed: true,
        version: version.trim(),
        path: resolved.path,
      };
    } catch (e) {
      return { installed: false, error: (e as Error).message };
    }
  }

  buildCommand(params: BuildCommandParams): SpawnSpec {
    const args: string[] = [
      '-p',
      '--output-format',
      'stream-json',
      // 不开 --stream-partial-output，见 capabilities.supportsTextDelta 注释
      '--trust',
    ];

    if (params.workingDirectory) {
      args.push('--workspace', params.workingDirectory);
    }
    if (params.model) {
      args.push('--model', params.model);
    }
    if (params.permissive) {
      args.push('-f');
    }
    // Sprint 4-ext / Phase A：CLI 不支持 thinking / context / effort 单独传参
    // （cursor-agent CLI 仅有 --model）；这些字段仅在 SDK 模式生效。
    // 这里静默忽略；若用户期望生效，建议在 Settings 切到 SDK 后端。
    if (params.thinking !== undefined && params.thinking !== null) {
      // eslint-disable-next-line no-console
      console.warn(
        '[cursor-cli] thinking is set but cursor-agent CLI does not support it; switch to SDK backend (SLARK_CURSOR_BACKEND=sdk) to apply.',
      );
    }
    if (params.context) {
      // eslint-disable-next-line no-console
      console.warn(
        `[cursor-cli] context="${params.context}" is set but cursor-agent CLI does not support it; switch to SDK backend (SLARK_CURSOR_BACKEND=sdk) to apply.`,
      );
    }
    args.push(params.prompt);

    return {
      command: 'cursor-agent',
      args,
      env: params.envVars,
      stdin: params.stdinContext,
      cwd: params.workingDirectory,
    };
  }

  parseLine(line: string): CLIEvent[] {
    if (!line.trim()) return [];

    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return [];
    }
    if (!obj || typeof obj !== 'object') return [];
    const o = obj as Record<string, unknown>;

    switch (o.type) {
      case 'system':
        if (o.subtype === 'init') {
          return [
            {
              type: 'session.started',
              session_id: String(o.session_id ?? 'unknown'),
              meta: {
                cwd: o.cwd,
                model: o.model,
                permissionMode: o.permissionMode,
              },
            },
          ];
        }
        return [];

      case 'user':
        return [];

      case 'thinking':
        if (o.subtype === 'delta') return [{ type: 'thinking.delta', text: String(o.text ?? '') }];
        if (o.subtype === 'completed') return [{ type: 'thinking.completed' }];
        return [];

      case 'assistant': {
        // 非 stream-partial 模式下 assistant 只是中间状态（内容会在 result 事件里一致呈现）
        // 为避免 Runner 拼接模式下重复，这里不 emit。最终 text.completed 由 result 事件提供。
        return [];
      }

      case 'tool_call': {
        const tc = o.tool_call as Record<string, Record<string, unknown>> | undefined;
        if (!tc) return [];
        const toolKey = Object.keys(tc).find((k) => k.endsWith('ToolCall'));
        const toolData = toolKey ? tc[toolKey] : {};
        const toolName = toolKey ? toolKey.replace('ToolCall', '').toLowerCase() : 'unknown';

        if (o.subtype === 'started') {
          return [
            {
              type: 'tool.started',
              call_id: String(o.call_id ?? ''),
              tool: toolName,
              args: (toolData?.args as Record<string, unknown>) ?? {},
            },
          ];
        }
        if (o.subtype === 'completed') {
          const result = (toolData?.result ?? {}) as Record<string, unknown>;
          const success = result.success !== undefined && result.error === undefined;
          const successObj = (result.success ?? {}) as Record<string, unknown>;
          return [
            {
              type: 'tool.completed',
              call_id: String(o.call_id ?? ''),
              tool: toolName,
              success,
              result:
                (successObj.stdout as string | undefined) ??
                (successObj.output as string | undefined) ??
                JSON.stringify(result).slice(0, 500),
              exit_code:
                typeof successObj.exitCode === 'number' ? successObj.exitCode : undefined,
              duration_ms:
                typeof successObj.executionTime === 'number' ? successObj.executionTime : undefined,
            },
          ];
        }
        return [];
      }

      case 'result': {
        if (o.subtype === 'success' || o.is_error === false) {
          const finalText = String(o.result ?? '');
          const events: CLIEvent[] = [];
          if (finalText) events.push({ type: 'text.completed', text: finalText });
          const usage = o.usage as Record<string, unknown> | undefined;
          events.push({
            type: 'session.completed',
            duration_ms: typeof o.duration_ms === 'number' ? o.duration_ms : undefined,
            usage: usage
              ? {
                  input_tokens: usage.inputTokens as number | undefined,
                  output_tokens: usage.outputTokens as number | undefined,
                  extra: {
                    cacheReadTokens: usage.cacheReadTokens,
                    cacheWriteTokens: usage.cacheWriteTokens,
                  },
                }
              : undefined,
          });
          return events;
        }
        return [
          {
            type: 'error',
            message: String(o.error ?? o.result ?? 'cursor-agent error'),
            code: String(o.subtype ?? 'cursor_error'),
          },
        ];
      }

      default:
        return [];
    }
  }

  async getSupportedModels(): Promise<string[]> {
    try {
      const { stdout } = await execCli('cursor-agent', ['--list-models'], { timeout: 10_000 });
      return stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) =>
            l &&
            l.includes('-') &&
            !l.toLowerCase().includes('loading') &&
            !l.toLowerCase().includes('available'),
        )
        .map((l) => {
          const part = l.split(/\s+-\s+/)[0];
          return part ? part.trim() : '';
        })
        .filter(Boolean);
    } catch {
      return ['composer-2-fast', 'composer-2', 'auto'];
    }
  }
}

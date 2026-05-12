/**
 * Codex CLI adapter.
 *
 * CLI: codex exec --json
 * Output: JSONL events written to stdout.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AdapterCapabilities,
  BuildCommandParams,
  CLIAdapter,
  CLIEvent,
  SpawnSpec,
} from './types.js';

const execFileAsync = promisify(execFile);

const REASONING_ALIASES: Record<string, string> = {
  'extra-high': 'xhigh',
  max: 'xhigh',
};

export class CodexAdapter implements CLIAdapter {
  readonly name = 'codex';

  readonly capabilities: AdapterCapabilities = {
    supportsTextDelta: false,
    supportsThinking: false,
    supportsWorkingDirectory: true,
    supportsEnvVars: true,
    supportsModelSelection: true,
    supportsReasoningEffort: true,
    supportsStdinContext: true,
  };

  async checkInstallation() {
    try {
      const { stdout: version } = await execFileAsync('codex', ['--version'], {
        timeout: 3000,
      });
      const { stdout: path } = await execFileAsync('which', ['codex'], {
        timeout: 3000,
      });
      return {
        installed: true,
        version: version.trim(),
        path: path.trim(),
      };
    } catch (e) {
      return { installed: false, error: (e as Error).message };
    }
  }

  buildCommand(params: BuildCommandParams): SpawnSpec {
    const args: string[] = [
      '-s',
      params.permissive ? 'workspace-write' : 'read-only',
      '-a',
      'never',
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--color',
      'never',
    ];

    if (params.workingDirectory) {
      args.push('-C', params.workingDirectory);
    }

    if (params.model) {
      args.push('-m', params.model);
    }

    if (params.reasoning) {
      const effort = REASONING_ALIASES[params.reasoning] ?? params.reasoning;
      args.push('-c', `model_reasoning_effort="${effort}"`);
    }

    args.push(params.prompt);

    return {
      command: 'codex',
      args,
      env: params.envVars,
      stdin: params.stdinContext,
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
      case 'thread.started':
        return [
          {
            type: 'session.started',
            session_id: String(o.thread_id ?? 'unknown'),
          },
        ];

      case 'turn.started':
        return [];

      case 'item.started':
        return this.parseItemStarted(o.item);

      case 'item.completed':
        return this.parseItemCompleted(o.item);

      case 'turn.completed': {
        const usage = o.usage as Record<string, unknown> | undefined;
        return [
          {
            type: 'session.completed',
            usage: usage
              ? {
                  input_tokens: asNumber(usage.input_tokens),
                  cached_input_tokens: asNumber(usage.cached_input_tokens),
                  output_tokens: asNumber(usage.output_tokens),
                  extra: {
                    reasoning_output_tokens: usage.reasoning_output_tokens,
                  },
                }
              : undefined,
          },
        ];
      }

      case 'turn.failed':
      case 'error':
        return [
          {
            type: 'error',
            message: stringifyMessage(o.message ?? o.error ?? 'codex error'),
            code: typeof o.code === 'string' ? o.code : 'codex_error',
          },
        ];

      default:
        return [];
    }
  }

  async getSupportedModels(): Promise<string[]> {
    return [
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-5.2',
    ];
  }

  private parseItemStarted(item: unknown): CLIEvent[] {
    if (!item || typeof item !== 'object') return [];
    const i = item as Record<string, unknown>;
    if (i.type !== 'command_execution') return [];
    return [
      {
        type: 'tool.started',
        call_id: String(i.id ?? ''),
        tool: 'shell',
        args: { command: String(i.command ?? '') },
      },
    ];
  }

  private parseItemCompleted(item: unknown): CLIEvent[] {
    if (!item || typeof item !== 'object') return [];
    const i = item as Record<string, unknown>;

    if (i.type === 'agent_message') {
      return [
        {
          type: 'text.completed',
          text: String(i.text ?? ''),
        },
      ];
    }

    if (i.type === 'command_execution') {
      return [
        {
          type: 'tool.completed',
          call_id: String(i.id ?? ''),
          tool: 'shell',
          success: typeof i.exit_code === 'number' ? i.exit_code === 0 : i.status === 'completed',
          result: String(i.aggregated_output ?? i.output ?? ''),
          exit_code: asNumber(i.exit_code),
        },
      ];
    }

    return [];
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function stringifyMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return 'codex error';
    }
  }
  return String(value);
}

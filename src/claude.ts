import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodType } from 'zod';

const DEFAULT_SYSTEM_PROMPT =
  'You are a data-extraction and analysis tool for a resume-tailoring CLI. ' +
  'You transcribe and analyze source material faithfully. Never invent, embellish, ' +
  'or infer facts that are not directly present in the material you are given.';

export async function checkAuth(): Promise<void> {
  const credentialsPath = join(homedir(), '.claude', '.credentials.json');
  try {
    await access(credentialsPath);
  } catch {
    throw new Error('Not logged in to Claude Code. Run `claude login` first.');
  }
}

export interface AskOptions<T> {
  prompt: string;
  schema: ZodType<T>;
  tools?: string[];
  effort?: 'low' | 'high';
  systemPrompt?: string;
  /**
   * Cancels the query. Interrupting a stage that is mid-request must actually
   * stop the request — otherwise a `suggest` call abandoned at 40 seconds keeps
   * running, and a second one starts alongside it when the stage is re-entered.
   */
  signal?: AbortSignal;
}

export async function ask<T>(opts: AskOptions<T>): Promise<T> {
  const abortController = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) abortController.abort();
    else opts.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  const q = query({
    prompt: opts.prompt,
    options: {
      abortController,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      outputFormat: { type: 'json_schema', schema: zodToJsonSchema(opts.schema) as Record<string, unknown> },
      systemPrompt: opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      settingSources: [],
      tools: opts.tools ?? [],
      maxThinkingTokens: opts.effort === 'high' ? 10000 : undefined,
    },
  });

  for await (const msg of q) {
    if (msg.type === 'result') {
      if (msg.subtype !== 'success') {
        throw new Error(`claude query failed: ${msg.errors?.join('; ') ?? msg.subtype}`);
      }
      return opts.schema.parse(msg.structured_output);
    }
  }

  throw new Error('claude query ended without a result message');
}

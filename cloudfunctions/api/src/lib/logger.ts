import { createHash } from 'node:crypto';

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

export interface LogSink {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const BLOCKED_KEY_PATTERN = /(secret|token|authorization|api[-_]?key|audio|base64|image|prompt|openid)/i;

function sanitize(fields: LogFields): LogFields {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (BLOCKED_KEY_PATTERN.test(key)) {
      safe[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string' && value.length > 300) {
      safe[key] = `${value.slice(0, 300)}…`;
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export function makeUserRef(openid: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${openid}`).digest('hex').slice(0, 12);
}

export class Logger {
  constructor(private readonly sink: LogSink = console) {}

  info(event: string, fields: LogFields = {}): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write('error', event, fields);
  }

  private write(level: string, event: string, fields: LogFields): void {
    const payload = {
      level,
      event,
      ts: new Date().toISOString(),
      ...sanitize(fields),
    };
    const line = JSON.stringify(payload);
    if (level === 'error') this.sink.error(line);
    else if (level === 'warn') this.sink.warn(line);
    else this.sink.info(line);
  }
}

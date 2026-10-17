import type { AnalysisSource, ServerTimings } from '../types/contracts';
import { storage } from './storage';

export interface AnalysisTimingRecord {
  createdAt: string;
  mode: 'cloud' | 'local_mock';
  source: AnalysisSource;
  captureMs: number;
  compressionMs: number;
  prepareMs: number;
  uploadMs: number;
  analyzeMs: number;
  totalMs: number;
  server?: ServerTimings;
}

export interface TtsTimingRecord {
  createdAt: string;
  ttsMs: number;
}

export function recordAnalysisTiming(record: AnalysisTimingRecord): void {
  const records = storage.getTimings<AnalysisTimingRecord>();
  records.unshift(record);
  storage.setTimings(records);
}

export function latestTiming(): AnalysisTimingRecord | null {
  return storage.getTimings<AnalysisTimingRecord>()[0] ?? null;
}

export function recordTtsTiming(ttsMs: number): void {
  const records = storage.getTtsTimings<TtsTimingRecord>();
  records.unshift({ createdAt: new Date().toISOString(), ttsMs });
  storage.setTtsTimings(records);
}

export function latestTtsTiming(): TtsTimingRecord | null {
  return storage.getTtsTimings<TtsTimingRecord>()[0] ?? null;
}

export function timingSummary(records: AnalysisTimingRecord[]): {
  count: number;
  averageTotalMs: number;
  lastTotalMs: number;
} {
  if (records.length === 0) {
    return { count: 0, averageTotalMs: 0, lastTotalMs: 0 };
  }
  const total = records.reduce((sum, item) => sum + item.totalMs, 0);
  return {
    count: records.length,
    averageTotalMs: Math.round(total / records.length),
    lastTotalMs: records[0].totalMs,
  };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} 毫秒`;
  return `${(ms / 1000).toFixed(1)} 秒`;
}

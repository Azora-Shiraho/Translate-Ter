import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  avoidSubtitleFileOverwrite,
  defaultSubtitleFileName,
  planSubtitleExportPath,
  resolveSubtitleFileFormat
} from './subtitleExport';

describe('subtitleExport', () => {
  it('keeps manual export file names variant-specific', () => {
    expect(defaultSubtitleFileName('D:/media/demo.mp4', 'translated', 'srt')).toBe('demo.translated.srt');
    expect(defaultSubtitleFileName('D:/media/demo.mp4', 'bilingual', 'ass')).toBe('demo.bilingual.ass');
  });

  it('adds the target language suffix for batch exports when enabled', () => {
    const plan = planSubtitleExportPath(
      'D:/media/demo.mp4',
      'translated',
      {
        exportDestinationMode: 'selected-directory',
        exportDirectory: 'D:/exports',
        exportFileFormat: 'srt',
        exportBatchWithLanguageSuffix: true
      },
      {
        batchExport: true,
        interactive: false,
        targetLanguage: 'zh-CN'
      }
    );

    expect(plan.defaultName).toBe('demo_zh-CN.srt');
    expect(plan.defaultPath).toBe(join('D:/exports', 'demo_zh-CN.srt'));
    expect(plan.requiresSaveDialog).toBe(false);
  });

  it('falls back to the source directory for silent batch exports', () => {
    const plan = planSubtitleExportPath(
      'D:/media/demo.mp4',
      'translated',
      {
        exportDestinationMode: 'ask-each-time',
        exportDirectory: '',
        exportFileFormat: 'srt',
        exportBatchWithLanguageSuffix: false
      },
      {
        batchExport: true,
        interactive: false,
        targetLanguage: 'zh-CN'
      }
    );

    expect(plan.defaultPath).toBe(join('D:/media', 'demo.srt'));
    expect(plan.requiresSaveDialog).toBe(false);
  });

  it('uses save-dialog planning for interactive exports', () => {
    const plan = planSubtitleExportPath(
      'D:/media/demo.mp4',
      'translated',
      {
        exportDestinationMode: 'ask-each-time',
        exportDirectory: '',
        exportFileFormat: 'ass',
        exportBatchWithLanguageSuffix: false
      }
    );

    expect(plan.defaultPath).toBe(join('D:/media', 'demo.translated.ass'));
    expect(plan.requiresSaveDialog).toBe(true);
  });

  it('resolves subtitle formats from the selected path extension', () => {
    expect(resolveSubtitleFileFormat('D:/exports/demo.ass', 'srt')).toBe('ass');
    expect(resolveSubtitleFileFormat('D:/exports/demo.unknown', 'srt')).toBe('srt');
  });

  it('uniquifies batch export paths when the target file already exists', () => {
    const existing = new Set([
      join('D:/exports', 'demo_zh-CN.srt'),
      join('D:/exports', 'demo_zh-CN-2.srt')
    ]);

    const next = avoidSubtitleFileOverwrite(join('D:/exports', 'demo_zh-CN.srt'), (candidate) => existing.has(candidate));

    expect(next).toBe(join('D:/exports', 'demo_zh-CN-3.srt'));
  });
});

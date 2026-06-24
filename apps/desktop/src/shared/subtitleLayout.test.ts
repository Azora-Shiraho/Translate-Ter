import { describe, expect, it } from 'vitest';
import type { SubtitleDocument } from './models';
import { normalizeSubtitleDocumentLayout, wrapSubtitleText } from './subtitleLayout';

describe('subtitle layout helpers', () => {
  it('wraps compact text without spaces', () => {
    expect(wrapSubtitleText('这是一个用于测试自动换行的中文句子', 6)).toBe('这是一个用于\n测试自动换行\n的中文句子');
  });

  it('does not duplicate the trailing chunk when splitting a long ASR segment', () => {
    const document: SubtitleDocument = {
      id: 'doc-repeat',
      format: 'srt',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [
        {
          id: 'seg-repeat',
          index: 1,
          startMs: 66000,
          endMs: 72000,
          sourceText: "But there's a higher metal level notion of what a proof is. Beyond that.",
          status: 'transcribed'
        }
      ],
      metadata: {
        createdAt: new Date().toISOString(),
        warnings: []
      }
    };

    const normalized = normalizeSubtitleDocumentLayout(document);

    expect(normalized.segments.at(-1)?.sourceText).toBe('proof is. Beyond that.');
    expect(normalized.segments.map((segment) => segment.sourceText).join('\n')).not.toContain(
      'proof is. Beyond that.\nproof is. Beyond that.'
    );
  });

  it('splits long ASR segments into shorter subtitle cues', () => {
    const document: SubtitleDocument = {
      id: 'doc-1',
      format: 'srt',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      segments: [
        {
          id: 'seg-1',
          index: 1,
          startMs: 4000,
          endMs: 10000,
          sourceText: 'The following content is provided under a Creative Commons license for educational reuse.',
          status: 'transcribed'
        }
      ],
      metadata: {
        createdAt: new Date().toISOString(),
        warnings: []
      }
    };

    const normalized = normalizeSubtitleDocumentLayout(document);

    expect(normalized.segments.length).toBeGreaterThan(1);
    expect(normalized.segments[0].id).toBe('seg-1-part-1');
    expect(normalized.segments[0].startMs).toBe(4000);
    expect(normalized.segments.at(-1)?.endMs).toBe(10000);
    for (let index = 1; index < normalized.segments.length; index += 1) {
      expect(normalized.segments[index].startMs).toBe(normalized.segments[index - 1].endMs);
    }
    expect(normalized.segments.every((segment) => segment.sourceText.split('\n').length <= 2)).toBe(true);
  });
});

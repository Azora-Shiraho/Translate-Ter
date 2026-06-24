import { describe, expect, it } from 'vitest';
import { parseSrt } from './srt';
import { formatAssTimestamp, serializeAss } from './ass';

describe('ASS serializer', () => {
  it('formats ASS timestamps in centiseconds', () => {
    expect(formatAssTimestamp(3_723_450)).toBe('1:02:03.45');
  });

  it('serializes bilingual subtitles with separate source and translated line styles', () => {
    const doc = parseSrt('1\n00:00:01,000 --> 00:00:03,000\nHello world\n');
    doc.segments[0].translatedText = '你好，世界';

    const output = serializeAss(doc, { variant: 'bilingual', bilingualOrder: 'target-first' });

    expect(output).toContain('Style: Default,Microsoft YaHei,30');
    expect(output).toContain('Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\q2\\fs30\\b1\\c&HFFFFFF&}你好，世界\\N{\\q2\\fs20\\b0\\c&HCFD6DE&\\alpha&H18&}Hello world');
  });

  it('collapses wrapped lines and shrinks long bilingual text to stay on a single line per language', () => {
    const doc = parseSrt(
      '1\n00:00:01,000 --> 00:00:05,000\nThis is a deliberately long subtitle line that was already wrapped once.\n'
    );
    doc.segments[0].sourceText =
      'This is a deliberately long subtitle line that was already wrapped once.\nAnd it keeps going.';
    doc.segments[0].translatedText =
      '这是一条已经被换行过一次而且仍然很长的译文，导出 ASS 时应该压成单行并在必要时缩小字号，' +
      '同时继续追加更多内容来触发自动缩字，这样双语字幕在导出后仍然能完整地保持在单行显示范围里。\n' +
      '后面还有一点内容，而且这里再补上一段更长的中文来确保测试真的会走到缩小字号的逻辑。';

    const output = serializeAss(doc, { variant: 'bilingual', bilingualOrder: 'source-first' });

    expect(output).not.toContain('wrapped once.\\NAnd it keeps going.');
    expect(output).toContain('wrapped once. And it keeps going.');
    expect(output).toMatch(/\\fs1\d\\b1\\c&HFFFFFF&/);
    expect(output).toContain('\\N{\\q2\\fs');
  });
});

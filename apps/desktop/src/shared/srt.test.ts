import { describe, expect, it } from 'vitest';
import { parseSrt, serializeSrt } from './srt';

describe('SRT parser/writer', () => {
  it('parses CRLF input into stable millisecond segments', () => {
    const doc = parseSrt('1\r\n00:00:01,250 --> 00:00:03,000\r\nHello world\r\n\r\n2\r\n00:00:03,500 --> 00:00:04,750\r\nNext line\r\n');

    expect(doc.segments).toHaveLength(2);
    expect(doc.segments[0]).toMatchObject({
      id: 'seg-0001',
      startMs: 1250,
      endMs: 3000,
      sourceText: 'Hello world'
    });
    expect(doc.metadata.warnings).toHaveLength(0);
  });

  it('serializes translated and bilingual variants without changing timestamps', () => {
    const doc = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nHello\n');
    doc.segments[0].translatedText = '你好';

    expect(serializeSrt(doc, { variant: 'translated' })).toContain('00:00:01,000 --> 00:00:02,000\n你好');
    expect(serializeSrt(doc, { variant: 'bilingual', bilingualOrder: 'source-first' })).toContain('Hello\n你好');
  });

  it('round-trips the full timeline without shifting cue boundaries', () => {
    const input = [
      '7',
      '00:00:00,010 --> 00:01:02,003',
      'First',
      '',
      '8',
      '01:02:03,004 --> 10:11:12,999',
      'Second line',
      'still same cue'
    ].join('\n');

    const firstPass = parseSrt(input);
    const output = serializeSrt(firstPass, { variant: 'source' });
    const secondPass = parseSrt(output);

    expect(secondPass.segments.map((segment) => [segment.startMs, segment.endMs])).toEqual(
      firstPass.segments.map((segment) => [segment.startMs, segment.endMs])
    );
  });

  it('warns on overlap instead of failing parse', () => {
    const doc = parseSrt('1\n00:00:01,000 --> 00:00:03,000\nA\n\n2\n00:00:02,500 --> 00:00:04,000\nB\n');
    expect(doc.metadata.warnings.some((warning) => warning.code === 'TimingOverlap')).toBe(true);
    expect(doc.segments[1].status).toBe('warning');
  });
});

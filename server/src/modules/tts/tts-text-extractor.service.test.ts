import { describe, it, expect } from 'vitest';
import { htmlToBlocks, normalizePath } from './tts-text-extractor.service';

describe('htmlToBlocks', () => {
  it('splits paragraphs into one block each', () => {
    expect(htmlToBlocks('<body><p>One.</p><p>Two.</p></body>')).toEqual(['One.', 'Two.']);
  });

  it('treats a heading and following paragraphs as separate ordered blocks', () => {
    expect(htmlToBlocks('<body><h1>Title</h1><p>Body para.</p></body>')).toEqual(['Title', 'Body para.']);
  });

  // Regression: leading content before the first block element used to become an
  // extra server-only block 0, shifting every audio block index by one (audio
  // played one paragraph behind the highlight). Foliate's getBlocks() drops it.
  it('drops bare text that appears before the first block-level element', () => {
    expect(htmlToBlocks('<body>Intro text<p>First para.</p><p>Second para.</p></body>')).toEqual(['First para.', 'Second para.']);
  });

  it('drops leading inline elements (e.g. drop-cap span) before the first block', () => {
    expect(htmlToBlocks('<body><span>Drop</span> lead<p>Real one.</p></body>')).toEqual(['Real one.']);
  });

  it('drops leading content even when the HTML is pretty-printed with newlines', () => {
    const html = '<body>\n  Intro\n  <p>First.</p>\n  <p>Second.</p>\n</body>';
    expect(htmlToBlocks(html)).toEqual(['First.', 'Second.']);
  });

  it('does not change well-formed chapters that already start with a block element', () => {
    const html = '<body>\n<p>Alpha.</p>\n<p>Bravo.</p>\n<p>Charlie.</p>\n</body>';
    expect(htmlToBlocks(html)).toEqual(['Alpha.', 'Bravo.', 'Charlie.']);
  });

  it('unwraps a single container div into its inner block elements', () => {
    expect(htmlToBlocks('<body><div class="chapter"><p>P1.</p><p>P2.</p></div></body>')).toEqual(['P1.', 'P2.']);
  });

  it('returns a single block when the body has no block-level elements', () => {
    expect(htmlToBlocks('<body>Just inline text with <em>emphasis</em>.</body>')).toEqual(['Just inline text with emphasis.']);
  });

  it('decodes entities and collapses whitespace within a block', () => {
    expect(htmlToBlocks('<body><p>Tom &amp; Jerry   say\n"hi".</p></body>')).toEqual(['Tom & Jerry say "hi".']);
  });
});

describe('normalizePath', () => {
  it('returns a simple path unchanged', () => {
    expect(normalizePath('OEBPS/Text/ch1.xhtml')).toBe('OEBPS/Text/ch1.xhtml');
  });

  it('collapses one .. segment', () => {
    expect(normalizePath('OEBPS/../Text/ch1.xhtml')).toBe('Text/ch1.xhtml');
  });

  it('collapses leading directory plus .. (epub relative href pattern)', () => {
    expect(normalizePath('OEBPS/../Text/chapter1.xhtml')).toBe('Text/chapter1.xhtml');
  });

  it('handles multiple .. segments', () => {
    expect(normalizePath('a/b/c/../../d.xhtml')).toBe('a/d.xhtml');
  });

  it('handles . segments', () => {
    expect(normalizePath('OEBPS/./Text/ch1.xhtml')).toBe('OEBPS/Text/ch1.xhtml');
  });

  it('returns empty string for pure .. navigation', () => {
    expect(normalizePath('../ch1.xhtml')).toBe('ch1.xhtml');
  });

  it('handles no directory prefix', () => {
    expect(normalizePath('chapter1.xhtml')).toBe('chapter1.xhtml');
  });
});

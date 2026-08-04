import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MessageMarkdown from '../components/MessageMarkdown';

describe('MessageMarkdown', () => {
  it('renders bold, italic, and inline code', () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown content={'**bold** and _italic_ and `code`'} />,
    );
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>');
    expect(html).toContain('code');
  });

  it('renders safe http links and strips javascript urls', () => {
    const safe = renderToStaticMarkup(
      <MessageMarkdown content={'[site](https://example.com)'} />,
    );
    expect(safe).toContain('href="https://example.com"');
    expect(safe).toContain('rel="noopener noreferrer"');

    const unsafe = renderToStaticMarkup(
      <MessageMarkdown content={'[x](javascript:alert(1))'} />,
    );
    expect(unsafe).not.toContain('javascript:');
  });

  it('does not execute raw html', () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown content={'Hello <script>alert(1)</script>'} />,
    );
    expect(html).not.toContain('<script>');
  });
});

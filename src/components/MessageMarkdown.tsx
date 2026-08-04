import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="message-md-link"
    >
      {children}
    </a>
  ),
  // Keep chat bubbles compact — avoid giant heading sizes.
  h1: ({ children }) => <p className="message-md-heading">{children}</p>,
  h2: ({ children }) => <p className="message-md-heading">{children}</p>,
  h3: ({ children }) => <p className="message-md-heading">{children}</p>,
  h4: ({ children }) => <p className="message-md-heading">{children}</p>,
  h5: ({ children }) => <p className="message-md-heading">{children}</p>,
  h6: ({ children }) => <p className="message-md-heading">{children}</p>,
  img: () => null,
  script: () => null,
  iframe: () => null,
};

type Props = {
  content: string;
};

/** Renders message body markdown safely (no raw HTML). */
export default function MessageMarkdown({ content }: Props) {
  return (
    <div className="message-md break-words text-left">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        urlTransform={(url) => {
          const value = url.trim();
          if (/^(https?:|mailto:)/i.test(value)) return value;
          return '';
        }}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

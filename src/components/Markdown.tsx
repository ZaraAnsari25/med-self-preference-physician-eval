import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Model output is untrusted: raw HTML is never rendered (no rehype-raw), unsafe
// URL schemes are stripped by react-markdown's default urlTransform, links
// open in a new tab without referrer, and images are shown as their alt text
// so no external content is fetched.
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  img: ({ alt, src }) => <span className="text-muted">[image{alt ? `: ${alt}` : ""}{src ? ` — ${src}` : ""}]</span>,
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}

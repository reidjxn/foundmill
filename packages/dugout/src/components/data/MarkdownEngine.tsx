/**
 * The Markdown parser and renderer (react-markdown + remark-gfm, about 45 KB gzipped), split from Markdown.tsx so it
 * loads as its own chunk instead of with every page that can show Markdown. Raw HTML is skipped.
 */
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];

export interface MarkdownEngineProps {
  children: string;
  components: Components;
}

export default function MarkdownEngine({ children, components }: MarkdownEngineProps) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components} skipHtml>
      {children}
    </ReactMarkdown>
  );
}

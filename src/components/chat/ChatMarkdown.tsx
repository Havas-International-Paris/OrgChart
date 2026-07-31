import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMarkdownProps {
  text: string;
  inverted?: boolean;
}

// The app has no @tailwindcss/typography plugin (Tailwind v4 is configured
// bare, see vite.config.ts), so element styling is done explicitly here via
// react-markdown's `components` prop rather than a `prose` class. `inverted`
// flips border/rule colors for the dark user-bubble background — see
// ChatPanel.tsx's message bubble classes this sits inside.
function buildComponents(inverted: boolean): Components {
  const ruleColor = inverted ? 'border-slate-600' : 'border-slate-300';
  const mutedText = inverted ? 'text-slate-300' : 'text-slate-500';
  return {
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
    li: ({ children }) => <li>{children}</li>,
    a: ({ children, href }) => (
      <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        {children}
      </a>
    ),
    code: ({ children }) => (
      <code className={`rounded px-1 py-0.5 font-mono text-xs ${inverted ? 'bg-slate-700' : 'bg-slate-200'}`}>
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className={`mb-2 overflow-x-auto rounded p-2 font-mono text-xs last:mb-0 ${inverted ? 'bg-slate-700' : 'bg-slate-200'}`}>
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="mb-2 overflow-x-auto last:mb-0">
        <table className={`w-full border-collapse text-xs ${ruleColor}`}>{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead>{children}</thead>,
    th: ({ children }) => (
      <th className={`border-b px-2 py-1 text-left font-semibold ${ruleColor}`}>{children}</th>
    ),
    td: ({ children }) => <td className={`border-b px-2 py-1 ${ruleColor} ${mutedText}`}>{children}</td>,
  };
}

// Assistant answers (and, for consistency, echoed user questions) are
// Markdown — Claude/Gemini both write **bold**, lists and GFM tables in
// their responses, and rendering them as raw text (the original
// `whitespace-pre-wrap` div) left every `**label**`/table literally on
// screen instead of formatted.
export function ChatMarkdown({ text, inverted = false }: ChatMarkdownProps) {
  return (
    <div className="text-sm leading-normal [&>*:last-child]:mb-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildComponents(inverted)}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Renderer markdown ligero para chat (AI Coach, refinamiento, etc).
 * Soporta GFM: tablas, strikethrough, task lists, autolink.
 * Estilos tailwind inline — sin necesidad de @tailwindcss/typography.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("text-sm leading-relaxed space-y-2", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-base font-bold mt-3 mb-1.5 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-bold mt-3 mb-1 first:mt-0 uppercase tracking-wide text-foreground/80">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-semibold mt-2 mb-0.5 first:mt-0 uppercase text-muted-foreground">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="leading-relaxed">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 space-y-0.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 space-y-0.5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-muted-foreground/40 pl-3 italic text-muted-foreground my-1">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-t border-muted" />,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:no-underline"
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className?.startsWith("language-");
            if (isInline) {
              return (
                <code
                  className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={cn("font-mono text-[0.85em]", className)} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="rounded-md bg-muted/60 p-3 overflow-x-auto text-[0.85em] leading-relaxed border my-2">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="w-full border-collapse border rounded text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/40">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border px-2 py-1 align-top">{children}</td>
          ),
          tr: ({ children }) => <tr className="even:bg-muted/10">{children}</tr>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

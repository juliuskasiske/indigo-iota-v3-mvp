"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders an LLM answer as markdown (GFM: tables, lists, bold, etc.) styled to
// the Indigo Iota palette. The answer model emits tables and **bold** that were
// previously shown raw; this turns them into real formatting.
export function Markdown({ children }: { children: string }) {
  return (
    <div
      className={
        "text-sm leading-relaxed text-foreground " +
        "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 " +
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 " +
        "[&_strong]:font-semibold [&_strong]:text-foreground " +
        "[&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-semibold " +
        "[&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold " +
        "[&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold " +
        "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 " +
        "[&_code]:rounded [&_code]:bg-background-soft [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs " +
        "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-background-soft [&_pre]:p-3 " +
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-foreground-muted"
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: (props) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...props} />
            </div>
          ),
          th: (props) => (
            <th
              className="border border-border bg-background-soft/60 px-3 py-1.5 text-left font-medium text-foreground"
              {...props}
            />
          ),
          td: (props) => (
            <td
              className="border border-border px-3 py-1.5 align-top text-foreground-muted"
              {...props}
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

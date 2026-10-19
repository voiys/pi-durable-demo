import type { ComponentProps } from "react";
import { Streamdown, useIsCodeFenceIncomplete, type AnimateOptions, type ExtraProps } from "streamdown";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";

// shadcn components/markdown.tsx: fenced code is a registry CodeBlock, inline code is styled, Streamdown's own controls are off.
function MarkdownCodeBlock({ code, language }: { code: string; language: string }) {
  // True while the closing fence has not arrived yet.
  const incomplete = useIsCodeFenceIncomplete();
  return (
    <CodeBlock className="bg-background my-1 rounded-lg">
      <CodeBlockHeader>
        <CodeBlockTitle className="text-muted-foreground text-[0.8em] font-medium">{language || "Code"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} disabled={incomplete} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="max-h-96 text-[0.8em]">{code}</CodeBlockContent>
    </CodeBlock>
  );
}

function MarkdownCode({ node, className, children, ...props }: ComponentProps<"code"> & ExtraProps) {
  // Streamdown marks fenced code with data-block. Inline code stays inline.
  if (!("data-block" in props))
    return (
      <code className={cn("bg-background/70 rounded-sm px-1 py-0.5 font-mono text-[0.86em]", className)} {...props}>
        {children}
      </code>
    );
  return <MarkdownCodeBlock code={typeof children === "string" ? children : ""} language={/language-(\S+)/.exec(className ?? "")?.[1] ?? ""} />;
}

// Streamdown memoizes on components, so keep the default stable.
const MARKDOWN_COMPONENTS = { code: MarkdownCode };
// Off: Streamdown asks before opening a link in a modal, and there are no modals here (research/ui-decisions.md).
const LINK_SAFETY = { enabled: false };
// Streamed words fade in (opacity only, so reduced motion keeps it), 200ms ease-out, 40ms apart (Streamdown's default
// stagger, capped 320ms behind the stream so a fast reply never lags).
const ANIMATE: AnimateOptions = { animation: "fadeIn", duration: 200, easing: "ease-out", sep: "word" };

/**
 * Reading type for replies (DESIGN.md §4): sizes are relative, so the text inherits the bubble's 15px/1.45 (or a panel's
 * 13px). Headings stay in the body's narrow band, lists hang, tables scroll sideways inside their container, links are underlined in the text's own ink (iMessage; blue on the gray bubble falls under 4.5:1).
 */
const PROSE = cn(
  "w-full min-w-0 space-y-2.5 overflow-hidden",
  "[&_[data-streamdown^=heading]]:mt-4 [&_[data-streamdown^=heading]:first-child]:mt-0 [&_[data-streamdown^=heading]]:mb-1 [&_[data-streamdown^=heading]]:text-[1em] [&_[data-streamdown^=heading]]:leading-snug [&_[data-streamdown^=heading]]:font-semibold [&_[data-streamdown^=heading]]:tracking-[-0.016em]",
  "[&_[data-streamdown=heading-1]]:text-[1.15em] [&_[data-streamdown=heading-2]]:text-[1.1em]",
  "[&_strong]:font-semibold",
  "[&_ol]:list-outside [&_ol]:pl-5 [&_ul]:list-outside [&_ul]:pl-5 [&_li]:py-0.5",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:not-italic [&_hr]:my-3",
  "[&_a]:text-current [&_a]:font-normal [&_a]:underline [&_a]:decoration-current/40 [&_a]:underline-offset-2 [&_a:hover]:decoration-current",
  "[&_[data-streamdown=table-wrapper]]:my-1 [&_[data-streamdown=table-wrapper]]:gap-0 [&_[data-streamdown=table-wrapper]]:border-0 [&_[data-streamdown=table-wrapper]]:bg-transparent [&_[data-streamdown=table-wrapper]]:p-0",
  "[&_[data-streamdown=table-wrapper]>div]:rounded-lg [&_[data-streamdown=table-header]]:bg-transparent",
  "[&_[data-streamdown=table-cell]]:px-3 [&_[data-streamdown=table-cell]]:py-1.5 [&_[data-streamdown=table-cell]]:text-[0.87em] [&_[data-streamdown=table-header-cell]]:px-3 [&_[data-streamdown=table-header-cell]]:py-1.5 [&_[data-streamdown=table-header-cell]]:text-[0.87em] [&_[data-streamdown=table-header-cell]]:font-semibold",
);

/** Markdown for replies, agent messages and reasoning. While `streaming`, Streamdown fades new words in and shows a caret. */
export function Markdown({ streaming = false, className, ...props }: { streaming?: boolean } & ComponentProps<typeof Streamdown>) {
  return (
    <Streamdown
      components={MARKDOWN_COMPONENTS}
      controls={false}
      linkSafety={LINK_SAFETY}
      className={cn(PROSE, className)}
      isAnimating={streaming}
      animated={ANIMATE}
      caret={streaming ? "block" : undefined}
      {...props}
    />
  );
}

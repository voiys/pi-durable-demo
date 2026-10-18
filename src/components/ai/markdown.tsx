import type { ComponentProps } from "react";
import { Streamdown, useIsCodeFenceIncomplete, type ExtraProps } from "streamdown";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "@/components/ui/code-block";
import { cn } from "@/lib/utils";

// shadcn components/markdown.tsx: fenced code is a registry CodeBlock, inline code is styled, Streamdown's own controls are off.
function MarkdownCodeBlock({ code, language }: { code: string; language: string }) {
  // True while the closing fence has not arrived yet.
  const incomplete = useIsCodeFenceIncomplete();
  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} disabled={incomplete} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers>{code}</CodeBlockContent>
    </CodeBlock>
  );
}

function MarkdownCode({ node, className, children, ...props }: ComponentProps<"code"> & ExtraProps) {
  // Streamdown marks fenced code with data-block. Inline code stays inline.
  if (!("data-block" in props))
    return (
      <code className={cn("rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]", className)} {...props}>
        {children}
      </code>
    );
  return <MarkdownCodeBlock code={typeof children === "string" ? children : ""} language={/language-(\S+)/.exec(className ?? "")?.[1] ?? ""} />;
}

// Streamdown memoizes on components, so keep the default stable.
const MARKDOWN_COMPONENTS = { code: MarkdownCode };

/** Markdown for replies, agent messages and reasoning. While `streaming`, Streamdown fades new words in and shows a caret. */
export function Markdown({ streaming = false, className, ...props }: { streaming?: boolean } & ComponentProps<typeof Streamdown>) {
  return (
    <Streamdown
      components={MARKDOWN_COMPONENTS}
      controls={false}
      className={cn("w-full min-w-0 overflow-hidden", className)}
      isAnimating={streaming}
      animated
      caret={streaming ? "block" : undefined}
      {...props}
    />
  );
}

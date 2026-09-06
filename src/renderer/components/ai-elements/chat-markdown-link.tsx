import { GlobeIcon } from 'lucide-react';
import React, {
  Children,
  Fragment,
  isValidElement,
  memo,
  useState,
  type ComponentProps,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import { cn } from '../../lib/utils';
import { parseAssistantCitationHref } from '../../../shared/citations';
import { parseFileRef } from '../../../shared/fileRef';
import {
  faviconUrlForOrigin,
  leadingExternalLinkTextLength,
  parseExternalMarkdownUrl,
  resolveMarkdownLinkIcon,
} from '../../../shared/markdownLinks';
import { CiteChip } from '../CiteChip';
import { useCiteNavigation } from '../citeNavigation';
import { GitHubIcon } from '../icons/GitHubIcon';
import { FileRefChip } from './file-ref';
import { ChatMarkdownImage } from './chat-markdown-image';

export const MARKDOWN_LINK_FAVICON_CLASS_NAME = 'block size-full shrink-0 select-none';

/** Hosts whose favicon request already failed this session — skip straight to the globe. */
export const failedFaviconHosts = new Set<string>();

/** Sites whose brand mark (drawn in `currentColor`) replaces the fetched favicon so it follows the theme. */
export function brandLinkIcon(host: string): typeof GitHubIcon | null {
  const icon = resolveMarkdownLinkIcon(host);
  if (icon === 'github') return GitHubIcon;
  return null;
}

export const MarkdownLinkFavicon = memo(function MarkdownLinkFavicon({ host }: { host: string }) {
  const [failedHost, setFailedHost] = useState<string | null>(null);
  const BrandIcon = brandLinkIcon(host);
  const faviconUrl = BrandIcon ? null : faviconUrlForOrigin(`https://${host}`);

  return (
    <span
      className="ms-[0.25em] me-[0.2em] inline-flex size-[14px] [vertical-align:-0.125em]"
      aria-hidden="true"
    >
      {BrandIcon ? (
        <BrandIcon className={MARKDOWN_LINK_FAVICON_CLASS_NAME} />
      ) : faviconUrl === null || failedHost === host || failedFaviconHosts.has(host) ? (
        <GlobeIcon className={MARKDOWN_LINK_FAVICON_CLASS_NAME} />
      ) : (
        <img
          src={faviconUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className={cn(MARKDOWN_LINK_FAVICON_CLASS_NAME, 'rounded-sm')}
          onError={() => {
            failedFaviconHosts.add(host);
            setFailedHost(host);
          }}
        />
      )}
    </span>
  );
});

export function breakableExternalLinkText(text: string): ReactNode[] {
  return Array.from(text, (character, index) => (
    <Fragment key={`${index}:${character}`}>
      {character}
      <wbr />
    </Fragment>
  ));
}

export function hastHasText(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (
    'type' in node &&
    (node as { type: string }).type === 'text' &&
    'value' in node &&
    typeof (node as { value: unknown }).value === 'string' &&
    (node as { value: string }).value.trim().length > 0
  ) {
    return true;
  }
  return (
    'children' in node &&
    Array.isArray((node as { children: unknown[] }).children) &&
    (node as { children: unknown[] }).children.some(hastHasText)
  );
}

export function hasReactTextContent(children: ReactNode): boolean {
  if (children == null) return false;
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children).trim().length > 0;
  }
  if (Array.isArray(children)) {
    return children.some(hasReactTextContent);
  }
  if (isValidElement(children)) {
    if (children.type === 'img' || children.type === ChatMarkdownImage) {
      return false;
    }
    const props = children.props as { children?: ReactNode };
    return hasReactTextContent(props?.children);
  }
  return false;
}

export function MarkdownExternalLinkContent({
  host,
  children,
}: {
  host: string;
  children: ReactNode;
}) {
  const childNodes = Children.toArray(children);
  const firstChild = childNodes[0];

  if (typeof firstChild === 'string' && firstChild.length > 0) {
    const leadingLength = leadingExternalLinkTextLength(firstChild);
    return (
      <>
        <span className="whitespace-nowrap">
          <MarkdownLinkFavicon host={host} />
          {firstChild.slice(0, leadingLength)}
        </span>
        {breakableExternalLinkText(firstChild.slice(leadingLength))}
        {childNodes.slice(1)}
      </>
    );
  }

  return (
    <>
      <span className="whitespace-nowrap">
        <MarkdownLinkFavicon host={host} />
        {firstChild}
      </span>
      {childNodes.slice(1)}
    </>
  );
}

/** Hook boundary: the anchor itself stays a pure function of its props. */
export function TranscriptCitationLink({
  citation,
}: {
  citation: NonNullable<ReturnType<typeof parseAssistantCitationHref>>;
}) {
  const navigate = useCiteNavigation();
  return (
    <CiteChip
      citation={citation}
      onNavigate={navigate ?? undefined}
      className="translate-y-[0.1em] align-baseline"
    />
  );
}

/**
 * Links, split by what they point at.
 *
 * A link to `src/main/index.ts` is the model naming a place in the project,
 * not a destination — the app has no browser to send it to, and rendering it
 * as an underlined URL both promises navigation that will not happen and
 * hides the filename in a run of blue text. Those become file chips.
 *
 * Links to external web pages show a brand mark (e.g. GitHub mark for github.com)
 * or a site favicon / globe icon, and open safely in the system default browser.
 */
export function MarkdownAnchor({
  href,
  children,
  node,
  onClick,
  ...props
}: ComponentProps<'a'> & { node?: unknown }) {
  if (href && parseFileRef(href)) {
    return <FileRefChip href={href}>{children}</FileRefChip>;
  }

  const citation = href ? parseAssistantCitationHref(href) : null;
  if (citation) {
    return <TranscriptCitationLink citation={citation} />;
  }

  const external = parseExternalMarkdownUrl(href);
  if (external) {
    const carriesText = (node && hastHasText(node)) || hasReactTextContent(children);
    const handleClick = (e: ReactMouseEvent<HTMLAnchorElement>) => {
      if (onClick) {
        onClick(e);
        if (e.defaultPrevented) return;
      }
      if (href && typeof window !== 'undefined' && (window as unknown as { atlasChat?: { browser?: { openExternal?: (url: string) => Promise<void> } } }).atlasChat?.browser?.openExternal) {
        e.preventDefault();
        void (window as unknown as { atlasChat: { browser: { openExternal: (url: string) => Promise<void> } } }).atlasChat.browser.openExternal(href).catch(() => {});
      }
    };

    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={handleClick}
        {...props}
      >
        {carriesText ? (
          <MarkdownExternalLinkContent host={external.host}>
            {children}
          </MarkdownExternalLinkContent>
        ) : (
          children
        )}
      </a>
    );
  }

  return (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  );
}

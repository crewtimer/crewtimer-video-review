import {
  ClassAttributes,
  FC,
  HTMLAttributes,
  ReactNode,
  useEffect,
  useState,
} from 'react';
import ReactMarkdown, { Components, ExtraProps } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import gfm from 'remark-gfm';
// eslint-disable-next-line import/no-unassigned-import
import 'github-markdown-css'; // for markdown-body className

const cache: { [url: string]: string } = {};

/**
 * Convert a heading so it incudes a linkable anchor
 *
 * @param props
 * @returns React.ReactNode
 */
const headingResolver = (
  props: ClassAttributes<HTMLHeadingElement> &
    HTMLAttributes<HTMLHeadingElement> &
    ExtraProps,
) => {
  const { children } = props || {};

  // If we have a heading, get the text and conver to anchor text
  // e.g. "## My Heading" => "my-heading"
  let anchor = typeof children === 'string' ? children.toLowerCase() : '';

  // Clean anchor (replace special characters whitespaces).
  // Alternatively, use encodeURIComponent() if you don't care about
  // pretty anchor links
  anchor = anchor.replace(/[^a-zA-Z0-9 ]/g, '');
  anchor = anchor.replace(/ /g, '-');

  // Utility
  const container = (child: ReactNode) => (
    <a
      id={anchor}
      href={`#${anchor}`}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <span>{child}</span>
    </a>
  );

  const tagName = (props.node?.tagName || 'h1').toLowerCase();
  const level = parseInt(tagName.replace('h', ''), 10);
  switch (level || 1) {
    case 1:
      return <h1>{container(children)}</h1>;
    case 2:
      return <h2>{container(children)}</h2>;
    case 3:
      return <h3>{container(children)}</h3>;
    case 4:
      return <h4>{container(children)}</h4>;
    case 5:
      return <h5>{container(children)}</h5>;

    default:
      return <h6>{container(children)}</h6>;
  }
};

const renderers: Components = {
  // This custom renderer changes how images are rendered
  // we use it to constrain the max width of an image to its container
  img: ({ ...props }) => {
    const { alt, src, title } = props;
    if (src === undefined) {
      return null;
    }
    let uri = src.replace(/%20=/, ' ='); // allow '%20=' or ' ='
    const size = uri.replace(/^.* =/, '');
    uri = uri.replace(/ =.*/, '');
    // console.log(JSON.stringify({ src, uri }));
    let width: undefined | string;
    let height: undefined | string;
    if (size) {
      [width, height] = size.split('x');
    }
    return (
      <img alt={alt} src={uri} title={title} width={width} height={height} />
    );
  },
  h1: headingResolver,
  h2: headingResolver,
  h3: headingResolver,
  h4: headingResolver,
  h5: headingResolver,
  h6: headingResolver,
  a: ({ ...props }) => {
    delete props.node;
    const domainName = new URL(window.location.href).hostname;
    if (
      props.href?.includes('localhost') ||
      props.href?.includes(domainName) ||
      props.href?.startsWith('#')
    ) {
      // eslint-disable-next-line react/jsx-props-no-spreading
      return <a {...props}>{props.children}</a>;
    }
    return (
      // eslint-disable-next-line react/jsx-props-no-spreading
      <a {...props} target="_blank" rel="noopener noreferrer">
        {props.children}
      </a>
    );
  },
};

export interface MarkdownProps {
  /** Markdown text to render */
  md?: string;
  /** A uri from which to load the markdown */
  url?: string;
  /** A google doc id form which to load markdown content */
  docId?: string;
}

/**
 * Render Markdown using github styling
 *
 * Properties:
 *   md: string - Markdown text to render
 *
 *   url: string - A url from which to load the markdown
 *
 *   docId: string - A google doc id from whic to load the markdown
 *
 * A size can be specified by appending =100x200 for 100 width, 200 height or
 * just =100 to only constrain the width.
 *
 * However, current versions of react-markdown choke on a space before = so
 * the workaround is to use %20=100 or %20=100x200 instead.
 */
const Markdown: FC<MarkdownProps> = ({ url, md, docId }) => {
  const [content, setContent] = useState('');

  useEffect(() => {
    if (md) {
      setContent(md);
      return;
    }

    const queryUrl = docId
      ? docId.endsWith('.md')
        ? `https://storage.googleapis.com/resources.crewtimer.com/docs/markdown/${docId}`
        : `https://www.googleapis.com/drive/v3/files/${docId}?alt=media&key=AIzaSyBxl61gy473Yq7KDT_838HYPnRsfZz_Y5M`
      : url;
    if (queryUrl === undefined) {
      return;
    }
    const cacheContent = cache[queryUrl];
    if (cacheContent) {
      setContent(cacheContent);
    } else {
      fetch(queryUrl)
        .then((response) => response.text())
        .then((text) => {
          cache[queryUrl] = text;
          setContent(text);
          return '';
        })
        .catch((e) => setContent(`Error: ${String(e)}`));
    }
  }, [url, docId, md]);

  useEffect(() => {
    const anchor = window.location.hash.slice(1); // strip first char (#)
    if (anchor) {
      const anchorEl = document.getElementById(anchor);
      if (anchorEl) {
        anchorEl.scrollIntoView();
      }
    }
  }, [content]);

  // transform image spec like ![alt](uri =100x200) to ![alt](uri%20=100x200)
  const mdcontent = content
    .replace(/ =([0-9]+)(x[0-9]+)?\)/, '%20=$1$2)')
    .replace('screen>', 'screen></iframe>');

  const renderersToUse = { ...renderers };

  // https://github.com/remarkjs/react-markdown/blob/main/changelog.md#remove-buggy-html-in-markdown-parser
  return (
    <div style={{ flex: 1, margin: 16 }} className="markdown-body">
      <ReactMarkdown
        rehypePlugins={[rehypeRaw, gfm]}
        components={renderersToUse}
      >
        {mdcontent}
      </ReactMarkdown>
    </div>
  );
};

export default Markdown;

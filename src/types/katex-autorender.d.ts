// KaTeX ships its own types for the main entry, but the `contrib/auto-render`
// subpath export has no bundled declarations. Minimal ambient shim.
declare module 'katex/contrib/auto-render' {
  interface RenderMathInElementOptions {
    delimiters?: Array<{ left: string; right: string; display: boolean }>;
    ignoredTags?: string[];
    ignoredClasses?: string[];
    throwOnError?: boolean;
    errorCallback?: (msg: string, err: Error) => void;
    [key: string]: unknown;
  }
  const renderMathInElement: (elem: HTMLElement, options?: RenderMathInElementOptions) => void;
  export default renderMathInElement;
}

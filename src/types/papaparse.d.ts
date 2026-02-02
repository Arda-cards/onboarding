declare module 'papaparse' {
  export interface ParseConfig<T = unknown> {
    delimiter?: string;
    newline?: string;
    quoteChar?: string;
    escapeChar?: string;
    header?: boolean;
    transformHeader?: (header: string, index: number) => string;
    dynamicTyping?: boolean | Record<string, boolean> | ((field: string | number) => boolean);
    preview?: number;
    encoding?: string;
    worker?: boolean;
    comments?: boolean | string;
    download?: boolean;
    downloadRequestHeaders?: Record<string, string>;
    downloadRequestBody?: unknown;
    skipEmptyLines?: boolean | 'greedy';
    fastMode?: boolean;
    withCredentials?: boolean;
    delimitersToGuess?: string[];
    chunkSize?: number;
    chunk?: (results: ParseResult<T>, parser: Parser) => void;
    step?: (results: ParseStepResult<T>, parser: Parser) => void;
    complete?: (results: ParseResult<T>, file?: File) => void;
    error?: (error: Error, file?: File) => void;
    transform?: (value: string, field: string | number) => unknown;
    beforeFirstChunk?: (chunk: string) => string | void;
  }

  export interface ParseMeta {
    delimiter: string;
    linebreak: string;
    aborted: boolean;
    fields?: string[];
    truncated: boolean;
    cursor: number;
  }

  export interface ParseError {
    type: string;
    code: string;
    message: string;
    row?: number;
    index?: number;
    fatal?: boolean;
  }

  export interface ParseResult<T> {
    data: T[];
    errors: ParseError[];
    meta: ParseMeta;
  }

  export interface ParseStepResult<T> {
    data: T;
    errors: ParseError[];
    meta: ParseMeta;
  }

  export interface Parser {
    abort: () => void;
    pause: () => void;
    resume: () => void;
  }

  export interface UnparseConfig {
    quotes?: boolean | boolean[] | ((value: unknown) => boolean);
    quoteChar?: string;
    escapeChar?: string;
    delimiter?: string;
    header?: boolean;
    newline?: string;
    skipEmptyLines?: boolean | 'greedy';
    columns?: string[];
    escapeFormulae?: boolean;
  }

  export function parse<T = unknown>(input: string | File, config?: ParseConfig<T>): ParseResult<T>;
  export function unparse<T = unknown>(data: T[] | { fields: string[]; data: T[] }, config?: UnparseConfig): string;

  const Papa: {
    parse: typeof parse;
    unparse: typeof unparse;
    BAD_DELIMITERS: string[];
    RECORD_SEP: string;
    UNIT_SEP: string;
    WORKERS_SUPPORTED: boolean;
    LocalChunkSize: number;
    RemoteChunkSize: number;
    DefaultDelimiter: string;
  };

  export default Papa;
}

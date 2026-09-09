/** Every API route returns one of these two shapes. */
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    /** Stable machine-readable code, safe to branch on in the UI. */
    code: string;
    /** User-facing message. Never contains secrets or internal detail. */
    message: string;
    /** Field-level validation problems, when the code is `validation_error`. */
    fields?: Record<string, string[]>;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// In-memory auth token store (never written to localStorage or sessionStorage)
let memoryAuthToken: string | null = null;

export function setMemoryAuthToken(token: string | null) {
  memoryAuthToken = token;
}

export function getMemoryAuthToken(): string | null {
  return memoryAuthToken;
}

export class ApiError extends Error {
  status: number;
  fieldErrors?: Record<string, string[]>;

  constructor(message: string, status: number, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export async function apiRequest<T = any>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    isFormData?: boolean;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'DebitOrigin',
  };

  if (memoryAuthToken) {
    headers.Authorization = `Bearer ${memoryAuthToken}`;
  }

  let bodyPayload: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.isFormData && options.body instanceof FormData) {
      bodyPayload = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      bodyPayload = JSON.stringify(options.body);
    }
  }

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: bodyPayload,
    credentials: 'include',
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new ApiError(
      data?.error || `Request failed (${res.status})`,
      res.status,
      data?.fieldErrors
    );
  }

  return data as T;
}

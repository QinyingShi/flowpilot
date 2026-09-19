import { headers } from 'next/headers';
import { readDevIdentity } from '@/lib/dev-auth';

const apiBaseUrl =
  process.env.PROJECT_API_BASE_URL?.replace(/\/$/, '') ??
  'http://127.0.0.1:8000';
const defaultProjectId = process.env.PROJECT_ID ?? 'nebula-customer-platform';
const projectCookieName = 'flowpilot-project';

function projectFromCookie(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const encodedValue = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${projectCookieName}=`))
    ?.slice(projectCookieName.length + 1);
  if (!encodedValue) return null;
  try {
    return decodeURIComponent(encodedValue);
  } catch {
    return null;
  }
}

function decodeFullName(value: string | null, encoding: string | null) {
  if (!value || encoding !== 'percent-encoded-utf-8') return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function currentUser() {
  const requestHeaders = await headers();
  if (process.env.NODE_ENV !== 'production') {
    const selected = readDevIdentity(requestHeaders.get('cookie'));
    if (selected === null) return null;
    if (selected) return selected;
  }
  const id = requestHeaders.get('oai-authenticated-user-id');
  const email = requestHeaders.get('oai-authenticated-user-email');
  if (!id || !email) {
    if (process.env.NODE_ENV !== 'production') {
      return {
        id: 'local-user',
        email: 'admin@flowpilot.local',
        displayName: 'Demo Admin',
      };
    }
    return null;
  }
  const fullName = decodeFullName(
    requestHeaders.get('oai-authenticated-user-full-name'),
    requestHeaders.get('oai-authenticated-user-full-name-encoding'),
  );
  return { id, email, displayName: fullName ?? email };
}

function backendHeaders(
  user: {
    id: string;
    email: string;
    displayName: string;
  },
  projectId = defaultProjectId,
): Record<string, string> {
  const result: Record<string, string> = {
    'content-type': 'application/json',
    'x-user-id': user.id,
    'x-user-email': user.email,
    'x-user-display-name': user.displayName,
    'x-project-id': projectId,
  };
  if (process.env.PROJECT_API_PROXY_SECRET) {
    result['x-project-api-secret'] = process.env.PROJECT_API_PROXY_SECRET;
  }
  return result;
}

async function proxyResponse(response: Response, activeProjectId?: string) {
  const contentType =
    response.headers.get('content-type') ?? 'application/json';
  const responseHeaders: Record<string, string> = {
    'content-type': contentType,
  };
  if (response.ok && activeProjectId) {
    responseHeaders['set-cookie'] =
      `${projectCookieName}=${encodeURIComponent(activeProjectId)}; Path=/; HttpOnly; SameSite=Lax`;
  }
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: responseHeaders,
  });
}

function unavailableResponse(error: unknown) {
  return Response.json(
    {
      error: 'python_backend_unavailable',
      message:
        error instanceof Error ? error.message : 'Python backend unavailable',
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: 'authentication_required' }, { status: 401 });
  }
  try {
    const activeProjectId =
      new URL(request.url).searchParams.get('projectId') ??
      projectFromCookie(request) ??
      defaultProjectId;
    const response = await fetch(`${apiBaseUrl}/api/workspace`, {
      headers: backendHeaders(user, activeProjectId),
      cache: 'no-store',
    });
    return proxyResponse(response, activeProjectId);
  } catch (error) {
    return unavailableResponse(error);
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: 'authentication_required' }, { status: 401 });
  }
  try {
    const response = await fetch(`${apiBaseUrl}/api/workspace`, {
      method: 'POST',
      headers: backendHeaders(
        user,
        projectFromCookie(request) ?? defaultProjectId,
      ),
      body: await request.text(),
    });
    return proxyResponse(response);
  } catch (error) {
    return unavailableResponse(error);
  }
}

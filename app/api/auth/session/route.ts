import {
  DEV_AUTH_COOKIE,
  DEV_SIGNED_OUT,
  localIdentityId,
  readDevIdentity,
  serializeDevIdentity,
  type DevIdentity,
} from '@/lib/dev-auth';

const demoIdentities: DevIdentity[] = [
  {
    id: 'local-user',
    email: 'admin@flowpilot.local',
    displayName: 'Demo Admin',
  },
  {
    id: 'local-manager',
    email: 'manager@flowpilot.local',
    displayName: 'Demo Manager',
  },
  {
    id: 'demo-user',
    email: 'demo@example.com',
    displayName: 'demo@example.com',
  },
  { id: 'qa-user', email: 'qa@example.com', displayName: 'QA' },
];

function unavailable() {
  return Response.json(
    { error: 'development_auth_unavailable' },
    { status: 404 },
  );
}

function cookie(value: string) {
  return `${DEV_AUTH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') return unavailable();
  const selected = readDevIdentity(request.headers.get('cookie'));
  return Response.json({
    developmentAuth: true,
    signedOut: selected === null,
    selected: selected ?? null,
    identities: demoIdentities,
  });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') return unavailable();
  const input = (await request
    .json()
    .catch(() => null)) as Partial<DevIdentity> | null;
  const email = input?.email?.trim().toLowerCase() ?? '';
  const displayName = input?.displayName?.trim() ?? '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !displayName) {
    return Response.json({ error: 'invalid_local_identity' }, { status: 400 });
  }
  const identity = {
    id: input?.id?.trim().slice(0, 120) || localIdentityId(email),
    email: email.slice(0, 254),
    displayName: displayName.slice(0, 80),
  };
  return Response.json(
    { ok: true, identity },
    { headers: { 'set-cookie': cookie(serializeDevIdentity(identity)) } },
  );
}

export async function DELETE() {
  if (process.env.NODE_ENV === 'production') return unavailable();
  return Response.json(
    { ok: true },
    { headers: { 'set-cookie': cookie(DEV_SIGNED_OUT) } },
  );
}

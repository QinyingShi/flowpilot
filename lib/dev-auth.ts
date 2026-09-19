export const DEV_AUTH_COOKIE = 'flowpilot-dev-user';
export const DEV_SIGNED_OUT = 'signed-out';

export type DevIdentity = {
  id: string;
  email: string;
  displayName: string;
};

export function readDevIdentity(
  cookieHeader: string | null,
): DevIdentity | null | undefined {
  const raw = (cookieHeader ?? '')
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${DEV_AUTH_COOKIE}=`))
    ?.slice(DEV_AUTH_COOKIE.length + 1);
  if (!raw) return undefined;
  if (raw === DEV_SIGNED_OUT) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Partial<DevIdentity>;
    if (
      typeof value.id !== 'string' ||
      typeof value.email !== 'string' ||
      typeof value.displayName !== 'string'
    ) {
      return undefined;
    }
    return {
      id: value.id.slice(0, 120),
      email: value.email.slice(0, 254),
      displayName: value.displayName.slice(0, 80),
    };
  } catch {
    return undefined;
  }
}

export function serializeDevIdentity(identity: DevIdentity) {
  return encodeURIComponent(JSON.stringify(identity));
}

export function localIdentityId(email: string) {
  const normalized = email.trim().toLowerCase();
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `local_${(hash >>> 0).toString(36)}`;
}

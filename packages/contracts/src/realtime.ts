/**
 * What a signed-in staff member needs to listen to the "something changed" channels of
 * their restaurant: a short-lived token and the exact channels it allows. The channels are
 * only invalidation signals; the data always comes from the API.
 */
export type RealtimeGrant = {
  channels: string[];
  expiresAt: string;
  token: string;
};

/** The same grant with where to connect, as the web app hands it to the browser. */
export type BrowserRealtimeGrant = RealtimeGrant & {
  publishableKey: string;
  url: string;
};

const channelPattern =
  /^tenant:[0-9a-f-]{36}:location:[0-9a-f-]{36}:[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseRealtimeGrant(input: unknown): RealtimeGrant | null {
  const root = record(input);
  if (
    !root ||
    typeof root.token !== "string" ||
    root.token.split(".").length !== 3 ||
    typeof root.expiresAt !== "string" ||
    Number.isNaN(Date.parse(root.expiresAt)) ||
    !Array.isArray(root.channels) ||
    root.channels.length > 8 ||
    !root.channels.every(
      (channel) => typeof channel === "string" && channelPattern.test(channel)
    )
  ) {
    return null;
  }
  return {
    channels: root.channels as string[],
    expiresAt: root.expiresAt,
    token: root.token
  };
}

export function parseBrowserRealtimeGrant(
  input: unknown
): BrowserRealtimeGrant | null {
  const grant = parseRealtimeGrant(input);
  const root = record(input);
  if (
    !grant ||
    !root ||
    typeof root.url !== "string" ||
    !/^https?:\/\//u.test(root.url) ||
    typeof root.publishableKey !== "string" ||
    root.publishableKey.length < 8
  ) {
    return null;
  }
  return { ...grant, publishableKey: root.publishableKey, url: root.url };
}

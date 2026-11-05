// Talking to Campus OS (/api/lms-extension/*, src/app/api/lms-extension in
// the app). Every request but pairing carries the token pairing gave
// this extension; the payload shapes are checked by the app
// (src/lib/lms/extension-protocol.ts). No chrome.* here, so it's testable.

/** Vercel caps a request at 4.5 MB, so files go up in parts this size. Matches the app's MAX_PART_BYTES. */
export const MAX_PART_BYTES = 3_500_000;
/** The biggest file the app reads. Matches MAX_UPLOAD_BYTES. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function base64url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function readBody(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Trades a one-time code from the Connect page for this extension's token. */
export async function pair(apiOrigin, code, fetchImpl = fetch) {
  const res = await fetchImpl(`${apiOrigin}/api/lms-extension/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await readBody(res);
  if (!res.ok || !data?.token) throw new ApiError(res.status, data?.error || "Couldn't connect to Campus OS.");
  return { token: data.token, email: data.email };
}

export function makeApi({ apiOrigin, token, fetchImpl = fetch }) {
  async function call(path, { method = "POST", json, bytes, headers = {} } = {}) {
    const res = await fetchImpl(`${apiOrigin}/api/lms-extension/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(bytes !== undefined ? { "Content-Type": "application/octet-stream" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : bytes,
    });
    const data = await readBody(res);
    if (!res.ok) throw new ApiError(res.status, data?.error || `Campus OS answered ${res.status}.`);
    return data;
  }

  return {
    session: () => call("session", { method: "GET" }),
    importCourses: (payload) => call("courses", { json: payload }),
    planMaterials: (payload) => call("materials", { json: payload }),
    uploadPart: (header, bytes) => call("upload", { bytes, headers: { "X-Campus-Upload": base64url(JSON.stringify(header)) } }),
    failed: (payload) => call("failed", { json: payload }),
    finish: (payload) => call("finish", { json: payload }),
    disconnect: () => call("disconnect", { json: {} }),
  };
}

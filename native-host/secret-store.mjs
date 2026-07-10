const SERVICE = "Clipplane";
const ACCOUNTS = {
  notionToken: "notion-token",
  flomoWebhook: "flomo-webhook"
};

let nativeStorePromise;

export class SecretStoreError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "SecretStoreError";
    this.code = "secret_store_unavailable";
  }
}
export async function getSecret(name, options = {}) {
  return (await resolveStore(options)).get(accountFor(name));
}

export async function setSecretVerified(name, value, options = {}) {
  const secret = String(value || "").trim();
  if (!secret) {
    throw new SecretStoreError(`Refusing to store an empty ${name} credential.`);
  }

  const store = await resolveStore(options);
  const account = accountFor(name);
  await store.set(account, secret);
  if (await store.get(account) !== secret) {
    throw new SecretStoreError(`The ${name} credential could not be verified after storage.`);
  }
}

export async function deleteSecret(name, options = {}) {
  await (await resolveStore(options)).delete(accountFor(name));
}

async function resolveStore(options) {
  if (options.secretStore) {
    return assertStore(options.secretStore);
  }

  nativeStorePromise ||= createNativeStore(options.platform || process.platform);
  return nativeStorePromise;
}

async function createNativeStore(platform) {
  const backendId = platform === "win32"
    ? "native-windows"
    : platform === "darwin"
      ? "native-macos"
      : "";

  if (!backendId) {
    throw new SecretStoreError("Clipplane secure credential storage is supported on Windows and macOS only.");
  }

  try {
    const keychain = await import("cross-keychain");
    await keychain.initBackend((backend) => backend.id === backendId);
    const backend = await keychain.getKeyring();
    if (backend.id !== backendId) {
      throw new Error(`Unexpected credential backend: ${backend.id}`);
    }

    return {
      backendId,
      get: (account) => backend.getPassword(SERVICE, account),
      set: (account, value) => backend.setPassword(SERVICE, account, value),
      delete: (account) => backend.deletePassword(SERVICE, account)
    };
  } catch (error) {
    throw new SecretStoreError(`The native ${backendId} credential backend is unavailable.`, error);
  }
}

function assertStore(store) {
  if (!["get", "set", "delete"].every((method) => typeof store[method] === "function")) {
    throw new SecretStoreError("The injected credential store is invalid.");
  }
  return store;
}

function accountFor(name) {
  const account = ACCOUNTS[name];
  if (!account) {
    throw new SecretStoreError(`Unknown Clipplane credential: ${name}`);
  }
  return account;
}

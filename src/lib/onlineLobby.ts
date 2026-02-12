import { randomBytes } from "crypto";

type LobbyClient = {
  id: string;
  modeKey: string;
  send: (event: string, payload: unknown) => void;
};

type LobbyStore = {
  clients: Map<string, LobbyClient>;
  modes: Map<string, Set<string>>;
};

const store: LobbyStore = (() => {
  const g = globalThis as { __onlineLobbyStore?: LobbyStore };
  if (g.__onlineLobbyStore) return g.__onlineLobbyStore;
  const next = { clients: new Map<string, LobbyClient>(), modes: new Map<string, Set<string>>() };
  g.__onlineLobbyStore = next;
  return next;
})();

function randomId() {
  return `lb_${randomBytes(12).toString("hex")}`;
}

export function registerLobbyClient(modeKey: string, send: (event: string, payload: unknown) => void) {
  const id = randomId();
  const client: LobbyClient = { id, modeKey, send };
  store.clients.set(id, client);
  const set = store.modes.get(modeKey) || new Set<string>();
  set.add(id);
  store.modes.set(modeKey, set);
  return id;
}

export function unregisterLobbyClient(id: string) {
  const client = store.clients.get(id);
  if (!client) return;
  store.clients.delete(id);
  const set = store.modes.get(client.modeKey);
  if (!set) return;
  set.delete(id);
  if (!set.size) store.modes.delete(client.modeKey);
}

export function broadcastLobby(modeKey: string, event: string, payload: unknown) {
  const set = store.modes.get(modeKey);
  if (!set || !set.size) return;
  for (const id of set) {
    const client = store.clients.get(id);
    if (!client) continue;
    try {
      client.send(event, payload);
    } catch {}
  }
}

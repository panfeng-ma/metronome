// @ts-nocheck
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.BILL_SERVICE_DATA_DIR
  ? path.resolve(process.env.BILL_SERVICE_DATA_DIR)
  : path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const DEFAULT_USER_EMAIL = process.env.DEMO_USER_EMAIL ?? "demo@example.com";

const DEFAULT_STORE = {
  users: {
    demo: {
      id: "019e8c2f-6710-7082-84c2-9020bd7ae4e1",
      email: DEFAULT_USER_EMAIL,
      metronomeCustomerId: null,
      lastMetronomeCustomerCreatedAt: null,
      metronomeContractId: null,
      lastMetronomeContractCreatedAt: null,
      stripeCustomerId: null,
      defaultStripePaymentMethodId: null,
      metronomeBillingProviderConfigurationId: null,
      lastCardSetupAt: null,
      lastMetronomeStripeBillingConfigAt: null,
      autoRecharge: {
        enabled: false,
        threshold: null,
        rechargeToAmount: null,
        configuredAt: null,
      },
      balance: 0,
      totalAllowance: 0,
      lowBalanceReminderSent: false,
      lastRechargeAt: null,
    },
  },
  processedEvents: [],
  notifications: [],
};

let store;
let writeQueue = Promise.resolve();

export async function loadStore() {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    store = JSON.parse(raw);
    if (!hasCreatedCustomer(store)) {
      store = structuredClone(DEFAULT_STORE);
      await rm(STORE_FILE, { force: true });
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    store = structuredClone(DEFAULT_STORE);
  }

  return store;
}

export async function updateStore(mutator) {
  const currentStore = await loadStore();
  const result = await mutator(currentStore);
  if (hasCreatedCustomer(currentStore)) {
    await persistStore();
  } else {
    store = structuredClone(DEFAULT_STORE);
    await rm(STORE_FILE, { force: true });
  }
  return result;
}

export async function resetStore() {
  store = structuredClone(DEFAULT_STORE);
  await rm(STORE_FILE, { force: true });
  return store;
}

export function getUser(currentStore, userId = "demo") {
  const user = currentStore.users[userId];
  if (!user) {
    throw new Error(`Unknown user: ${userId}`);
  }

  return user;
}

function hasCreatedCustomer(currentStore) {
  return Object.values(currentStore.users ?? {}).some((user) =>
    Boolean(user.metronomeCustomerId),
  );
}

async function persistStore() {
  await mkdir(DATA_DIR, { recursive: true });
  writeQueue = writeQueue.then(() =>
    writeFile(STORE_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8"),
  );

  return writeQueue;
}

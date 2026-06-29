// @ts-nocheck
import { randomUUID } from "node:crypto";
import Metronome from "@metronome/sdk";
import nodemailer from "nodemailer";
import Stripe from "stripe";
import { getUser, loadStore, resetStore, updateStore } from "./store";

const DEFAULT_CONSUME_TOKENS = Number(process.env.DEFAULT_CONSUME_TOKENS ?? 1);
const DEFAULT_COMMIT_ACCESS_DAYS = Number(
  process.env.METRONOME_COMMIT_ACCESS_DAYS ?? 365,
);
const DEFAULT_COMMIT_PRIORITY = Number(
  process.env.METRONOME_COMMIT_PRIORITY ?? 100,
);
const DEFAULT_LOW_BALANCE_REMINDER_THRESHOLD = Number(
  process.env.LOW_BALANCE_REMINDER_THRESHOLD ?? 2,
);
const MIN_AUTO_RECHARGE_TOP_UP_AMOUNT = Number(
  process.env.MIN_AUTO_RECHARGE_TOP_UP_AMOUNT ?? 10,
);

export function getDefaultConsumeTokens() {
  return DEFAULT_CONSUME_TOKENS;
}

export function getLowBalanceReminderThreshold(user = {}) {
  const autoRechargeThreshold = Number(user.autoRecharge?.threshold);
  if (
    user.autoRecharge?.enabled &&
    Number.isFinite(autoRechargeThreshold) &&
    autoRechargeThreshold > 0
  ) {
    return autoRechargeThreshold;
  }

  return DEFAULT_LOW_BALANCE_REMINDER_THRESHOLD;
}

export function getMinimumAutoRechargeTopUpAmount() {
  return MIN_AUTO_RECHARGE_TOP_UP_AMOUNT;
}

export async function sendTestEmail({ to }: any) {
  const email = String(to ?? "").trim();
  if (!email || !email.includes("@")) {
    throw new AppError("请输入有效目标邮箱", 400);
  }

  const sentAt = new Date().toISOString();
  const result = await sendEmail({
    to: email,
    subject: "Bill service demo 测试邮件",
    text: `这是一封测试邮件，用于验证 Bill service demo 的 SMTP 配置。\n\n发送时间：${sentAt}`,
    dryRunMessage: `[mail:dry-run] Test email to ${email} at ${sentAt}`,
  });

  return {
    ...result,
    email,
    sentAt,
  };
}

export async function deleteBillingCustomer({
  customerId,
  userId = "demo",
}: any = {}) {
  const store = await loadStore();
  const user = getUser(store, userId);
  const metronomeCustomerId = customerId ?? user.metronomeCustomerId;

  if (!metronomeCustomerId) {
    const reset = await resetStore();
    return { deleted: false, user: getUser(reset, userId) };
  }

  const result = await archiveMetronomeCustomer(metronomeCustomerId);

  const reset = await resetStore();

  return {
    deleted: true,
    archivedCustomerId: metronomeCustomerId,
    result,
    user: getUser(reset, userId),
  };
}

async function archiveMetronomeCustomer(customerId) {
  try {
    const metronome = getMetronomeClient();
    return await metronome.v1.customers.archive({
      id: customerId,
    });
  } catch (error) {
    if (
      error.status === 400 &&
      error.message.includes("Customer already archived")
    ) {
      return {
        alreadyArchived: true,
        message: error.message,
      };
    }

    throw error;
  }
}

export async function createBillingCustomer({ userId = "demo" }: any = {}) {
  const store = await loadStore();
  const user = getUser(store, userId);

  if (isConfiguredValue(user.metronomeCustomerId)) {
    return { created: false, user };
  }

  assertMetronomeContractConfig();
  const stripeCustomerId = await createStripeCustomerIfConfigured(userId);
  const payload = buildMetronomeCustomerPayload({ user, stripeCustomerId });
  console.log("createBillingCustomer", JSON.stringify(payload, null, 2));
  const customer = await createMetronomeCustomer(payload);
  const metronomeCustomerId = getCreatedMetronomeCustomerId(customer);
  const billingProviderConfigurationId = stripeCustomerId
    ? await ensureMetronomeStripeBillingConfiguration({
        metronomeCustomerId,
        stripeCustomerId,
      })
    : null;
  const contract = await createMetronomeContractForCustomer({
    customerId: metronomeCustomerId,
    billingProviderConfigurationId,
  });
  const metronomeContractId = getCreatedMetronomeContractId(contract);

  return updateStore(async (latestStore) => {
    const latestUser = getUser(latestStore, userId);
    latestUser.metronomeCustomerId = metronomeCustomerId;
    latestUser.metronomeContractId = metronomeContractId;
    latestUser.lastMetronomeCustomerCreatedAt = new Date().toISOString();
    latestUser.lastMetronomeContractCreatedAt =
      latestUser.lastMetronomeCustomerCreatedAt;
    if (stripeCustomerId) {
      latestUser.stripeCustomerId = stripeCustomerId;
      latestUser.metronomeBillingProviderConfigurationId =
        billingProviderConfigurationId;
      latestUser.lastMetronomeStripeBillingConfigAt =
        latestUser.lastMetronomeCustomerCreatedAt;
    }
    return { created: true, user: latestUser, metronomeCustomer: customer };
  });
}

export async function createCardSetupSession({ origin, userId = "demo" }: any) {
  const metronomeCustomerId = await getRequiredMetronomeCustomerId(userId);
  const customerQuery = `customer_id=${encodeURIComponent(metronomeCustomerId)}`;

  const stripe = getStripeClient();
  const customerId = await ensureStripeCustomer({ stripe, userId });
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    payment_method_types: ["card"],
    wallet_options: {
      link: {
        display: "never",
      },
    },
    success_url: `${origin}/api/billing/card/setup/success?session_id={CHECKOUT_SESSION_ID}&${customerQuery}`,
    cancel_url: `${origin}/api/billing/card/setup/cancel?${customerQuery}`,
    metadata: {
      user_id: userId,
    },
    setup_intent_data: {
      metadata: {
        user_id: userId,
      },
    },
  });

  if (!session.url) {
    throw new AppError("Stripe 未返回绑卡跳转地址", 502);
  }

  return {
    setupUrl: session.url,
    sessionId: session.id,
    metronomeCustomerId,
    stripeCustomerId: customerId,
  };
}

export async function completeCardSetup({ sessionId, userId = "demo" }: any) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new AppError("Stripe 绑卡回调缺少 session_id", 400);
  }

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["setup_intent"],
  });
  const customerId = getStripeCustomerIdFromValue(session.customer);
  const paymentMethodId = await getSetupSessionPaymentMethodId({
    stripe,
    session,
  });

  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });

  const store = await loadStore();
  const currentUser = getUser(store, userId);
  const billingProviderConfigurationId =
    await ensureMetronomeStripeBillingConfiguration({
      metronomeCustomerId: currentUser.metronomeCustomerId,
      stripeCustomerId: customerId,
    });

  return updateStore(async (store) => {
    const user = getUser(store, userId);
    user.stripeCustomerId = customerId;
    user.defaultStripePaymentMethodId = paymentMethodId;
    user.lastCardSetupAt = new Date().toISOString();
    if (billingProviderConfigurationId) {
      user.metronomeBillingProviderConfigurationId =
        billingProviderConfigurationId;
      user.lastMetronomeStripeBillingConfigAt = user.lastCardSetupAt;
    }
    return user;
  });
}

export async function getUserWithMetronomeBalance(userId = "demo") {
  const store = await loadStore();
  const user = getUser(store, userId);

  if (!getMetronomeBearerToken() || !user.metronomeCustomerId) {
    return user;
  }

  try {
    return await syncUserBalanceFromMetronome(userId);
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }

    return updateStore(async (latestStore) => {
      const latestUser = getUser(latestStore, userId);
      latestUser.lastMetronomeBalanceSyncError = error.message;
      latestUser.lastMetronomeBalanceSyncErrorAt = new Date().toISOString();
      return latestUser;
    });
  }
}

export async function createRechargeSession({ amount, userId = "demo" }: any) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError("充值金额必须大于 0", 400);
  }

  const cents = dollarsToCents(amount, "充值金额");
  if (cents < 50) {
    throw new AppError("最小充值金额为 0.50 美元", 400);
  }

  const customerId = await getRequiredMetronomeCustomerId(userId);
  const contractId = await ensureMetronomeContractForUser(userId);
  await assertStripeCustomerCanAutoCharge(userId);
  await assertContractHasStripeBillingProvider({
    contractId,
    customerId,
    userId,
  });
  const startedAt = new Date().toISOString();

  if (isMetronomePrepaidCommitConfigured()) {
    const payload = buildContractPrepaidCommitEditPayload({
      amount,
      amountCents: cents,
      contractId,
      customerId,
      userId,
    });

    const edit = await addMetronomeContractPrepaidCommit(payload);
    const commitId = getCreatedContractEditCommitId(edit);

    return {
      provider: "metronome-contract-add-commit-payment-gate",
      edit,
      commitId,
      editId: getContractEditId(edit),
      payload,
      startedAt,
    };
  }

  const result = await applyBalanceWebhook({
    eventId: `local-auto-charge:${randomUUID()}`,
    userId,
    balanceDelta: amount,
    totalAllowanceDelta: amount,
    kind: "metronome-local-auto-charge-sandbox",
    metadata: {
      customerId,
      amount,
    },
  });

  return {
    provider: "metronome-local-auto-charge-sandbox",
    simulatedWebhook: result,
    startedAt,
  };
}

export async function configureAutoRecharge({
  threshold,
  rechargeToAmount,
  userId = "demo",
}: any) {
  const thresholdCents = dollarsToCents(threshold, "触发阈值");
  const rechargeToCents = dollarsToCents(rechargeToAmount, "最低保留额度");

  if (rechargeToCents <= thresholdCents) {
    throw new AppError("最低保留额度必须大于触发阈值", 400);
  }

  const minimumTopUpCents = dollarsToCents(
    getMinimumAutoRechargeTopUpAmount(),
    "自动充值最低补差金额",
  );
  if (rechargeToCents - thresholdCents < minimumTopUpCents) {
    throw new AppError(
      `最低保留额度至少比触发阈值高 $${getMinimumAutoRechargeTopUpAmount().toFixed(2)}`,
      400,
    );
  }

  const customerId = await getRequiredMetronomeCustomerId(userId);
  const contractId = await ensureMetronomeContractForUser(userId);
  assertMetronomeCommitProductConfig();
  await assertStripeCustomerCanAutoCharge(userId);
  await assertContractHasStripeBillingProvider({
    contractId,
    customerId,
    userId,
  });

  const payload = await buildAutoRechargePayload({
    contractId,
    customerId,
    rechargeToCents,
    thresholdCents,
  });
  const result = await editMetronomeContract(
    payload,
    "Metronome auto recharge config failed",
  );

  return updateStore(async (store) => {
    const user = getUser(store, userId);
    user.autoRecharge = {
      enabled: true,
      threshold: centsToDollars(thresholdCents),
      rechargeToAmount: centsToDollars(rechargeToCents),
      configuredAt: new Date().toISOString(),
    };
    return { user, result, payload };
  });
}

export async function consumeTokens({
  userId = "demo",
  tokens = DEFAULT_CONSUME_TOKENS,
}: any) {
  const consumeTokenCount = Number(tokens);
  if (!Number.isInteger(consumeTokenCount) || consumeTokenCount <= 0) {
    throw new AppError("消耗 Token 数必须大于 0", 400);
  }

  if (getMetronomeBearerToken()) {
    await syncUserBalanceFromMetronome(userId);
  }

  const result = await updateStore(async (store) => {
    const user = getUser(store, userId);
    if (user.balance <= 0) {
      throw new AppError("可消费额度不足，请先充值", 409);
    }

    const usageEvent = await sendMetronomeUsageEvent(user, consumeTokenCount);

    return {
      user,
      consumedTokens: consumeTokenCount,
      usageEvent,
    };
  });

  if (result.usageEvent.dryRun) {
    return result;
  }

  const user = await syncUserBalanceFromMetronome(userId);
  return {
    ...result,
    user,
    lowBalanceReminderSent: user.lowBalanceReminderSent,
  };
}

export async function applyMetronomeWebhook(payload) {
  if (!payload || typeof payload !== "object") {
    throw new AppError("Metronome Webhook payload 无效", 400);
  }

  if (payload.type === "commit.create") {
    return applyMetronomeCommitCreatedWebhook(payload);
  }

  if (["credit.created", "invoice.paid"].includes(payload.type)) {
    return applyMetronomeBalanceSyncWebhook(payload);
  }

  if (payload.type === "payment_gate.payment_status") {
    return applyMetronomePaymentGateStatusWebhook(payload);
  }

  if ("balanceDelta" in payload) {
    return applyBalanceWebhook({
      eventId: payload.eventId,
      userId: payload.userId ?? "demo",
      balanceDelta: payload.balanceDelta,
      totalAllowanceDelta: payload.totalAllowanceDelta ?? 0,
      kind: "metronome-webhook",
      metadata: payload.metadata ?? {},
    });
  }

  return {
    ignored: true,
    eventId: payload.id,
    type: payload.type,
    reason: "unsupported_metronome_webhook_type",
  };
}

export async function applyBalanceWebhook({
  eventId,
  userId = "demo",
  balanceDelta,
  totalAllowanceDelta = 0,
  kind = "webhook",
  metadata = {},
}: any) {
  if (!eventId) {
    throw new AppError("Webhook eventId 不能为空", 400);
  }

  const delta = Number(balanceDelta);
  const allowanceDelta = Number(totalAllowanceDelta);
  if (!Number.isFinite(delta) || !Number.isFinite(allowanceDelta)) {
    throw new AppError("余额变更数值无效", 400);
  }

  return updateStore(async (store) => {
    if (store.processedEvents.includes(eventId)) {
      return { duplicate: true, user: getUser(store, userId) };
    }

    const user = getUser(store, userId);
    user.balance = Math.max(0, user.balance + delta);

    if (allowanceDelta > 0) {
      user.totalAllowance += allowanceDelta;
      user.lowBalanceReminderSent = false;
      user.lastRechargeAt = new Date().toISOString();
    }

    store.processedEvents.push(eventId);
    await maybeSendLowBalanceReminder(store, user, kind);

    return { duplicate: false, user };
  });
}

export async function syncUserBalanceFromMetronome(userId = "demo") {
  const store = await loadStore();
  const currentUser = getUser(store, userId);
  const snapshot = await fetchMetronomeBalanceSnapshot(
    currentUser.metronomeCustomerId,
  );

  return updateStore(async (latestStore) => {
    const user = getUser(latestStore, userId);
    const allowanceIncreased = snapshot.totalAllowance > user.totalAllowance;

    user.balance = snapshot.balance;
    user.totalAllowance = snapshot.totalAllowance;
    user.lastMetronomeBalanceSyncAt = snapshot.syncedAt;

    if (allowanceIncreased) {
      user.lowBalanceReminderSent = false;
      user.lastRechargeAt = snapshot.syncedAt;
    }

    await maybeSendLowBalanceReminder(latestStore, user, "metronome-sync");

    return user;
  });
}

export async function getMetronomeBillingDiagnostics(userId = "demo") {
  const store = await loadStore();
  const user = getUser(store, userId);
  const bearerToken = getMetronomeBearerToken();

  if (!bearerToken) {
    return {
      configured: false,
      reason: "missing_metronome_bearer_token",
      user: summarizeUserForDiagnostics(user),
    };
  }

  const metronome = getMetronomeClient();
  const customerId = user.metronomeCustomerId;
  const coveringDate = new Date().toISOString();

  if (!customerId) {
    return {
      configured: false,
      reason: "missing_metronome_customer_id",
      user: summarizeUserForDiagnostics(user),
    };
  }

  try {
    const [billingProviders, invoices, commits, credits] = await Promise.all([
      metronome.v1.settings.billingProviders.list(),
      listFirst(
        metronome.v1.customers.invoices.list({
          customer_id: customerId,
          sort: "date_desc",
        }),
        10,
      ),
      listFirst(
        metronome.v1.customers.commits.list({
          customer_id: customerId,
          covering_date: coveringDate,
          include_balance: true,
          include_contract_commits: true,
        }),
        10,
      ),
      listFirst(
        metronome.v1.customers.credits.list({
          customer_id: customerId,
          covering_date: coveringDate,
          include_balance: true,
          include_contract_credits: true,
        }),
        10,
      ),
    ]);

    return {
      configured: true,
      checkedAt: new Date().toISOString(),
      user: summarizeUserForDiagnostics(user),
      billingProviders: billingProviders.data.map(summarizeBillingProvider),
      invoices: invoices.map(summarizeInvoice),
      commits: commits.map(summarizeCommitOrCredit),
      credits: credits.map(summarizeCommitOrCredit),
      hints: buildPaymentFlowHints({
        billingProviders: billingProviders.data,
        invoices,
      }),
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(`Metronome diagnostics failed: ${error.message}`, 502);
  }
}

const EMBEDDABLE_DASHBOARD_TYPES = new Set([
  "invoices",
  "usage",
  "commits_and_credits",
]);

export async function getEmbeddableDashboardUrl({
  customerId,
  dashboard = "commits_and_credits",
  userId = "demo",
}: {
  customerId?: string;
  dashboard?: string;
  userId?: string;
} = {}) {
  if (!EMBEDDABLE_DASHBOARD_TYPES.has(dashboard)) {
    throw new AppError("无效的 dashboard 类型", 400);
  }

  const metronomeCustomerId =
    customerId ?? (await getRequiredMetronomeCustomerId(userId));
  const metronome = getMetronomeClient();
  const response = await metronome.v1.dashboards.getEmbeddableURL({
    customer_id: metronomeCustomerId,
    dashboard,
  });
  const url = response?.data?.url;

  if (!url) {
    throw new AppError("Metronome 未返回 embeddable dashboard URL", 502);
  }

  return {
    url,
    dashboard,
    customerId: metronomeCustomerId,
  };
}

function getCreatedContractEditCommitId(response) {
  const commitId =
    response?.data?.edit?.add_commits?.[0]?.id ??
    response?.data?.add_commits?.[0]?.id ??
    response?.edit?.add_commits?.[0]?.id ??
    response?.add_commits?.[0]?.id;

  return commitId ?? null;
}

function getContractEditId(response) {
  return (
    response?.data?.edit?.id ??
    response?.data?.id ??
    response?.edit?.id ??
    response?.id ??
    null
  );
}

async function applyMetronomeCommitCreatedWebhook(payload) {
  if (!payload.id || !payload.commit_id || !payload.customer_id) {
    throw new AppError(
      "commit.create Webhook 缺少 id、commit_id 或 customer_id",
      400,
    );
  }

  const commit = await fetchMetronomeCommit({
    customerId: payload.customer_id,
    commitId: payload.commit_id,
  });

  if (commit.type !== "PREPAID") {
    return {
      ignored: true,
      eventId: payload.id,
      type: payload.type,
      reason: "commit_is_not_prepaid",
    };
  }

  await markEventProcessed(payload.id, payload.customer_id);

  return {
    ignored: true,
    eventId: payload.id,
    type: payload.type,
    commitId: payload.commit_id,
    reason: "prepaid_commit_created_before_invoice_paid",
  };
}

async function applyMetronomePaymentGateStatusWebhook(payload) {
  if (!payload.id) {
    throw new AppError("payment_gate.payment_status Webhook 缺少 id", 400);
  }

  const properties = payload.properties ?? {};
  const paymentStatus = String(properties.payment_status ?? "").toLowerCase();

  if (paymentStatus !== "paid") {
    return {
      ignored: true,
      eventId: payload.id,
      type: payload.type,
      paymentStatus,
      reason: "payment_status_is_not_paid",
    };
  }

  const customerId =
    properties.customer_id ?? payload.customer_id ?? payload.customer?.id;
  if (!customerId) {
    return {
      ignored: true,
      eventId: payload.id,
      type: payload.type,
      reason: "missing_customer_id",
    };
  }

  const result = await applyMetronomeBalanceSyncWebhook({
    id: payload.id,
    type: payload.type,
    customer_id: customerId,
  });

  return {
    ...result,
    invoiceId: properties.invoice_id ?? payload.invoice_id,
    paymentStatus,
  };
}

async function applyMetronomeBalanceSyncWebhook(payload) {
  if (!payload.id) {
    throw new AppError(`${payload.type} Webhook 缺少 id`, 400);
  }

  const customerId = payload.customer_id ?? payload.customer?.id;
  if (!customerId) {
    return {
      ignored: true,
      eventId: payload.id,
      type: payload.type,
      reason: "missing_customer_id",
    };
  }

  const userId = await getUserIdByMetronomeCustomerId(customerId);
  const store = await loadStore();
  if (store.processedEvents.includes(payload.id)) {
    return { duplicate: true, user: getUser(store, userId) };
  }

  const user = getMetronomeBearerToken()
    ? await syncUserBalanceFromMetronome(userId)
    : getUser(store, userId);

  await updateStore(async (latestStore) => {
    if (!latestStore.processedEvents.includes(payload.id)) {
      latestStore.processedEvents.push(payload.id);
    }

    return latestStore;
  });

  return {
    duplicate: false,
    synced: Boolean(getMetronomeBearerToken()),
    eventId: payload.id,
    type: payload.type,
    user,
  };
}

async function markEventProcessed(eventId, customerId) {
  const userId = await getUserIdByMetronomeCustomerId(customerId);

  return updateStore(async (store) => {
    if (!store.processedEvents.includes(eventId)) {
      store.processedEvents.push(eventId);
    }

    return { duplicate: false, user: getUser(store, userId) };
  });
}

async function maybeSendLowBalanceReminder(store, user, reason) {
  if (user.totalAllowance <= 0 || user.lowBalanceReminderSent) {
    return;
  }

  const threshold = getLowBalanceReminderThreshold(user);
  if (user.balance > threshold) {
    return;
  }

  const notification = {
    id: `low-balance-${Date.now()}`,
    userId: user.id,
    email: user.email,
    balance: user.balance,
    totalAllowance: user.totalAllowance,
    threshold,
    reason,
    createdAt: new Date().toISOString(),
  };

  store.notifications.push(notification);
  user.lowBalanceReminderSent = true;
  try {
    await sendLowBalanceEmail(notification);
  } catch (error) {
    console.error("[mail:error] Low balance reminder failed:", error);
  }
}

async function sendLowBalanceEmail(notification) {
  await sendEmail({
    to: notification.email,
    subject: "预付费额度不足提醒",
    text: `你的可消费额度为 $${notification.balance}，已低于提醒额度 $${notification.threshold}，请及时充值。`,
    dryRunMessage: `[mail:dry-run] Low balance reminder to ${notification.email}: $${notification.balance}/$${notification.totalAllowance}`,
  });
}

async function sendEmail({ to, subject, text, dryRunMessage }: any) {
  const smtpConfig = getSmtpTransportConfig();
  if (!smtpConfig) {
    console.log(dryRunMessage);
    return { dryRun: true };
  }

  const transport = nodemailer.createTransport(smtpConfig.transport);
  await transport.sendMail({
    from: smtpConfig.from,
    to,
    subject,
    text,
  });

  return { dryRun: false };
}

function getSmtpTransportConfig() {
  const {
    SMTP_HOST,
    SMTP_PORT = "465",
    SMTP_SECURE = "true",
    SMTP_USER,
    SMTP_PASS,
    SMTP_URL,
  } = process.env;

  if (SMTP_HOST || SMTP_USER || SMTP_PASS) {
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      return null;
    }

    const port = Number(SMTP_PORT);
    if (!Number.isInteger(port) || port <= 0) {
      throw new AppError("SMTP_PORT 必须是有效端口号", 400);
    }

    return {
      from: process.env.MAIL_FROM ?? `"Token Center" <${SMTP_USER}>`,
      transport: {
        host: SMTP_HOST,
        port,
        secure: SMTP_SECURE === "true",
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      },
    };
  }

  if (!SMTP_URL) {
    return null;
  }

  const url = new URL(SMTP_URL);
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  const port = Number(url.port || (url.protocol === "smtps:" ? 465 : 587));
  if (!url.hostname || !user || !pass || !Number.isInteger(port) || port <= 0) {
    throw new AppError(
      "SMTP_URL 无效，请改用 SMTP_HOST/SMTP_USER/SMTP_PASS 显式配置",
      400,
    );
  }

  return {
    from: process.env.MAIL_FROM ?? `"Token Center" <${user}>`,
    transport: {
      host: url.hostname,
      port,
      secure: url.protocol === "smtps:",
      auth: {
        user,
        pass,
      },
    },
  };
}

async function sendMetronomeUsageEvent(user, tokens) {
  if (!user.metronomeCustomerId) {
    throw new AppError("用户尚未创建 Metronome Customer，无法上报 usage", 400);
  }

  const transactionId = randomUUID();
  const event = {
    transaction_id: transactionId,
    timestamp: new Date().toISOString(),
    event_type: "token_usage",
    properties: {
      tokens,
    },
    customer_id: user.metronomeCustomerId,
  };

  const bearerToken = getMetronomeBearerToken();
  if (!bearerToken) {
    console.log(`[metronome:dry-run] ${JSON.stringify(event)}`);
    return { sent: false, dryRun: true, event };
  }

  try {
    const metronome = new Metronome({
      bearerToken,
    });

    const result = await metronome.v1.usage.ingest({
      usage: [event],
    });

    return { sent: true, dryRun: false, event, result };
  } catch (error) {
    throw new AppError(`Metronome usage event failed: ${error.message}`, 502);
  }
}

async function fetchMetronomeCommit({ customerId, commitId }: any) {
  try {
    const metronome = getMetronomeClient();

    for await (const commit of metronome.v1.customers.commits.list({
      customer_id: customerId,
      commit_id: commitId,
    })) {
      return commit;
    }
  } catch (error) {
    throw new AppError(`Metronome commit lookup failed: ${error.message}`, 502);
  }

  throw new AppError(`Metronome commit not found: ${commitId}`, 404);
}

async function fetchMetronomeBalanceSnapshot(customerId) {
  if (!customerId) {
    throw new AppError(
      "用户缺少 metronomeCustomerId，无法同步 Metronome 余额",
      400,
    );
  }

  const metronome = getMetronomeClient();
  const coveringDate = new Date().toISOString();

  try {
    const [commits, credits, invoices] = await Promise.all([
      listAll(
        metronome.v1.customers.commits.list({
          customer_id: customerId,
          covering_date: coveringDate,
          include_balance: true,
          include_contract_commits: true,
        }),
      ),
      listAll(
        metronome.v1.customers.credits.list({
          customer_id: customerId,
          covering_date: coveringDate,
          include_balance: true,
          include_contract_credits: true,
        }),
      ),
      listFirst(
        metronome.v1.customers.invoices.list({
          customer_id: customerId,
          sort: "date_desc",
        }),
        50,
      ),
    ]);

    const prepaidCommits = commits.filter(
      (commit) => commit.type === "PREPAID",
    );
    const paidCommitIds = getPaidCommitIds(invoices);
    const paidPrepaidCommits = prepaidCommits.filter((commit) =>
      paidCommitIds.has(commit.id),
    );
    const balanceCents =
      sumMetronomeBalances(paidPrepaidCommits) + sumMetronomeBalances(credits);
    const totalAllowanceCents =
      sumAccessScheduleAmounts(paidPrepaidCommits) +
      sumAccessScheduleAmounts(credits);

    return {
      balance: centsToDollars(balanceCents),
      totalAllowance: centsToDollars(totalAllowanceCents),
      syncedAt: new Date().toISOString(),
      source: "metronome",
      commitCount: paidPrepaidCommits.length,
      pendingCommitCount: prepaidCommits.length - paidPrepaidCommits.length,
      creditCount: credits.length,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(`Metronome balance sync failed: ${error.message}`, 502);
  }
}

function getPaidCommitIds(invoices) {
  const paidCommitIds = new Set();

  for (const invoice of invoices) {
    if (!isInvoicePaid(invoice)) {
      continue;
    }

    for (const lineItem of invoice.line_items ?? []) {
      if (lineItem.type === "commit_purchase" && lineItem.commit_id) {
        paidCommitIds.add(lineItem.commit_id);
      }
    }
  }

  return paidCommitIds;
}

function isInvoicePaid(invoice) {
  return [
    invoice.status,
    invoice.billable_status,
    invoice.external_invoice?.external_status,
  ].some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes("paid"),
  );
}

function getCommitAccessAmountDollars(commit) {
  const amountCents = commit.access_schedule?.schedule_items?.reduce(
    (total, item) => total + Number(item.amount ?? 0),
    0,
  );

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new AppError(`Metronome commit amount invalid: ${commit.id}`, 400);
  }

  return amountCents / 100;
}

async function listAll(page) {
  const items = [];
  for await (const item of page) {
    items.push(item);
  }

  return items;
}

async function listFirst(page, limit) {
  const items = [];
  for await (const item of page) {
    items.push(item);
    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

function summarizeUserForDiagnostics(user) {
  return {
    id: user.id,
    email: user.email,
    metronomeCustomerId: user.metronomeCustomerId,
    metronomeContractId: user.metronomeContractId,
    metronomeBillingProviderConfigurationId:
      user.metronomeBillingProviderConfigurationId,
    cachedBalance: user.balance,
    cachedTotalAllowance: user.totalAllowance,
    lastRechargeAt: user.lastRechargeAt,
    lastMetronomeBalanceSyncAt: user.lastMetronomeBalanceSyncAt,
  };
}

function summarizeBillingProvider(provider) {
  return {
    billingProvider: provider.billing_provider,
    deliveryMethod: provider.delivery_method,
    deliveryMethodId: provider.delivery_method_id,
    configurationKeys: Object.keys(
      provider.delivery_method_configuration ?? {},
    ),
  };
}

function summarizeInvoice(invoice) {
  return {
    id: invoice.id,
    status: invoice.status,
    type: invoice.type,
    contractId: invoice.contract_id,
    issuedAt: invoice.issued_at,
    startTimestamp: invoice.start_timestamp,
    endTimestamp: invoice.end_timestamp,
    total: centsToDollars(invoice.total),
    subtotal:
      invoice.subtotal === undefined
        ? undefined
        : centsToDollars(invoice.subtotal),
    billableStatus: invoice.billable_status,
    externalInvoice: invoice.external_invoice,
    lineItems: invoice.line_items?.map((lineItem) => ({
      name: lineItem.name,
      type: lineItem.type,
      total: centsToDollars(lineItem.total),
      commitId: lineItem.commit_id,
      commitType: lineItem.commit_type,
    })),
  };
}

function summarizeCommitOrCredit(item) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    balance:
      item.balance === undefined ? undefined : centsToDollars(item.balance),
    accessAmount: centsToDollars(
      item.access_schedule?.schedule_items?.reduce(
        (total, scheduleItem) => total + Number(scheduleItem.amount ?? 0),
        0,
      ) ?? 0,
    ),
    priority: item.priority,
    contractId: item.contract?.id,
    product: item.product,
  };
}

function buildPaymentFlowHints({ billingProviders, invoices }: any) {
  const hasStripeProvider = billingProviders.some(
    (provider) => provider.billing_provider === "stripe",
  );
  const invoicesWithExternalProvider = invoices.filter(
    (invoice) => invoice.external_invoice,
  );
  const commitPurchaseInvoices = invoices.filter((invoice) =>
    invoice.line_items?.some((lineItem) => lineItem.type === "commit_purchase"),
  );
  const paidInvoices = invoices.filter((invoice) =>
    String(invoice.billable_status ?? invoice.status)
      .toLowerCase()
      .includes("paid"),
  );

  return {
    hasStripeBillingProvider: hasStripeProvider,
    hasExternalInvoiceRecords: invoicesWithExternalProvider.length > 0,
    recentCommitPurchaseInvoiceCount: commitPurchaseInvoices.length,
    recentPaidInvoiceCount: paidInvoices.length,
    likelyMode: inferPaymentMode({
      hasStripeProvider,
      invoicesWithExternalProvider,
      commitPurchaseInvoices,
      paidInvoices,
    }),
  };
}

function inferPaymentMode({
  hasStripeProvider,
  invoicesWithExternalProvider,
  commitPurchaseInvoices,
  paidInvoices,
}: any) {
  if (!hasStripeProvider) {
    return "no_stripe_billing_provider_detected";
  }

  if (paidInvoices.length > 0) {
    return "stripe_or_external_provider_payment_completed";
  }

  if (invoicesWithExternalProvider.length > 0) {
    return "invoice_delivered_to_external_billing_provider";
  }

  if (commitPurchaseInvoices.length > 0) {
    return "metronome_invoice_created_without_external_provider_status";
  }

  return "no_recent_commit_purchase_invoice_detected";
}

function sumMetronomeBalances(items) {
  return items.reduce((total, item) => total + Number(item.balance ?? 0), 0);
}

function sumAccessScheduleAmounts(items) {
  return items.reduce((total, item) => {
    const amount = item.access_schedule?.schedule_items?.reduce(
      (scheduleTotal, scheduleItem) =>
        scheduleTotal + Number(scheduleItem.amount ?? 0),
      0,
    );

    return total + Number(amount ?? 0);
  }, 0);
}

function centsToDollars(amountCents) {
  if (!Number.isFinite(amountCents)) {
    throw new AppError("Metronome 余额数值无效", 502);
  }

  return amountCents / 100;
}

function dollarsToCents(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(`${label}必须大于 0`, 400);
  }

  return Math.round(amount * 100);
}

async function getUserIdByMetronomeCustomerId(customerId) {
  const store = await loadStore();
  const user = Object.values(store.users).find(
    (candidate) => candidate.metronomeCustomerId === customerId,
  );

  if (!user) {
    throw new AppError(`Unknown Metronome customer: ${customerId}`, 400);
  }

  return user.id;
}

async function getRequiredMetronomeCustomerId(userId) {
  const store = await loadStore();
  const user = getUser(store, userId);

  if (!isConfiguredValue(user.metronomeCustomerId)) {
    throw new AppError(
      "用户尚未创建 Metronome Customer，请先创建 Customer",
      400,
    );
  }

  return user.metronomeCustomerId;
}

async function createStripeCustomerIfConfigured(userId) {
  if (!isConfiguredValue(process.env.STRIPE_SECRET_KEY)) {
    return null;
  }

  const store = await loadStore();
  const user = getUser(store, userId);
  if (isConfiguredValue(user.stripeCustomerId)) {
    return user.stripeCustomerId;
  }

  const payload = {
    email: user.email,
    metadata: {
      user_id: user.id,
      metronome_customer_id: user.metronomeCustomerId ?? "",
    },
  };
  console.log("payload", payload);

  const stripe = getStripeClient();
  const customer = await stripe.customers.create(payload);

  console.log("createStripeCustomerIfConfigured", customer);

  return customer.id;
}

async function ensureMetronomeContractForUser(userId) {
  const store = await loadStore();
  const user = getUser(store, userId);

  if (
    isConfiguredValue(user.metronomeContractId) &&
    (!isConfiguredValue(user.stripeCustomerId) ||
      isConfiguredValue(user.metronomeBillingProviderConfigurationId))
  ) {
    return user.metronomeContractId;
  }

  const customerId = await getRequiredMetronomeCustomerId(userId);
  assertMetronomeContractConfig();
  const billingProviderConfigurationId = user.stripeCustomerId
    ? await ensureMetronomeStripeBillingConfiguration({
        metronomeCustomerId: customerId,
        stripeCustomerId: user.stripeCustomerId,
      })
    : null;
  const contract = await createMetronomeContractForCustomer({
    customerId,
    billingProviderConfigurationId,
  });
  const contractId = getCreatedMetronomeContractId(contract);

  await updateStore(async (latestStore) => {
    const latestUser = getUser(latestStore, userId);
    latestUser.metronomeContractId = contractId;
    latestUser.lastMetronomeContractCreatedAt = new Date().toISOString();
    if (billingProviderConfigurationId) {
      latestUser.metronomeBillingProviderConfigurationId =
        billingProviderConfigurationId;
      latestUser.lastMetronomeStripeBillingConfigAt =
        latestUser.lastMetronomeContractCreatedAt;
    }
    return latestStore;
  });

  return contractId;
}

async function assertStripeCustomerCanAutoCharge(userId) {
  if (!isConfiguredValue(process.env.STRIPE_SECRET_KEY)) {
    return;
  }

  const store = await loadStore();
  const user = getUser(store, userId);
  if (!isConfiguredValue(user.stripeCustomerId)) {
    throw new AppError("用户尚未绑定 Stripe Customer，无法自动扣款", 400);
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.retrieve(user.stripeCustomerId);
  if (customer.deleted) {
    throw new AppError("Stripe Customer 已删除，无法自动扣款", 400);
  }

  const defaultPaymentMethod =
    getDefaultPaymentMethodIdFromStripeCustomer(customer);

  if (!defaultPaymentMethod) {
    throw new AppError("Stripe Customer 缺少默认付款方式，请先重新绑卡", 400);
  }

  await updateStore(async (latestStore) => {
    const latestUser = getUser(latestStore, userId);
    latestUser.defaultStripePaymentMethodId = defaultPaymentMethod;
    return latestStore;
  });
}

async function assertContractHasStripeBillingProvider({
  contractId,
  customerId,
  userId,
}: any) {
  const store = await loadStore();
  const user = getUser(store, userId);
  const metronome = getMetronomeClient();
  const contract = await metronome.v2.contracts.retrieve({
    contract_id: contractId,
    customer_id: customerId,
  });
  const billingConfiguration =
    getContractBillingProviderConfiguration(contract);

  if (
    billingConfiguration?.billing_provider !== "stripe" ||
    billingConfiguration?.delivery_method !== "direct_to_billing_provider"
  ) {
    throw new AppError(
      "Metronome contract 未绑定 Stripe direct_to_billing_provider billing configuration",
      400,
    );
  }

  if (
    user.metronomeBillingProviderConfigurationId &&
    billingConfiguration.id &&
    user.metronomeBillingProviderConfigurationId !== billingConfiguration.id
  ) {
    throw new AppError(
      "Metronome contract 绑定的 billing configuration 与本地记录不一致",
      400,
    );
  }
}

function getContractBillingProviderConfiguration(contract) {
  return (
    contract?.data?.customer_billing_provider_configuration ??
    contract?.data?.current?.customer_billing_provider_configuration ??
    contract?.customer_billing_provider_configuration ??
    contract?.current?.customer_billing_provider_configuration
  );
}

async function buildAutoRechargePayload({
  contractId,
  customerId,
  rechargeToCents,
  thresholdCents,
}: any) {
  const metronome = getMetronomeClient();
  const contract = await metronome.v2.contracts.retrieve({
    contract_id: contractId,
    customer_id: customerId,
  });
  const configuration = buildPrepaidBalanceThresholdConfiguration({
    rechargeToCents,
    thresholdCents,
  });
  const existingConfiguration =
    getContractPrepaidBalanceThresholdConfiguration(contract);
  const payload = {
    contract_id: contractId,
    customer_id: customerId,
    uniqueness_key: `auto-recharge-${randomUUID()}`,
  };

  if (existingConfiguration) {
    payload.update_prepaid_balance_threshold_configuration = configuration;
  } else {
    payload.add_prepaid_balance_threshold_configuration = configuration;
  }

  return payload;
}

function buildPrepaidBalanceThresholdConfiguration({
  rechargeToCents,
  thresholdCents,
}: any) {
  const configuration = {
    commit: {
      product_id: process.env.METRONOME_COMMIT_PRODUCT_ID,
      name: "Automatic prepaid recharge",
      description: "Automatic recharge created by bill-service-demo",
      priority: DEFAULT_COMMIT_PRIORITY,
    },
    is_enabled: true,
    payment_gate_config: {
      payment_gate_type: "STRIPE",
      stripe_config: {
        payment_type: "INVOICE",
        invoice_metadata: {
          source: "bill-service-demo-auto-recharge",
        },
      },
      tax_type: "NONE",
    },
    recharge_to_amount: rechargeToCents,
    threshold_amount: thresholdCents,
  };

  if (isConfiguredValue(process.env.METRONOME_CREDIT_TYPE_ID)) {
    configuration.custom_credit_type_id = process.env.METRONOME_CREDIT_TYPE_ID;
  }

  return configuration;
}

function getContractPrepaidBalanceThresholdConfiguration(contract) {
  return (
    contract?.data?.prepaid_balance_threshold_configuration ??
    contract?.data?.current?.prepaid_balance_threshold_configuration ??
    contract?.prepaid_balance_threshold_configuration ??
    contract?.current?.prepaid_balance_threshold_configuration
  );
}

async function ensureStripeCustomer({ stripe, userId }: any) {
  const store = await loadStore();
  const user = getUser(store, userId);

  if (isConfiguredValue(user.stripeCustomerId)) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    metadata: {
      user_id: user.id,
      metronome_customer_id: user.metronomeCustomerId ?? "",
    },
  });

  await updateStore(async (latestStore) => {
    getUser(latestStore, userId).stripeCustomerId = customer.id;
    return latestStore;
  });

  return customer.id;
}

function buildMetronomeCustomerPayload({ user, stripeCustomerId }: any) {
  const payload = {
    name: user.email,
  };

  if (isConfiguredValue(stripeCustomerId)) {
    payload.customer_billing_provider_configurations = [
      {
        billing_provider: "stripe",
        delivery_method: "direct_to_billing_provider",
        configuration: {
          stripe_customer_id: stripeCustomerId,
          stripe_collection_method: "charge_automatically",
        },
      },
    ];
  }

  return payload;
}

async function createMetronomeCustomer(payload) {
  try {
    const metronome = getMetronomeClient();
    return await metronome.v1.customers.create(payload);
  } catch (error) {
    throw new AppError(
      `Metronome customer creation failed: ${error.message}`,
      error.status ?? 502,
    );
  }
}

function getCreatedMetronomeCustomerId(response) {
  const customerId =
    response?.data?.customer_id ??
    response?.customer_id ??
    response?.data?.id ??
    response?.id;

  if (!customerId) {
    throw new AppError("Metronome 未返回 customer id", 502);
  }

  return customerId;
}

async function createMetronomeContractForCustomer({
  customerId,
  billingProviderConfigurationId,
}: any) {
  const payload = buildMetronomeContractPayload({
    customerId,
    billingProviderConfigurationId,
  });

  try {
    const metronome = getMetronomeClient();
    return await metronome.v1.contracts.create(payload);
  } catch (error) {
    throw new AppError(
      `Metronome contract creation failed: ${error.message}`,
      502,
    );
  }
}

function buildMetronomeContractPayload({
  customerId,
  billingProviderConfigurationId,
}: any) {
  assertMetronomeContractConfig();
  const payload = {
    customer_id: customerId,
    starting_at: getCurrentUtcHourBoundary().toISOString(),
  };
  const rateCardId = process.env.METRONOME_RATE_CARD_ID;

  if (isConfiguredValue(rateCardId)) {
    payload.rate_card_id = rateCardId;
  } else {
    throw new AppError(
      "缺少 METRONOME_RATE_CARD_ID，无法为新 Customer 创建 contract",
      400,
    );
  }

  if (billingProviderConfigurationId) {
    payload.billing_provider_configuration = {
      billing_provider_configuration_id: billingProviderConfigurationId,
    };
  }

  return payload;
}

function assertMetronomeContractConfig() {
  if (!isConfiguredValue(process.env.METRONOME_RATE_CARD_ID)) {
    throw new AppError(
      "缺少 METRONOME_RATE_CARD_ID，无法为 Customer 创建 contract",
      400,
    );
  }
}

function getCreatedMetronomeContractId(response) {
  const contractId =
    response?.data?.id ??
    response?.data?.contract_id ??
    response?.id ??
    response?.contract_id;

  if (!contractId) {
    throw new AppError("Metronome 未返回 contract id", 502);
  }

  return contractId;
}

async function ensureMetronomeStripeBillingConfiguration({
  metronomeCustomerId,
  stripeCustomerId,
}: any) {
  if (!getMetronomeBearerToken()) {
    return null;
  }

  if (!metronomeCustomerId) {
    throw new AppError(
      "用户缺少 metronomeCustomerId，无法关联 Stripe Customer",
      400,
    );
  }

  if (!stripeCustomerId) {
    throw new AppError(
      "用户缺少 stripeCustomerId，无法配置 Metronome 自动扣款",
      400,
    );
  }

  try {
    const metronome = getMetronomeClient();
    const existingConfiguration = await findStripeBillingConfiguration({
      metronome,
      metronomeCustomerId,
      stripeCustomerId,
    });

    if (existingConfiguration?.id) {
      return existingConfiguration.id;
    }

    const response = await metronome.v1.customers.setBillingConfigurations({
      data: [
        {
          customer_id: metronomeCustomerId,
          billing_provider: "stripe",
          delivery_method: "direct_to_billing_provider",
          configuration: {
            stripe_customer_id: stripeCustomerId,
            stripe_collection_method: "charge_automatically",
          },
        },
      ],
    });
    const createdConfigurationId = response?.data?.[0]?.id;

    if (createdConfigurationId) {
      return createdConfigurationId;
    }

    const createdConfiguration = await findStripeBillingConfiguration({
      metronome,
      metronomeCustomerId,
      stripeCustomerId,
    });

    if (!createdConfiguration?.id) {
      throw new Error(
        "Metronome did not return a Stripe billing provider configuration id",
      );
    }

    return createdConfiguration.id;
  } catch (error) {
    throw new AppError(
      `Metronome Stripe billing config failed: ${error.message}`,
      502,
    );
  }
}

async function findStripeBillingConfiguration({
  metronome,
  metronomeCustomerId,
  stripeCustomerId,
}: any) {
  const response = await metronome.v1.customers.retrieveBillingConfigurations({
    customer_id: metronomeCustomerId,
  });

  return response.data?.find((configuration) => {
    if (configuration.archived_at) {
      return false;
    }

    return (
      configuration.billing_provider === "stripe" &&
      configuration.delivery_method === "direct_to_billing_provider" &&
      configuration.configuration?.stripe_customer_id === stripeCustomerId &&
      configuration.configuration?.stripe_collection_method ===
        "charge_automatically"
    );
  });
}

function isMetronomePrepaidCommitConfigured() {
  return Boolean(
    getMetronomeBearerToken() &&
    isConfiguredValue(process.env.METRONOME_COMMIT_PRODUCT_ID),
  );
}

function assertMetronomeCommitProductConfig() {
  if (!isConfiguredValue(process.env.METRONOME_COMMIT_PRODUCT_ID)) {
    throw new AppError(
      "尚未配置 METRONOME_COMMIT_PRODUCT_ID，无法创建 prepaid commit",
      400,
    );
  }
}

function buildContractPrepaidCommitEditPayload({
  amount,
  amountCents,
  contractId,
  customerId,
  userId,
}: any) {
  const startingAt = getCurrentUtcHourBoundary();
  const endingBefore = new Date(startingAt);
  endingBefore.setUTCDate(
    endingBefore.getUTCDate() + DEFAULT_COMMIT_ACCESS_DAYS,
  );
  const rechargeRequestId = `recharge-${randomUUID()}`;

  const accessSchedule = {
    schedule_items: [
      {
        amount: amountCents,
        starting_at: startingAt.toISOString(),
        ending_before: endingBefore.toISOString(),
      },
    ],
  };
  const invoiceSchedule = {
    do_not_invoice: false,
    schedule_items: [
      {
        amount: amountCents,
        timestamp: startingAt.toISOString(),
      },
    ],
  };

  if (isConfiguredValue(process.env.METRONOME_CREDIT_TYPE_ID)) {
    accessSchedule.credit_type_id = process.env.METRONOME_CREDIT_TYPE_ID;
    invoiceSchedule.credit_type_id = process.env.METRONOME_CREDIT_TYPE_ID;
  }

  const commit = {
    access_schedule: accessSchedule,
    description: `Created by bill-service-demo for user ${userId}; amount_usd=${amount.toFixed(2)}`,
    invoice_schedule: invoiceSchedule,
    name: `Prepaid recharge $${amount.toFixed(2)}`,
    payment_gate_config: {
      payment_gate_type: "STRIPE",
      stripe_config: {
        payment_type: "INVOICE",
        invoice_metadata: {
          user_id: userId,
          amount_usd: amount.toFixed(2),
        },
      },
      tax_type: "NONE",
    },
    priority: DEFAULT_COMMIT_PRIORITY,
    product_id: process.env.METRONOME_COMMIT_PRODUCT_ID,
    temporary_id: rechargeRequestId,
    type: "PREPAID",
  };

  if (isConfiguredValue(process.env.METRONOME_COMMIT_CUSTOM_FIELDS_JSON)) {
    commit.custom_fields = parseCommitCustomFields(
      process.env.METRONOME_COMMIT_CUSTOM_FIELDS_JSON,
    );
  }

  return {
    add_commits: [commit],
    contract_id: contractId,
    customer_id: customerId,
    uniqueness_key: rechargeRequestId,
  };
}

function getCurrentUtcHourBoundary(now = new Date()) {
  const currentHour = new Date(now);
  currentHour.setUTCMinutes(0, 0, 0);
  return currentHour;
}

async function addMetronomeContractPrepaidCommit(payload) {
  return editMetronomeContract(
    payload,
    "Metronome contract add prepaid commit failed",
  );
}

async function editMetronomeContract(payload, errorPrefix) {
  try {
    const metronome = new Metronome({
      bearerToken: getMetronomeBearerToken(),
    });

    return await metronome.v2.contracts.edit(payload);
  } catch (error) {
    const status =
      error.status >= 400 && error.status < 500 ? error.status : 502;
    throw new AppError(`${errorPrefix}: ${error.message}`, status);
  }
}

function isConfiguredValue(value) {
  return Boolean(value && !value.includes("xxx") && !value.includes("example"));
}

function parseCommitCustomFields(rawValue) {
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("must be a JSON object");
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)]),
    );
  } catch (error) {
    throw new AppError(
      `METRONOME_COMMIT_CUSTOM_FIELDS_JSON 无效: ${error.message}`,
      400,
    );
  }
}

function getMetronomeClient() {
  const bearerToken = getMetronomeBearerToken();
  if (!bearerToken) {
    throw new AppError("缺少 METRONOME_BEARER_TOKEN，无法调用 Metronome", 502);
  }

  return new Metronome({
    bearerToken,
  });
}

function getStripeClient() {
  if (!isConfiguredValue(process.env.STRIPE_SECRET_KEY)) {
    throw new AppError("缺少 STRIPE_SECRET_KEY，无法跳转 Stripe 绑卡", 400);
  }

  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

async function getSetupSessionPaymentMethodId({ stripe, session }: any) {
  const setupIntent =
    typeof session.setup_intent === "string"
      ? await stripe.setupIntents.retrieve(session.setup_intent)
      : session.setup_intent;
  const paymentMethod = setupIntent?.payment_method;
  const paymentMethodId =
    typeof paymentMethod === "string" ? paymentMethod : paymentMethod?.id;

  if (!paymentMethodId) {
    throw new AppError("Stripe 绑卡回调未返回 payment method", 502);
  }

  return paymentMethodId;
}

function getStripeCustomerIdFromValue(customer) {
  const customerId = typeof customer === "string" ? customer : customer?.id;
  if (!customerId) {
    throw new AppError("Stripe 绑卡回调未返回 customer", 502);
  }

  return customerId;
}

function getDefaultPaymentMethodIdFromStripeCustomer(customer) {
  return typeof customer.invoice_settings?.default_payment_method === "string"
    ? customer.invoice_settings.default_payment_method
    : customer.invoice_settings?.default_payment_method?.id;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getMetronomeBearerToken() {
  const token = process.env.METRONOME_BEARER_TOKEN;
  if (!token || token.includes("xxx") || token.includes("example")) {
    return null;
  }

  return token;
}

export class AppError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

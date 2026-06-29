"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type ActionFeedback = {
  message: string;
  isSuccess: boolean;
};

type PendingRecharge = {
  startedAt: string;
  initialBalance: number;
  initialTotalAllowance: number;
};

type BalanceOverviewProps = {
  customerId: string | null;
  email: string;
  feedback: ActionFeedback | null;
  initialBalance: number;
  initialTotalAllowance: number;
  lastMetronomeBalanceSyncError?: string | null;
  lowBalanceReminderSent?: boolean;
  onRechargeComplete: () => void;
  pendingRecharge: PendingRecharge | null;
  threshold: number;
};

type BalancePayload = {
  balance: number;
  totalAllowance: number;
  lastRechargeAt?: string | null;
};

type AutoRechargeFieldsProps = {
  minimumAutoRechargeTopUp: number;
  onMinimumRetainedChange: (value: string) => void;
  onThresholdChange: (value: string) => void;
  threshold: string;
  minimumRetained: string;
};

type DashboardType = "invoices" | "usage" | "commits_and_credits";

type DashboardProps = {
  customerId: string;
};

type EmbeddableDashboardPanelProps = {
  customerId: string;
  dashboard: DashboardType;
  title: string;
  description: string;
};

type HomePageClientProps = {
  autoRecharge: {
    enabled?: boolean;
    threshold?: number;
    rechargeToAmount?: number;
  };
  autoRechargeThreshold: number;
  defaultConsumeTokens: number;
  email: string;
  initialBalance: number;
  initialTotalAllowance: number;
  lastMetronomeBalanceSyncError?: string | null;
  lowBalanceReminderSent?: boolean;
  metronomeBillingProviderConfigurationId?: string | null;
  metronomeContractId?: string | null;
  metronomeCustomerId: string | null;
  minimumAutoRechargeTopUp: number;
  minimumRetainedBalance: number;
  notifications: Array<{
    createdAt: string;
    email: string;
    balance: number;
    threshold?: number;
  }>;
  stripeCustomerId?: string | null;
  defaultStripePaymentMethodId?: string | null;
  threshold: number;
};

class ApiCallError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function callApi<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new ApiCallError(payload.error || payload.message || "请求失败", response.status);
  }

  return payload as T;
}

function readFlashCookie(): ActionFeedback | null {
  const match = document.cookie.match(/(?:^|;\s*)flash=([^;]*)/);
  if (!match) {
    return null;
  }

  document.cookie = "flash=; Max-Age=0; path=/";

  try {
    const data = JSON.parse(decodeURIComponent(match[1])) as {
      message?: string;
      success?: boolean;
    };

    if (!data.message) {
      return null;
    }

    return {
      message: data.message,
      isSuccess: data.success !== false,
    };
  } catch {
    return null;
  }
}

function useEmbeddableDashboardUrl(customerId: string, dashboard: DashboardType) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          dashboard,
          customer_id: customerId,
        });
        const response = await fetch(`/api/metronome/dashboard?${params.toString()}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "加载 Dashboard 失败");
        }

        const payload = (await response.json()) as { url: string };
        if (!cancelled) {
          setEmbedUrl(payload.url);
        }
      } catch (loadError) {
        if (!cancelled) {
          setEmbedUrl(null);
          setError(
            loadError instanceof Error ? loadError.message : "加载 Dashboard 失败",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [customerId, dashboard]);

  return { embedUrl, error, loading };
}

function EmbeddableDashboardPanel({
  customerId,
  dashboard,
  title,
  description,
}: EmbeddableDashboardPanelProps) {
  const { embedUrl, error, loading } = useEmbeddableDashboardUrl(customerId, dashboard);

  return (
    <section className="card dashboard-card">
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      {error ? <div className="alert">{error}</div> : null}
      {loading ? <p className="muted">正在加载 Dashboard…</p> : null}
      {embedUrl ? (
        <iframe
          className="dashboard-frame"
          src={embedUrl}
          title={`Metronome ${dashboard} dashboard`}
        />
      ) : null}
    </section>
  );
}

export function CommitsAndCreditsDashboard({ customerId }: DashboardProps) {
  return (
    <EmbeddableDashboardPanel
      customerId={customerId}
      dashboard="commits_and_credits"
      title="Credits & Commits"
      description="查看 Credits 与 Commits 余额及明细。"
    />
  );
}

export function UsageDashboard({ customerId }: DashboardProps) {
  return (
    <EmbeddableDashboardPanel
      customerId={customerId}
      dashboard="usage"
      title="Usage"
      description="查看用量明细与计费事件。"
    />
  );
}

export function InvoicesDashboard({ customerId }: DashboardProps) {
  return (
    <EmbeddableDashboardPanel
      customerId={customerId}
      dashboard="invoices"
      title="Invoices"
      description="查看发票与账单记录。"
    />
  );
}

function Dashboard({ customerId }: { customerId: string | null }) {
  if (!customerId) {
    return (
      <section className="card">
        <h2>Billing Dashboard</h2>
        <p className="muted">请先创建 Metronome Customer 后再查看嵌入式账单 Dashboard。</p>
      </section>
    );
  }

  return (
    <>
      <CommitsAndCreditsDashboard customerId={customerId} />
      <UsageDashboard customerId={customerId} />
      <InvoicesDashboard customerId={customerId} />
    </>
  );
}

function BalanceOverview({
  customerId,
  email,
  feedback,
  initialBalance,
  initialTotalAllowance,
  lastMetronomeBalanceSyncError,
  lowBalanceReminderSent,
  onRechargeComplete,
  pendingRecharge,
  threshold,
}: BalanceOverviewProps) {
  const [balance, setBalance] = useState(initialBalance);
  const [totalAllowance, setTotalAllowance] = useState(initialTotalAllowance);

  useEffect(() => {
    setBalance(initialBalance);
    setTotalAllowance(initialTotalAllowance);
  }, [initialBalance, initialTotalAllowance]);

  useEffect(() => {
    if (!customerId) {
      return;
    }

    const intervalMs = 5000;

    const pollBalance = async () => {
      try {
        const response = await fetch("/api/balance", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          return;
        }

        const user = (await response.json()) as BalancePayload;
        setBalance(Number(user.balance));
        setTotalAllowance(Number(user.totalAllowance));

        if (
          pendingRecharge &&
          hasSyncedRecharge({
            user,
            initialBalance: pendingRecharge.initialBalance,
            initialTotalAllowance: pendingRecharge.initialTotalAllowance,
            pendingStartedAt: pendingRecharge.startedAt,
          })
        ) {
          onRechargeComplete();
        }
      } catch (_error) {
        // Keep the current display; the next interval may succeed.
      }
    };

    const interval = window.setInterval(pollBalance, intervalMs);
    const timeout = window.setTimeout(pollBalance, 1000);
    const onVisibilityChange = () => {
      if (!document.hidden) {
        void pollBalance();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [customerId, onRechargeComplete, pendingRecharge]);

  return (
    <section className="card">
      <p className="muted">Demo 用户：{email}</p>
      <h1>可消费额度</h1>
      <div className="balance">${formatMoney(balance)}</div>
      <p className="muted">
        累计预付费额度 <span>${formatMoney(totalAllowance)}</span>，可用额度低于
        ${formatMoney(threshold)} 时提醒。
        {lowBalanceReminderSent ? "本轮充值已发送过低余额提醒。" : ""}
      </p>
      {feedback ? (
        <div className={`alert ${feedback.isSuccess ? "success" : ""}`}>
          {feedback.message}
        </div>
      ) : null}
      {lastMetronomeBalanceSyncError ? (
        <div className="alert">
          Metronome 余额同步失败，当前展示本地缓存：
          {lastMetronomeBalanceSyncError}
        </div>
      ) : null}
      {balance > 0 ? null : (
        <div className="alert">当前没有可用额度，请先充值。</div>
      )}
    </section>
  );
}

function AutoRechargeFields({
  minimumAutoRechargeTopUp,
  minimumRetained,
  onMinimumRetainedChange,
  onThresholdChange,
  threshold,
}: AutoRechargeFieldsProps) {
  const minRetained = useMemo(() => {
    const thresholdAmount = Number(threshold);
    if (!Number.isFinite(thresholdAmount)) {
      return minimumAutoRechargeTopUp;
    }

    return thresholdAmount + minimumAutoRechargeTopUp;
  }, [minimumAutoRechargeTopUp, threshold]);

  const estimatedTopUpAtThreshold = useMemo(() => {
    const thresholdAmount = Number(threshold);
    const retainedAmount = Number(minimumRetained);

    if (!Number.isFinite(thresholdAmount) || !Number.isFinite(retainedAmount)) {
      return 0;
    }

    return Math.max(0, retainedAmount - thresholdAmount);
  }, [minimumRetained, threshold]);

  return (
    <>
      <label>
        触发阈值（USD）
        <input
          type="number"
          min="0.5"
          step="0.5"
          value={threshold}
          onChange={(event) => onThresholdChange(event.target.value)}
          required
        />
      </label>
      <label>
        最低保留额度（USD）
        <input
          type="number"
          min={formatMoney(minRetained)}
          step="0.5"
          value={minimumRetained}
          onChange={(event) => onMinimumRetainedChange(event.target.value)}
          required
        />
      </label>
      <p className="muted">
        Metronome 当前要求最低保留额度至少比触发阈值高 $
        {formatMoney(minimumAutoRechargeTopUp)}
        。按当前填写值，余额在触发阈值附近时预计补差约 $
        {formatMoney(estimatedTopUpAtThreshold)}。
      </p>
    </>
  );
}

function ActionError({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return <div className="alert">{error}</div>;
}

function useActionSubmit(onSubmit: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);

    try {
      await onSubmit();
    } catch (submitError) {
      if (submitError instanceof ApiCallError) {
        setError(submitError.message);
      } else if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError("请求失败，请稍后重试。");
      }
    } finally {
      setLoading(false);
    }
  };

  return { error, loading, handleSubmit, setError };
}

function CustomerSection({
  customerId,
  contractId,
  billingConfigId,
  onFeedback,
  onRefresh,
}: {
  customerId: string | null;
  contractId?: string | null;
  billingConfigId?: string | null;
  onFeedback: (feedback: ActionFeedback) => void;
  onRefresh: () => void;
}) {
  const hasCustomerId = Boolean(customerId);
  const { error, loading, handleSubmit } = useActionSubmit(async () => {
    if (hasCustomerId) {
      const result = await callApi<{ message: string }>("/api/billing/customer/delete", {
        customer_id: customerId,
      });
      onFeedback({ message: result.message, isSuccess: true });
      onRefresh();
      return;
    }

    const result = await callApi<{ redirectUrl: string }>("/api/billing/customer");
    window.location.assign(result.redirectUrl);
  });

  return (
    <div className="card">
      <h2>Customer</h2>
      <p className="muted">为业务用户创建 Metronome Customer 后会直接跳转 Stripe Setup Mode 绑卡。</p>
      <p className="muted">
        Metronome Customer：<code>{customerId ?? "not_created"}</code>
      </p>
      <p className="muted">
        Metronome Contract：<code>{contractId ?? "not_created"}</code>
      </p>
      <p className="muted">
        Billing Config：<code>{billingConfigId ?? "not_created"}</code>
      </p>
      <ActionError error={error} />
      <div className="action-form">
        <button
          className={hasCustomerId ? "danger" : undefined}
          type="button"
          disabled={loading}
          onClick={() => void handleSubmit()}
        >
          {hasCustomerId ? "删除当前 Customer" : "创建 Customer 并绑卡"}
        </button>
      </div>
    </div>
  );
}

function CardSection({
  customerId,
  stripeCustomerId,
  defaultPaymentMethodId,
}: {
  customerId: string | null;
  stripeCustomerId?: string | null;
  defaultPaymentMethodId?: string | null;
}) {
  const hasCustomerId = Boolean(customerId);
  const { error, loading, handleSubmit } = useActionSubmit(async () => {
    const result = await callApi<{ redirectUrl: string }>("/api/billing/card/setup", {
      customer_id: customerId,
    });
    window.location.assign(result.redirectUrl);
  });

  return (
    <div className="card">
      <h2>银行卡</h2>
      <p className="muted">
        首次充值前先跳转到 Stripe Setup Mode 绑定银行卡；后续充值由 Metronome 触发 Stripe 自动扣款。
      </p>
      <p className="muted">
        Stripe Customer：<code>{stripeCustomerId ?? "not_created"}</code>
      </p>
      <p className="muted">
        Default Payment Method：<code>{defaultPaymentMethodId ?? "not_set"}</code>
      </p>
      <ActionError error={error} />
      <div className="action-form">
        <button
          type="button"
          disabled={!hasCustomerId || loading}
          onClick={() => void handleSubmit()}
        >
          {stripeCustomerId ? "更换银行卡" : "绑定银行卡"}
        </button>
      </div>
    </div>
  );
}

function RechargeSection({
  customerId,
  hasBalance,
  initialBalance,
  initialTotalAllowance,
  onFeedback,
  onPendingRecharge,
}: {
  customerId: string | null;
  hasBalance: boolean;
  initialBalance: number;
  initialTotalAllowance: number;
  onFeedback: (feedback: ActionFeedback) => void;
  onPendingRecharge: (pending: PendingRecharge) => void;
}) {
  const hasCustomerId = Boolean(customerId);
  const [amount, setAmount] = useState("10");
  const { error, loading, handleSubmit } = useActionSubmit(async () => {
    const result = await callApi<{
      message: string;
      startedAt: string;
    }>("/api/recharge", {
      amount: Number(amount),
      customer_id: customerId,
    });

    onPendingRecharge({
      startedAt: result.startedAt,
      initialBalance,
      initialTotalAllowance,
    });
    onFeedback({ message: result.message, isSuccess: true });
  });

  return (
    <div className="card">
      <h2>预付费充值</h2>
      <p className="muted">
        输入美元金额后会通过 Metronome 创建 Prepaid Commit，由 Metronome 自动交给 Stripe 扣款，无需再次跳转支付页。
      </p>
      <ActionError error={error} />
      <div className="action-form">
        <label>
          充值金额（USD）
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </label>
        <button type="button" disabled={!hasCustomerId || loading} onClick={() => void handleSubmit()}>
          {hasBalance ? "继续充值" : "立即充值"}
        </button>
      </div>
    </div>
  );
}

function AutoRechargeSection({
  autoRecharge,
  autoRechargeThreshold,
  customerId,
  minimumAutoRechargeTopUp,
  minimumRetainedBalance,
  onFeedback,
  onRefresh,
}: {
  autoRecharge: HomePageClientProps["autoRecharge"];
  autoRechargeThreshold: number;
  customerId: string | null;
  minimumAutoRechargeTopUp: number;
  minimumRetainedBalance: number;
  onFeedback: (feedback: ActionFeedback) => void;
  onRefresh: () => void;
}) {
  const hasCustomerId = Boolean(customerId);
  const [threshold, setThreshold] = useState(formatMoney(autoRechargeThreshold));
  const [minimumRetained, setMinimumRetained] = useState(formatMoney(minimumRetainedBalance));
  const { error, loading, handleSubmit } = useActionSubmit(async () => {
    const result = await callApi<{ message: string }>("/api/billing/auto-recharge", {
      customer_id: customerId,
      threshold,
      minimum_retained_amount: minimumRetained,
    });

    onFeedback({ message: result.message, isSuccess: true });
    onRefresh();
  });

  return (
    <div className="card">
      <h2>自动充值</h2>
      <p className="muted">
        配置“可用额度低于多少时触发，以及触发后至少保留多少额度”。实际充值金额由 Metronome 按最低保留额度减去触发时当前余额计算。
      </p>
      <p className="muted">
        当前配置：
        {autoRecharge.enabled
          ? `低于 $${formatMoney(autoRecharge.threshold ?? 0)} 触发，最低保留 $${formatMoney(autoRecharge.rechargeToAmount ?? 0)}`
          : "not_configured"}
      </p>
      <ActionError error={error} />
      <div className="action-form">
        <AutoRechargeFields
          minimumAutoRechargeTopUp={minimumAutoRechargeTopUp}
          minimumRetained={minimumRetained}
          onMinimumRetainedChange={setMinimumRetained}
          onThresholdChange={setThreshold}
          threshold={threshold}
        />
        <button type="button" disabled={!hasCustomerId || loading} onClick={() => void handleSubmit()}>
          保存自动充值配置
        </button>
      </div>
    </div>
  );
}

function ConsumeSection({
  customerId,
  defaultConsumeTokens,
  onFeedback,
  onRefresh,
}: {
  customerId: string | null;
  defaultConsumeTokens: number;
  onFeedback: (feedback: ActionFeedback) => void;
  onRefresh: () => void;
}) {
  const hasCustomerId = Boolean(customerId);
  const [tokens, setTokens] = useState(String(defaultConsumeTokens));
  const { error, loading, handleSubmit } = useActionSubmit(async () => {
    const result = await callApi<{ message: string }>("/api/consume", {
      customer_id: customerId,
      tokens: Number(tokens),
    });

    onFeedback({ message: result.message, isSuccess: true });
    onRefresh();
  });

  return (
    <div className="card">
      <h2>模拟业务消耗</h2>
      <p className="muted">
        默认模拟消耗 {defaultConsumeTokens} Token，可按本次业务调用调整 Token 数；费用由 Metronome Pricing 计算。
      </p>
      <ActionError error={error} />
      <div className="action-form">
        <label>
          消耗数量（Token）
          <input
            type="number"
            min="1"
            step="1"
            value={tokens}
            onChange={(event) => setTokens(event.target.value)}
            required
          />
        </label>
        <button
          className="secondary"
          type="button"
          disabled={!hasCustomerId || loading}
          onClick={() => void handleSubmit()}
        >
          上报 Token 消耗
        </button>
      </div>
    </div>
  );
}

function TestEmailSection({
  customerId,
  defaultEmail,
  onFeedback,
}: {
  customerId: string | null;
  defaultEmail: string;
  onFeedback: (feedback: ActionFeedback) => void;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const { error, loading, handleSubmit } = useActionSubmit(async () => {
    const result = await callApi<{ message: string }>("/api/mail/test", {
      customer_id: customerId,
      email,
    });

    onFeedback({ message: result.message, isSuccess: true });
  });

  return (
    <div className="card">
      <h2>测试发送邮件</h2>
      <p className="muted">
        输入目标邮箱后发送一封测试邮件，用于验证当前 SMTP 配置；未配置 SMTP 时会在服务端日志输出 dry-run。
      </p>
      <ActionError error={error} />
      <div className="action-form">
        <label>
          目标邮箱
          <input
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <button type="button" disabled={loading} onClick={() => void handleSubmit()}>
          发送测试邮件
        </button>
      </div>
    </div>
  );
}

export function HomePageClient({
  autoRecharge,
  autoRechargeThreshold,
  defaultConsumeTokens,
  email,
  initialBalance,
  initialTotalAllowance,
  lastMetronomeBalanceSyncError,
  lowBalanceReminderSent,
  metronomeBillingProviderConfigurationId,
  metronomeContractId,
  metronomeCustomerId,
  minimumAutoRechargeTopUp,
  minimumRetainedBalance,
  notifications,
  stripeCustomerId,
  defaultStripePaymentMethodId,
  threshold,
}: HomePageClientProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [pendingRecharge, setPendingRecharge] = useState<PendingRecharge | null>(null);
  const hasBalance = initialBalance > 0;

  useEffect(() => {
    const flash = readFlashCookie();
    if (flash) {
      setFeedback(flash);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleRechargeComplete = useCallback(() => {
    setPendingRecharge(null);
    setFeedback({
      message: "预付费充值成功，可消费额度已更新。",
      isSuccess: true,
    });
    router.refresh();
  }, [router]);

  return (
    <main>
      <BalanceOverview
        customerId={metronomeCustomerId}
        email={email}
        feedback={feedback}
        initialBalance={initialBalance}
        initialTotalAllowance={initialTotalAllowance}
        lastMetronomeBalanceSyncError={lastMetronomeBalanceSyncError}
        lowBalanceReminderSent={lowBalanceReminderSent}
        onRechargeComplete={handleRechargeComplete}
        pendingRecharge={pendingRecharge}
        threshold={threshold}
      />

      <Dashboard customerId={metronomeCustomerId} />

      <section className="grid">
        <CustomerSection
          billingConfigId={metronomeBillingProviderConfigurationId}
          contractId={metronomeContractId}
          customerId={metronomeCustomerId}
          onFeedback={setFeedback}
          onRefresh={handleRefresh}
        />
        <CardSection
          customerId={metronomeCustomerId}
          defaultPaymentMethodId={defaultStripePaymentMethodId}
          stripeCustomerId={stripeCustomerId}
        />
        <RechargeSection
          customerId={metronomeCustomerId}
          hasBalance={hasBalance}
          initialBalance={initialBalance}
          initialTotalAllowance={initialTotalAllowance}
          onFeedback={setFeedback}
          onPendingRecharge={setPendingRecharge}
        />
        <AutoRechargeSection
          autoRecharge={autoRecharge}
          autoRechargeThreshold={autoRechargeThreshold}
          customerId={metronomeCustomerId}
          minimumAutoRechargeTopUp={minimumAutoRechargeTopUp}
          minimumRetainedBalance={minimumRetainedBalance}
          onFeedback={setFeedback}
          onRefresh={handleRefresh}
        />
        <ConsumeSection
          customerId={metronomeCustomerId}
          defaultConsumeTokens={defaultConsumeTokens}
          onFeedback={setFeedback}
          onRefresh={handleRefresh}
        />
        <TestEmailSection
          customerId={metronomeCustomerId}
          defaultEmail={email}
          onFeedback={setFeedback}
        />
      </section>

      <section className="card">
        <h2>低余额提醒记录</h2>
        {notifications.length === 0 ? (
          <p className="muted">暂无提醒。未配置 SMTP 时，邮件会以 dry-run 方式打印在服务端日志中。</p>
        ) : (
          <ul>
            {notifications
              .slice()
              .reverse()
              .map((item) => (
                <li key={`${item.createdAt}-${item.email}`}>
                  {item.createdAt}：可用额度 ${formatMoney(item.balance)}，提醒阈值 $
                  {formatMoney(item.threshold ?? threshold)}，已提醒 {item.email}
                </li>
              ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function hasSyncedRecharge({
  user,
  initialBalance,
  initialTotalAllowance,
  pendingStartedAt,
}: {
  user: BalancePayload;
  initialBalance: number;
  initialTotalAllowance: number;
  pendingStartedAt?: string | null;
}) {
  const balance = Number(user.balance);
  const totalAllowance = Number(user.totalAllowance);

  return (
    isTimestampAfter(user.lastRechargeAt, pendingStartedAt) ||
    totalAllowance > Number(initialTotalAllowance) ||
    (balance > Number(initialBalance) &&
      totalAllowance >= Number(initialTotalAllowance))
  );
}

function isTimestampAfter(value?: string | null, baseline?: string | null) {
  if (!value) {
    return false;
  }

  if (!baseline) {
    return true;
  }

  const timestamp = Date.parse(value);
  const baselineTimestamp = Date.parse(baseline);
  return (
    Number.isFinite(timestamp) &&
    Number.isFinite(baselineTimestamp) &&
    timestamp >= baselineTimestamp
  );
}

function formatMoney(value: number) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "0.00";
  }

  return amount.toFixed(2);
}

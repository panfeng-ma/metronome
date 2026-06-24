"use client";

import { useEffect, useMemo, useState } from "react";

type BalanceOverviewProps = {
  customerId: string | null;
  email: string;
  initialBalance: number;
  initialTotalAllowance: number;
  isSuccessStatus: boolean;
  lastMetronomeBalanceSyncError?: string | null;
  lowBalanceReminderSent?: boolean;
  message?: string | null;
  pendingStartedAt?: string | null;
  shouldRedirectOnRecharge: boolean;
  threshold: number;
};

type BalancePayload = {
  balance: number;
  totalAllowance: number;
  lastRechargeAt?: string | null;
};

type AutoRechargeFieldsProps = {
  initialMinimumRetainedBalance: number;
  initialThreshold: number;
  minimumAutoRechargeTopUp: number;
};

type DashboardType = "invoices" | "usage" | "commits_and_credits";

type DashboardProps = {
  customerId: string | null;
};

const DASHBOARD_TABS: Array<{ id: DashboardType; label: string }> = [
  { id: "commits_and_credits", label: "Credits & Commits" },
  { id: "usage", label: "Usage" },
  { id: "invoices", label: "Invoices" },
];

export function Dashboard({ customerId }: DashboardProps) {
  const [dashboard, setDashboard] = useState<DashboardType>("commits_and_credits");
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId) {
      setEmbedUrl(null);
      setError(null);
      return;
    }

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

  if (!customerId) {
    return (
      <section className="card">
        <h2>Billing Dashboard</h2>
        <p className="muted">请先创建 Metronome Customer 后再查看嵌入式账单 Dashboard。</p>
      </section>
    );
  }

  return (
    <section className="card dashboard-card">
      <h2>Billing Dashboard</h2>
      <p className="muted">
        通过 Metronome embeddable dashboard 查看发票、用量与 Credits/Commits 余额。
      </p>
      <div className="dashboard-tabs" role="tablist" aria-label="Dashboard 类型">
        {DASHBOARD_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={dashboard === tab.id}
            className={dashboard === tab.id ? "dashboard-tab active" : "dashboard-tab"}
            onClick={() => setDashboard(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
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

export function BalanceOverview({
  customerId,
  email,
  initialBalance,
  initialTotalAllowance,
  isSuccessStatus,
  lastMetronomeBalanceSyncError,
  lowBalanceReminderSent,
  message,
  pendingStartedAt,
  shouldRedirectOnRecharge,
  threshold,
}: BalanceOverviewProps) {
  const [balance, setBalance] = useState(initialBalance);
  const [totalAllowance, setTotalAllowance] = useState(initialTotalAllowance);

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
          shouldRedirectOnRecharge &&
          hasSyncedRecharge({
            user,
            initialBalance,
            initialTotalAllowance,
            pendingStartedAt,
          })
        ) {
          const nextUrl = new URL("/", window.location.origin);
          nextUrl.searchParams.set("status", "recharge_success");
          nextUrl.searchParams.set("customer_id", customerId);
          window.location.replace(nextUrl.toString());
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
  }, [
    customerId,
    initialBalance,
    initialTotalAllowance,
    pendingStartedAt,
    shouldRedirectOnRecharge,
  ]);

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
      {message ? (
        <div className={`alert ${isSuccessStatus ? "success" : ""}`}>
          {message}
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

export function AutoRechargeFields({
  initialMinimumRetainedBalance,
  initialThreshold,
  minimumAutoRechargeTopUp,
}: AutoRechargeFieldsProps) {
  const [threshold, setThreshold] = useState(formatMoney(initialThreshold));
  const [retained, setRetained] = useState(
    formatMoney(initialMinimumRetainedBalance),
  );

  const minRetained = useMemo(() => {
    const thresholdAmount = Number(threshold);
    if (!Number.isFinite(thresholdAmount)) {
      return minimumAutoRechargeTopUp;
    }

    return thresholdAmount + minimumAutoRechargeTopUp;
  }, [minimumAutoRechargeTopUp, threshold]);

  const estimatedTopUpAtThreshold = useMemo(() => {
    const thresholdAmount = Number(threshold);
    const retainedAmount = Number(retained);

    if (!Number.isFinite(thresholdAmount) || !Number.isFinite(retainedAmount)) {
      return 0;
    }

    return Math.max(0, retainedAmount - thresholdAmount);
  }, [retained, threshold]);

  return (
    <>
      <label>
        触发阈值（USD）
        <input
          name="threshold"
          type="number"
          min="0.5"
          step="0.5"
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          required
        />
      </label>
      <label>
        最低保留额度（USD）
        <input
          name="minimum_retained_amount"
          type="number"
          min={formatMoney(minRetained)}
          step="0.5"
          value={retained}
          onChange={(event) => setRetained(event.target.value)}
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

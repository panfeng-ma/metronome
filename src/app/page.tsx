import {
  getDefaultConsumeTokens,
  getLowBalanceReminderThreshold,
  getMinimumAutoRechargeTopUpAmount,
  getUserWithMetronomeBalance
} from "../lib/billing";
import { loadStore } from "../lib/store";
import { AutoRechargeFields, BalanceOverview } from "./page-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_MESSAGES: Record<string, string> = {
  recharge_success: "预付费充值成功，可消费额度已更新。",
  recharge_pending: "已发起充值，Metronome 正在通过 Stripe 自动扣款，余额会在 Webhook 同步后更新。",
  recharge_failed: "充值取消或失败，请重新发起充值。",
  customer_deleted: "当前 Metronome Customer 已归档，本地状态已重置。",
  customer_delete_unconfigured: "尚未配置 METRONOME_BEARER_TOKEN，无法归档 Metronome Customer。",
  customer_alias_conflict: "Metronome ingest alias 已被其他 Customer 占用；当前创建流程已避免发送固定 alias，请重试创建。",
  customer_required: "请先创建 Metronome Customer，再继续绑卡、充值或上报 usage。",
  customer_unconfigured: "尚未配置 METRONOME_BEARER_TOKEN，无法创建 Metronome Customer。",
  contract_unconfigured: "尚未配置 METRONOME_RATE_CARD_ID，无法为 Customer 创建 contract。",
  card_setup_success: "银行卡已绑定，并已设置为 Stripe Customer 默认付款方式。",
  card_setup_cancelled: "已取消绑卡，充值前请先完成银行卡绑定。",
  card_setup_unconfigured: "尚未配置 STRIPE_SECRET_KEY，无法打开 Stripe 绑卡页面。",
  card_setup_required: "Stripe Customer 缺少默认付款方式，请先重新绑定银行卡。",
  auto_recharge_configured: "自动充值配置已写入 Metronome Contract。",
  auto_recharge_amount_too_low:
    "自动充值配置失败：最低保留额度和触发阈值之间的差额太小，请调高“最低保留额度（USD）”后重试。",
  auto_recharge_invalid_range: "自动充值配置失败：最低保留额度必须大于触发阈值。",
  auto_recharge_product_unconfigured: "自动充值配置失败：尚未配置 METRONOME_COMMIT_PRODUCT_ID。",
  auto_recharge_billing_provider_invalid:
    "自动充值配置失败：当前 Contract 未正确绑定 Stripe billing provider，请重新创建 Customer 或检查 billing config。",
  auto_recharge_unconfigured:
    "自动充值配置失败，请检查 METRONOME_COMMIT_PRODUCT_ID、Contract billing provider 和绑卡状态。",
  consume_success: "Token usage 已上报，余额以 Metronome 计算结果为准。",
  consume_failed: "消耗失败，Metronome usage event 发送失败，请检查配置后重试。",
  insufficient_balance: "余额不足，请先充值。",
  test_email_sent: "测试邮件已发送，请检查目标邮箱。",
  test_email_dry_run:
    "测试邮件已进入 dry-run，未完整配置 SMTP_HOST、SMTP_USER 和 SMTP_PASS，邮件内容已打印在服务端日志中。",
  test_email_invalid: "测试邮件发送失败：请输入有效的目标邮箱。",
  test_email_failed:
    "测试邮件发送失败，请检查 SMTP_HOST、SMTP_PORT、SMTP_SECURE、SMTP_USER、SMTP_PASS、MAIL_FROM 和服务端日志。"
};

const SUCCESS_STATUSES = new Set([
  "recharge_success",
  "customer_deleted",
  "card_setup_success",
  "auto_recharge_configured",
  "consume_success",
  "test_email_sent",
  "test_email_dry_run"
]);

type HomeSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HomePage({
  searchParams
}: {
  searchParams: HomeSearchParams;
}) {
  const params = await searchParams;
  const status = getSearchParam(params, "status");
  const pendingStartedAt = getSearchParam(params, "started_at");
  const customerId = getSearchParam(params, "customer_id");
  const user = await getUserWithMetronomeBalance();
  const store = await loadStore();
  const hasBalance = Number(user.balance) > 0;
  const threshold = getLowBalanceReminderThreshold(user);
  const resolvedStatus = resolveStatus({ status, user, pendingStartedAt });
  const message = resolvedStatus ? STATUS_MESSAGES[resolvedStatus] ?? null : null;
  const metronomeCustomerId = customerId ?? user.metronomeCustomerId ?? null;
  const hasCustomerId = Boolean(metronomeCustomerId);
  const isSuccessStatus = resolvedStatus ? SUCCESS_STATUSES.has(resolvedStatus) : false;
  const autoRecharge = user.autoRecharge ?? {};
  const autoRechargeThreshold = autoRecharge.threshold ?? 2;
  const minimumAutoRechargeTopUp = getMinimumAutoRechargeTopUpAmount();
  const minimumRetainedBalance = Math.max(
    Number(autoRecharge.rechargeToAmount ?? Number(autoRechargeThreshold) + minimumAutoRechargeTopUp),
    Number(autoRechargeThreshold) + minimumAutoRechargeTopUp
  );
  const defaultConsumeTokens = getDefaultConsumeTokens();
  const notifications = store.notifications ?? [];

  return (
    <main>
      <BalanceOverview
        customerId={metronomeCustomerId}
        email={user.email}
        initialBalance={Number(user.balance)}
        initialTotalAllowance={Number(user.totalAllowance)}
        isSuccessStatus={isSuccessStatus}
        lastMetronomeBalanceSyncError={user.lastMetronomeBalanceSyncError}
        lowBalanceReminderSent={user.lowBalanceReminderSent}
        message={message}
        pendingStartedAt={pendingStartedAt}
        shouldRedirectOnRecharge={resolvedStatus === "recharge_pending"}
        threshold={threshold}
      />

      <section className="grid">
        <div className="card">
          <h2>Customer</h2>
          <p className="muted">为业务用户创建 Metronome Customer 后会直接跳转 Stripe Setup Mode 绑卡。</p>
          <p className="muted">
            Metronome Customer：<code>{metronomeCustomerId ?? "not_created"}</code>
          </p>
          <p className="muted">
            Metronome Contract：<code>{user.metronomeContractId ?? "not_created"}</code>
          </p>
          <p className="muted">
            Billing Config：<code>{user.metronomeBillingProviderConfigurationId ?? "not_created"}</code>
          </p>
          {hasCustomerId ? (
            <form action="/api/billing/customer/delete" method="post">
              <CustomerIdHiddenInput customerId={metronomeCustomerId} />
              <button className="danger" type="submit">
                删除当前 Customer
              </button>
            </form>
          ) : (
            <form action="/api/billing/customer" method="post">
              <button type="submit">创建 Customer 并绑卡</button>
            </form>
          )}
        </div>

        <div className="card">
          <h2>银行卡</h2>
          <p className="muted">首次充值前先跳转到 Stripe Setup Mode 绑定银行卡；后续充值由 Metronome 触发 Stripe 自动扣款。</p>
          <p className="muted">
            Stripe Customer：<code>{user.stripeCustomerId ?? "not_created"}</code>
          </p>
          <p className="muted">
            Default Payment Method：<code>{user.defaultStripePaymentMethodId ?? "not_set"}</code>
          </p>
          <form action="/api/billing/card/setup" method="post">
            <CustomerIdHiddenInput customerId={metronomeCustomerId} />
            <button type="submit" disabled={!hasCustomerId}>
              {user.stripeCustomerId ? "更换银行卡" : "绑定银行卡"}
            </button>
          </form>
        </div>

        <div className="card">
          <h2>预付费充值</h2>
          <p className="muted">
            输入美元金额后会通过 Metronome 创建 Prepaid Commit，由 Metronome 自动交给 Stripe 扣款，无需再次跳转支付页。
          </p>
          <form action="/api/recharge" method="post">
            <CustomerIdHiddenInput customerId={metronomeCustomerId} />
            <label>
              充值金额（USD）
              <input name="amount" type="number" min="0.5" step="0.5" defaultValue="10" required />
            </label>
            <button type="submit" disabled={!hasCustomerId}>
              {hasBalance ? "继续充值" : "立即充值"}
            </button>
          </form>
        </div>

        <div className="card">
          <h2>自动充值</h2>
          <p className="muted">
            配置“可用额度低于多少时触发，以及触发后至少保留多少额度”。实际充值金额由 Metronome 按最低保留额度减去触发时当前余额计算。
          </p>
          <p className="muted">
            当前配置：
            {autoRecharge.enabled
              ? `低于 $${formatMoney(autoRecharge.threshold)} 触发，最低保留 $${formatMoney(autoRecharge.rechargeToAmount)}`
              : "not_configured"}
          </p>
          <form action="/api/billing/auto-recharge" method="post">
            <CustomerIdHiddenInput customerId={metronomeCustomerId} />
            <AutoRechargeFields
              initialMinimumRetainedBalance={minimumRetainedBalance}
              initialThreshold={Number(autoRechargeThreshold)}
              minimumAutoRechargeTopUp={minimumAutoRechargeTopUp}
            />
            <button type="submit" disabled={!hasCustomerId}>
              保存自动充值配置
            </button>
          </form>
        </div>

        <div className="card">
          <h2>模拟业务消耗</h2>
          <p className="muted">
            默认模拟消耗 {defaultConsumeTokens} Token，可按本次业务调用调整 Token 数；费用由 Metronome Pricing 计算。
          </p>
          <form action="/api/consume" method="post">
            <CustomerIdHiddenInput customerId={metronomeCustomerId} />
            <label>
              消耗数量（Token）
              <input name="tokens" type="number" min="1" step="1" defaultValue={defaultConsumeTokens} required />
            </label>
            <button className="secondary" type="submit" disabled={!hasCustomerId}>
              上报 Token 消耗
            </button>
          </form>
        </div>

        <div className="card">
          <h2>测试发送邮件</h2>
          <p className="muted">输入目标邮箱后发送一封测试邮件，用于验证当前 SMTP 配置；未配置 SMTP 时会在服务端日志输出 dry-run。</p>
          <form action="/api/mail/test" method="post">
            <CustomerIdHiddenInput customerId={metronomeCustomerId} />
            <label>
              目标邮箱
              <input name="email" type="email" placeholder="name@example.com" defaultValue={user.email} required />
            </label>
            <button type="submit">发送测试邮件</button>
          </form>
        </div>
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
              .map((item: any) => (
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

function CustomerIdHiddenInput({ customerId }: { customerId: string | null }) {
  if (!customerId) {
    return null;
  }

  return <input type="hidden" name="customer_id" value={customerId} />;
}

function getSearchParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function resolveStatus({
  status,
  user,
  pendingStartedAt
}: {
  status: string | null;
  user: any;
  pendingStartedAt: string | null;
}) {
  if (
    status === "recharge_pending" &&
    isTimestampAfter(user.lastRechargeAt, pendingStartedAt)
  ) {
    return "recharge_success";
  }

  return status;
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
  return Number.isFinite(timestamp) && Number.isFinite(baselineTimestamp) && timestamp >= baselineTimestamp;
}

function formatMoney(value: number) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "0.00";
  }

  return amount.toFixed(2);
}

import {
  getDefaultConsumeTokens,
  getLowBalanceReminderThreshold,
  getMinimumAutoRechargeTopUpAmount,
  getUserWithMetronomeBalance
} from "../lib/billing";
import { loadStore } from "../lib/store";
import { HomePageClient } from "./page-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getUserWithMetronomeBalance();
  const store = await loadStore();
  const threshold = getLowBalanceReminderThreshold(user);
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
    <HomePageClient
      autoRecharge={autoRecharge}
      autoRechargeThreshold={Number(autoRechargeThreshold)}
      defaultConsumeTokens={defaultConsumeTokens}
      email={user.email}
      initialBalance={Number(user.balance)}
      initialTotalAllowance={Number(user.totalAllowance)}
      lastMetronomeBalanceSyncError={user.lastMetronomeBalanceSyncError}
      lowBalanceReminderSent={user.lowBalanceReminderSent}
      metronomeBillingProviderConfigurationId={user.metronomeBillingProviderConfigurationId}
      metronomeContractId={user.metronomeContractId}
      metronomeCustomerId={user.metronomeCustomerId ?? null}
      minimumAutoRechargeTopUp={minimumAutoRechargeTopUp}
      minimumRetainedBalance={minimumRetainedBalance}
      notifications={notifications}
      stripeCustomerId={user.stripeCustomerId}
      defaultStripePaymentMethodId={user.defaultStripePaymentMethodId}
      threshold={threshold}
    />
  );
}

import { t } from '@/marketing/i18n/browser';
import './embeddedFocus';
import '@seams/mpc-wallet/styles.css';
import './showcase.css';
import './checkout.css';
import React from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { TransactionReviewControls } from '@seams/mpc-wallet/react';
import { CheckoutSession } from './checkoutSession';
import {
  cart,
  expressCents,
  formatBalance,
  formatPrice,
  formatTokenAmount,
  shop,
  subtotalCents,
  totalCents,
  type CheckoutChoice,
  type Delivery,
} from './checkoutCart';
import { paymentTokens, type SampleToken } from './sampleTokens';
import { schedulePlayback } from './playbackClock';
import { configureModalBackdrop } from './modalBackdrop';
import { applyCheckoutPalette } from './checkoutAppearance';

configureModalBackdrop();
applyCheckoutPalette(document.documentElement);

/* A sample shop's own checkout card, shown in the SDK's modal. Pay hands the
   same modal to the wallet approval, which morphs from the card; Back in the
   wallet morphs it back. When a run ends, the checkout opens again. */

const reopenDelayMs = 700;

function TokenBadge({ token }: { token: SampleToken }): React.JSX.Element {
  return (
    <span className="checkout-token" data-token={token.symbol} aria-hidden="true">
      {token.symbol === 'JPYC' ? '¥' : '$'}
    </span>
  );
}

function Checkout(): React.JSX.Element {
  const [run, setRun] = React.useState(0);
  const [open, setOpen] = React.useState(true);
  const finish = React.useCallback(() => setOpen(false), []);
  React.useEffect(() => {
    if (open) return;
    return schedulePlayback(() => {
      setRun((value) => value + 1);
      setOpen(true);
    }, reopenDelayMs);
  }, [open]);
  return open ? <CheckoutReview key={run} onFinish={finish} /> : <></>;
}

function CheckoutReview({ onFinish }: { onFinish: () => void }): React.JSX.Element | null {
  const [session, setSession] = React.useState<CheckoutSession | null>(null);
  const [delivery, setDelivery] = React.useState<Delivery>('standard');
  const [token, setToken] = React.useState<SampleToken>(paymentTokens[0]);
  React.useEffect(() => {
    const next = new CheckoutSession(onFinish);
    setSession(next);
    return next.dispose;
  }, [onFinish]);
  if (!session) return null;
  const choice: CheckoutChoice = { token, delivery };
  return createPortal(
    <section
      className="seams-transaction-review-content checkout-review"
      aria-labelledby="checkout-title"
      ref={session.observe}
    >
      <div className="checkout-heading">
        <h2 id="checkout-title">{t('checkoutTitle')}</h2>
        <span className="checkout-eyebrow">
          {shop.name} · {t('orderNumber').replaceAll('{order}', shop.order)}
        </span>
      </div>
      <CheckoutPanel
        choice={choice}
        onDelivery={setDelivery}
        onToken={setToken}
        controls={{
          continueToWallet: () => session.continueToWallet(choice),
          cancel: session.cancel,
          fail: session.fail,
        }}
      />
    </section>,
    session.slot,
  );
}

function CheckoutPanel({
  choice,
  onDelivery,
  onToken,
  controls,
}: {
  choice: CheckoutChoice;
  onDelivery: (delivery: Delivery) => void;
  onToken: (token: SampleToken) => void;
  controls: TransactionReviewControls;
}): React.JSX.Element {
  const total = totalCents(choice.delivery);
  return (
    <>
      <ul className="checkout-items" aria-label={t('yourCart')}>
        {cart.map((item) => (
          <li key={item.id}>
            <img src={item.thumb} alt="" width={44} height={44} />
            <span>
              {t('productBaumkuchen')}
              <small>{item.flavor} · ×1</small>
            </span>
            <span>{formatPrice(item.cents)}</span>
          </li>
        ))}
      </ul>
      <dl className="checkout-ship">
        <dt>{t('shipTo')}</dt>
        <dd>
          {t('sampleCustomer')}
          <small>{t('sampleAddress')}</small>
        </dd>
      </dl>
      <fieldset className="checkout-choices">
        <legend>{t('delivery')}</legend>
        <label>
          <input
            type="radio"
            name="checkout-delivery"
            checked={choice.delivery === 'standard'}
            onChange={() => onDelivery('standard')}
          />
          <span>
            {t('standardDelivery')}
            <small>{t('standardDays')}</small>
          </span>
          <strong>{t('free')}</strong>
        </label>
        <label>
          <input
            type="radio"
            name="checkout-delivery"
            checked={choice.delivery === 'express'}
            onChange={() => onDelivery('express')}
          />
          <span>
            {t('expressDelivery')}
            <small>{t('expressDays')}</small>
          </span>
          <strong>{formatPrice(expressCents)}</strong>
        </label>
      </fieldset>
      <fieldset className="checkout-choices">
        <legend>{t('payFromWallet')}</legend>
        {paymentTokens.map((option) => (
          <label key={option.id}>
            <input
              type="radio"
              name="checkout-token"
              checked={choice.token.id === option.id}
              onChange={() => onToken(option)}
            />
            <TokenBadge token={option} />
            <span>
              {option.symbol}{' '}
              <span className="checkout-network">
                {t('onNetwork').replaceAll('{network}', option.network)}
              </span>
              <small>{t('balance').replaceAll('{amount}', formatBalance(option))}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <dl className="checkout-totals">
        <dt>{t('subtotal')}</dt>
        <dd>{formatPrice(subtotalCents())}</dd>
        <dt>{t('shipping')}</dt>
        <dd>{choice.delivery === 'express' ? formatPrice(expressCents) : t('free')}</dd>
        <dt>{t('networkFee')}</dt>
        <dd>{t('paidByShop').replaceAll('{shop}', shop.name)}</dd>
        <dt className="checkout-total">{t('total')}</dt>
        <dd className="checkout-total">{formatTokenAmount(choice.token, total)}</dd>
      </dl>
      <button className="checkout-confirm" type="button" onClick={controls.continueToWallet}>
        <span>{t('payTotal').replaceAll('{amount}', formatTokenAmount(choice.token, total))}</span>
        <span aria-hidden="true">→</span>
      </button>
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<Checkout />);

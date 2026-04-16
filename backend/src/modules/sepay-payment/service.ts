import {
  AbstractPaymentProvider,
  PaymentSessionStatus,
} from '@medusajs/framework/utils'
import {
  CreatePaymentProviderSession,
  PaymentProviderError,
  PaymentProviderSessionResponse,
  UpdatePaymentProviderSession,
  ProviderWebhookPayload,
  WebhookActionResult,
} from '@medusajs/framework/types'
import { Logger } from '@medusajs/framework/types'

type InjectedDependencies = {
  logger: Logger
}

export interface SepayPaymentProviderOptions {
  bank?: string
  accountNumber?: string
  apiToken?: string
  apiUrl?: string
}

/**
 * SePay payment provider for bank-transfer QR payments.
 * Payment confirmation is handled via the /store/sepay/webhook endpoint.
 */
class SepayPaymentProviderService extends AbstractPaymentProvider<SepayPaymentProviderOptions> {
  static identifier = 'sepay'

  protected readonly logger_: Logger
  protected readonly bank_: string
  protected readonly accountNumber_: string
  protected readonly apiToken_: string
  protected readonly apiUrl_: string

  constructor(
    { logger }: InjectedDependencies,
    options: SepayPaymentProviderOptions
  ) {
    super({ logger }, options)
    this.logger_ = logger
    this.bank_ = options.bank || 'BIDV'
    this.accountNumber_ = options.accountNumber || ''
    this.apiToken_ = options.apiToken || ''
    this.apiUrl_ = options.apiUrl || 'https://my.sepay.vn/userapi'
  }

  static validateOptions(options: Record<string, unknown>): void {
    // apiToken is recommended but not strictly required at boot time
    // (the webhook route handles validation at runtime)
  }

  async initiatePayment(
    context: CreatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    this.logger_.info(`[SePay] Initiating payment session for amount ${context.amount}`)

    const sessionId = `sepay_${Date.now()}`

    return {
      id: sessionId,
      data: {
        status: 'pending',
        amount: context.amount,
        currency_code: context.currency_code,
        bank: this.bank_,
        account_number: this.accountNumber_,
        session_id: sessionId,
      },
    }
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    _context: Record<string, unknown>
  ): Promise<PaymentProviderError | { status: PaymentSessionStatus; data: Record<string, unknown> }> {
    const status = paymentSessionData?.status as string

    if (status === 'paid') {
      this.logger_.info('[SePay] Payment confirmed via webhook — authorizing')
      return {
        status: PaymentSessionStatus.AUTHORIZED,
        data: { ...paymentSessionData, status: 'authorized' },
      }
    }

    // Payment not yet confirmed — remain pending
    return {
      status: PaymentSessionStatus.PENDING,
      data: paymentSessionData,
    }
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    this.logger_.info('[SePay] Capturing payment')
    return {
      ...paymentSessionData,
      status: 'captured',
    }
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    this.logger_.info('[SePay] Cancelling payment')
    return {
      ...paymentSessionData,
      status: 'cancelled',
    }
  }

  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    this.logger_.info(`[SePay] Refunding payment, amount: ${refundAmount}`)
    return {
      ...paymentSessionData,
      status: 'refunded',
      refund_amount: refundAmount,
    }
  }

  async retrievePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    // Optionally query SePay API to check transaction status
    if (!this.apiToken_ || !this.accountNumber_) {
      return paymentSessionData
    }

    try {
      const response = await fetch(
        `${this.apiUrl_}/transactions/list?account_number=${this.accountNumber_}&limit=5`,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken_}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        this.logger_.warn('[SePay] Failed to retrieve payment status from API')
        return paymentSessionData
      }

      const data = await response.json() as { transactions?: Array<{ transfer_type: string; transaction_content?: string }> }
      const sessionId = paymentSessionData?.session_id as string
      const transactions = data?.transactions || []

      const matched = transactions.find(
        (tx) =>
          tx.transfer_type === 'in' &&
          tx.transaction_content?.toUpperCase().includes(sessionId?.toUpperCase())
      )

      if (matched) {
        return { ...paymentSessionData, status: 'paid' }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger_.warn(`[SePay] Error retrieving payment: ${message}`)
    }

    return paymentSessionData
  }

  async updatePayment(
    context: UpdatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    return {
      id: (context.data?.id as string) ?? `sepay_${Date.now()}`,
      data: {
        ...context.data,
        amount: context.amount,
        currency_code: context.currency_code,
      },
    }
  }

  async deletePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    return paymentSessionData
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    const status = paymentSessionData?.status as string
    switch (status) {
      case 'captured':
        return PaymentSessionStatus.CAPTURED
      case 'cancelled':
        return PaymentSessionStatus.CANCELED
      case 'authorized':
        return PaymentSessionStatus.AUTHORIZED
      case 'paid':
        return PaymentSessionStatus.AUTHORIZED
      default:
        return PaymentSessionStatus.PENDING
    }
  }

  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload['payload']
  ): Promise<WebhookActionResult> {
    // SePay webhooks are handled by the custom /store/sepay/webhook route
    return { action: 'not_supported' }
  }
}

export default SepayPaymentProviderService

import {
  AbstractPaymentProvider,
  MedusaError,
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

/**
 * Cash on Delivery (COD) payment provider.
 * Payments are collected in cash upon delivery — no external API calls needed.
 */
class CodPaymentProviderService extends AbstractPaymentProvider<Record<string, never>> {
  static identifier = 'cod'

  protected readonly logger_: Logger

  constructor({ logger }: InjectedDependencies, options: Record<string, never>) {
    super({ logger }, options)
    this.logger_ = logger
  }

  static validateOptions(_options: Record<string, unknown>): void {
    // No required options for COD
  }

  async initiatePayment(
    context: CreatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    this.logger_.info(`[COD] Initiating payment session for amount ${context.amount}`)
    return {
      id: `cod_${Date.now()}`,
      data: {
        status: 'pending',
        amount: context.amount,
        currency_code: context.currency_code,
      },
    }
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    _context: Record<string, unknown>
  ): Promise<PaymentProviderError | { status: PaymentSessionStatus; data: Record<string, unknown> }> {
    this.logger_.info('[COD] Authorizing payment — cash collected on delivery')
    return {
      status: PaymentSessionStatus.AUTHORIZED,
      data: {
        ...paymentSessionData,
        status: 'authorized',
      },
    }
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    this.logger_.info('[COD] Capturing COD payment')
    return {
      ...paymentSessionData,
      status: 'captured',
    }
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    this.logger_.info('[COD] Cancelling COD payment')
    return {
      ...paymentSessionData,
      status: 'cancelled',
    }
  }

  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    this.logger_.info(`[COD] Refunding COD payment, amount: ${refundAmount}`)
    return {
      ...paymentSessionData,
      status: 'refunded',
      refund_amount: refundAmount,
    }
  }

  async retrievePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    return paymentSessionData
  }

  async updatePayment(
    context: UpdatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    return {
      id: (context.data?.id as string) ?? `cod_${Date.now()}`,
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
      default:
        return PaymentSessionStatus.PENDING
    }
  }

  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload['payload']
  ): Promise<WebhookActionResult> {
    return { action: 'not_supported' }
  }
}

export default CodPaymentProviderService

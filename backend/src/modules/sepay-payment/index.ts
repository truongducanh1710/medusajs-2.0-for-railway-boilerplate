import { AbstractPaymentProvider, PaymentSessionStatus } from "@medusajs/framework/utils"

class SepayPaymentProvider extends AbstractPaymentProvider {
  static identifier = "sepay"

  private apiToken: string
  private accountNumber: string
  private bank: string
  private apiUrl: string

  constructor(container, config) {
    super(container, config)
    this.apiToken = config.apiToken
    this.accountNumber = config.accountNumber
    this.bank = config.bank
    this.apiUrl = config.apiUrl
  }

  async initiatePayment(input) {
    const { amount, currency_code, resource_id } = input

    try {
      // Generate QR code via Sepay API
      const response = await fetch(`${this.apiUrl}/qr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-token': this.apiToken
        },
        body: JSON.stringify({
          account_number: this.accountNumber,
          bank: this.bank,
          amount: Math.round(amount / 100), // Convert cents to VND
          content: `Payment for order ${resource_id}`,
          template: 'compact'
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to generate QR')
      }

      return {
        id: `sepay_${Date.now()}`,
        data: {
          qrUrl: data.qrDataURL,
          bank: this.bank,
          accountNumber: this.accountNumber,
          amount: Math.round(amount / 100),
          content: `Payment for order ${resource_id}`
        }
      }
    } catch (error) {
      throw new Error(`Sepay payment initiation failed: ${error.message}`)
    }
  }

  async getWebhookActionAndData(data) {
    // Handle webhook from Sepay if needed
    return {
      action: "not_supported",
      data: {}
    }
  }

  async authorizePayment(input) {
    // For Sepay, authorization is handled via polling in frontend
    return {
      data: {
        ...input.data,
        status: PaymentSessionStatus.AUTHORIZED
      }
    }
  }

  async capturePayment(input) {
    return {
      data: {
        ...input.data,
        status: PaymentSessionStatus.CAPTURED
      }
    }
  }

  async cancelPayment(input) {
    return {
      data: {
        ...input.data,
        status: PaymentSessionStatus.CANCELED
      }
    }
  }

  async deletePayment(input) {
    return {
      data: {
        ...input.data,
        status: PaymentSessionStatus.CANCELED
      }
    }
  }

  async getPaymentStatus(input) {
    return {
      data: input.data,
      status: PaymentSessionStatus.PENDING
    }
  }

  async refundPayment(input) {
    throw new Error("Refunds not supported by Sepay")
  }

  async retrievePayment(input) {
    return {
      data: input.data
    }
  }

  async updatePayment(input) {
    return {
      data: input.data
    }
  }
}

export default SepayPaymentProvider
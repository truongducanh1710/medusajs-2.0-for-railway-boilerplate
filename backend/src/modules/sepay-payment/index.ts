import { AbstractPaymentProvider, PaymentSessionStatus } from "@medusajs/framework/utils"

class SepayPaymentProvider extends AbstractPaymentProvider {
  static identifier = "sepay"

  private accountNumber: string
  private bank: string

  constructor(container, config) {
    super(container, config)
    this.accountNumber = config.accountNumber
    this.bank = config.bank
  }

  async initiatePayment(input) {
    const { amount, resource_id } = input
    const normalizedAmount = Math.round(Number(amount) || 0)
    const content = `Payment for order ${resource_id}`
    const qrUrl =
      `https://img.vietqr.io/image/${this.bank}-${this.accountNumber}-compact2.png` +
      `?amount=${normalizedAmount}` +
      `&addInfo=${encodeURIComponent(content)}` +
      `&accountName=${encodeURIComponent("PHAN VIET")}`

    return {
      id: `sepay_${Date.now()}`,
      data: {
        qrUrl,
        bank: this.bank,
        accountNumber: this.accountNumber,
        amount: normalizedAmount,
        content,
        accountName: "PHAN VIET",
      },
    }
  }

  async getWebhookActionAndData(data) {
    // Handle webhook from Sepay if needed
    return {
      action: "not_supported" as any,
      data: {
        session_id: "",
        amount: 0
      }
    }
  }

  async authorizePayment(input) {
    // For Sepay, authorization is handled via polling in frontend
    return {
      data: input.data,
      status: PaymentSessionStatus.AUTHORIZED
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
    return {
      data: input.data
    }
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

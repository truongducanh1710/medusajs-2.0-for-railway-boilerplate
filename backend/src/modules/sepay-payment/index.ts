import { AbstractPaymentProvider, PaymentProviderError, PaymentProviderSessionResponse, PaymentSessionStatus } from "@medusajs/framework/utils"

class SepayPaymentProvider extends AbstractPaymentProvider {
  static identifier = "sepay"

  constructor(container, config) {
    super(container, config)
    this.apiToken = config.apiToken
    this.accountNumber = config.accountNumber
    this.bank = config.bank
    this.apiUrl = config.apiUrl
  }

  async initiatePayment(context) {
    const { amount, currency_code, resource_id } = context

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
        success: true,
        data: {
          id: `sepay_${Date.now()}`,
          status: PaymentSessionStatus.PENDING,
          data: {
            qrUrl: data.qrDataURL,
            bank: this.bank,
            accountNumber: this.accountNumber,
            amount: Math.round(amount / 100),
            content: `Payment for order ${resource_id}`
          }
        }
      }
    } catch (error) {
      throw new PaymentProviderError(
        `Sepay payment initiation failed: ${error.message}`,
        error
      )
    }
  }

  async authorizePayment(paymentSessionData, context) {
    // For Sepay, authorization is handled via polling in frontend
    // This would be called when payment is confirmed
    return {
      success: true,
      data: {
        ...paymentSessionData,
        status: PaymentSessionStatus.AUTHORIZED
      }
    }
  }

  async capturePayment(paymentSessionData) {
    // Capture the payment
    return {
      success: true,
      data: {
        ...paymentSessionData,
        status: PaymentSessionStatus.CAPTURED
      }
    }
  }

  async cancelPayment(paymentSessionData) {
    return {
      success: true,
      data: {
        ...paymentSessionData,
        status: PaymentSessionStatus.CANCELED
      }
    }
  }

  async deletePayment(paymentSessionData) {
    return {
      success: true,
      data: {
        ...paymentSessionData,
        status: PaymentSessionStatus.CANCELED
      }
    }
  }

  async getPaymentStatus(paymentSessionData) {
    // In a real implementation, you might poll Sepay API for status
    // For now, return current status
    return {
      success: true,
      data: paymentSessionData
    }
  }

  async refundPayment(paymentSessionData, refundAmount) {
    throw new PaymentProviderError("Refunds not supported by Sepay")
  }

  async retrievePayment(paymentSessionData) {
    return {
      success: true,
      data: paymentSessionData
    }
  }

  async updatePayment(paymentSessionData, context) {
    return {
      success: true,
      data: paymentSessionData
    }
  }

  async getPaymentData(sessionId) {
    // Retrieve payment data from your storage if needed
    return {}
  }
}

export default SepayPaymentProvider
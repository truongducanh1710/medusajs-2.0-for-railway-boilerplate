import { ModuleProviderExports } from '@medusajs/framework/types'
import CodPaymentProviderService from './service'

const services = [CodPaymentProviderService]

const providerExport: ModuleProviderExports = {
  services,
}

export default providerExport

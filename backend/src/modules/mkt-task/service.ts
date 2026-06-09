import { MedusaService } from "@medusajs/framework/utils"
import MktTask from "./models/mkt-task"
import MktChannel from "./models/mkt-channel"
import MktMessage from "./models/mkt-message"

class MktTaskModuleService extends MedusaService({ MktTask, MktChannel, MktMessage }) {}

export default MktTaskModuleService

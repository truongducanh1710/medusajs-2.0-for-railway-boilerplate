import { MedusaService } from "@medusajs/framework/utils"
import MktTask from "./models/mkt-task"
import MktChannel from "./models/mkt-channel"
import MktMessage from "./models/mkt-message"
import MktPresenceSession from "./models/mkt-presence-session"

class MktTaskModuleService extends MedusaService({ MktTask, MktChannel, MktMessage, MktPresenceSession }) {}

export default MktTaskModuleService

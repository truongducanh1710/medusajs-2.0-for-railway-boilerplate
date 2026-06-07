import { Module } from "@medusajs/framework/utils"
import FacebookChatService from "./service"

export const FACEBOOK_CHAT_MODULE = "facebookChatModule"

export default Module(FACEBOOK_CHAT_MODULE, {
  service: FacebookChatService,
})

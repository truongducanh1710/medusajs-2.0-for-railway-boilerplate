import { Metadata } from "next"

import LoginTemplate from "@modules/account/templates/login-template"

export const metadata: Metadata = {
  title: "Đăng nhập",
  description: "Đăng nhập vào tài khoản Phan Viet Store của bạn.",
}

export default function Login() {
  return <LoginTemplate />
}

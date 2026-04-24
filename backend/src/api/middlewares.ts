import { defineMiddlewares } from "@medusajs/framework/http"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/product-content",
      method: ["POST"],
      bodyParser: {
        sizeLimit: "100mb",
      },
    },
  ],
})

import { getAuth } from "@clerk/express";
import { GetNotificationDeliveryStatusResponse } from "@workspace/api-zod";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/notifications/delivery-status", (req, res) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to view notification delivery settings." });
    return;
  }

  res.json(
    GetNotificationDeliveryStatusResponse.parse({
      emailConfigured: Boolean(process.env.RESEND_FROM_EMAIL && process.env.RESEND_API_KEY),
      pushConfigured:
        Boolean(process.env.ONESIGNAL_APP_ID) &&
        Boolean(process.env.ONESIGNAL_REST_API_KEY) &&
        process.env.ONESIGNAL_API_READY === "true",
    }),
  );
});

export default router;

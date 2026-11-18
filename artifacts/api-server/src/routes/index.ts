import { Router, type IRouter } from "express";
import healthRouter from "./health";
import semesterRouter from "./semester";
import syllabiRouter from "./syllabi";
import calendarRouter from "./calendar";
import notificationDeliveryRouter from "./notification-delivery";

const router: IRouter = Router();

router.use(healthRouter);
router.use(semesterRouter);
router.use(syllabiRouter);
router.use(calendarRouter);
router.use(notificationDeliveryRouter);

export default router;

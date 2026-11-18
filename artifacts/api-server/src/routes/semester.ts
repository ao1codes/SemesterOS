import { clerkClient, getAuth } from "@clerk/express";
import { StateConflict, stateRevision } from "../lib/state-revision";
import { semesterValidationError } from "../lib/semester-validation";
import {
  SaveSemesterStateBody,
  SaveSemesterStateResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import {
  deleteSemesterState,
  emptySemesterState,
  readSemesterState,
  saveSemesterState,
} from "../lib/semester-store";

const router: IRouter = Router();

router.get("/semester-state", async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to save your semester." });
    return;
  }

  try {
    const state = await readSemesterState(userId, emptySemesterState);
    res.setHeader("Cache-Control","no-store");
    res.json({...state, revision:stateRevision(state)});
  } catch (error) {
    next(error);
  }
});

router.put("/semester-state", async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to save your semester." });
    return;
  }

  const parsed = SaveSemesterStateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Semester data is invalid." });
    return;
  }

  try {
    const state = SaveSemesterStateResponse.parse(parsed.data);
    const invalid=semesterValidationError(state);
    if(invalid){res.status(400).json({error:invalid});return;}
    await saveSemesterState(userId, state);
    res.json({...state, revision:stateRevision(state)});
  } catch (error) {
    if (error instanceof StateConflict) {res.status(409).json({error:error.message});return;}
    next(error);
  }
});

router.delete("/account", async (req,res,next)=>{
  const userId = getAuth(req).userId;
  if (!userId) {res.status(401).json({error:"Sign in to delete your account."});return;}
  try {
    // Remove application data first. If the identity provider fails, the user can safely retry.
    await deleteSemesterState(userId);
    await clerkClient.users.deleteUser(userId);
    res.status(204).end();
  } catch (error) {next(error);}
});

router.delete("/semester-state", async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to delete your saved semester." });
    return;
  }

  try {
    await deleteSemesterState(userId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;

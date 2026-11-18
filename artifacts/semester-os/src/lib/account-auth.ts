import { useAuth as useClerkAuth, useUser as useClerkUser, useClerk as useClerkClient } from "@clerk/react";

export const clerkKey = import.meta.env.VITE_CLERK_MODE === "disabled"
  ? ""
  : import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "";

// Configuration cannot change during a page lifetime. Do not mount Clerk or run
// its hooks at all in a keyless demo (no fake user, session, or private API calls).
export function useAuth() {
  if (!clerkKey) return { isLoaded: true, isSignedIn: false, userId:null, getToken: async () => null };
  return useClerkAuth();
}
export function useUser() {
  if (!clerkKey) return { user: null };
  return useClerkUser();
}
export function useClerk(): Pick<ReturnType<typeof useClerkClient>, "signOut" | "addListener"> {
  if (!clerkKey) return { signOut: async () => {}, addListener: () => () => {} };
  return useClerkClient();
}

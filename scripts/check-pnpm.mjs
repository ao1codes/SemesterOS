if (!process.env.npm_config_user_agent?.startsWith("pnpm/")) {
  console.error("Use pnpm 10: corepack pnpm install");
  process.exit(1);
}

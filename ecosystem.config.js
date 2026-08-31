module.exports = {
  apps: [
    {
      name: "pepeshops-web",
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${process.env.PORT || 3000} -H 0.0.0.0`,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "pepeshops-worker",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "worker/index.ts",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

#!/usr/bin/env node

/**
 * Production Process Supervisor for PepeShops
 * Runs both Next.js Web Server and Background Polling Worker concurrently in a single container.
 * Perfect for Nixpacks, Railway, Coolify, Zeabur, Render, Dokku, Docker, etc.
 */

const { spawn, execSync } = require("child_process");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const port = process.env.PORT || "3000";

console.log("═════════════════════════════════════════════════════════");
console.log("  🚀 Starting PepeShops Production Engine (Nixpacks)");
console.log("═════════════════════════════════════════════════════════");
console.log(`  Target Port: ${port}`);
console.log(`  Environment: ${process.env.NODE_ENV || "production"}`);
console.log("═════════════════════════════════════════════════════════\n");

// 1. Sync Database Schema & Generate Client (if DATABASE_URL is available)
if (process.env.DATABASE_URL) {
  try {
    console.log("📦 Checking & syncing database schema...");
    execSync("npx prisma db push --skip-generate", {
      cwd: rootDir,
      stdio: "inherit",
      env: process.env,
    });
    console.log("✅ Database schema is up to date.\n");
  } catch (err) {
    console.warn("⚠️ Database push warning (continuing startup):", err.message);
  }
}

// Helper to prefix output
function pipeOutput(child, prefix, colorCode = "36") {
  child.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        console.log(`\x1b[${colorCode}m[${prefix}]\x1b[0m ${line}`);
      }
    }
  });

  child.stderr.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        console.error(`\x1b[31m[${prefix}:ERR]\x1b[0m ${line}`);
      }
    }
  });
}

// 2. Start Next.js Web Server
console.log(`🌐 Starting Next.js Web Server on 0.0.0.0:${port}...`);
const webProcess = spawn(
  "node",
  ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "0.0.0.0"],
  {
    cwd: rootDir,
    env: { ...process.env, NODE_ENV: "production", PORT: port },
  }
);
pipeOutput(webProcess, "WEB", "32"); // Green

// 3. Start Background Polling Worker & Scheduler
console.log("⚙️ Starting Background Polling Worker & Scheduler...");
let workerProcess = null;

function startWorker() {
  workerProcess = spawn(
    "npx",
    ["tsx", "worker/index.ts"],
    {
      cwd: rootDir,
      env: { ...process.env, NODE_ENV: "production" },
    }
  );
  pipeOutput(workerProcess, "WORKER", "35"); // Magenta

  workerProcess.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.warn(`⚠️ Worker exited with code ${code} / signal ${signal}. Restarting in 3 seconds...`);
      setTimeout(startWorker, 3000);
    }
  });
}

startWorker();

// 4. Graceful Shutdown Handling
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n🛑 Received ${signal}. Shutting down all processes cleanly...`);

  if (webProcess) {
    webProcess.kill("SIGTERM");
  }
  if (workerProcess) {
    workerProcess.kill("SIGTERM");
  }

  setTimeout(() => {
    console.log("Force exiting...");
    process.exit(0);
  }, 4000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

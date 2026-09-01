const nextJest = require("next/jest");

// next/jest wires up SWC transforms + the "@/*" path alias automatically —
// same reason to prefer it over hand-rolled ts-jest config as everywhere
// else in this migration: fewer moving parts to keep in sync by hand.
const createJestConfig = nextJest({ dir: "./" });

const customJestConfig = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  // class-validator/class-transformer decorators read Reflect metadata at
  // module-load time, before any individual test file's own imports run.
  setupFiles: ["reflect-metadata"],
};

module.exports = createJestConfig(customJestConfig);

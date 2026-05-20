/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@fluxboard/domain$": "<rootDir>/../packages/domain/src/index.ts",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tests/tsconfig.json" }],
  },
};

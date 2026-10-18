module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "@swc/jest",
      { jsc: { target: "es2022" }, module: { type: "commonjs" } },
    ],
  },
  testMatch: ["**/src/api/admin/cham-cong/__tests__/**/*.spec.ts"],
  moduleFileExtensions: ["ts", "tsx", "js"],
};

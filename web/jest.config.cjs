module.exports = {
  testEnvironment: "jest-environment-jsdom",
  transform: { "^.+\\.[jt]sx?$": "babel-jest" },
  moduleNameMapper: { "\\.(css|less|scss)$": "identity-obj-proxy" },
  testMatch: ["**/__tests__/**/*.test.[jt]s?(x)"],
};